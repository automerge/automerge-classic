const assert = require('assert')
const A = require('../src/automerge')

describe('sync protocol - integration ', () => {
  describe('2 peers', () => {
    it('syncs a single change', () => {
      let doc = A.init()

      const network = new Network()
      const alice = new Peer('alice', doc)
      const bob = new Peer('bob', doc)

      network.connect(alice, bob)

      // alice makes a change
      alice.change(s => (s.alice = 1))

      network.deliverAll()

      assert.deepStrictEqual(alice.doc, bob.doc)
    })

    it('syncs divergent changes', () => {
      let doc = A.init()

      const network = new Network()
      const alice = new Peer('alice', doc)
      const bob = new Peer('bob', doc)

      network.connect(alice, bob)

      // alice makes a change
      alice.change(s => (s.alice = 42))

      // bob makes a change
      bob.change(s => (s.bob = 13))

      // while they're disconnected, they have divergent docs
      assert.notDeepStrictEqual(alice.doc, bob.doc)

      network.deliverAll()

      // after connecting, their docs converge
      assert.deepStrictEqual(alice.doc, bob.doc)
    })
  })

  describePeers(['a', 'b', 'c'])
  describePeers(['a', 'b', 'c', 'd'])

  // these pass but are slow
  // describePeers(['a', 'b', 'c', 'd', 'e'])
  // describePeers(['a', 'b', 'c', 'd', 'e', 'f'])
  // describePeers(['a', 'b', 'c', 'd', 'e', 'f', 'g'])

  function describePeers(users) {
    describe(`${users.length} peers`, () => {
      function connectAll(peers) {
        const network = new Network()
        peers.forEach((a, i) => {
          const followingPeers = peers.slice(i + 1)
          followingPeers.forEach(b => {
            network.connect(a, b)
          })
        })
        return network
      }

      function connectDaisyChain(peers) {
        const network = new Network()
        peers.slice(0, peers.length - 1).forEach((a, i) => {
          const b = peers[i + 1]
          network.connect(a, b)
        })
        return network
      }

      function assertAllEqual(peers) {
        peers.slice(0, peers.length - 1).forEach((a, i) => {
          const b = peers[i + 1]
          assert.deepStrictEqual(a.doc, b.doc)
        })
      }

      function assertAllDifferent(peers) {
        peers.slice(0, peers.length - 1).forEach((a, i) => {
          const b = peers[i + 1]
          assert.notDeepStrictEqual(a.doc, b.doc)
        })
      }

      it(`syncs a single change (direct connections)`, () => {
        const doc = A.init()
        const peers = users.map(name => new Peer(name, doc))

        const network = connectAll(peers)

        // first user makes a change
        peers[0].change(s => (s[users[0]] = 42))

        network.deliverAll()

        // all peers have the same doc
        assertAllEqual(peers)
      })

      it(`syncs a single change (indirect connections)`, () => {
        const doc = A.init()
        const peers = users.map(name => new Peer(name, doc))
        const network = connectDaisyChain(peers)

        // first user makes a change
        peers[0].change(s => (s[users[0]] = 42))

        network.deliverAll()

        // all peers have the same doc
        assertAllEqual(peers)
      })

      it(`syncs multiple changes (direct connections)`, () => {
        const doc = A.init()
        const peers = users.map(name => new Peer(name, doc))
        const network = connectAll(peers)

        // each user makes a change
        peers.forEach(peer => {
          peer.change(s => (s[peer.id] = 42))
          network.deliverAll()
        })

        // all peers have the same doc
        assertAllEqual(peers)
      })

      it(`syncs multiple changes (indirect connections)`, () => {
        const doc = A.init()
        const peers = users.map(name => new Peer(name, doc))
        const network = connectDaisyChain(peers)

        // each user makes a change
        peers.forEach(peer => {
          peer.change(s => (s[peer.id] = 42))
          network.deliverAll()
        })

        // all peers have the same doc
        assertAllEqual(peers)
      })

      it('syncs divergent changes (indirect connections)', function () {
        const doc = A.init()
        const peers = users.map(name => new Peer(name, doc))
        const network = connectDaisyChain(peers)

        // each user makes a change
        peers.forEach(peer => {
          peer.change(s => (s[peer.id] = 42))
        })

        // while they're disconnected, they have divergent docs
        assertAllDifferent(peers)

        network.deliverAll()

        // after connecting, their docs converge
        assertAllEqual(peers)
      })

      it('syncs conflicting divergent changes (indirect connections)', function () {
        const doc = A.init()
        const peers = users.map(name => new Peer(name, doc))
        const network = connectDaisyChain(peers)

        // each user makes a change
        peers.forEach(peer => {
          peer.change(s => (s.foo = peer.id))
        })

        // while they're disconnected, they have divergent docs
        assertAllDifferent(peers)

        network.deliverAll()

        // after connecting, their docs converge
        assertAllEqual(peers)
      })

      it('syncs divergent changes (direct connections)', function () {
        this.timeout(5 ** users.length)
        const doc = A.init()
        const peers = users.map(name => new Peer(name, doc))
        const network = connectAll(peers)

        // each user makes a change
        peers.forEach(peer => {
          peer.change(s => (s[peer.id] = 42))
        })

        // while they're disconnected, they have divergent docs
        assertAllDifferent(peers)

        network.deliverAll()

        // after connecting, their docs converge
        assertAllEqual(peers)
      })

      it('syncs conflicting divergent changes (direct connections)', function () {
        this.timeout(5 ** users.length)
        const doc = A.init()
        const peers = users.map(name => new Peer(name, doc))
        const network = connectAll(peers)

        // each user makes a change
        peers.forEach(peer => {
          peer.change(s => (s.foo = peer.id))
        })

        // while they're disconnected, they have divergent docs
        assertAllDifferent(peers)

        network.deliverAll()

        // after connecting, their docs converge
        assertAllEqual(peers)
      })
    })
  }
})

// Simulates a peer-to-peer network
class Network {
  registerPeer(peer) {
    this.peers[peer.id] = peer
    this.peers = {}
    this.queue = []

    peer.network = this
  }

  // Establishes a bidirectionial connection between two peers
  connect(a, b) {
    this.registerPeer(a)
    this.registerPeer(b)
    a.connect(b.id)
    b.connect(a.id)
  }

  // Enqueues one message to be sent from fromPeer to toPeer
  sendMessage(from, to, body) {
    this.queue.push({ from, to, body })
  }

  // Runs the protocol until all peers run out of things to say
  deliverAll() {
    let messageCount = 0
    const peerCount = Object.keys(this.peers).length
    const maxMessages = 5 ** peerCount // rough estimate

    while (this.queue.length) {
      const { to, from, body } = this.queue.shift()
      const peer = this.peers[to]
      peer.receiveMessage(from, body)

      // catch failure to converge
      if (messageCount++ > maxMessages) throw truncateStack(new Error('loop detected'))
    }
    // console.log(`${Object.keys(this.peers).length} peers, required ${messageCount} messages`)
  }
}

// One peer, which may be connected to any number of other peers
class Peer {
  constructor(id, doc) {
    this.syncStates = {}
    this.id = id
    this.doc = A.clone(doc)
  }

  // Called by Network.connect when a connection is established with a remote peer
  connect(peerId) {
    this.syncStates[peerId] = A.initSyncState()
  }

  // Performs a local change and then informs all peers
  change(fn) {
    this.doc = A.change(this.doc, fn)
    this.sync()
  }

  // Generates and enqueues messages to all peers we're connected to (unless there is nothing to send)
  sync() {
    for (const peerId in this.syncStates) {
      const prevSyncState = this.syncStates[peerId]
      const [syncState, message] = A.generateSyncMessage(this.doc, prevSyncState)
      this.syncStates[peerId] = syncState
      if (message !== null) this.network.sendMessage(this.id, peerId, message)
    }
  }

  // Called by Network when we receive a message from another peer
  receiveMessage(sender, message) {
    const [doc, syncState] = A.receiveSyncMessage(this.doc, this.syncStates[sender], message)
    this.doc = doc
    this.syncStates[sender] = syncState
    this.sync()
  }
}

const truncateStack = (err, lines = 5) => {
  err.stack = err.stack.split('\n').slice(0, lines).join('\n') // truncate repetitive stack
  return err
}
