const assert = require('assert')
const sinon = require('sinon')
const Automerge = require('../src/Automerge')
const Connection = Automerge.Connection
const DocSet = Automerge.DocSet

describe('Automerge.Connection', () => {
  let docSet1, docSet2, docSet3, sendMsg1, sendMsg2, sendMsg3,
    conn1, conn2, conn3, doc1, doc2, doc3

  beforeEach(() => {
    docSet1 = new DocSet(); sendMsg1 = sinon.spy(); conn1 = new Connection(docSet1, sendMsg1)
    docSet2 = new DocSet(); sendMsg2 = sinon.spy(); conn2 = new Connection(docSet2, sendMsg2)
    docSet3 = new DocSet(); sendMsg3 = sinon.spy(); conn3 = new Connection(docSet3, sendMsg3)
    doc1 = Automerge.changeset(Automerge.init(), doc => doc.doc1 = 'doc1')
    doc2 = Automerge.changeset(Automerge.init(), doc => doc.doc2 = 'doc2')
    doc3 = Automerge.changeset(Automerge.init(), doc => doc.doc3 = 'doc3')
  })

  it('should not send messages if there are no documents', () => {
    conn1.open()
    assert(!sendMsg1.called)
  })

  it('should advertise locally available documents', () => {
    docSet1.setDoc('doc1', doc1)
    conn1.open()
    assert(sendMsg1.calledOnce)
    assert.deepEqual(sendMsg1.getCall(0).args[0],
                     {docId: 'doc1', clock: {[doc1._actorId]: 1}})
  })

  it('should send any document that does not exist remotely', () => {
    docSet1.setDoc('doc1', doc1)
    conn1.open(); conn2.open()

    conn2.receiveMsg(sendMsg1.getCall(0).args[0])
    assert(sendMsg2.calledOnce)
    assert.deepEqual(sendMsg2.getCall(0).args[0], {docId: 'doc1', clock: {}})

    conn1.receiveMsg(sendMsg2.getCall(0).args[0])
    assert(sendMsg1.calledTwice)
    assert.strictEqual(sendMsg1.getCall(1).args[0].docId, 'doc1')
    assert.strictEqual(sendMsg1.getCall(1).args[0].changes.length, 1)

    conn2.receiveMsg(sendMsg1.getCall(1).args[0])
    assert.strictEqual(docSet2.getDoc('doc1').doc1, 'doc1')
    assert(sendMsg2.calledTwice)
    assert.deepEqual(sendMsg2.getCall(1).args[0],
                     {docId: 'doc1', clock: {[doc1._actorId]: 1}})

    conn1.receiveMsg(sendMsg2.getCall(1).args[0])
    assert(sendMsg1.calledTwice) // no more messages to send
  })

  it('should receive any document that does not exist locally', () => {
    docSet1.setDoc('doc1', doc1)
    docSet2.setDoc('doc2', doc2)
    conn1.open(); conn2.open()
    assert(sendMsg1.calledOnce)
    assert(sendMsg2.calledOnce)

    conn1.receiveMsg(sendMsg2.getCall(0).args[0])
    assert(sendMsg1.calledTwice)
    assert.deepEqual(sendMsg1.getCall(1).args[0], {docId: 'doc2', clock: {}})

    conn2.receiveMsg(sendMsg1.getCall(0).args[0])
    assert(sendMsg2.calledTwice)
    assert.deepEqual(sendMsg2.getCall(1).args[0], {docId: 'doc1', clock: {}})

    conn2.receiveMsg(sendMsg1.getCall(1).args[0])
    assert(sendMsg2.calledThrice)
    assert.strictEqual(sendMsg2.getCall(2).args[0].docId, 'doc2')
    assert.strictEqual(sendMsg2.getCall(2).args[0].changes.length, 1)

    conn1.receiveMsg(sendMsg2.getCall(1).args[0])
    conn1.receiveMsg(sendMsg2.getCall(2).args[0])
    assert.strictEqual(docSet1.getDoc('doc1').doc1, 'doc1')
    assert.strictEqual(docSet1.getDoc('doc2').doc2, 'doc2')
    assert.strictEqual(sendMsg1.callCount, 4)

    conn2.receiveMsg(sendMsg1.getCall(2).args[0])
    conn2.receiveMsg(sendMsg1.getCall(3).args[0])
    assert.strictEqual(sendMsg2.callCount, 4)

    conn1.receiveMsg(sendMsg2.getCall(3).args[0])
    assert.strictEqual(sendMsg1.callCount, 4)
  })

  it('should bring an older copy up-to-date with a newer one', () => {
    doc2 = Automerge.merge(Automerge.init(), doc1)
    doc2 = Automerge.changeset(doc2, doc => doc.doc1 = 'doc1++')
    docSet1.setDoc('doc1', doc1)
    docSet2.setDoc('doc1', doc2)

    conn1.open()
    assert(sendMsg1.calledOnce)
    assert.deepEqual(sendMsg1.getCall(0).args[0],
                     {docId: 'doc1', clock: {[doc1._actorId]: 1}})

    conn2.open()
    assert(sendMsg2.calledOnce)
    assert.deepEqual(sendMsg2.getCall(0).args[0],
                     {docId: 'doc1', clock: {[doc1._actorId]: 1, [doc2._actorId]: 1}})

    conn1.receiveMsg(sendMsg2.getCall(0).args[0])
    assert(sendMsg1.calledOnce) // no need for another message, request is already in flight

    conn2.receiveMsg(sendMsg1.getCall(0).args[0])
    assert(sendMsg2.calledTwice)
    assert.strictEqual(sendMsg2.getCall(1).args[0].docId, 'doc1')
    assert.strictEqual(sendMsg2.getCall(1).args[0].changes.length, 1)

    conn1.receiveMsg(sendMsg2.getCall(1).args[0])
    assert(sendMsg1.calledTwice)
    assert.deepEqual(sendMsg1.getCall(1).args[0],
                     {docId: 'doc1', clock: {[doc1._actorId]: 1, [doc2._actorId]: 1}})

    conn2.receiveMsg(sendMsg1.getCall(1).args[0])
    assert(sendMsg2.calledTwice)
    assert.strictEqual(docSet1.getDoc('doc1').doc1, 'doc1++')
    assert.strictEqual(docSet2.getDoc('doc1').doc1, 'doc1++')
  })

  it('should bidirectionally merge divergent document copies', () => {
    doc2 = Automerge.merge(Automerge.init(), doc1)
    doc2 = Automerge.changeset(doc2, doc => doc.two = 'two')
    doc1 = Automerge.changeset(doc1, doc => doc.one = 'one')
    docSet1.setDoc('doc1', doc1)
    docSet2.setDoc('doc1', doc2)

    conn1.open()
    assert(sendMsg1.calledOnce)
    assert.deepEqual(sendMsg1.getCall(0).args[0],
                     {docId: 'doc1', clock: {[doc1._actorId]: 2}})

    conn2.receiveMsg(sendMsg1.getCall(0).args[0])
    assert(sendMsg2.calledOnce)
    assert.deepEqual(sendMsg2.getCall(0).args[0].clock,
                     {[doc1._actorId]: 1, [doc2._actorId]: 1})
    assert.strictEqual(sendMsg2.getCall(0).args[0].changes.length, 1)

    conn1.receiveMsg(sendMsg2.getCall(0).args[0])
    assert(sendMsg1.calledTwice)
    assert.deepEqual(sendMsg1.getCall(1).args[0].clock,
                     {[doc1._actorId]: 2, [doc2._actorId]: 1})
    assert.strictEqual(sendMsg1.getCall(1).args[0].changes.length, 1)

    conn2.receiveMsg(sendMsg1.getCall(1).args[0])
    assert(sendMsg2.calledOnce)
    assert.deepEqual(docSet1.getDoc('doc1'),
                     {_objectId: doc1._objectId, doc1: 'doc1', one: 'one', two: 'two'})
    assert.deepEqual(docSet2.getDoc('doc1'),
                     {_objectId: doc1._objectId, doc1: 'doc1', one: 'one', two: 'two'})
  })

  it('should forward incoming changes to other connections', () => {
    const sendMsg12 = sinon.spy(), conn12 = new Connection(docSet1, sendMsg12)
    const sendMsg13 = sinon.spy(), conn13 = new Connection(docSet1, sendMsg13)
    const sendMsg21 = sinon.spy(), conn21 = new Connection(docSet2, sendMsg21)
    const sendMsg31 = sinon.spy(), conn31 = new Connection(docSet3, sendMsg31)

    docSet2.setDoc('doc1', doc1)
    conn12.open(); conn13.open(); conn21.open(); conn31.open()
    assert(sendMsg21.calledOnce)

    conn12.receiveMsg(sendMsg21.getCall(0).args[0])
    assert(sendMsg12.calledOnce)

    conn21.receiveMsg(sendMsg12.getCall(0).args[0])
    assert(sendMsg21.calledTwice)

    conn12.receiveMsg(sendMsg21.getCall(1).args[0])
    assert.strictEqual(docSet1.getDoc('doc1').doc1, 'doc1')
    assert(sendMsg12.calledTwice)
    assert(sendMsg13.calledOnce)

    conn31.receiveMsg(sendMsg13.getCall(0).args[0])
    assert(sendMsg31.calledOnce)

    conn13.receiveMsg(sendMsg31.getCall(0).args[0])
    assert(sendMsg13.calledTwice)

    conn31.receiveMsg(sendMsg13.getCall(1).args[0])
    assert(sendMsg31.calledTwice)
    assert.strictEqual(docSet3.getDoc('doc1').doc1, 'doc1')

    conn13.receiveMsg(sendMsg31.getCall(1).args[0])
    assert(sendMsg13.calledTwice)
    assert(sendMsg12.calledTwice)

    conn21.receiveMsg(sendMsg12.getCall(1).args[0])
    assert(sendMsg21.calledTwice)
  })

  it('should tolerate duplicate message deliveries', () => {
    const sendMsg12 = sinon.spy(), conn12 = new Connection(docSet1, sendMsg12)
    const sendMsg13 = sinon.spy(), conn13 = new Connection(docSet1, sendMsg13)
    const sendMsg21 = sinon.spy(), conn21 = new Connection(docSet2, sendMsg21)
    const sendMsg23 = sinon.spy(), conn23 = new Connection(docSet2, sendMsg23)
    const sendMsg31 = sinon.spy(), conn31 = new Connection(docSet3, sendMsg31)
    const sendMsg32 = sinon.spy(), conn32 = new Connection(docSet3, sendMsg32)

    doc1 = Automerge.changeset(Automerge.init(), doc => doc.list = [])
    doc2 = Automerge.merge(Automerge.init(), doc1)
    doc3 = Automerge.merge(Automerge.init(), doc1)
    docSet1.setDoc('doc1', doc1)
    docSet2.setDoc('doc1', doc1)
    docSet3.setDoc('doc1', doc1)

    conn12.open(); conn13.open(); conn21.open(); conn23.open(); conn31.open(); conn32.open()
    conn12.receiveMsg(sendMsg21.getCall(0).args[0])
    conn21.receiveMsg(sendMsg12.getCall(0).args[0])
    conn13.receiveMsg(sendMsg31.getCall(0).args[0])
    conn31.receiveMsg(sendMsg13.getCall(0).args[0])
    conn23.receiveMsg(sendMsg32.getCall(0).args[0])
    conn32.receiveMsg(sendMsg23.getCall(0).args[0])
    assert(sendMsg12.calledOnce)
    assert(sendMsg13.calledOnce)
    assert(sendMsg21.calledOnce)
    assert(sendMsg23.calledOnce)
    assert(sendMsg31.calledOnce)
    assert(sendMsg32.calledOnce)

    doc1 = Automerge.changeset(doc1, doc => doc.list.push('hello'))
    docSet1.setDoc('doc1', doc1)
    assert(sendMsg12.calledTwice)
    assert(sendMsg13.calledTwice)
    assert.deepEqual(sendMsg12.getCall(1).args[0].clock, {[doc1._actorId]: 2})
    assert.strictEqual(sendMsg12.getCall(1).args[0].changes.length, 1)

    conn21.receiveMsg(sendMsg12.getCall(1).args[0])
    assert(sendMsg21.calledTwice)
    assert(sendMsg23.calledTwice)
    assert.deepEqual(sendMsg21.getCall(1).args[0],
                     {docId: 'doc1', clock: {[doc1._actorId]: 2}})
    assert.strictEqual(sendMsg23.getCall(1).args[0].changes.length, 1)

    conn12.receiveMsg(sendMsg21.getCall(1).args[0])
    assert(sendMsg12.calledTwice)

    conn31.receiveMsg(sendMsg13.getCall(1).args[0])
    assert(sendMsg31.calledTwice)
    assert(sendMsg32.calledTwice)
    assert.deepEqual(sendMsg31.getCall(1).args[0],
                     {docId: 'doc1', clock: {[doc1._actorId]: 2}})
    assert.strictEqual(sendMsg32.getCall(1).args[0].changes.length, 1)

    conn13.receiveMsg(sendMsg31.getCall(1).args[0])
    assert(sendMsg13.calledTwice)

    conn32.receiveMsg(sendMsg23.getCall(1).args[0])
    assert(sendMsg31.calledTwice)
    assert(sendMsg32.calledTwice)

    conn23.receiveMsg(sendMsg32.getCall(1).args[0])
    assert(sendMsg21.calledTwice)
    assert(sendMsg23.calledTwice)

    assert.deepEqual(docSet1.getDoc('doc1'), {_objectId: doc1._objectId, list: ['hello']})
    assert.deepEqual(docSet2.getDoc('doc1'), {_objectId: doc1._objectId, list: ['hello']})
    assert.deepEqual(docSet3.getDoc('doc1'), {_objectId: doc1._objectId, list: ['hello']})
  })
})
