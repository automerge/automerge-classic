const assert = require('assert')
const sinon = require('sinon')
const Immutable = require('immutable')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('Automerge.initImmutable()', () => {
  let beforeDoc, afterDoc, appliedDoc, appliedDoc2, changes

  beforeEach(() => {
    beforeDoc = Automerge.change(Automerge.initImmutable(), doc => doc.document = 'watch me now')
    afterDoc = Automerge.change(beforeDoc, doc => doc.document = 'i can mash potato')
    changes = Automerge.getChanges(beforeDoc, afterDoc)
    appliedDoc = Automerge.applyChanges(beforeDoc, changes)
    appliedDoc2 = Automerge.applyChanges(appliedDoc, changes)
  })

  if (process.env.TEST_DIST !== '1') {
    // This test is disabled when running the tests against ../dist/automerge.js, because
    // the Immutable object we import above is a different instance of the Immutable.js
    // library compared to the one that is bundled inside ../dist/automerge.js.
    it('Uses Immutable.Map', () => {
      assert(beforeDoc instanceof Immutable.Map)
      assert(afterDoc instanceof Immutable.Map)
      assert(appliedDoc instanceof Immutable.Map)
      assert(appliedDoc2 instanceof Immutable.Map)
    })
  }

  it('applies changes', () => {
    assert.equal(Automerge.save(appliedDoc), Automerge.save(afterDoc))
    assert.equal(Automerge.save(appliedDoc2), Automerge.save(afterDoc))
  })

  it('supports fetching conflicts on lists', () => {
    let s1 = Automerge.change(Automerge.initImmutable(), doc => doc.pixels = ['red'])
    let s2 = Automerge.merge(Automerge.initImmutable(), s1)
    s1 = Automerge.change(s1, doc => doc.pixels[0] = 'green')
    s2 = Automerge.change(s2, doc => doc.pixels[0] = 'blue')
    s1 = Automerge.merge(s1, s2)
    if (s1._actorId > s2._actorId) {
      assert(s1.get('pixels').equals(Immutable.List.of('green')))
      assert(Automerge.getConflicts(s1, s1.get('pixels')).equals(
        Immutable.List.of(Immutable.Map().set(s2._actorId, 'blue'))))
    } else {
      assert(s1.get('pixels').equals(Immutable.List.of('blue')))
      assert(Automerge.getConflicts(s1, s1.get('pixels')).equals(
        Immutable.List.of(Immutable.Map().set(s1._actorId, 'green'))))
    }
  })
})
