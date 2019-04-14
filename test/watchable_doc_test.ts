import * as assert from 'assert'
import * as Automerge from 'automerge'
import { Change } from 'automerge'
import sinon from 'sinon'

describe('Automerge.WatchableDoc', () => {
  interface TestDoc {
    document: string
  }
  let watchDoc: Automerge.WatchableDoc<TestDoc>
  let beforeDoc: TestDoc
  let afterDoc: TestDoc
  let changes: Change[]
  let callback: sinon.SinonSpy

  beforeEach(() => {
    beforeDoc = Automerge.change(Automerge.init<TestDoc>(), doc => (doc.document = 'watch me now'))
    afterDoc = Automerge.change(beforeDoc, doc => (doc.document = 'i can mash potato'))
    changes = Automerge.getChanges(beforeDoc, afterDoc)
    watchDoc = new Automerge.WatchableDoc(beforeDoc)
    callback = sinon.spy()
    watchDoc.registerHandler(callback)
  })

  it('should have a document inside the docset', () => {
    assert.strictEqual(watchDoc.get(), beforeDoc)
  })

  it('should call the handler via set', () => {
    watchDoc.set(afterDoc)
    assert.strictEqual(callback.calledOnce, true)
    assert.deepEqual(watchDoc.get(), afterDoc)
  })

  it('should call the handler via applyChanges', () => {
    watchDoc.applyChanges(changes)
    assert.strictEqual(callback.calledOnce, true)
    assert.deepEqual(watchDoc.get(), afterDoc)
  })

  it('should allow removing the handler', () => {
    watchDoc.unregisterHandler(callback)
    watchDoc.applyChanges(changes)
    assert.strictEqual(callback.notCalled, true)
  })
})
