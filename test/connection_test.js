const assert = require('assert')
const sinon = require('sinon')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const Connection = Automerge.Connection
const DocSet = Automerge.DocSet

describe('Automerge.Connection', () => {
  let doc1, nodes

  beforeEach(() => {
    doc1 = Automerge.change(Automerge.init(), doc => doc.doc1 = 'doc1')
    nodes = []
    for (let i = 0; i < 5; i++) nodes.push(new DocSet())
  })

  // Mini-DSL for describing the message exchanges between nodes
  function execution(links, steps) {
    let count = [], spies = [], conns = [], allConns = []

    for (let link of links) {
      let n1 = link[0], n2 = link[1]
      if (!count[n1]) count[n1] = []; count[n1][n2] = 0
      if (!count[n2]) count[n2] = []; count[n2][n1] = 0
      if (!spies[n1]) spies[n1] = []; spies[n1][n2] = sinon.spy()
      if (!spies[n2]) spies[n2] = []; spies[n2][n1] = sinon.spy()
      if (!conns[n1]) conns[n1] = []; conns[n1][n2] = new Connection(nodes[n1], spies[n1][n2])
      if (!conns[n2]) conns[n2] = []; conns[n2][n1] = new Connection(nodes[n2], spies[n2][n1])
      allConns.push(conns[n1][n2], conns[n2][n1])
    }

    for (let conn of allConns) conn.open()

    for (let step of steps) {
      if (typeof step === 'function') {
        step()
      } else if (typeof step === 'object') {
        if (spies[step.from][step.to].callCount <= count[step.from][step.to]) {
          throw new Error('Expected message was not sent at step: ' + JSON.stringify(step))
        }

        let msg = spies[step.from][step.to].getCall(count[step.from][step.to]).args[0]
        if (step.match) step.match(msg)

        if (step.deliver) {
          count[step.from][step.to] += 1
          conns[step.to][step.from].receiveMsg(msg)
        } else if (step.drop) {
          count[step.from][step.to] += 1
        }
      }
    }

    function checkCallCount(n1, n2) {
      if (spies[n1][n2].callCount !== count[n1][n2]) {
        throw new Error(`Expected ${count[n1][n2]} messages from node ${n1} to node ${n2}, ` +
                        `but saw ${spies[n1][n2].callCount} messages`
        )
      }
    }

    for (let link of links) {
      checkCallCount(link[0], link[1])
      checkCallCount(link[1], link[0])
    }
  }

  it('should not send messages if there are no documents', () => {
    execution([[1, 2]], [])
  })

  it('should advertise locally available documents', () => {
    nodes[1].setDoc('doc1', doc1)

    execution([[1, 2]], [
      {from: 1, to: 2, drop: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 1}})
      }}
    ])
  })

  it('should send any document that does not exist remotely', () => {
    nodes[1].setDoc('doc1', doc1)

    execution([[1, 2]], [
      // Node 1 advertises document
      {from: 1, to: 2, deliver: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 1}})
      }},

      // Node 2 requests document
      {from: 2, to: 1, deliver: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {}})
      }},

      // Node 1 responds with document data
      {from: 1, to: 2, deliver: true, match(msg) {
        assert.strictEqual(msg.docId, 'doc1')
        assert.strictEqual(msg.changes.length, 1)
      }},

      () => { assert.strictEqual(nodes[2].getDoc('doc1').doc1, 'doc1') },

      // Node 2 acknowledges receipt
      {from: 2, to: 1, deliver: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 1}})
      }}
    ])
  })

  it('should concurrently exchange any missing documents', () => {
    let doc2 = Automerge.change(Automerge.init(), doc => doc.doc2 = 'doc2')
    nodes[1].setDoc('doc1', doc1)
    nodes[2].setDoc('doc2', doc2)

    execution([[1, 2]], [
      // The two nodes concurrently and independently send an initial advertisement
      {from: 1, to: 2, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 1}})
      }},
      {from: 2, to: 1, match(msg) {
        assert.deepEqual(msg, {docId: 'doc2', clock: {[Automerge.getActorId(doc2)]: 1}})
      }},
      {from: 1, to: 2, deliver: true}, {from: 2, to: 1, deliver: true},

      // The two requests for missing documents cross over
      {from: 1, to: 2, match(msg) {
        assert.deepEqual(msg, {docId: 'doc2', clock: {}})
      }},
      {from: 2, to: 1, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {}})
      }},
      {from: 1, to: 2, deliver: true}, {from: 2, to: 1, deliver: true},

      // The two document data responses
      {from: 1, to: 2, match(msg) {
        assert.strictEqual(msg.docId, 'doc1')
        assert.strictEqual(msg.changes.length, 1)
      }},
      {from: 2, to: 1, match(msg) {
        assert.strictEqual(msg.docId, 'doc2')
        assert.strictEqual(msg.changes.length, 1)
      }},
      {from: 1, to: 2, deliver: true}, {from: 2, to: 1, deliver: true},

      // The two acknowledgements
      {from: 1, to: 2, deliver: true}, {from: 2, to: 1, deliver: true}
    ])
  })

  it('should bring an older copy up-to-date with a newer one', () => {
    let doc2 = Automerge.merge(Automerge.init(), doc1)
    doc2 = Automerge.change(doc2, doc => doc.doc1 = 'doc1++')
    nodes[1].setDoc('doc1', doc1)
    nodes[2].setDoc('doc1', doc2)

    execution([[1, 2]], [
      // Initial advertisement messages
      {from: 1, to: 2, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 1}})
      }},
      {from: 2, to: 1, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {
          [Automerge.getActorId(doc1)]: 1,
          [Automerge.getActorId(doc2)]: 1
        }})
      }},
      {from: 1, to: 2, deliver: true}, {from: 2, to: 1, deliver: true},

      // Node 2 sends missing changes to node 1
      {from: 2, to: 1, deliver: true, match(msg) {
        assert.strictEqual(msg.docId, 'doc1')
        assert.strictEqual(msg.changes.length, 1)
      }},

      // Node 1 acknowledges the change, and that's it
      {from: 1, to: 2, deliver: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {
          [Automerge.getActorId(doc1)]: 1,
          [Automerge.getActorId(doc2)]: 1
        }})
      }}
    ])

    assert.strictEqual(nodes[1].getDoc('doc1').doc1, 'doc1++')
    assert.strictEqual(nodes[2].getDoc('doc1').doc1, 'doc1++')
  })

  it('should bidirectionally merge divergent document copies', () => {
    let doc2 = Automerge.merge(Automerge.init(), doc1)
    doc2 = Automerge.change(doc2, doc => doc.two = 'two')
    doc1 = Automerge.change(doc1, doc => doc.one = 'one')
    nodes[1].setDoc('doc1', doc1)
    nodes[2].setDoc('doc1', doc2)

    execution([[1, 2]], [
      // Node 1 sends an advertisement but node 2 doesn't (for whatever reason)
      {from: 1, to: 2, deliver: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 2}})
      }},
      {from: 2, to: 1, drop: true},

      // Node 2 sends the change that node 1 is missing
      {from: 2, to: 1, deliver: true, match(msg) {
        assert.deepEqual(msg.clock, {
          [Automerge.getActorId(doc1)]: 1,
          [Automerge.getActorId(doc2)]: 1
        })
        assert.strictEqual(msg.changes.length, 1)
      }},

      // Node 1 acknowledges node 2's change, and sends the change that node 2 is missing
      {from: 1, to: 2, deliver: true, match(msg) {
        assert.deepEqual(msg.clock, {
          [Automerge.getActorId(doc1)]: 2,
          [Automerge.getActorId(doc2)]: 1
        })
        assert.strictEqual(msg.changes.length, 1)
      }},

      // Node 2 acknowledges node 1's change
      {from: 2, to: 1, deliver: true, match(msg) {
        assert.deepEqual(msg.clock, {
          [Automerge.getActorId(doc1)]: 2,
          [Automerge.getActorId(doc2)]: 1
        })
      }}
    ])

    assert.deepEqual(nodes[1].getDoc('doc1'), {doc1: 'doc1', one: 'one', two: 'two'})
    assert.deepEqual(nodes[2].getDoc('doc1'), {doc1: 'doc1', one: 'one', two: 'two'})
  })

  it('should forward incoming changes to other connections', () => {
    nodes[2].setDoc('doc1', doc1)

    execution([[1, 2], [1, 3]], [
      // Node 2 advertises the document
      {from: 2, to: 1, deliver: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 1}})
      }},

      // Node 1 requests the document from node 2
      {from: 1, to: 2, deliver: true},

      // Node 2 sends the document to node 1
      {from: 2, to: 1, deliver: true},
      () => { assert.strictEqual(nodes[1].getDoc('doc1').doc1, 'doc1') },

      // Node 1 sends acknowledgement to node 2, and advertisement to node 3
      {from: 1, to: 2, deliver: true},
      {from: 1, to: 3, deliver: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 1}})
      }},

      // Node 3 requests the document from node 1
      {from: 3, to: 1, deliver: true},

      // Node 1 sends the document to node 3
      {from: 1, to: 3, deliver: true},
      () => { assert.strictEqual(nodes[3].getDoc('doc1').doc1, 'doc1') },

      // Node 3 sends acknowledgement to node 1
      {from: 3, to: 1, deliver: true}
    ])
  })

  it('should tolerate duplicate message deliveries', () => {
    doc1 = Automerge.change(Automerge.init(), doc => doc.list = [])
    let doc2 = Automerge.merge(Automerge.init(), doc1)
    let doc3 = Automerge.merge(Automerge.init(), doc1)
    nodes[1].setDoc('doc1', doc1)
    nodes[2].setDoc('doc1', doc1)
    nodes[3].setDoc('doc1', doc1)

    execution([[1, 2], [1, 3], [2, 3]], [
      // Advertisement messages
      {from: 1, to: 2, deliver: true},
      {from: 1, to: 3, deliver: true},
      {from: 2, to: 1, deliver: true},
      {from: 2, to: 3, deliver: true},
      {from: 3, to: 1, deliver: true},
      {from: 3, to: 2, deliver: true},

      // Change made on node 1, propagated to nodes 2 and 3
      () => {
        doc1 = Automerge.change(doc1, doc => doc.list.push('hello'))
        nodes[1].setDoc('doc1', doc1)
      },
      {from: 1, to: 2, deliver: true, match(msg) {
        assert.deepEqual(msg.clock, {[Automerge.getActorId(doc1)]: 2})
        assert.strictEqual(msg.changes.length, 1)
      }},
      {from: 1, to: 3, match(msg) {
        assert.deepEqual(msg.clock, {[Automerge.getActorId(doc1)]: 2})
        assert.strictEqual(msg.changes.length, 1)
      }},

      // Node 2 acknowledges to node 1, and forwards to node 3
      {from: 2, to: 1, deliver: true, match(msg) {
        assert.deepEqual(msg, {docId: 'doc1', clock: {[Automerge.getActorId(doc1)]: 2}})
      }},
      {from: 2, to: 3, match(msg) {
        assert.strictEqual(msg.changes.length, 1)
      }},

      // Now node 3 receives the change notifications from nodes 1 and 2
      {from: 1, to: 3, deliver: true},
      {from: 2, to: 3, deliver: true},

      // Acknowledgements from node 3
      {from: 3, to: 1, deliver: true, match(msg) {
        assert.deepEqual(msg.clock, {[Automerge.getActorId(doc1)]: 2})
      }},
      {from: 3, to: 2, deliver: true, match(msg) {
        assert.deepEqual(msg.clock, {[Automerge.getActorId(doc1)]: 2})
      }}
    ])

    assert.deepEqual(nodes[1].getDoc('doc1'), {list: ['hello']})
    assert.deepEqual(nodes[2].getDoc('doc1'), {list: ['hello']})
    assert.deepEqual(nodes[3].getDoc('doc1'), {list: ['hello']})
  })
})
