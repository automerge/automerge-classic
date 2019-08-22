const assert = require('assert')
const sinon = require('sinon')
const Automerge =
  process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('Automerge.DocSet', () => {
  let beforeDoc
  let afterDoc
  let docSet
  let changes
  let callback
  const ID = '1'

  beforeEach(() => {
    beforeDoc = Automerge.change(Automerge.init(), doc => (doc.birds = ['goldfinch']))
    afterDoc = Automerge.change(beforeDoc, doc => (doc.birds = ['swallows']))
    changes = Automerge.getChanges(beforeDoc, afterDoc)
    docSet = new Automerge.DocSet()
    docSet.setDoc(ID, beforeDoc)
    callback = sinon.spy()
    docSet.registerHandler(callback)
  })

  it('should have a document inside the docset', () => {
    assert.strictEqual(docSet.getDoc(ID), beforeDoc)
  })

  it('should call the handler via set', () => {
    docSet.setDoc(ID, afterDoc)
    assert.strictEqual(callback.calledOnce, true)
    assert.deepEqual(docSet.getDoc(ID), afterDoc)
  })

  it('should call the handler via applyChanges', () => {
    docSet.applyChanges(ID, changes)
    assert.strictEqual(callback.calledOnce, true)
    assert.deepEqual(docSet.getDoc(ID), afterDoc)
  })

  it('should allow removing the handler', () => {
    docSet.unregisterHandler(callback)
    docSet.applyChanges(ID, changes)
    assert.strictEqual(callback.notCalled, true)
  })

  it('should allow removing a document', () => {
    docSet.removeDoc(ID)
    assert.strictEqual(docSet.getDoc(ID), undefined)
  })
})
