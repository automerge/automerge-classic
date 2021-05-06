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
  /** Map of `Peer` objects (key is their peerId) */
  peers = {}

  connected = true

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
   * @param channel The channel used to connect to the peer
   */
  connectTo(peerId, channel) {
    const peer = new Peer(this.userId, peerId, channel)
    this.peers[peerId] = peer
    channel.join()
    channel.addListener('data', (senderId, msg) => {
      if (senderId === this.userId) return // don't react to our own mesages
      const peer = this.peers[senderId]
      const updatedDoc = peer.receive(this.doc, msg)
      this._update(updatedDoc)
    })
  }

  /**
   * By using this method to modify the doc, we ensure that all peers are automatically updated
   * @param fn An Automerge.ChangeFn used to mutate the doc in place
   */
  change(fn) {
    const updatedDoc = A.change(this.doc, fn)
    this._update(updatedDoc)
  }

  /**
   *
   */
  disconnect() {
    for (const peer of this._peerList) {
      peer.channel.leave()
    }
    this.connected = false
  }

  connect() {
    for (const peer of this._peerList) {
      peer.channel.join()
    }
    this.connected = true
    this._update(this.doc)
  }

  // PRIVATE

  /** Our set of peers as an array */
  get _peerList() {
    return Object.values(this.peers)
  }

  _update(updatedDoc) {
    this.doc = updatedDoc
    if (!this.connected) return // only send updates if we're online
    for (const peer of this._peerList) {
      peer.update(this.doc)
    }
  }
}

class Peer extends EventEmitter {
  constructor(userId, peerId, channel) {
    super()
    this.userId = userId
    this.peerId = peerId
    this.channel = channel
    this.syncState = A.initSyncState()
  }

  send(msg) {
    this.channel.write(this.userId, msg)
  }

  update(doc) {
    const [syncState, msg] = A.generateSyncMessage(doc, this.syncState)
    this.syncState = syncState
    // only send a sync message if something has changed
    if (msg !== null) this.send(msg)
  }

  receive(doc, msg) {
    const [updatedDoc, syncState] = A.receiveSyncMessage(doc, this.syncState, msg)
    this.syncState = syncState
    return updatedDoc
  }
}

// dummy 2-way channel for testing
class Channel extends EventEmitter {
  peers = 0
  buffer = []

  join() {
    this.peers += 1
    if (this.peers >= 3) throw new Error('This channel only supports 2 peers')
    if (this.peers === 2) {
      // someone is already here, emit any messages they sent before we joined
      for (const { peerId, msg } of this.buffer) {
        this.emit('data', peerId, msg)
      }
      this.buffer = []
    }
    return this
  }

  leave() {
    this.peers -= 1
  }

  write(peerId, msg) {
    if (this.peers === 2) {
      // there's someone on the other end
      this.emit('data', peerId, msg)
    } else {
      // we're alone, save up messages until someone else joins
      this.buffer.push({ peerId, msg })
    }
  }
}

const pause = (t = 100) => new Promise(resolve => setTimeout(() => resolve(), t))
