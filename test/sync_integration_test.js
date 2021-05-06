const assert = require('assert')
const { EventEmitter } = require('events')
const A = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('sync protocol - integration', () => {
  console.clear()

  describe('2 peers', () => {
    it(`syncs a single change`, async () => {
      let doc = A.init()

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)

      const channel = new Channel()
      alice.connectTo(bob.userId, channel)
      bob.connectTo(alice.userId, channel)

      // alice makes a change
      alice.change(s => (s.alice = 1))

      await pause()

      // bob gets the changes
      assert.deepStrictEqual(alice.doc, bob.doc)
    })

    it('syncs divergent changes', async () => {
      let doc = A.init()

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)

      const channel = new Channel()
      alice.connectTo(bob.userId, channel)
      bob.connectTo(alice.userId, channel)

      alice.disconnect()

      // alice makes a change
      alice.change(s => (s.alice = 42))

      // bob makes a change
      bob.change(s => (s.bob = 13))

      await pause()

      // while they're disconnected, they have divergent docs
      assert.notDeepStrictEqual(alice.doc, bob.doc)

      alice.connect()
      await pause()

      // after connecting, their docs converge
      assert.deepStrictEqual(alice.doc, bob.doc)
    })
  })

  describePeers(['alice', 'bob', 'charlie'])
  describePeers(['alice', 'bob', 'charlie', 'dwight'])
  describePeers(['alice', 'bob', 'charlie', 'dwight', 'eleanor'])

  function describePeers(users) {
    describe(`${users.length} peers`, () => {
      function connect(a, b) {
        const channel = new Channel()
        a.connectTo(b.userId, channel)
        b.connectTo(a.userId, channel)
      }

      function connectAll(peers) {
        for (let i = 0; i < peers.length; i++) {
          for (let j = i + 1; j < peers.length; j++) {
            const a = peers[i]
            const b = peers[j]
            connect(a, b)
          }
        }
      }

      function connectAllInDaisyChain(peers) {
        peers.slice(0, peers.length - 1).forEach((peer, i) => {
          const nextPeer = peers[i + 1]
          connect(peer, nextPeer)
        })
      }

      async function assertAllEqual(peers) {
        await pause(peers.length * 50)
        peers.slice(0, peers.length - 1).forEach((peer, i) => {
          const nextPeer = peers[i + 1]
          assert.deepStrictEqual(peer.doc, nextPeer.doc)
        })
      }

      async function assertAllDifferent(peers) {
        await pause(peers.length * 50)
        peers.slice(0, peers.length - 1).forEach((peer, i) => {
          const nextPeer = peers[i + 1]
          assert.notDeepStrictEqual(peer.doc, nextPeer.doc)
        })
      }

      it(`syncs a single change (direct connections)`, async () => {
        const doc = A.init()
        const peers = users.map(name => new ConnectedDoc(name, doc))
        connectAll(peers)

        // first user makes a change
        peers[0].change(s => (s[users[0]] = 42))

        // all peers have the same doc
        assertAllEqual(peers)
      })

      it(`syncs a single change (indirect connections)`, async () => {
        const doc = A.init()
        const peers = users.map(name => new ConnectedDoc(name, doc))
        connectAllInDaisyChain(peers)

        // first user makes a change
        peers[0].change(s => (s[users[0]] = 42))

        // all peers have the same doc
        await assertAllEqual(peers)
      })

      it(`syncs multiple changes (direct connections)`, async () => {
        const doc = A.init()
        const peers = users.map(name => new ConnectedDoc(name, doc))
        connectAll(peers)

        // first user makes a change
        peers[0].change(s => (s[users[0]] = 42))

        // all peers have the same doc
        await assertAllEqual(peers)
      })

      it(`syncs multiple changes (indirect connections)`, async () => {
        const doc = A.init()
        const peers = users.map(name => new ConnectedDoc(name, doc))
        connectAllInDaisyChain(peers)

        // each user makes a change
        peers.forEach(peer => peer.change(s => (s[peer.userId] = 42)))

        // all peers have the same doc
        await assertAllEqual(peers)
      })

      it('syncs multiple divergent changes (direct connections)', async () => {
        const doc = A.init()
        const peers = users.map(name => new ConnectedDoc(name, doc))
        connectAll(peers)

        // everyone disconnects
        peers.forEach(peer => peer.disconnect())

        // each user makes a change
        peers.forEach(peer => peer.change(s => (s[peer.userId] = 42)))

        // while they're disconnected, they have divergent docs
        await assertAllDifferent(peers)

        // everyone reconnects
        peers.forEach(peer => peer.connect())

        // after connecting, their docs converge
        await assertAllEqual(peers)
      })
    })
  }
})

class ConnectedDoc {
  /** Tracks our simulated connection status */
  online = true

  /** Map of `Peer` objects (key is their peerId) */
  peers = {}

  /**
   * Keeps the user's Automerge document in sync with any number of peers
   * @param userId Unique identifier for the current user, e.g. `alice` or `herb@devresults.com`
   * @param doc The Automerge document to keep in sync
   */
  constructor(userId, doc) {
    this.userId = userId
    this.doc = A.clone(doc)
  }

  /**
   * Sets up the connection with a peer and listens for their messages
   * @param peerId The id of the peer we're connecting to
   * @param channel The channel used to connect to the peer (must expose a `write` method, and emit a `data` event)
   */
  connectTo(peerId, channel) {
    const peer = new Peer(this.userId, peerId, channel)
    this.peers[peerId] = peer
    channel.on('data', (senderId, msg) => {
      if (senderId === this.userId) return // don't receive our own mesages
      if (!this.online) return // don't receive messages while we're "offline"

      this.doc = peer.receive(this.doc, msg)
      this.sync()
    })
  }

  /**
   * By using this method to modify the doc, we ensure that all peers are automatically updated
   * @param fn An Automerge.ChangeFn used to mutate the doc in place
   */
  change(fn) {
    this.doc = A.change(this.doc, fn)
    this.sync()
  }

  /** Simulates going offline */
  disconnect() {
    this.online = false
  }

  /** Simulates going back online */
  connect() {
    this.online = true
    this.sync()
  }

  // PRIVATE

  /** Our set of peers as an array */
  get _peerList() {
    return Object.values(this.peers)
  }

  /** Syncs with all peers */
  sync() {
    if (!this.online) return // only send updates if we're "online"
    for (const peer of this._peerList) {
      peer.sync(this.doc)
    }
  }
}

class Peer {
  iterations = 0
  syncState = A.initSyncState()

  /**
   *
   * @param userId Current user's unique id
   * @param peerId Remote peer's unique id
   * @param channel Channel used to connect to the remote peer
   */
  constructor(userId, peerId, channel) {
    this.userId = userId
    this.peerId = peerId
    this.channel = channel
  }

  /**
   * Compares the current Automerge doc with the sync state we have for this peer,
   * and sends the peer a sync message if anything has changed
   * @param doc The current version of the Automerge doc
   */
  sync(doc) {
    const [syncState, msg] = A.generateSyncMessage(doc, this.syncState)
    this.syncState = syncState

    // only send a sync message if something has changed
    // (if msg is null, our docs have converged)
    if (msg !== null) {
      this.send(msg)
    } else {
      // we've converged
      this.iterations = 0
    }
  }

  /**
   * Use information in the message received, along with the the sync state
   * we have for the peer, to return an updated version of our doc
   * @param doc Document at the time the message was received
   * @param msg Automerge sync message
   * @returns an updated document
   */
  receive(doc, msg) {
    const [updatedDoc, syncState] = A.receiveSyncMessage(doc, this.syncState, msg)
    this.syncState = syncState
    return updatedDoc
  }

  // PRIVATE

  send(msg) {
    this.iterations += 1
    // console.log(`${this.userId}->${this.peerId} ${this.iterations}`)
    if (this.iterations > 100) {
      throw truncateStack(new Error('loop detected (failed to converge)'), 2)
    }

    this.channel.write(this.userId, msg)
  }
}

// dummy 2-way channel for testing
class Channel extends EventEmitter {
  write(peerId, msg) {
    setTimeout(() => {
      this.emit('data', peerId, msg)
    }, 1)
  }
}

const truncateStack = (err, lines = 5) => {
  err.stack = err.stack.split('\n').slice(0, lines).join('\n') // truncate repetitive stack
  return err
}
const pause = (t = 50) => new Promise(resolve => setTimeout(() => resolve(), t))
