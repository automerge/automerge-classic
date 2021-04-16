const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { checkEncoded } = require('./helpers')
const { equalBytes } = require('../src/common')
const { generateSyncMessage } = require('../backend')
const { BloomFilter, decodeSyncMessage, encodeSyncMessage } = require('../backend/sync')
const Frontend = require("../frontend")

function getHeads(doc) {
  return Automerge.Backend.getHeads(Automerge.Frontend.getBackendState(doc))
}

describe('Data sync protocol', () => {
  const emptyDocBloomFilter = [ { bloom: Uint8Array.of(), lastSync: []}]
  const anUnknownPeerState = {sharedHeads: [], have: [], ourNeed: [], theirHeads: null, theirNeed: null, unappliedChanges: [], lastSentHeads: [] }
  const anEmptyPeerState = { sharedHeads: [], have: emptyDocBloomFilter, ourNeed: [], theirHeads: [], theirNeed: [], unappliedChanges: [], lastSentHeads: [] }
  const expectedEmptyDocSyncMessage = { 
    changes: [],
    have: emptyDocBloomFilter, 
    heads: [],
    need: []
  }
  describe('with docs already in sync', () => {
    describe('an empty local doc', () => {
      it('should send a sync message implying no local data', () => {
        let n1 = Automerge.init()
        
        let p1, m1
        ;[p1, m1] = Automerge.generateSyncMessage(n1)
        assert.deepStrictEqual(p1, anUnknownPeerState)
        assert.deepStrictEqual(decodeSyncMessage(m1), expectedEmptyDocSyncMessage)
      })
      
      it('should not reply if we have no data as well', () => {
        const n1 = Automerge.init()
        let n2 = Automerge.init()
        const [p1, m1] = Automerge.generateSyncMessage(n1)
        let p2, m2
        ;[n2, p2] = Automerge.receiveSyncMessage(n2, m1)
        ;[p2, m2] = Automerge.generateSyncMessage(n2, p2)

        assert.deepStrictEqual(p2, anEmptyPeerState)
        assert.deepStrictEqual(m2, null)
      })
    })

    describe('documents with data', () => {
      it('repos with equal heads do not need a reply message', () => {
        let m1 = null, m2 = null
        let peer1 = null, peer2 = null
        let n1 = Automerge.init(), n2 = Automerge.init()
        // make two nodes with the same changes
        n1 = Automerge.change(n1, doc => doc.n = [])
        for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, doc => doc.n.push(i))
        n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
        assert.deepStrictEqual(n1,n2)

        // generate a naive sync message
        ;[peer1,m1] = Automerge.generateSyncMessage(n1)
        assert.deepStrictEqual(peer1, {...anUnknownPeerState, lastSentHeads: getHeads(n1)})

        // heads are equal so this message should be null
        ;[n2, peer2] = Automerge.receiveSyncMessage(n2,m1)
        ;[peer2, m2] = Automerge.generateSyncMessage(n2, peer2)
        assert.strictEqual(m2, null)
      })

      it('n1 should offer all changes to n2 when starting from nothing', () => {
        let n1 = Automerge.init(), n2 = Automerge.init()
        // make changes for n1 that n2 should request
        n1 = Automerge.change(n1, doc => doc.n = [])
        for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, doc => doc.n.push(i))
                
        assert.notDeepStrictEqual(n1, n2)
        const [after1, after2] = Automerge.sync(n1, n2)
        assert.deepStrictEqual(after1, after2)
      })

      it('should sync peers where one has commits the other does not', () => {
        let n1 = Automerge.init(), n2 = Automerge.init()
        
        // make changes for n1 that n2 should request
        n1 = Automerge.change(n1, doc => doc.n = [])
        for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, doc => doc.n.push(i))
        
        assert.notDeepStrictEqual(n1, n2)
        ;[n1, n2] = Automerge.sync(n1, n2)
        assert.deepStrictEqual(n1, n2)
      })

      it('should work with prior sync state', () => {
        // create & synchronize two nodes
        let n1 = Automerge.init(), n2 = Automerge.init(), n1PeerState, n2PeerState
        for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, doc => doc.x = i)        
        ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2)

        // modify the first node further
        for (let i = 5; i < 10; i++) n1 = Automerge.change(n1, doc => doc.x = i)

        assert.notDeepStrictEqual(n1, n2)
        ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2, n1PeerState, n2PeerState)
        assert.deepStrictEqual(n1, n2)
      })

      it('should not generate messages once synced', () => {
        // create & synchronize two nodes
        let n1 = Automerge.init('abc123'), n2 = Automerge.init('def456')
        let p1, p2, message, patch
        for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, doc => doc.x = i)        
        for (let i = 0; i < 5; i++) n2 = Automerge.change(n2, doc => doc.y = i)        

        const A = Automerge.Backend
        n1 = Automerge.Frontend.getBackendState(n1)
        n2 = Automerge.Frontend.getBackendState(n2)

        // NB: This test assumes there are no false positives in the bloom filter,
        //     which is coincidentally the case with the given IDs, but might not be at some point in the future.
        //     (There's a 1% chance a format change could cause a false positive.)

        // n1 reports what it has 
        ;[p1, message] = A.generateSyncMessage(n1,p1)

        // n2 receives that message and sends changes along with what it has
        ;[n2, p2, patch] = A.receiveSyncMessage(n2, message)
        ;[p2, message] = A.generateSyncMessage(n2,p2)
        assert.deepStrictEqual(decodeSyncMessage(message).changes.length, 5)
        assert.deepStrictEqual(patch, null) // no changes arrived

        // n1 receives the changes and replies with the changes it now knows n2 needs
        ;[n1, p1, patch] = A.receiveSyncMessage(n1, message)
        ;[p1, message] = A.generateSyncMessage(n1,p1)
        assert.deepStrictEqual(decodeSyncMessage(message).changes.length, 5)
        // assert.deepStrictEqual(n1, {x: 4, y: 4})
        assert.notDeepStrictEqual(patch, null) // changes arrived

        // n2 applies the changes and sends confirmation ending the exchange
        ;[n2, p2, patch] = A.receiveSyncMessage(n2, message)
        ;[p2, message] = A.generateSyncMessage(n2,p2)
        // assert.deepStrictEqual(n2, {x: 4, y: 4})
        assert.notDeepStrictEqual(patch, null) // changes arrived

        // n1 receives the message and has nothing more to say
        ;[n1, p1, patch] = A.receiveSyncMessage(n1, message)
        ;[p1, message] = A.generateSyncMessage(n1,p1)
        assert.deepStrictEqual(message, null)
        assert.deepStrictEqual(patch, null) // no changes arrived

        // n2 also has nothing left to say
        ;[p2, message] = A.generateSyncMessage(n2,p2)
        assert.deepStrictEqual(message, null)

        ;[p1, message] = A.generateSyncMessage(n1,p1)
        assert.deepStrictEqual(message, null)

        ;[p2, message] = A.generateSyncMessage(n2,p2)
        assert.deepStrictEqual(message, null)
      })
      
      it.only('should allow simultaneous messages during synchronization', () => {
        const Frontend = Automerge.Frontend
        const Backend = Automerge.Backend

        // create & synchronize two nodes
        let f1 = Automerge.Frontend.init('abc123'), f2 = Automerge.Frontend.init('def456')
        let b1 = Automerge.Backend.init(), b2 = Automerge.Backend.init()

        let p1, p2, b1tob2Message, b2tob1Message, patch, change, pat1, pat2
        for (let i = 0; i < 5; i++) {
          ;[f1, c1] = Automerge.Frontend.change(f1, doc => doc.x = i)
          ;[b1, pat1] = Automerge.Backend.applyLocalChange(b1, c1)
          f1 = Automerge.Frontend.applyPatch(f1, pat1)
        }
        for (let i = 0; i < 5; i++) {
          ;[f2, c2] = Automerge.Frontend.change(f2, doc => doc.y = i)
          ;[b2, pat2] = Automerge.Backend.applyLocalChange(b2, c2)
          f2 = Automerge.Frontend.applyPatch(f2, pat2)
        }

        // NB: This test assumes there are no false positives in the bloom filter,
        //     which is coincidentally the case with the given IDs, but might not be at some point in the future.
        //     (There's a 1% chance a format change could cause a false positive.)

        // both sides report what they have but have no shared peer state
        ;[p1, b1tob2Message] = Backend.generateSyncMessage(b1, p1)
        ;[p2, b2tob1Message] = Backend.generateSyncMessage(b2, p2)

        assert.deepStrictEqual(decodeSyncMessage(b1tob2Message).changes.length, 0)
        assert.deepStrictEqual(decodeSyncMessage(b1tob2Message).have[0].lastSync.length, 0)
        assert.deepStrictEqual(decodeSyncMessage(b2tob1Message).changes.length, 0)
        assert.deepStrictEqual(decodeSyncMessage(b2tob1Message).have[0].lastSync.length, 0)

        // n1 and n2 receives that message and update sync state but make no patch 
        ;[b1, p1, patch1] = Backend.receiveSyncMessage(b1, b2tob1Message)
        assert.deepStrictEqual(patch1, null) // no changes arrived, so no patch
        ;[b2, p2, patch2] = Backend.receiveSyncMessage(b2, b1tob2Message)
        assert.deepStrictEqual(patch2, null) // no changes arrived, so no patch

        // now both reply with their local changes the other lacks
        // (standard warning that 1% of the time this will result in a "need" message)
        ;[p1, b1tob2Message] = Backend.generateSyncMessage(b1,p1)
        assert.deepStrictEqual(decodeSyncMessage(b1tob2Message).changes.length, 5)
        ;[p2, b2tob1Message] = Backend.generateSyncMessage(b2,p2)
        assert.deepStrictEqual(decodeSyncMessage(b2tob1Message).changes.length, 5)
        
        // both should now apply the changes and update the frontend 
        ;[b1, p1, patch1] = Backend.receiveSyncMessage(b1, b2tob1Message)
        assert.deepStrictEqual(p1.unappliedChanges.length, 0)
        assert.notDeepStrictEqual(patch1, null)
        f1 = Automerge.Frontend.applyPatch(f1, patch1)
        assert.deepStrictEqual(f1, {x: 4, y: 4})

        ;[b2, p2, patch2] = Backend.receiveSyncMessage(b2, b1tob2Message)
        assert.deepStrictEqual(p2.unappliedChanges.length, 0)
        assert.notDeepStrictEqual(patch2, null)
        f2 = Automerge.Frontend.applyPatch(f2, patch2)
        assert.deepStrictEqual(f2, {x: 4, y: 4})

        // there should be no changes left to send and lastSync.heads should match
        ;[p1, b1tob2Message] = Backend.generateSyncMessage(b1,p1)
        // XXX: this needs unconfirmed-change tracking to work,
        //      we've already sent this data but we don't know the other side has it here
        //assert.deepStrictEqual(decodeSyncMessage(b1tob2Message).changes.length, 0)
        ;[p2, b2tob1Message] = Backend.generateSyncMessage(b2,p2)
        // XXX: same
        //assert.deepStrictEqual(decodeSyncMessage(b2tob1Message).changes.length, 0)
        
        // XXX: these heads aren't the same because we never update lastSync to include heads we made locally 
        // assert.deepStrictEqual(decodeSyncMessage(b1tob2Message).have[0].lastSync.length, 1)
        // assert.deepStrictEqual(decodeSyncMessage(b1tob2Message).have[0].lastSync, 
        //                        decodeSyncMessage(b2tob1Message).have[0].lastSync)
 
        // n1 receives the changes and replies with the changes it now knows n2 needs
        ;[b1, p1, pat1] = Backend.receiveSyncMessage(b1, b2tob1Message)
        ;[b2, p2, pat2] = Backend.receiveSyncMessage(b2, b1tob2Message)
        // XXX: i think sync should be done here, but i haven't given it enough thought.
        //      this test still needs to figure out whether any other steps are necessary to reach full sync
      })

      it.skip('should assume sent changes were recieved until we hear otherwise', () => {
        let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
        let p1 = null, p2 = null, message = null
        n1 = Automerge.change(n1, doc => doc.items = [])
        ;[n1,n2,p1,p2] = Automerge.sync(n1,n2)

        n1 = Automerge.change(n1, doc => doc.items.push('x'))
        ;[p1, message ] = Automerge.generateSyncMessage(n1,p1)
        assert.deepStrictEqual(message.changes.length, 1)

        n1 = Automerge.change(n1, doc => doc.items.push('y'))
        ;[p1, message ] = Automerge.generateSyncMessage(n1,p1)
        assert.deepStrictEqual(message.changes.length, 1)

        n1 = Automerge.change(n1, doc => doc.items.push('z'))
        ;[p1, message ] = Automerge.generateSyncMessage(n1,p1)
        assert.deepStrictEqual(message.changes.length, 1)
      })

      it('should work regardless of who initiates the exchange', () => {
        // create & synchronize two nodes
        let n1 = Automerge.init(), n2 = Automerge.init(), n1PeerState, n2PeerState
        for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, doc => doc.x = i)        
        ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2)

        // modify the first node further
        for (let i = 5; i < 10; i++) n1 = Automerge.change(n1, doc => doc.x = i)

        assert.notDeepStrictEqual(n1, n2)
        ;[n2, n1, n2PeerState, n1PeerState] = Automerge.sync(n2, n1, n2PeerState, n1PeerState)
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
      
      ;[n1, n2] = Automerge.sync(n1, n2)

      for (let i = 10; i < 15; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      for (let i = 15; i < 18; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.x = i)

      assert.notDeepStrictEqual(n1, n2)
      ;[n1, n2] = Automerge.sync(n1, n2)
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
      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      
      let n1PeerState = null, n2PeerState = null
      ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2, n1PeerState, n2PeerState)

      for (let i = 10; i < 15; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      for (let i = 15; i < 18; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.x = i)

      assert.notDeepStrictEqual(n1, n2)
      ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2, n1PeerState, n2PeerState)
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)
    })

    it('should ensure non-empty state after sync', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let n1PeerState = null, n2PeerState = null

      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2, n1PeerState, n2PeerState)

      assert.deepStrictEqual(n1PeerState.sharedHeads, getHeads(n1))
      assert.deepStrictEqual(n2PeerState.sharedHeads, getHeads(n1))
    })

    it('should re-sync after one node crashed with data loss', () => {
      // Scenario:     (r)                  (n2)                 (n1)
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8
      // n2 has changes {c0, c1, c2}, s1's lastSync is c5, and s2's lastSync is c2.
      // we want to successfully sync (n1) with (r), even though (n1) believes it's talking to (n2)
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let n1PeerState = null, n2PeerState = null
      
      // n1 makes three changes, which we sync to n2
      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2, n1PeerState, n2PeerState)
      
      // save a copy of n2 as "r" to simulate recovering from crash
      let r, rPeerState
      ;[r, rPeerState] = [Automerge.clone(n2), n2PeerState]

      // sync another few commits
      for (let i = 3; i < 6; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2, n1PeerState, n2PeerState)
      // everyone should be on the same page here
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)

      // now make a few more changes, then attempt to sync the fully-up-to-date n1 with the confused r
      for (let i = 6; i < 9; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)

      assert.notDeepStrictEqual(getHeads(n1), getHeads(r))
      assert.notDeepStrictEqual(n1, r)
      assert.deepStrictEqual(n1, { x: 8 })
      assert.deepStrictEqual(r, { x: 2 })
      ;[n1, r, n1PeerState, rPeerState] = Automerge.sync(n1, r, n1PeerState, rPeerState)
      assert.deepStrictEqual(getHeads(n1), getHeads(r))
      assert.deepStrictEqual(n1, r)
    })

    // 2
    it('should re-sync after both nodes crashed with data loss', () => {
      // Scenario:     (r)                  (n2)                 (n1)
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8
      // n2 has changes {c0, c1, c2}, s1's lastSync is c5, and s2's lastSync is c2.
      // we want to successfully sync (n1) with (r), even though (n1) believes it's talking to (n2)
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let n1PeerState = null, n2PeerState = null
      
      // n1 makes three changes, which we sync to n2
      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2, n1PeerState, n2PeerState)
      
      // save a copy of n2 as "r" to simulate recovering from crash
      let r, rPeerState
      ;[r, rPeerState] = [Automerge.clone(n2), n2PeerState]

      // sync another few commits
      for (let i = 3; i < 6; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1, n2, n1PeerState, n2PeerState] = Automerge.sync(n1, n2, n1PeerState, n2PeerState)
      // everyone should be on the same page here
      assert.deepStrictEqual(getHeads(n1), getHeads(n2))
      assert.deepStrictEqual(n1, n2)

      // now make a few more changes, then attempt to sync the fully-up-to-date n1 with the confused r
      for (let i = 6; i < 9; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)

      // let's add some extra changes to R as well for this test
      for (let i = 0; i < 3; i++) r = Automerge.change(r, {time: 0}, doc => doc.r = i)

      assert.notDeepStrictEqual(getHeads(n1), getHeads(r))
      assert.notDeepStrictEqual(n1, r)
      assert.deepStrictEqual(n1, { x: 8 })
      assert.deepStrictEqual(r, { x: 2, r: 2 })
      ;[n1, r, n1PeerState, rPeerState] = Automerge.sync(n1, r, n1PeerState, rPeerState)
      assert.deepStrictEqual(getHeads(n1), getHeads(r))
      assert.deepStrictEqual(n1, r)
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

    // 3
    it.skip('should handle a false-positive head', () => {
      // Scenario:                                                            ,-- n1
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8 <-- c9 <-+
      //                                                                      `-- n2
      // where n2 is a false positive in the Bloom filter containing {n1}.
      // lastSync is c9.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      const lastSync = getHeads(n1)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      for (let i = 3; ; i++) { // search for false positive; see comment above
        const n1up = Automerge.change(Automerge.clone(n1, {actorId: '01234567'}), {time: 0}, doc => doc.x = `${i} @ n1`)
        const n2up = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        if (new BloomFilter(getHeads(n1up)).containsHash(getHeads(n2up)[0])) {
          n1 = n1up; n2 = n2up; break
        }
      }
      const bothHeads = [getHeads(n1)[0], getHeads(n2)[0]].sort()
      const s1 = new SyncPeer(n1, lastSync), s2 = new SyncPeer(n2, lastSync, s1); s1.remote = s2
      assert.strictEqual(s1.sendMessage().type, 'sync') // m1: initial message
      assert.strictEqual(s2.sendMessage().type, 'sync') // m2: initial message
      assert.strictEqual(s2.sendMessage().type, 'sync') // m3: response to m1
      assert.strictEqual(s1.sendMessage().hash, getHeads(n1)[0]) // change in response to m2
      assert.deepStrictEqual(s1.sendMessage(), {type: 'sync', heads: getHeads(n1), need: getHeads(n2), have: []}) // m4: response to m2
      assert.deepStrictEqual(s2.sendMessage().hash, getHeads(n2)[0]) // change in response to m4
      assert.deepStrictEqual(s2.sendMessage().heads, bothHeads) // m5: response to n1's change and m4
      assert.deepStrictEqual(s1.sendMessage().heads, bothHeads) // m6: response to n2's change and m5
      assert.strictEqual(s1.sendMessage(), undefined)
      assert.strictEqual(s2.sendMessage(), undefined)
      assert.deepStrictEqual(getHeads(s1.doc), bothHeads)
      assert.deepStrictEqual(getHeads(s2.doc), bothHeads)
    })

    it.skip('should handle a false-positive dependency', () => {
      // Scenario:                                                            ,-- n1c1 <-- n1c2
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8 <-- c9 <-+
      //                                                                      `-- n2c1 <-- n2c2
      // where n2c1 is a false positive in the Bloom filter containing {n1c1, n1c2}.
      // lastSync is c9.
      
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      let lastSync = getHeads(n1), n1hash1, n1hash2, n2hash1, n2hash2
      for (let i = 222; ; i++) { // search for false positive; see comment above
        const n1up1 = Automerge.change(Automerge.clone(n1, {actorId: '01234567'}), {time: 0}, doc => doc.x = `${i} @ n1`)
        const n2up1 = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        n1hash1 = getHeads(n1up1)[0]; n2hash1 = getHeads(n2up1)[0]
        const n1up2 = Automerge.change(n1up1, {time: 0}, doc => doc.x = 'final @ n1')
        const n2up2 = Automerge.change(n2up1, {time: 0}, doc => doc.x = 'final @ n2')
        n1hash2 = getHeads(n1up2)[0]; n2hash2 = getHeads(n2up2)[0]
        if (new BloomFilter([n1hash1, n1hash2]).containsHash(n2hash1)) {
          n1 = n1up2; n2 = n2up2; break
        }
      }
      const bothHeads = [n1hash2, n2hash2].sort()
      const s1 = new SyncPeer(n1, lastSync), s2 = new SyncPeer(n2, lastSync, s1); s1.remote = s2
      assert.strictEqual(s1.sendMessage().type, 'sync') // m1: initial message
      assert.strictEqual(s2.sendMessage().type, 'sync') // m2: initial message
      assert.strictEqual(s1.sendMessage().hash, n1hash1) // change in response to m2
      assert.strictEqual(s1.sendMessage().hash, n1hash2) // change in response to m2
      assert.deepStrictEqual(s1.sendMessage(), {type: 'sync', heads: [n1hash2], need: [n2hash2], have: []}) // m3: response to m2
      assert.strictEqual(s2.sendMessage().hash, n2hash2) // change in response to m1
      assert.deepStrictEqual(s2.sendMessage(), {type: 'sync', heads: [n2hash2], need: [n1hash2], have: []}) // m4: response to m1
      assert.deepStrictEqual(s2.sendMessage().heads, bothHeads) // m5: response to n1's changes and m3
      assert.strictEqual(s2.sendMessage(), undefined)
      assert.deepStrictEqual(s1.sendMessage(), {type: 'sync', heads: [n1hash2], need: [n2hash1], have: []}) // m5: response to n2's change and m4
      assert.strictEqual(s2.sendMessage().hash, n2hash1) // change in response to m5
      assert.deepStrictEqual(s2.sendMessage().heads, bothHeads) // m6: response to m5
      assert.deepStrictEqual(s1.sendMessage().heads, bothHeads) // m7: response to n2's change and m6
      assert.strictEqual(s1.sendMessage(), undefined)
      assert.strictEqual(s2.sendMessage(), undefined)
      assert.deepStrictEqual(getHeads(s1.doc), bothHeads)
      assert.deepStrictEqual(getHeads(s2.doc), bothHeads)
    })

    // 4
    it.skip('should not require an additional request when a false-positive depends on a true-negative', () => {
      // Scenario:                         ,-- n1c1 <-- n1c2 <-- n1c3
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-+
      //                                   `-- n2c1 <-- n2c2 <-- n2c3
      // where n2c2 is a false positive in the Bloom filter containing {n1c1, n1c2, n1c3}.
      // lastSync is c4.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      let lastSync = getHeads(n1), n1hash1, n1hash2, n1hash3, n2hash1, n2hash2, n2hash3
      for (let i = 222; ; i++) { // search for false positive; see comment above
        const n1up1 = Automerge.change(Automerge.clone(n1, {actorId: '01234567'}), {time: 0}, doc => doc.x = `${i} @ n1`)
        const n2up1 = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        n1hash1 = getHeads(n1up1)[0]; n2hash1 = getHeads(n2up1)[0]
        const n1up2 = Automerge.change(n1up1, {time: 0}, doc => doc.x = `${i+1} @ n1`)
        const n2up2 = Automerge.change(n2up1, {time: 0}, doc => doc.x = `${i+1} @ n2`)
        n1hash2 = getHeads(n1up2)[0]; n2hash2 = getHeads(n2up2)[0]
        const n1up3 = Automerge.change(n1up2, {time: 0}, doc => doc.x = 'final @ n1')
        const n2up3 = Automerge.change(n2up2, {time: 0}, doc => doc.x = 'final @ n2')
        n1hash3 = getHeads(n1up3)[0]; n2hash3 = getHeads(n2up3)[0]
        if (new BloomFilter([n1hash1, n1hash2, n1hash3]).containsHash(n2hash2)) {
          n1 = n1up3; n2 = n2up3; break
        }
      }
      const bothHeads = [n1hash3, n2hash3].sort()
      const s1 = new SyncPeer(n1, lastSync), s2 = new SyncPeer(n2, lastSync, s1); s1.remote = s2
      assert.strictEqual(s1.sendMessage().type, 'sync') // m1: initial message
      assert.strictEqual(s2.sendMessage().type, 'sync') // m2: initial message
      assert.strictEqual(s1.sendMessage().hash, n1hash1) // change in response to m2
      assert.strictEqual(s1.sendMessage().hash, n1hash2) // change in response to m2
      assert.strictEqual(s1.sendMessage().hash, n1hash3) // change in response to m2
      assert.deepStrictEqual(s1.sendMessage(), {type: 'sync', heads: [n1hash3], need: [n2hash3], have: []}) // m3: response to m2
      assert.strictEqual(s2.sendMessage().hash, n2hash1) // change in response to m1
      assert.strictEqual(s2.sendMessage().hash, n2hash2) // change in response to m1
      assert.strictEqual(s2.sendMessage().hash, n2hash3) // change in response to m1
      assert.deepStrictEqual(s2.sendMessage(), {type: 'sync', heads: [n2hash3], need: [n1hash3], have: []}) // m4: response to m1
      assert.deepStrictEqual(s2.sendMessage().heads, bothHeads) // m5: response to n1's changes and m3
      assert.deepStrictEqual(s1.sendMessage().heads, bothHeads) // m6: response to n2's changes and m4
      assert.strictEqual(s1.sendMessage(), undefined)
      assert.strictEqual(s2.sendMessage(), undefined)
      assert.deepStrictEqual(getHeads(s1.doc), bothHeads)
      assert.deepStrictEqual(getHeads(s2.doc), bothHeads)
    })

    // 5
    it.skip('should handle chains of false-positives', () => {
      // Scenario:                         ,-- c5
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-+
      //                                   `-- n2c1 <-- n2c2 <-- n2c3
      // where n2c1 and n2c2 are both false positives in the Bloom filter containing {c5}.
      // lastSync is c4.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      let lastSync = getHeads(n1), n2hash1, n2hash2, n2hash3
      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = 5)
      for (let i = 1; ; i++) { // search for false positive; see comment above
        const n2up1 = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        if (new BloomFilter(getHeads(n1)).containsHash(getHeads(n2up1)[0])) {
          n2 = n2up1; n2hash1 = getHeads(n2up1)[0]; break
        }
      }
      for (let i = 37; ; i++) { // search for false positive; see comment above
        const n2up2 = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} again`)
        if (new BloomFilter(getHeads(n1)).containsHash(getHeads(n2up2)[0])) {
          n2 = n2up2; n2hash2 = getHeads(n2up2)[0]; break
        }
      }
      n2 = Automerge.change(n2, {time: 0}, doc => doc.x = 'final @ n2')
      n2hash3 = getHeads(n2)[0]
      const bothHeads = [getHeads(n1)[0], n2hash3].sort()
      const s1 = new SyncPeer(n1, lastSync), s2 = new SyncPeer(n2, lastSync, s1); s1.remote = s2
      assert.strictEqual(s1.sendMessage().type, 'sync') // m1: initial message
      assert.strictEqual(s2.sendMessage().type, 'sync') // m2: initial message
      assert.strictEqual(s1.sendMessage().hash, getHeads(n1)[0]) // change in response to m2
      assert.deepStrictEqual(s1.sendMessage(), {type: 'sync', heads: getHeads(n1), need: [n2hash3], have: []}) // m3: response to m2
      assert.strictEqual(s2.sendMessage().hash, n2hash3) // change in response to m1
      assert.deepStrictEqual(s2.sendMessage(), {type: 'sync', heads: getHeads(n2), need: getHeads(n1), have: []}) // m4: response to m1
      assert.deepStrictEqual(s2.sendMessage().heads, bothHeads) // m5: response to n1's changes and m3
      assert.strictEqual(s2.sendMessage(), undefined)
      assert.deepStrictEqual(s1.sendMessage(), {type: 'sync', heads: getHeads(n1), need: [n2hash2], have: []}) // m5: response to n2's change and m4
      assert.strictEqual(s2.sendMessage().hash, n2hash2) // change in response to m5
      assert.deepStrictEqual(s2.sendMessage().heads, bothHeads) // m6: response to m5
      assert.deepStrictEqual(s1.sendMessage(), {type: 'sync', heads: getHeads(n1), need: [n2hash1], have: []}) // m7: response to n2's change and m6
      assert.strictEqual(s2.sendMessage().hash, n2hash1) // change in response to m7
      assert.deepStrictEqual(s2.sendMessage().heads, bothHeads) // m8: response to m7
      assert.deepStrictEqual(s1.sendMessage().heads, bothHeads) // m9: response to m8
      assert.deepStrictEqual(getHeads(s1.doc), bothHeads)
      assert.deepStrictEqual(getHeads(s2.doc), bothHeads)
      assert.strictEqual(s1.sendMessage(), undefined)
      assert.strictEqual(s2.sendMessage(), undefined)
      assert.deepStrictEqual(getHeads(s1.doc), bothHeads)
      assert.deepStrictEqual(getHeads(s2.doc), bothHeads)
    })

    // this test fails because after sync node a
    // has theirHeads:[] and sharedHeads:[]
    // so it will attempt to resend all data on the next sync
    // fix A: after receiving changes always send one more message with
    // your new heads 
    // fix B: after sending changes update peer state to reflect that these changes are incorporated
    // 6
    it.skip('should allow the false-positive hash to be explicitly requested', () => {
      // Scenario:                                                            ,-- n1
      // c0 <-- c1 <-- c2 <-- c3 <-- c4 <-- c5 <-- c6 <-- c7 <-- c8 <-- c9 <-+
      //                                                                      `-- n2
      // where n2 is a false positive in the Bloom filter containing {n1}.
      // lastSync is c9.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      let p1, p2, message;
      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      ;[n1,n2,p1,p2] = Automerge.sync(n1,n2);
      for (let i = 3; ; i++) { // search for false positive; see comment above
        const n1up = Automerge.change(Automerge.clone(n1, {actorId: '01234567'}), {time: 0}, doc => doc.x = `${i} @ n1`)
        const n2up = Automerge.change(Automerge.clone(n2, {actorId: '89abcdef'}), {time: 0}, doc => doc.x = `${i} @ n2`)
        if (new BloomFilter(getHeads(n1up)).containsHash(getHeads(n2up)[0])) {
          n1 = n1up; n2 = n2up; break
        }
      }

      console.log("p1", p1)
      console.log("p2", p2)
      ;[p1, message] = Automerge.generateSyncMessage(n1, p1);
//      assert.strictEqual(message.changes.length, 0)
      console.log("m1", message.changes.length)
      ;[n2, p2] = Automerge.receiveSyncMessage(n2, message, p2)
      ;[p2, message] = Automerge.generateSyncMessage(n2, p2);
      console.log("m2", message.changes.length)
//      assert.strictEqual(message.changes.length, 0)
/*
      sync1.need = getHeads(n2) // explicitly request the missing change
      const sync1a = Automerge.Backend.decodeSyncMessage(Automerge.Backend.encodeSyncMessage(sync1))
      const [response2, changes2] = Automerge.Backend.syncResponse(Automerge.Frontend.getBackendState(n2), sync1a)
      assert.strictEqual(changes2.length, 1)
      assert.strictEqual(Automerge.decodeChange(changes2[0]).hash, getHeads(n2)[0])
*/
    })
  })

  describe('syncResponse()', () => {
    it('should allow multiple Bloom filters', () => {
      // Scenario:           ,-- n1c1 <-- n1c2 <-- n1c3
      // c0 <-- c1 <-- c2 <-+--- n2c1 <-- n2c2 <-- n2c3
      //                     `-- n3c1 <-- n3c2 <-- n3c3
      // n1 has {c0, c1, c2, n1c1, n1c2, n1c3, n2c1, n2c2};
      // n2 has {c0, c1, c2, n1c1, n1c2, n2c1, n2c2, n2c3};
      // n3 has {c0, c1, c2, n3c1, n3c2, n3c3}.
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef'), n3 = Automerge.init('76543210')
      let p13, p12, p21, p32, p31, p23, message1, message2, message3
      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      // sync all 3 nodes
      ;[n1, n2, p12, p21] = Automerge.sync(n1,n2);
      ;[n1, n3, p13, p31] = Automerge.sync(n1,n3);
      ;[n3, n2, p32, p23] = Automerge.sync(n3,n2);
      for (let i = 0; i < 2; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = `${i} @ n1`)
      for (let i = 0; i < 2; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.x = `${i} @ n2`)
      n1 = Automerge.applyChanges(n1, Automerge.getAllChanges(n2))
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      n1 = Automerge.change(n1, {time: 0}, doc => doc.x = `3 @ n1`)
      n2 = Automerge.change(n2, {time: 0}, doc => doc.x = `3 @ n2`)
      for (let i = 0; i < 3; i++) n3 = Automerge.change(n3, {time: 0}, doc => doc.x = `${i} @ n3`)
      // node 1 tells 3 what it has
      ;[p13, message1] = Automerge.generateSyncMessage(n1, p13)
      // node3 tells 2 what it has
      ;[p32, message3] = Automerge.generateSyncMessage(n3, p32)
      // Copy the Bloom filter received from n1 into the message sent from n3 to n2
      const modifiedMessage = decodeSyncMessage(message3)
      modifiedMessage.have.push(decodeSyncMessage(message1).have[0])
      ;[n2, p23] = Automerge.receiveSyncMessage(n2,encodeSyncMessage(modifiedMessage))
      ;[p23, message2] = Automerge.generateSyncMessage(n2, p23)
      assert.strictEqual(decodeSyncMessage(message2).changes.length, 1)
      assert.strictEqual(Automerge.decodeChange(decodeSyncMessage(message2).changes[0]).hash, getHeads(n2)[0])
    })

    it('should allow any change to be requested', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      const lastSync = getHeads(n1)
      for (let i = 3; i < 6; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      let message, peer1, peer2;
      ;[n1,n2,peer1,peer2] = Automerge.sync(n1,n2);
      peer1.lastSentHeads = [] // force generateSyncMessage to return a message even though nothing changed
      ;[peer1, message] = Automerge.generateSyncMessage(n1, peer1)
      const modMsg = decodeSyncMessage(message)
      modMsg.need = lastSync // re-request change 2
      ;[n2, peer2] = Automerge.receiveSyncMessage(n2, encodeSyncMessage(modMsg), peer2)
      ;[peer1, message] = Automerge.generateSyncMessage(n2, peer2)
      assert.strictEqual(decodeSyncMessage(message).changes.length, 1)
      assert.strictEqual(Automerge.decodeChange(decodeSyncMessage(message).changes[0]).hash, lastSync[0])
    })

    it('should ignore requests for a nonexistent change', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 3; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = i)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      let peer1 = null, peer2 = null, message = null;
      const lastSync = getHeads(n1)
      ;[peer1, message] = Automerge.generateSyncMessage(n1)
      message.need = ['0000000000000000000000000000000000000000000000000000000000000000']
      ;[n2, peer2] = Automerge.receiveSyncMessage(n2, message)
      ;[peer2, message] = Automerge.generateSyncMessage(n2,peer2)
      assert.strictEqual(message, null)
    })
  })
})
