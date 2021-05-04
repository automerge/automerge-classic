const assert = require('assert')
const { EventEmitter } = require('events')
const A = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('integration tests for data sync protocol', () => {
  function setup(template) {
    let doc = A.from(template)

    const channel = new Channel()
    const alice = new ConnectedDoc(channel, doc)
    const bob = new ConnectedDoc(channel, doc)

    return { alice, bob }
  }

  it(`syncs a change one way`, () => {
    const { alice, bob } = setup({ wrens: 1, goldfinches: 12 })

    // alice makes a change
    alice.change(s => {
      s.wrens = 42
    })

    assert.strictEqual(bob.doc.wrens, 42)
    assert.deepStrictEqual(alice.doc, bob.doc)
  })

  it('syncs divergent changes', () => {
    const { alice, bob } = setup({ wrens: 1, goldfinches: 12 })

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

class ConnectedDoc extends EventEmitter {
  constructor(channel, doc) {
    super()
    this.peerId = A.uuid()
    this.doc = A.clone(doc)
    this.syncState = A.initSyncState()

    // connect to channel
    this.channel = channel.join()
    this.channel.on('data', (senderPeerId, msg) => {
      if (senderPeerId === this.peerId) return // ignore messages we sent
      this.receive(msg)
    })

    // send an initial update
    this.update()
  }

  // public

  disconnect() {
    this.channel.leave()
  }

  connect() {
    this.channel.join()
  }

  // wrapper for Automerge.change that also triggers an update
  change(fn) {
    this.doc = A.change(this.doc, fn)
    this.update()
  }

  // private

  // called any time the document changes
  update() {
    const [syncState, msg] = A.generateSyncMessage(this.doc, this.syncState)
    this.syncState = syncState
    this.send(msg)
  }

  // this is called internally whenever we receive a message on the channel
  receive(msg) {
    const [doc, syncState] = A.receiveSyncMessage(this.doc, this.syncState, msg)
    this.doc = doc
    this.syncState = syncState
    this.update()
  }

  // this is called internally to send messages over the channel
  send(msg) {
    if (msg === null) return // null msg = nothing changed
    this.channel.write(this.peerId, msg)
  }
}
