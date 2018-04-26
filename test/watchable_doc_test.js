const assert = require('assert')
const sinon = require('sinon')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const WatchableDoc = Automerge.WatchableDoc

describe('Automerge.WatchableDoc', () => {
  let watchDoc, beforeDoc, afterDoc, changes

  beforeEach(() => {
    beforeDoc = Automerge.change(Automerge.init(), doc => doc.document = 'watch me now')
    afterDoc = Automerge.change(beforeDoc, doc => doc.document = 'i can mash potato')
    changes = Automerge.getChanges(beforeDoc, afterDoc)
    watchDoc = new WatchableDoc(beforeDoc)
  })
  
  it('should have a document inside the docset', () => {
    assert.strictEqual(watchDoc.get(), beforeDoc)
  })

  it('should call the handler via set', () => {
    let callback = sinon.spy();
    watchDoc.registerHandler(callback);
    watchDoc.set(afterDoc)
    assert(callback.calledOnce)
    assert.deepEqual(watchDoc.get(), afterDoc)
  })

  it('should call the handler via applyChanges', () => {
    let callback = sinon.spy();
    watchDoc.registerHandler(callback);
    watchDoc.applyChanges(changes)
    assert(callback.calledOnce)
    assert.deepEqual(watchDoc.get(), afterDoc)
  })

  it('should allow removing the handler', () => {
    let callback = sinon.spy();
    watchDoc.registerHandler(callback);
    watchDoc.unregisterHandler(callback);
    watchDoc.applyChanges(changes)
    assert(callback.notCalled)
  })
})
