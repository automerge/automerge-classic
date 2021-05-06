const assert = require('assert')
const { EventEmitter } = require('events')
const A = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

console.clear()

describe('sync protocol - integration', () => {
  beforeEach(() => {
    iterations = 0
  })

  function connect(a, b) {
    const channel = new Channel()
    a.connectTo(b.userId, channel)
    b.connectTo(a.userId, channel)
  }

  describe('two peers', () => {
    it(`syncs a single change`, () => {
      let doc = A.from({})

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)

      connect(alice, bob)

      // alice makes a change
      alice.change(s => {
        s.alice = 1
      })

      // bob gets the changes
      assert.deepStrictEqual(alice.doc, bob.doc)
    })

    it('syncs divergent changes', () => {
      let doc = A.from({})

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)

      connect(alice, bob)

      alice.disconnect()

      // alice makes a change
      alice.change(s => (s.alice = 1))

      // bob makes a change
      bob.change(s => (s.bob = 1))

      // while they're disconnected, they have divergent docs
      assert.notDeepStrictEqual(alice.doc, bob.doc)

      alice.connect()

      // after connecting, their docs converge
      assert.deepStrictEqual(alice.doc, bob.doc)
    })
  })

  describe('three peers', () => {
    it(`syncs a single change`, () => {
      let doc = A.from({})

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)
      const charlie = new ConnectedDoc('charlie', doc)

      connect(alice, bob)
      connect(bob, charlie)

      // alice makes a change
      alice.change(s => {
        s.alice = 1
      })

      // charlie gets the changes (via bob)
      assert.deepStrictEqual(alice.doc, charlie.doc)
    })

    it(`syncs a single change (all connected to all)`, () => {
      let doc = A.from({})

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)
      const charlie = new ConnectedDoc('charlie', doc)

      connect(alice, bob)
      connect(bob, charlie)
      connect(alice, charlie)

      // alice makes a change
      alice.change(s => {
        s.alice = 1
      })

      // charlie gets the changes (via bob)
      assert.deepStrictEqual(alice.doc, charlie.doc)
    })

    it(`syncs multiple changes`, () => {
      let doc = A.from({})

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)
      const charlie = new ConnectedDoc('charlie', doc)

      connect(alice, bob)
      connect(bob, charlie)
      connect(alice, charlie)

      // each one makes a change
      alice.change(s => (s.alice = 1))
      bob.change(s => (s.bob = 1))
      charlie.change(s => (s.charlie = 1))

      // all docs converge
      assert.deepStrictEqual(alice.doc, bob.doc)
      assert.deepStrictEqual(bob.doc, charlie.doc)
      assert.deepStrictEqual(alice.doc, charlie.doc)
    })

    it('syncs divergent changes', async () => {
      let doc = A.from({})

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)
      const charlie = new ConnectedDoc('charlie', doc)

      connect(alice, charlie)
      connect(alice, bob)
      connect(alice, charlie)

      alice.disconnect()
      bob.disconnect()
      charlie.disconnect()

      // each one makes a change
      alice.change(s => (s.alice = 1))
      bob.change(s => (s.bob = 1))
      charlie.change(s => (s.charlie = 1))

      // while they're disconnected, they have divergent docs
      assert.notDeepStrictEqual(alice.doc, bob.doc)
      assert.notDeepStrictEqual(bob.doc, charlie.doc)
      assert.notDeepStrictEqual(alice.doc, charlie.doc)

      alice.connect()
      bob.connect()
      charlie.connect()

      // after connecting, their docs converge
      assert.deepStrictEqual(alice.doc, bob.doc)
      assert.deepStrictEqual(bob.doc, charlie.doc)
      assert.deepStrictEqual(alice.doc, charlie.doc)
    })
  })
})

class ConnectedDoc extends EventEmitter {
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
    super()
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

class Peer extends EventEmitter {
  syncState = A.initSyncState()

  /**
   *
   * @param userId Current user's unique id
   * @param peerId Remote peer's unique id
   * @param channel Channel used to connect to the remote peer
   */
  constructor(userId, peerId, channel) {
    super()
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
    // (if msg is null, nothing has changed)
    if (msg !== null) this.send(msg)
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
    this.channel.write(this.userId, msg)
  }
}

// dummy 2-way channel for testing
class Channel extends EventEmitter {
  write(peerId, msg) {
    this.emit('data', peerId, msg)
  }
}

const pause = (t = 100) => new Promise(resolve => setTimeout(() => resolve(), t))
