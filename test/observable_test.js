const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('Automerge.Observable', () => {
  it('allows registering a callback on the root object', () => {
    let observable = new Automerge.Observable(), callbackChanges
    let doc = Automerge.init({observable}), actor = Automerge.getActorId(doc)
    observable.observe(doc, (diff, before, after, local, changes) => {
      callbackChanges = changes
      assert.deepStrictEqual(diff, {
        objectId: '_root', type: 'map', props: {bird: {[`1@${actor}`]: {type: 'value', value: 'Goldfinch'}}}
      })
      assert.deepStrictEqual(before, {})
      assert.deepStrictEqual(after, {bird: 'Goldfinch'})
      assert.strictEqual(local, true)
      assert.strictEqual(changes.length, 1)
    })
    doc = Automerge.change(doc, doc => doc.bird = 'Goldfinch')
    assert.strictEqual(callbackChanges.length, 1)
    assert.ok(callbackChanges[0] instanceof Uint8Array)
    assert.strictEqual(callbackChanges[0], Automerge.getLastLocalChange(doc))
  })

  it('allows registering a callback on a text object', () => {
    let observable = new Automerge.Observable(), callbackCalled = false
    let doc = Automerge.from({text: new Automerge.Text()}, {observable})
    let actor = Automerge.getActorId(doc)
    observable.observe(doc.text, (diff, before, after, local) => {
      callbackCalled = true
      assert.deepStrictEqual(diff, {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'b', 'c']}
        ]
      })
      assert.deepStrictEqual(before.toString(), '')
      assert.deepStrictEqual(after.toString(), 'abc')
      assert.deepStrictEqual(local, true)
    })
    doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
    assert.strictEqual(callbackCalled, true)
  })

  it('should call the callback when applying remote changes', () => {
    let observable = new Automerge.Observable(), callbackChanges
    let local = Automerge.from({text: new Automerge.Text()}, {observable})
    let remote = Automerge.init()
    const localId = Automerge.getActorId(local), remoteId = Automerge.getActorId(remote)
    observable.observe(local.text, (diff, before, after, local, changes) => {
      callbackChanges = changes
      assert.deepStrictEqual(diff, {
        objectId: `1@${localId}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${remoteId}`, opId: `2@${remoteId}`, value: {type: 'value', value: 'a'}}
        ]
      })
      assert.deepStrictEqual(before.toString(), '')
      assert.deepStrictEqual(after.toString(), 'a')
      assert.deepStrictEqual(local, false)
    })
    ;[remote] = Automerge.applyChanges(remote, Automerge.getAllChanges(local))
    remote = Automerge.change(remote, doc => doc.text.insertAt(0, 'a'))
    const allChanges = Automerge.getAllChanges(remote)
    ;[local] = Automerge.applyChanges(local, allChanges)
    assert.strictEqual(callbackChanges, allChanges)
  })

  it('should observe objects nested inside list elements', () => {
    let observable = new Automerge.Observable(), callbackCalled = false
    let doc = Automerge.from({todos: [{title: 'Buy milk', done: false}]}, {observable})
    const actor = Automerge.getActorId(doc)
    observable.observe(doc.todos[0], (diff, before, after, local) => {
      callbackCalled = true
      assert.deepStrictEqual(diff, {
        objectId: `2@${actor}`, type: 'map', props: {done: {[`5@${actor}`]: {type: 'value', value: true}}}
      })
      assert.deepStrictEqual(before, {title: 'Buy milk', done: false})
      assert.deepStrictEqual(after, {title: 'Buy milk', done: true})
      assert.strictEqual(local, true)
    })
    doc = Automerge.change(doc, doc => doc.todos[0].done = true)
    assert.strictEqual(callbackCalled, true)
  })

  it('should provide before and after states if list indexes changed', () => {
    let observable = new Automerge.Observable(), callbackCalled = false
    let doc = Automerge.from({todos: [{title: 'Buy milk', done: false}]}, {observable})
    const actor = Automerge.getActorId(doc)
    observable.observe(doc.todos[0], (diff, before, after, local) => {
      callbackCalled = true
      assert.deepStrictEqual(diff, {
        objectId: `2@${actor}`, type: 'map', props: {done: {[`8@${actor}`]: {type: 'value', value: true}}}
      })
      assert.deepStrictEqual(before, {title: 'Buy milk', done: false})
      assert.deepStrictEqual(after, {title: 'Buy milk', done: true})
      assert.strictEqual(local, true)
    })
    doc = Automerge.change(doc, doc => {
      doc.todos.unshift({title: 'Water plants', done: false})
      doc.todos[1].done = true
    })
    assert.strictEqual(callbackCalled, true)
  })

  it('should observe rows inside tables', () => {
    let observable = new Automerge.Observable(), callbackCalled = false
    let doc = Automerge.init({observable}), actor = Automerge.getActorId(doc), rowId
    doc = Automerge.change(doc, doc => {
      doc.todos = new Automerge.Table()
      rowId = doc.todos.add({title: 'Buy milk', done: false})
    })
    observable.observe(doc.todos.byId(rowId), (diff, before, after, local) => {
      callbackCalled = true
      assert.deepStrictEqual(diff, {
        objectId: `2@${actor}`, type: 'map', props: {done: {[`5@${actor}`]: {type: 'value', value: true}}}
      })
      assert.deepStrictEqual(before, {id: rowId, title: 'Buy milk', done: false})
      assert.deepStrictEqual(after, {id: rowId, title: 'Buy milk', done: true})
      assert.strictEqual(local, true)
    })
    doc = Automerge.change(doc, doc => doc.todos.byId(rowId).done = true)
    assert.strictEqual(callbackCalled, true)
  })

  it('should observe nested objects inside text', () => {
    let observable = new Automerge.Observable(), callbackCalled = false
    let doc = Automerge.init({observable}), actor = Automerge.getActorId(doc)
    doc = Automerge.change(doc, doc => {
      doc.text = new Automerge.Text()
      doc.text.insertAt(0, 'a', 'b', {start: 'bold'}, 'c', {end: 'bold'})
    })
    observable.observe(doc.text.get(2), (diff, before, after, local) => {
      callbackCalled = true
      assert.deepStrictEqual(diff, {
        objectId: `4@${actor}`, type: 'map', props: {start: {[`9@${actor}`]: {type: 'value', value: 'italic'}}}
      })
      assert.deepStrictEqual(before, {start: 'bold'})
      assert.deepStrictEqual(after, {start: 'italic'})
      assert.strictEqual(local, true)
    })
    doc = Automerge.change(doc, doc => doc.text.get(2).start = 'italic')
    assert.strictEqual(callbackCalled, true)
  })

  it('should not allow observers on non-document objects', () => {
    let observable = new Automerge.Observable()
    let doc = Automerge.init({observable})
    assert.throws(() => {
      Automerge.change(doc, doc => {
        const text = new Automerge.Text()
        doc.text = text
        observable.observe(text, () => {})
      })
    }, /The observed object must be part of an Automerge document/)
  })

  it('should allow multiple observers', () => {
    let observable = new Automerge.Observable(), called1 = false, called2 = false
    let doc = Automerge.init({observable})
    observable.observe(doc, () => { called1 = true })
    observable.observe(doc, () => { called2 = true })
    Automerge.change(doc, doc => doc.foo = 'bar')
    assert.strictEqual(called1, true)
    assert.strictEqual(called2, true)
  })
})
