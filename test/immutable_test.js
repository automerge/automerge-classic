const assert = require('assert')
const sinon = require('sinon')
const Immutable = require('immutable')
const Automerge = require('../src/Automerge')

describe('Automerge.initImmutable()', () => {
  let beforeDoc, afterDoc, appliedDoc, appliedDoc2, changes

  beforeEach(() => {
    beforeDoc = Automerge.change(Automerge.initImmutable(), doc => doc.document = 'watch me now')
    afterDoc = Automerge.change(beforeDoc, doc => doc.document = 'i can mash potato')
    changes = Automerge.getChanges(beforeDoc, afterDoc)
    appliedDoc = Automerge.applyChanges(beforeDoc, changes)
    appliedDoc2 = Automerge.applyChanges(appliedDoc, changes)
  })

  it('Uses Immutable.Map', () => {
    assert(beforeDoc instanceof Immutable.Map)
    assert(afterDoc instanceof Immutable.Map)
    assert(appliedDoc instanceof Immutable.Map)
    assert(appliedDoc2 instanceof Immutable.Map)
  })

  it('applies changes', () => {
    assert.equal(Automerge.save(appliedDoc), Automerge.save(afterDoc))
    assert.equal(Automerge.save(appliedDoc2), Automerge.save(afterDoc))
  })

})
