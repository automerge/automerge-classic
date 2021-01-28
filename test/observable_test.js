const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('Automerge.Observable', () => {
  it('allows registering a callback on the root object', () => {
    let observable = new Automerge.Observable(), callbackCalled = false
    let doc = Automerge.init({observable}), actor = Automerge.getActorId(doc)
    observable.observe(doc, (diff, before, after, local) => {
      callbackCalled = true
      assert.deepStrictEqual(diff, {
        objectId: '_root', type: 'map', props: {bird: {[`1@${actor}`]: {value: 'Goldfinch'}}}
      })
      assert.deepStrictEqual(before, {})
      assert.deepStrictEqual(after, {bird: 'Goldfinch'})
      assert.deepStrictEqual(local, true)
    })
    doc = Automerge.change(doc, doc => doc.bird = 'Goldfinch')
    assert.strictEqual(callbackCalled, true)
  })

  it('allows registering a callback on a text object', () => {
    let observable = new Automerge.Observable(), callbackCalled = false
    let doc = Automerge.from({text: new Automerge.Text()}, {observable})
    let actor = Automerge.getActorId(doc)
    observable.observe(doc.text, (diff, before, after, local) => {
      callbackCalled = true
      assert.deepStrictEqual(diff, {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor}`},
          {action: 'insert', index: 1, elemId: `3@${actor}`},
          {action: 'insert', index: 2, elemId: `4@${actor}`}
        ], props: {
          0: {[`2@${actor}`]: {value: 'a'}},
          1: {[`3@${actor}`]: {value: 'b'}},
          2: {[`4@${actor}`]: {value: 'c'}}
        }
      })
      assert.deepStrictEqual(before.toString(), '')
      assert.deepStrictEqual(after.toString(), 'abc')
      assert.deepStrictEqual(local, true)
    })
    doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
    assert.strictEqual(callbackCalled, true)
  })

  it('should call the callback when applying remote changes', () => {
    let observable = new Automerge.Observable(), callbackCalled = false
    let local = Automerge.from({text: new Automerge.Text()}, {observable})
    let remote = Automerge.init()
    const localId = Automerge.getActorId(local), remoteId = Automerge.getActorId(remote)
    observable.observe(local.text, (diff, before, after, local) => {
      callbackCalled = true
      assert.deepStrictEqual(diff, {
        objectId: `1@${localId}`, type: 'text',
        edits: [{action: 'insert', index: 0, elemId: `2@${remoteId}`}],
        props: {0: {[`2@${remoteId}`]: {value: 'a'}}}
      })
      assert.deepStrictEqual(before.toString(), '')
      assert.deepStrictEqual(after.toString(), 'a')
      assert.deepStrictEqual(local, false)
    })
    remote = Automerge.applyChanges(remote, Automerge.getAllChanges(local))
    remote = Automerge.change(remote, doc => doc.text.insertAt(0, 'a'))
    local = Automerge.applyChanges(local, Automerge.getAllChanges(remote))
    assert.strictEqual(callbackCalled, true)
  })
})
