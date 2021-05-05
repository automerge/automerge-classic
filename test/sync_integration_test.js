const assert = require('assert')
const { EventEmitter } = require('events')
const A = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('sync protocol - integration', () => {
  beforeEach(() => {
    iterations = 0
  })

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

      // console.log('---------------- connecting')

      connect(alice, charlie)
      connect(alice, bob)
      connect(alice, charlie)

      // console.log('---------------- disconnecting')

      alice.disconnect()
      bob.disconnect()
      charlie.disconnect()

      // console.log('---------------- making changes')

      // each one makes a change
      alice.change(s => (s.alice = 1))
      bob.change(s => (s.bob = 1))
      charlie.change(s => (s.charlie = 1))

      // while they're disconnected, they have divergent docs
      assert.notDeepStrictEqual(alice.doc, bob.doc)
      assert.notDeepStrictEqual(bob.doc, charlie.doc)
      assert.notDeepStrictEqual(alice.doc, charlie.doc)

      // console.log('---------------- reconnecting')

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
    this.connected = true
    const peer = new Peer(this.peerId, remotePeerId, this.doc, channel)
    this.peers[remotePeerId] = peer
    peer.update(this.doc)
    peer.on('change', doc => {
      // console.log(`doc changed ${this.peerId}<-${remotePeerId}`, doc)
      this.update(doc, remotePeerId)
    })
  }

  update(doc, remotePeerId) {
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
    this.connected = false
    for (const peerId in this.peers) {
      this.peers[peerId].channel.leave()
    }
  }

  connect() {
    this.connected = true
    for (const peerId in this.peers) {
      const peer = this.peers[peerId]
      peer.channel.join()
      peer.update(this.doc)
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

    this.updates = 0

    channel.join()
    this.channel = channel
    channel.addListener('data', (senderPeerId, msg) => {
      if (senderPeerId === this.peerId) return // ignore our own messages
      this.receive(msg)
    })
  }

  update(doc) {
    const [syncState, msg] = A.generateSyncMessage(doc, this.syncState)
    this.doc = doc
    this.syncState = syncState
    this.send(msg)
  }

  receive(msg) {
    const [doc, syncState] = A.receiveSyncMessage(this.doc, this.syncState, msg)
    // console.log(`received update ${this.peerId}<-${this.remotePeerId}`, doc)
    this.doc = doc
    this.syncState = syncState
    this.emit('change', doc)
  }

  send(msg) {
    if (msg === null) return // nothing changed

    this.updates += 1
    if (this.updates > 10) throw new Error('loop detected')

    // console.log(`sending update ${this.peerId}->${this.remotePeerId}`, this.doc)
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

const pause = (t = 100) => new Promise(resolve => setTimeout(() => resolve(), t))
