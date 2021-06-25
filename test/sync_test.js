const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { BloomFilter } = require('../backend/sync')
const { decodeChangeMeta } = require('../backend/columnar')
const { decodeSyncMessage, encodeSyncMessage, decodeSyncState, encodeSyncState, initSyncState } = Automerge.Backend

function getHeads(doc) {
  return Automerge.Backend.getHeads(Automerge.Frontend.getBackendState(doc))
}

function getMissingDeps(doc) {
  return Automerge.Backend.getMissingDeps(Automerge.Frontend.getBackendState(doc))
}

function sync(a, b, aSyncState = initSyncState(), bSyncState = initSyncState()) {
  const MAX_ITER = 10
  let aToBmsg = null, bToAmsg = null, i = 0
  do {
    [aSyncState, aToBmsg] = Automerge.generateSyncMessage(a, aSyncState)
    ;[bSyncState, bToAmsg] = Automerge.generateSyncMessage(b, bSyncState)

    if (aToBmsg) {
      [b, bSyncState] = Automerge.receiveSyncMessage(b, bSyncState, aToBmsg)
    }
    if (bToAmsg) {
      [a, aSyncState] = Automerge.receiveSyncMessage(a, aSyncState, bToAmsg)
    }

    if (i++ > MAX_ITER) {
      throw new Error(`Did not synchronize within ${MAX_ITER} iterations. Do you have a bug causing an infinite loop?`)
    }
  } while (aToBmsg || bToAmsg)

  return [a, b, aSyncState, bSyncState]
}

describe('Data sync protocol', () => {
  describe('with docs already in sync', () => {
    describe('an empty local doc', () => {
      it('should send a sync message implying no local data', () => {
        let n1 = Automerge.init()
        let s1 = initSyncState()
        let m1
        ;[s1, m1] = Automerge.generateSyncMessage(n1, s1)
        const message = decodeSyncMessage(m1)
        assert.deepStrictEqual(message.heads, [])
        assert.deepStrictEqual(message.need, [])
        assert.deepStrictEqual(message.have.length, 1)
        assert.deepStrictEqual(message.have[0].lastSync, [])
        assert.deepStrictEqual(message.have[0].bloom.byteLength, 0)
        assert.deepStrictEqual(message.changes, [])
      })

      it('should not reply if we have no data as well', () => {
        let n1 = Automerge.init(), n2 = Automerge.init()
        let s1 = initSyncState(), s2 = initSyncState()
        let m1 = null, m2 = null
        ;[s1, m1] = Automerge.generateSyncMessage(n1, s1)
        ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, m1)
        ;[s2, m2] = Automerge.generateSyncMessage(n2, s2)
        assert.deepStrictEqual(m2, null)
      })
    })

    describe('documents with data', () => {
      it('repos with equal heads do not need a reply message', () => {
        let n1 = Automerge.init(), n2 = Automerge.init()
        let s1 = initSyncState(), s2 = initSyncState()
        let m1 = null, m2 = null

        // make two nodes with the same changes
        n1 = Automerge.change(n1, {time: 0}, doc => doc.n = [])
        for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.n.push(i))
        ;[n2] = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
        assert.deepStrictEqual(n1, n2)

        // generate a naive sync message
        ;[s1, m1] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(s1.lastSentHeads, getHeads(n1))

        // heads are equal so this message should be null
        ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, m1)
        ;[s2, m2] = Automerge.generateSyncMessage(n2, s2)
        assert.strictEqual(m2, null)
      })

      it('n1 should offer all changes to n2 when starting from nothing', () => {
        let n1 = Automerge.init(), n2 = Automerge.init()

        // make changes for n1 that n2 should request
        n1 = Automerge.change(n1, {time: 0}, doc => doc.n = [])
        for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.n.push(i))

        assert.notDeepStrictEqual(n1, n2)
        const [after1, after2] = sync(n1, n2)
        assert.deepStrictEqual(after1, after2)
      })

      it('should sync peers where one has commits the other does not', () => {
        let n1 = Automerge.init(), n2 = Automerge.init()

        // make changes for n1 that n2 should request
        n1 = Automerge.change(n1, {time: 0}, doc => doc.n = [])
        for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.n.push(i))

        assert.notDeepStrictEqual(n1, n2)
        ;[n1, n2] = sync(n1, n2)
        assert.deepStrictEqual(n1, n2)
      })

      it('should work with prior sync state', () => {
        // create & synchronize two nodes
        let n1 = Automerge.init(), n2 = Automerge.init()
        let s1 = initSyncState(), s2 = initSyncState()

        for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
        ;[n1, n2, s1, s2] = sync(n1, n2)

        // modify the first node further
        for (let i = 5; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)

        assert.notDeepStrictEqual(n1, n2)
        ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
        assert.deepStrictEqual(n1, n2)
      })

      it('should not generate messages once synced', () => {
        // create & synchronize two nodes
        let n1 = Automerge.init('abc123'), n2 = Automerge.init('def456')
        let s1 = initSyncState(), s2 = initSyncState()

        let message, patch
        for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
        for (let i = 0; i < 5; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.y = i)

        // n1 reports what it has
        ;[s1, message] = Automerge.generateSyncMessage(n1, s1, n1)

        // n2 receives that message and sends changes along with what it has
        ;[n2, s2, patch] = Automerge.receiveSyncMessage(n2, s2, message)
        ;[s2, message] = Automerge.generateSyncMessage(n2, s2)
        assert.deepStrictEqual(decodeSyncMessage(message).changes.length, 5)
        assert.deepStrictEqual(patch, null) // no changes arrived

        // n1 receives the changes and replies with the changes it now knows n2 needs
        ;[n1, s1, patch] = Automerge.receiveSyncMessage(n1, s1, message)
        ;[s1, message] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(decodeSyncMessage(message).changes.length, 5)
        assert.deepStrictEqual(patch.diffs.props, {y: {'5@def456': {type: 'value', value: 4, datatype: 'int'}}}) // changes arrived

        // n2 applies the changes and sends confirmation ending the exchange
        ;[n2, s2, patch] = Automerge.receiveSyncMessage(n2, s2, message)
        ;[s2, message] = Automerge.generateSyncMessage(n2, s2)
        assert.deepStrictEqual(patch.diffs.props, {x: {'5@abc123': {type: 'value', value: 4, datatype: 'int'}}}) // changes arrived

        // n1 receives the message and has nothing more to say
        ;[n1, s1, patch] = Automerge.receiveSyncMessage(n1, s1, message)
        ;[s1, message] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(message, null)
        assert.deepStrictEqual(patch, null) // no changes arrived

        // n2 also has nothing left to say
        ;[s2, message] = Automerge.generateSyncMessage(n2, s2)
        assert.deepStrictEqual(message, null)
      })

      it('should allow simultaneous messages during synchronization', () => {
        // create & synchronize two nodes
        let n1 = Automerge.init('abc123'), n2 = Automerge.init('def456')
        let s1 = initSyncState(), s2 = initSyncState()
        for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
        for (let i = 0; i < 5; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.y = i)
        const head1 = getHeads(n1)[0], head2 = getHeads(n2)[0]

        // both sides report what they have but have no shared peer state
        let msg1to2, msg2to1
        ;[s1, msg1to2] = Automerge.generateSyncMessage(n1, s1)
        ;[s2, msg2to1] = Automerge.generateSyncMessage(n2, s2)
        assert.deepStrictEqual(decodeSyncMessage(msg1to2).changes.length, 0)
        assert.deepStrictEqual(decodeSyncMessage(msg1to2).have[0].lastSync.length, 0)
        assert.deepStrictEqual(decodeSyncMessage(msg2to1).changes.length, 0)
        assert.deepStrictEqual(decodeSyncMessage(msg2to1).have[0].lastSync.length, 0)

        // n1 and n2 receives that message and update sync state but make no patch
        let patch1, patch2
        ;[n1, s1, patch1] = Automerge.receiveSyncMessage(n1, s1, msg2to1)
        assert.deepStrictEqual(patch1, null) // no changes arrived, so no patch
        ;[n2, s2, patch2] = Automerge.receiveSyncMessage(n2, s2, msg1to2)
        assert.deepStrictEqual(patch2, null) // no changes arrived, so no patch

        // now both reply with their local changes the other lacks
        // (standard warning that 1% of the time this will result in a "need" message)
        ;[s1, msg1to2] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(decodeSyncMessage(msg1to2).changes.length, 5)
        ;[s2, msg2to1] = Automerge.generateSyncMessage(n2, s2)
        assert.deepStrictEqual(decodeSyncMessage(msg2to1).changes.length, 5)

        // both should now apply the changes and update the frontend
        ;[n1, s1, patch1] = Automerge.receiveSyncMessage(n1, s1, msg2to1)
        assert.deepStrictEqual(getMissingDeps(n1), [])
        assert.notDeepStrictEqual(patch1, null)
        assert.deepStrictEqual(n1, {x: 4, y: 4})

        ;[n2, s2, patch2] = Automerge.receiveSyncMessage(n2, s2, msg1to2)
        assert.deepStrictEqual(getMissingDeps(n2), [])
        assert.notDeepStrictEqual(patch2, null)
        assert.deepStrictEqual(n2, {x: 4, y: 4})

        // The response acknowledges the changes received, and sends no further changes
        ;[s1, msg1to2] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(decodeSyncMessage(msg1to2).changes.length, 0)
        ;[s2, msg2to1] = Automerge.generateSyncMessage(n2, s2)
        assert.deepStrictEqual(decodeSyncMessage(msg2to1).changes.length, 0)

        // After receiving acknowledgements, their shared heads should be equal
        ;[n1, s1, patch1] = Automerge.receiveSyncMessage(n1, s1, msg2to1)
        ;[n2, s2, patch2] = Automerge.receiveSyncMessage(n2, s2, msg1to2)
        assert.deepStrictEqual(s1.sharedHeads, [head1, head2].sort())
        assert.deepStrictEqual(s2.sharedHeads, [head1, head2].sort())
        assert.deepStrictEqual(patch1, null)
        assert.deepStrictEqual(patch2, null)

        // We're in sync, no more messages required
        ;[s1, msg1to2] = Automerge.generateSyncMessage(n1, s1)
        ;[s2, msg2to1] = Automerge.generateSyncMessage(n2, s2)
        assert.deepStrictEqual(msg1to2, null)
        assert.deepStrictEqual(msg2to1, null)

        // If we make one more change, and start another sync, its lastSync should be updated
        n1 = Automerge.change(n1, {time: 0}, doc => doc.x = 5)
        ;[s1, msg1to2] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(decodeSyncMessage(msg1to2).have[0].lastSync, [head1, head2].sort())
      })

      it('should assume sent changes were recieved until we hear otherwise', () => {
        let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
        let s1 = initSyncState(), message = null

        n1 = Automerge.change(n1, {time: 0}, doc => doc.items = [])
        ;[n1, n2, s1, /* s2 */] = sync(n1, n2)

        n1 = Automerge.change(n1, {time: 0}, doc => doc.items.push('x'))
        ;[s1, message] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(decodeSyncMessage(message).changes.length, 1)

        n1 = Automerge.change(n1, {time: 0}, doc => doc.items.push('y'))
        ;[s1, message] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(decodeSyncMessage(message).changes.length, 1)

        n1 = Automerge.change(n1, {time: 0}, doc => doc.items.push('z'))
        ;[s1, message] = Automerge.generateSyncMessage(n1, s1)
        assert.deepStrictEqual(decodeSyncMessage(message).changes.length, 1)
      })

      it('should work regardless of who initiates the exchange', () => {
        // create & synchronize two nodes
        let n1 = Automerge.init(), n2 = Automerge.init()
        let s1 = initSyncState(), s2 = initSyncState()

        for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
        ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)

        // modify the first node further
        for (let i = 5; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)

        assert.notDeepStrictEqual(n1, n2)
        ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
        assert.deepStrictEqual(n1, n2)
      })
    })
  })

  describe('with diverged documents', () => {
    it('should work without prior sync state', () => {
      // Scenario:                                                            ,-- c10 <-- c11 <-- c12 <-- c13 <-- c14
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8 <-- c9 <-+
      //                                                                      `-- c15 <-- c16 <-- c17
      // lastSync is undefined.

      // create two peers both with divergent commits
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)

      ;[n1, n2] = sync(n1, n2)

      for (let i = 10; i < 15; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      for (let i = 15; i < 18; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.x = i)

      assert.notDeepStrictEqual(n1, n2)
      ;[n1, n2] = sync(n1, n2)
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)
    })

    it('should work with prior sync state', () => {
      // Scenario:                                                            ,-- c10 <-- c11 <-- c12 <-- c13 <-- c14
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8 <-- c9 <-+
      //                                                                      `-- c15 <-- c16 <-- c17
      // lastSync is c9.

      // create two peers both with divergent commits
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()

      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)

      for (let i = 10; i < 15; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      for (let i = 15; i < 18; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.x = i)
      s1 = decodeSyncState(encodeSyncState(s1))
      s2 = decodeSyncState(encodeSyncState(s2))

      assert.notDeepStrictEqual(n1, n2)
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)
    })

    it('should ensure non-empty state after sync', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()

      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)

      assert.deepStrictEqual(s1.sharedHeads, getHeads(n1))
      assert.deepStrictEqual(s2.sharedHeads, getHeads(n1))
    })

    it('should re-sync after one node crashed with data loss', () => {
      // Scenario:     (r)                  (n2)                 (n1)
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8
      // n2 has changes {c0, c1, c2}, n1's lastSync is c5, and n2's lastSync is c2.
      // we want to successfully sync (n1) with (r), even though (n1) believes it's talking to (n2)
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()

      // n1 makes three changes, which we sync to n2
      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)

      // save a copy of n2 as "r" to simulate recovering from crash
      let r, rSyncState
      ;[r, rSyncState] = [Automerge.clone(n2), s2]

      // sync another few commits
      for (let i = 3; i < 6; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
      // everyone should be on the same page here
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)

      // now make a few more changes, then attempt to sync the fully-up-to-date n1 with the confused r
      for (let i = 6; i < 9; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      s1 = decodeSyncState(encodeSyncState(s1))
      rSyncState = decodeSyncState(encodeSyncState(rSyncState))

      assert.notDeepStrictEqual(getHeads(n1), getHeads(r))
      assert.notDeepStrictEqual(n1, r)
      assert.deepStrictEqual(n1, {x: 8})
      assert.deepStrictEqual(r, {x: 2})
      ;[n1, r, s1, rSyncState] = sync(n1, r, s1, rSyncState)
      assert.deepStrictEqual(getHeads(n1), getHeads(r))
      assert.deepStrictEqual(n1, r)
    })

    it('should resync after one node experiences data loss without disconnecting', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()

      // n1 makes three changes, which we sync to n2
      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)

      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)

      let n2AfterDataLoss = Automerge.init('89abcdef')

      // "n2" now has no data, but n1 still thinks it does. Note we don't do
      // decodeSyncState(encodeSyncState(s1)) in order to simulate data loss without disconnecting
      ;[n1, n2, s1, s2] = sync(n1, n2AfterDataLoss, s1, initSyncState())
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)
    })

    it('should handle changes concurrent to the last sync heads', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef'), n3 = Automerge.init('fedcba98')
      let s12 = initSyncState(), s21 = initSyncState(), s23 = initSyncState(), s32 = initSyncState()

      // Change 1 is known to all three nodes
      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = 1)
      ;[n1, n2, s12, s21] = sync(n1, n2, s12, s21)
      ;[n2, n3, s23, s32] = sync(n2, n3, s23, s32)

      // Change 2 is known to n1 and n2
      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = 2)
      ;[n1, n2, s12, s21] = sync(n1, n2, s12, s21)

      // Each of the three nodes makes one change (changes 3, 4, 5)
      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = 3)
      n2 = Automerge.change(n2, {time: 0}, doc => doc.x = 4)
      n3 = Automerge.change(n3, {time: 0}, doc => doc.x = 5)

      // Apply n3's latest change to n2. If running in Node, turn the Uint8Array into a Buffer, to
      // simulate transmission over a network (see https://github.com/automerge/automerge/pull/362)
      let change = Automerge.getLastLocalChange(n3)
      if (typeof Buffer === 'function') change = Buffer.from(change)
      ;[n2] = Automerge.applyChanges(n2, [change])

      // Now sync n1 and n2. n3's change is concurrent to n1 and n2's last sync heads
      ;[n1, n2, s12, s21] = sync(n1, n2, s12, s21)
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)
    })

    it('should handle histories with lots of branching and merging', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef'), n3 = Automerge.init('fedcba98')
      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = 0)
      ;[n2] = Automerge.applyChanges(n2, [Automerge.getLastLocalChange(n1)])
      ;[n3] = Automerge.applyChanges(n3, [Automerge.getLastLocalChange(n1)])
      n3 = Automerge.change(n3, {time: 0}, doc => doc.x = 1)

      //        - n1c1 <------ n1c2 <------ n1c3 <-- etc. <-- n1c20 <------ n1c21
      //       /          \/           \/                              \/
      //      /           /\           /\                              /\
      // c0 <---- n2c1 <------ n2c2 <------ n2c3 <-- etc. <-- n2c20 <------ n2c21
      //      \                                                          /
      //       ---------------------------------------------- n3c1 <-----
      for (let i = 1; i < 20; i++) {
        n1 = Automerge.change(n1, {time: 0}, doc => doc.n1 = i)
        n2 = Automerge.change(n2, {time: 0}, doc => doc.n2 = i)
        const change1 = Automerge.getLastLocalChange(n1)
        const change2 = Automerge.getLastLocalChange(n2)
        ;[n1] = Automerge.applyChanges(n1, [change2])
        ;[n2] = Automerge.applyChanges(n2, [change1])
      }

      let s1 = initSyncState(), s2 = initSyncState()
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)

      // Having n3's last change concurrent to the last sync heads forces us into the slower code path
      ;[n2] = Automerge.applyChanges(n2, [Automerge.getLastLocalChange(n3)])
      n1 = Automerge.change(n1, {time: 0}, doc => doc.n1 = 'final')
      n2 = Automerge.change(n2, {time: 0}, doc => doc.n2 = 'final')

      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)
    })
  })

  describe('with false positives', () => {
    // NOTE: the following tests use brute force to search for Bloom filter false positives. The
    // tests make change hashes deterministic by fixing the actorId and change timestamp to be
    // constants. The loop that searches for false positives is then initialised such that it finds
    // a false positive on its first iteration. However, if anything changes about the encoding of
    // changes (causing their hashes to change) or if the Bloom filter configuration is changed,
    // then the false positive will no longer be the first loop iteration. The tests should still
    // pass because the loop will run until a false positive is found, but they will be slower.

    it('should handle a false-positive head', () => {
      // Scenario:                                                            ,-- n1
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8 <-- c9 <-+
      //                                                                      `-- n2
      // where n2 is a false positive in the Bloom filter containing {n1}.
      // lastSync is c9.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()

      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2)
      for (let i = 1; ; i++) { // search for false positive; see comment above
        const n1up = Automerge.change(Automerge.clone(n1, {actorId: '01234567'}), {time: 0}, doc => doc.x = `${i} @ n1`)
        const n2up = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        if (new BloomFilter(getHeads(n1up)).containsHash(getHeads(n2up)[0])) {
          n1 = n1up; n2 = n2up; break
        }
      }
      const allHeads = [...getHeads(n1), ...getHeads(n2)].sort()
      s1 = decodeSyncState(encodeSyncState(s1))
      s2 = decodeSyncState(encodeSyncState(s2))
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
      assert.deepStrictEqual(getHeads(n1), allHeads)
      assert.deepStrictEqual(getHeads(n2), allHeads)
    })

    describe('with a false-positive dependency', () => {
      let n1, n2, s1, s2, n1hash2, n2hash2

      beforeEach(() => {
        // Scenario:                                                            ,-- n1c1 <-- n1c2
        // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8 <-- c9 <-+
        //                                                                      `-- n2c1 <-- n2c2
        // where n2c1 is a false positive in the Bloom filter containing {n1c1, n1c2}.
        // lastSync is c9.
        n1 = Automerge.init('01234567')
        n2 = Automerge.init('89abcdef')
        s1 = initSyncState()
        s2 = initSyncState()
        for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
        ;[n1, n2, s1, s2] = sync(n1, n2)

        let n1hash1, n2hash1
        for (let i = 29; ; i++) { // search for false positive; see comment above
          const n1us1 = Automerge.change(Automerge.clone(n1, {actorId: '01234567'}), {time: 0}, doc => doc.x = `${i} @ n1`)
          const n2us1 = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
          n1hash1 = getHeads(n1us1)[0]; n2hash1 = getHeads(n2us1)[0]
          const n1us2 = Automerge.change(n1us1, {time: 0}, doc => doc.x = 'final @ n1')
          const n2us2 = Automerge.change(n2us1, {time: 0}, doc => doc.x = 'final @ n2')
          n1hash2 = getHeads(n1us2)[0]; n2hash2 = getHeads(n2us2)[0]
          if (new BloomFilter([n1hash1, n1hash2]).containsHash(n2hash1)) {
            n1 = n1us2; n2 = n2us2; break
          }
        }
      })

      it('should sync two nodes without connection reset', () => {
        [n1, n2, s1, s2] = sync(n1, n2, s1, s2)
        assert.deepStrictEqual(getHeads(n1), [n1hash2, n2hash2].sort())
        assert.deepStrictEqual(getHeads(n2), [n1hash2, n2hash2].sort())
      })

      it('should sync two nodes with connection reset', () => {
        s1 = decodeSyncState(encodeSyncState(s1))
        s2 = decodeSyncState(encodeSyncState(s2))
        ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
        assert.deepStrictEqual(getHeads(n1), [n1hash2, n2hash2].sort())
        assert.deepStrictEqual(getHeads(n2), [n1hash2, n2hash2].sort())
      })

      it('should sync three nodes', () => {
        s1 = decodeSyncState(encodeSyncState(s1))
        s2 = decodeSyncState(encodeSyncState(s2))

        // First n1 and n2 exchange Bloom filters
        let m1, m2
        ;[s1, m1] = Automerge.generateSyncMessage(n1, s1)
        ;[s2, m2] = Automerge.generateSyncMessage(n2, s2)
        ;[n1, s1] = Automerge.receiveSyncMessage(n1, s1, m2)
        ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, m1)

        // Then n1 and n2 send each other their changes, except for the false positive
        ;[s1, m1] = Automerge.generateSyncMessage(n1, s1)
        ;[s2, m2] = Automerge.generateSyncMessage(n2, s2)
        ;[n1, s1] = Automerge.receiveSyncMessage(n1, s1, m2)
        ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, m1)
        assert.strictEqual(decodeSyncMessage(m1).changes.length, 2) // n1c1 and n1c2
        assert.strictEqual(decodeSyncMessage(m2).changes.length, 1) // only n2c2; change n2c1 is not sent

        // n3 is a node that doesn't have the missing change. Nevertheless n1 is going to ask n3 for it
        let n3 = Automerge.init('fedcba98'), s13 = initSyncState(), s31 = initSyncState()
        ;[n1, n3, s13, s31] = sync(n1, n3, s13, s31)
        assert.deepStrictEqual(getHeads(n1), [n1hash2])
        assert.deepStrictEqual(getHeads(n3), [n1hash2])
      })
    })

    it('should not require an additional request when a false-positive depends on a true-negative', () => {
      // Scenario:                         ,-- n1c1 <-- n1c2 <-- n1c3
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-+
      //                                   `-- n2c1 <-- n2c2 <-- n2c3
      // where n2c2 is a false positive in the Bloom filter containing {n1c1, n1c2, n1c3}.
      // lastSync is c4.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()
      let n1hash3, n2hash3

      for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2)
      for (let i = 86; ; i++) { // search for false positive; see comment above
        const n1us1 = Automerge.change(Automerge.clone(n1, {actorId: '01234567'}), {time: 0}, doc => doc.x = `${i} @ n1`)
        const n2us1 = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        const n1hash1 = getHeads(n1us1)[0]
        const n1us2 = Automerge.change(n1us1, {time: 0}, doc => doc.x = `${i + 1} @ n1`)
        const n2us2 = Automerge.change(n2us1, {time: 0}, doc => doc.x = `${i + 1} @ n2`)
        const n1hash2 = getHeads(n1us2)[0], n2hash2 = getHeads(n2us2)[0]
        const n1up3 = Automerge.change(n1us2, {time: 0}, doc => doc.x = 'final @ n1')
        const n2up3 = Automerge.change(n2us2, {time: 0}, doc => doc.x = 'final @ n2')
        n1hash3 = getHeads(n1up3)[0]; n2hash3 = getHeads(n2up3)[0]
        if (new BloomFilter([n1hash1, n1hash2, n1hash3]).containsHash(n2hash2)) {
          n1 = n1up3; n2 = n2up3; break
        }
      }
      const bothHeads = [n1hash3, n2hash3].sort()
      s1 = decodeSyncState(encodeSyncState(s1))
      s2 = decodeSyncState(encodeSyncState(s2))
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
      assert.deepStrictEqual(getHeads(n1), bothHeads)
      assert.deepStrictEqual(getHeads(n2), bothHeads)
    })

    it('should handle chains of false-positives', () => {
      // Scenario:                         ,-- c5
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-+
      //                                   `-- n2c1 <-- n2c2 <-- n2c3
      // where n2c1 and n2c2 are both false positives in the Bloom filter containing {c5}.
      // lastSync is c4.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()

      for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = 5)
      for (let i = 2; ; i++) { // search for false positive; see comment above
        const n2us1 = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        if (new BloomFilter(getHeads(n1)).containsHash(getHeads(n2us1)[0])) {
          n2 = n2us1; break
        }
      }
      for (let i = 141; ; i++) { // search for false positive; see comment above
        const n2us2 = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} again`)
        if (new BloomFilter(getHeads(n1)).containsHash(getHeads(n2us2)[0])) {
          n2 = n2us2; break
        }
      }
      n2 = Automerge.change(n2, {time: 0}, doc => doc.x = 'final @ n2')

      const allHeads = [...getHeads(n1), ...getHeads(n2)].sort()
      s1 = decodeSyncState(encodeSyncState(s1))
      s2 = decodeSyncState(encodeSyncState(s2))
      ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2)
      assert.deepStrictEqual(getHeads(n1), allHeads)
      assert.deepStrictEqual(getHeads(n2), allHeads)
    })

    it('should allow the false-positive hash to be explicitly requested', () => {
      // Scenario:                                                            ,-- n1
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8 <-- c9 <-+
      //                                                                      `-- n2
      // where n2 causes a false positive in the Bloom filter containing {n1}.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()
      let message

      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, s1, s2] = sync(n1, n2)
      s1 = decodeSyncState(encodeSyncState(s1))
      s2 = decodeSyncState(encodeSyncState(s2))

      for (let i = 1; ; i++) { // brute-force search for false positive; see comment above
        const n1up = Automerge.change(Automerge.clone(n1, {actorId: '01234567'}), {time: 0}, doc => doc.x = `${i} @ n1`)
        const n2up = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        // check if the bloom filter on n2 will believe n1 already has a particular hash
        // this will mean n2 won't offer that data to n2 by receiving a sync message from n1
        if (new BloomFilter(getHeads(n1up)).containsHash(getHeads(n2up)[0])) {
          n1 = n1up; n2 = n2up; break
        }
      }

      // n1 creates a sync message for n2 with an ill-fated bloom
      [s1, message] = Automerge.generateSyncMessage(n1, s1)
      assert.strictEqual(decodeSyncMessage(message).changes.length, 0)

      // n2 receives it and DOESN'T send a change back
      ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, message)
      ;[s2, message] = Automerge.generateSyncMessage(n2, s2)
      assert.strictEqual(decodeSyncMessage(message).changes.length, 0)

      // n1 should now realize it's missing that change and request it explicitly
      ;[n1, s1] = Automerge.receiveSyncMessage(n1, s1, message)
      ;[s1, message] = Automerge.generateSyncMessage(n1, s1)
      assert.deepStrictEqual(decodeSyncMessage(message).need, getHeads(n2))

      // n2 should fulfill that request
      ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, message)
      ;[s2, message] = Automerge.generateSyncMessage(n2, s2)
      assert.strictEqual(decodeSyncMessage(message).changes.length, 1)

      // n1 should apply the change and the two should now be in sync
      ;[n1, s1] = Automerge.receiveSyncMessage(n1, s1, message)
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
    })
  })

  describe('protocol features', () => {
    it('should allow multiple Bloom filters', () => {
      // Scenario:           ,-- n1c1 <-- n1c2 <-- n1c3
      // c0 <-- c1 <-- c2 <-+--- n2c1 <-- n2c2 <-- n2c3
      //                     `-- n3c1 <-- n3c2 <-- n3c3
      // n1 has {c0, c1, c2, n1c1, n1c2, n1c3, n2c1, n2c2};
      // n2 has {c0, c1, c2, n1c1, n1c2, n2c1, n2c2, n2c3};
      // n3 has {c0, c1, c2, n3c1, n3c2, n3c3}.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef'), n3 = Automerge.init('76543210')
      let s13 = initSyncState(), s12 = initSyncState(), s21 = initSyncState()
      let s32 = initSyncState(), s31 = initSyncState(), s23 = initSyncState()
      let message1, message2, message3

      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      // sync all 3 nodes
      ;[n1, n2, s12, s21] = sync(n1, n2) // eslint-disable-line no-unused-vars -- kept for consistency
      ;[n1, n3, s13, s31] = sync(n1, n3)
      ;[n3, n2, s32, s23] = sync(n3, n2)
      for (let i = 0; i < 2; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = `${i} @ n1`)
      for (let i = 0; i < 2; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.x = `${i} @ n2`)
      ;[n1] = Automerge.applyChanges(n1, Automerge.getAllChanges(n2))
      ;[n2] = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = `3 @ n1`)
      n2 = Automerge.change(n2, {time: 0}, doc => doc.x = `3 @ n2`)
      for (let i = 0; i < 3; i++) n3 = Automerge.change(n3, {time: 0}, doc => doc.x = `${i} @ n3`)
      const n1c3 = getHeads(n1)[0], n2c3 = getHeads(n2)[0], n3c3 = getHeads(n3)[0]
      s13 = decodeSyncState(encodeSyncState(s13))
      s31 = decodeSyncState(encodeSyncState(s31))
      s23 = decodeSyncState(encodeSyncState(s23))
      s32 = decodeSyncState(encodeSyncState(s32))

      // Now n3 concurrently syncs with n1 and n2. Doing this naively would result in n3 receiving
      // changes {n1c1, n1c2, n2c1, n2c2} twice (those are the changes that both n1 and n2 have, but
      // that n3 does not have). We want to prevent this duplication.
      ;[s13, message1] = Automerge.generateSyncMessage(n1, s13) // message from n1 to n3
      assert.strictEqual(decodeSyncMessage(message1).changes.length, 0)
      ;[n3, s31] = Automerge.receiveSyncMessage(n3, s31, message1)
      ;[s31, message3] = Automerge.generateSyncMessage(n3, s31) // message from n3 to n1
      assert.strictEqual(decodeSyncMessage(message3).changes.length, 3) // {n3c1, n3c2, n3c3}
      ;[n1, s13] = Automerge.receiveSyncMessage(n1, s13, message3)

      // Copy the Bloom filter received from n1 into the message sent from n3 to n2. This Bloom
      // filter indicates what changes n3 is going to receive from n1.
      ;[s32, message3] = Automerge.generateSyncMessage(n3, s32) // message from n3 to n2
      const modifiedMessage = decodeSyncMessage(message3)
      modifiedMessage.have.push(decodeSyncMessage(message1).have[0])
      assert.strictEqual(modifiedMessage.changes.length, 0)
      ;[n2, s23] = Automerge.receiveSyncMessage(n2, s23, encodeSyncMessage(modifiedMessage))

      // n2 replies to n3, sending only n2c3 (the one change that n2 has but n1 doesn't)
      ;[s23, message2] = Automerge.generateSyncMessage(n2, s23)
      assert.strictEqual(decodeSyncMessage(message2).changes.length, 1) // {n2c3}
      ;[n3, s32] = Automerge.receiveSyncMessage(n3, s32, message2)

      // n1 replies to n3
      ;[s13, message1] = Automerge.generateSyncMessage(n1, s13)
      assert.strictEqual(decodeSyncMessage(message1).changes.length, 5) // {n1c1, n1c2, n1c3, n2c1, n2c2}
      ;[n3, s31] = Automerge.receiveSyncMessage(n3, s31, message1)
      assert.deepStrictEqual(getHeads(n3), [n1c3, n2c3, n3c3].sort())
    })

    it('should allow any change to be requested', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()
      let message = null

      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      const lastSync = getHeads(n1)
      for (let i = 3; i < 6; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)

      ;[n1, n2, s1, s2] = sync(n1, n2)
      s1.lastSentHeads = [] // force generateSyncMessage to return a message even though nothing changed
      ;[s1, message] = Automerge.generateSyncMessage(n1, s1)
      const modMsg = decodeSyncMessage(message)
      modMsg.need = lastSync // re-request change 2
      ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, encodeSyncMessage(modMsg))
      ;[s1, message] = Automerge.generateSyncMessage(n2, s2)
      assert.strictEqual(decodeSyncMessage(message).changes.length, 1)
      assert.strictEqual(Automerge.decodeChange(decodeSyncMessage(message).changes[0]).hash, lastSync[0])
    })

    it('should ignore requests for a nonexistent change', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let s1 = initSyncState(), s2 = initSyncState()
      let message = null

      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n2] = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      ;[s1, message] = Automerge.generateSyncMessage(n1, s1)
      message.need = ['0000000000000000000000000000000000000000000000000000000000000000']
      ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, message)
      ;[s2, message] = Automerge.generateSyncMessage(n2, s2)
      assert.strictEqual(message, null)
    })

    it('should allow a subset of changes to be sent', () => {
      //       ,-- c1 <-- c2
      // c0 <-+
      //       `-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef'), n3 = Automerge.init('76543210')
      let s1 = initSyncState(), s2 = initSyncState()
      let msg, decodedMsg

      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = 0)
      n3 = Automerge.merge(n3, n1)
      for (let i = 1; i <= 2; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i) // n1 has {c0, c1, c2}
      for (let i = 3; i <= 4; i++) n3 = Automerge.change(n3, {time: 0}, doc => doc.x = i) // n3 has {c0, c3, c4}
      const c2 = getHeads(n1)[0], c4 = getHeads(n3)[0]
      n2 = Automerge.merge(n2, n3) // n2 has {c0, c3, c4}

      // Sync n1 and n2, so their shared heads are {c2, c4}
      ;[n1, n2, s1, s2] = sync(n1, n2)
      s1 = decodeSyncState(encodeSyncState(s1))
      s2 = decodeSyncState(encodeSyncState(s2))
      assert.deepStrictEqual(s1.sharedHeads, [c2, c4].sort())
      assert.deepStrictEqual(s2.sharedHeads, [c2, c4].sort())

      // n2 and n3 apply {c5, c6, c7, c8}
      n3 = Automerge.change(n3, {time: 0}, doc => doc.x = 5)
      const change5 = Automerge.getLastLocalChange(n3)
      n3 = Automerge.change(n3, {time: 0}, doc => doc.x = 6)
      const change6 = Automerge.getLastLocalChange(n3), c6 = getHeads(n3)[0]
      for (let i = 7; i <= 8; i++) n3 = Automerge.change(n3, {time: 0}, doc => doc.x = i)
      const c8 = getHeads(n3)[0]
      n2 = Automerge.merge(n2, n3)

      // Now n1 initiates a sync with n2, and n2 replies with {c5, c6}. n2 does not send {c7, c8}
      ;[s1, msg] = Automerge.generateSyncMessage(n1, s1)
      ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, msg)
      ;[s2, msg] = Automerge.generateSyncMessage(n2, s2)
      decodedMsg = decodeSyncMessage(msg)
      decodedMsg.changes = [change5, change6]
      msg = encodeSyncMessage(decodedMsg)
      const sentHashes = {}
      sentHashes[decodeChangeMeta(change5, true).hash] = true
      sentHashes[decodeChangeMeta(change6, true).hash] = true
      s2.sentHashes = sentHashes
      ;[n1, s1] = Automerge.receiveSyncMessage(n1, s1, msg)
      assert.deepStrictEqual(s1.sharedHeads, [c2, c6].sort())

      // n1 replies, confirming the receipt of {c5, c6} and requesting the remaining changes
      ;[s1, msg] = Automerge.generateSyncMessage(n1, s1)
      ;[n2, s2] = Automerge.receiveSyncMessage(n2, s2, msg)
      assert.deepStrictEqual(decodeSyncMessage(msg).need, [c8])
      assert.deepStrictEqual(decodeSyncMessage(msg).have[0].lastSync, [c2, c6].sort())
      assert.deepStrictEqual(s1.sharedHeads, [c2, c6].sort())
      assert.deepStrictEqual(s2.sharedHeads, [c2, c6].sort())

      // n2 sends the remaining changes {c7, c8}
      ;[s2, msg] = Automerge.generateSyncMessage(n2, s2)
      ;[n1, s1] = Automerge.receiveSyncMessage(n1, s1, msg)
      assert.strictEqual(decodeSyncMessage(msg).changes.length, 2)
      assert.deepStrictEqual(s1.sharedHeads, [c2, c8].sort())
    })
  })
})
