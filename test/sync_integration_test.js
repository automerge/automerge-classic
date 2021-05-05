const assert = require('assert')
const { EventEmitter } = require('events')
const A = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('sync protocol - integration', () => {
  describe('two peers', () => {
    it(`syncs a single change`, () => {
      let doc = A.from({ wrens: 1, goldfinches: 12 })

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)

      connect(alice, bob)

      // alice makes a change
      alice.change(s => {
        s.wrens = 42
      })

      // bob gets the changes
      assert.strictEqual(bob.doc.wrens, 42)
      assert.deepStrictEqual(alice.doc, bob.doc)
    })

    it('syncs divergent changes', () => {
      let doc = A.from({ wrens: 1, goldfinches: 12 })

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)

      connect(alice, bob)

      alice.disconnect()

      // alice makes a change
      alice.change(s => (s.wrens = 42))

      // bob makes a change
      bob.change(s => (s.goldfinches = 0))

      // while they're disconnected, they have divergent docs
      assert.strictEqual(bob.doc.wrens, 1)
      assert.strictEqual(alice.doc.goldfinches, 12)
      assert.notDeepStrictEqual(alice.doc, bob.doc)

      alice.connect()

      // after connecting, their docs converge
      assert.strictEqual(bob.doc.wrens, 42)
      assert.strictEqual(alice.doc.goldfinches, 0)
      assert.deepStrictEqual(alice.doc, bob.doc)
    })
  })

  describe('three peers', () => {
    it(`syncs a single change`, () => {
      let doc = A.from({ wrens: 1, goldfinches: 12 })

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)
      const charlie = new ConnectedDoc('charlie', doc)

      connect(alice, bob)
      connect(bob, charlie)

      // alice makes a change
      alice.change(s => {
        s.wrens = 42
      })

      // charlie gets the changes (via bob)
      assert.strictEqual(charlie.doc.wrens, 42)
      assert.deepStrictEqual(alice.doc, charlie.doc)
    })

    it(`syncs a single change (all connected to all)`, () => {
      let doc = A.from({ wrens: 1, goldfinches: 12 })

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)
      const charlie = new ConnectedDoc('charlie', doc)

      connect(alice, bob)
      connect(bob, charlie)
      connect(alice, charlie)

      // alice makes a change
      alice.change(s => {
        s.wrens = 42
      })

      // charlie gets the changes (via bob)
      assert.strictEqual(charlie.doc.wrens, 42)
      assert.deepStrictEqual(alice.doc, charlie.doc)
    })

    it.only('syncs divergent changes', () => {
      let doc = A.from({ wrens: 1, goldfinches: 12 })

      const alice = new ConnectedDoc('alice', doc)
      const bob = new ConnectedDoc('bob', doc)
      const charlie = new ConnectedDoc('charlie', doc)

      connect(alice, bob)
      connect(bob, charlie)
      connect(alice, charlie)

      alice.disconnect()
      bob.disconnect()
      charlie.disconnect()

      // each one makes a change
      alice.change(s => (s.wrens = 42))
      bob.change(s => (s.goldfinches = 0))
      charlie.change(s => (s.cassowaries = 13))

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

function connect(a, b) {
  const channel = new Channel()
  a.connectTo(b.peerId, channel)
  b.connectTo(a.peerId, channel)
}

class ConnectedDoc extends EventEmitter {
  constructor(peerId, doc) {
    super()
    this.peerId = peerId
    this.doc = A.clone(doc)
    this.peers = {}
  }

  connectTo(remotePeerId, channel) {
    const peer = new Peer(this.peerId, remotePeerId, this.doc, channel)
    this.peers[remotePeerId] = peer
    peer.update(this.doc)
    peer.on('change', doc => this.update(doc))
  }

  update(doc) {
    this.doc = doc
    for (const peerId in this.peers) {
      this.peers[peerId].update(doc)
    }
  }

  change(fn) {
    const updatedDoc = A.change(this.doc, fn)
    this.update(updatedDoc)
  }

  disconnect() {
    for (const peerId in this.peers) {
      this.peers[peerId].channel.leave()
    }
  }

  connect() {
    for (const peerId in this.peers) {
      this.peers[peerId].channel.join()
    }
  }
}

class Peer extends EventEmitter {
  constructor(peerId, remotePeerId, doc, channel) {
    super()
    this.syncState = A.initSyncState()
    this.peerId = peerId
    this.remotePeerId = remotePeerId
    this.doc = doc

    channel.join()
    this.channel = channel
    channel.addListener('data', (senderPeerId, msg) => {
      if (senderPeerId === this.peerId) return // ignore our own messages
      this.receive(msg)
    })
  }

  update(doc) {
    try {
      const [syncState, msg] = A.generateSyncMessage(doc, this.syncState)
      this.doc = doc
      this.syncState = syncState
      this.send(msg)
    } catch (e) {
      if (e.message.startsWith('Attempting to use an outdated Automerge document')) return
      else throw e
    }
  }

  receive(msg) {
    try {
      const [doc, syncState] = A.receiveSyncMessage(this.doc, this.syncState, msg)
      this.syncState = syncState
      this.update(doc)
      this.emit('change', doc)
    } catch (e) {
      if (e.message.startsWith('Attempting to use an outdated Automerge document')) return
      else throw e
    }
  }

  send(msg) {
    if (msg === null) return // nothing changed
    console.log(`sending update ${this.peerId}->${this.remotePeerId}`, this.doc)
    this.channel.write(this.peerId, msg)
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
