/* eslint-disable no-unused-vars */
// This file is used for running the test suite against an alternative backend
// implementation, such as the WebAssembly version compiled from Rust.
// It needs to be loaded before the test suite files, which can be done with
// `mocha --file test/wasm.js` (shortcut: `yarn testwasm`).
// You need to set the environment variable WASM_BACKEND_PATH to the path where
// the alternative backend module can be found; typically this is something
// like `../automerge-rs/automerge-backend-wasm`.
// Since this file relies on an environment variable and filesystem paths, it
// currently only works in Node, not in a browser.

if (!process.env.WASM_BACKEND_PATH) {
  throw new RangeError('Please set environment variable WASM_BACKEND_PATH to the path of the WebAssembly backend')
}

const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const jsBackend = require('../backend')
const Frontend = require('../frontend')
const { decodeChange } = require('../backend/columnar')
const uuid = require('../src/uuid')

const path = require('path')
const wasmBackend = require(path.resolve(process.env.WASM_BACKEND_PATH))
Automerge.setDefaultBackend(wasmBackend)

describe('JavaScript-WebAssembly interoperability', () => {
  describe('from JS to Wasm', () => {
    interopTests(jsBackend, wasmBackend)
  })

  describe('from Wasm to JS', () => {
    interopTests(wasmBackend, jsBackend)
  })
})

function interopTests(sourceBackend, destBackend) {
  let source, dest
  beforeEach(() => {
    source = sourceBackend.init()
    dest = destBackend.init()
  })

  it('should set a key in a map', () => {
    const actor = uuid()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, time: 0, startOp: 1, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]
    })
    const [dest1, patch] = destBackend.applyChanges(dest, [change1])
    assert.deepStrictEqual(patch, {
      clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 1, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        bird: {[`1@${actor}`]: {type: 'value', value: 'magpie'}}
      }}
    })
  })

  it('should delete a key from a map', () => {
    const actor = uuid()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]
    })
    const [source2, p2, change2] = sourceBackend.applyLocalChange(source1, {
      actor, seq: 2, startOp: 2, time: 0, deps: [], ops: [
        {action: 'del', obj: '_root', key: 'bird', pred: [`1@${actor}`]}
      ]
    })
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    const [dest2, patch2] = destBackend.applyChanges(dest1, [change2])
    assert.deepStrictEqual(patch2, {
      clock: {[actor]: 2}, deps: [decodeChange(change2).hash], maxOp: 2, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {bird: {}}}
    })
  })

  it('should create nested maps', () => {
    const actor = uuid()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, key: 'wrens', datatype: 'int', value: 3, pred: []}
      ]
    })
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    assert.deepStrictEqual(patch1, {
      clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 2, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {wrens: {[`2@${actor}`]: {type: 'value', datatype: 'int', value: 3}}}
      }}}}
    })
  })

  it('should create lists', () => {
    const actor = uuid()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: 'chaffinch', pred: []}
      ]
    })
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    assert.deepStrictEqual(patch1, {
      clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 2, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`,
            value: {type: 'value', value: 'chaffinch'}}
        ]
      }}}}
    })
  })

  it('should delete list elements', () => {
    const actor = uuid()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: 'chaffinch', pred: []}
      ]
    })
    const [source2, p2, change2] = sourceBackend.applyLocalChange(source1, {
      actor, seq: 2, startOp: 3, time: 0, deps: [], ops: [
        {action: 'del', obj: `1@${actor}`, elemId: `2@${actor}`, pred: [`2@${actor}`]}
      ]
    })
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    const [dest2, patch2] = destBackend.applyChanges(dest1, [change2])
    assert.deepStrictEqual(patch2, {
      clock: {[actor]: 2}, deps: [decodeChange(change2).hash], maxOp: 3, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'list',
        edits: [{action: 'remove', index: 0, count: 1}]
      }}}}
    })
  })

  it('should support Text objects', () => {
    const actor = uuid()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeText', obj: '_root', key: 'text', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head',      insert: true, value: 'a', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: `2@${actor}`, insert: true, value: 'b', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: `3@${actor}`, insert: true, value: 'c', pred: []}
      ]
    })
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    assert.deepStrictEqual(patch1, {
      clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 4, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'b', 'c']},
        ],
      }}}}
    })
  })

  it('should support Table objects', () => {
    const actor = uuid(), rowId = uuid()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeTable', obj: '_root',      key: 'birds',   insert: false, pred: []},
        {action: 'makeMap',   obj: `1@${actor}`, key: rowId,     insert: false, pred: []},
        {action: 'set',       obj: `2@${actor}`, key: 'species', insert: false, value: 'Chaffinch', pred: []},
        {action: 'set',       obj: `2@${actor}`, key: 'colour',  insert: false, value: 'brown',     pred: []}
      ]
    })
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    assert.deepStrictEqual(patch1, {
      clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 4, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'table', props: {[rowId]: {[`2@${actor}`]: {
          objectId: `2@${actor}`, type: 'map', props: {
            species: {[`3@${actor}`]: {type: 'value', value: 'Chaffinch'}},
            colour:  {[`4@${actor}`]: {type: 'value', value: 'brown'}}
          }
        }}}
      }}}}
    })
  })

  it('should support Counter objects', () => {
    const actor = uuid()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'counter', value: 1, datatype: 'counter', pred: []}
      ]
    })
    const [source2, p2, change2] = sourceBackend.applyLocalChange(source1, {
      actor, seq: 2, startOp: 2, time: 0, deps: [], ops: [
        {action: 'inc', obj: '_root', key: 'counter', value: 2, pred: [`1@${actor}`]}
      ]
    })
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    const [dest2, patch2] = destBackend.applyChanges(dest1, [change2])
    assert.deepStrictEqual(patch2, {
      clock: {[actor]: 2}, deps: [decodeChange(change2).hash], maxOp: 2, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        counter: {[`1@${actor}`]: {type: 'value', value: 3, datatype: 'counter'}}
      }}
    })
  })

  it('should support Date objects', () => {
    const actor = uuid(), now = new Date()
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'now', value: now.getTime(), datatype: 'timestamp', pred: []}
      ]
    })
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    assert.deepStrictEqual(patch1, {
      clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 1, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        now: {[`1@${actor}`]: {type: 'value', value: now.getTime(), datatype: 'timestamp'}}
      }}
    })
  })

  it('should support DEFLATE-compressed changes', () => {
    let longString = '', actor = uuid()
    for (let i = 0; i < 1024; i++) longString += 'a'
    const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
      actor, seq: 1, time: 0, startOp: 1, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'longString', value: longString, pred: []}
      ]
    })
    assert.ok(change1.byteLength < 100)
    const [dest1, patch1] = destBackend.applyChanges(dest, [change1])
    assert.deepStrictEqual(patch1, {
      clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 1, pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        longString: {[`1@${actor}`]: {type: 'value', value: longString}}
      }}
    })
  })

  describe('save() and load()', () => {
    it('should work for a simple document', () => {
      const actor = uuid()
      const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
        actor, seq: 1, time: 0, startOp: 1, deps: [], ops: [
          {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
        ]
      })
      const dest1 = destBackend.load(sourceBackend.save(source1))
      const patch = destBackend.getPatch(dest1)
      assert.deepStrictEqual(patch, {
        clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {[`1@${actor}`]: {type: 'value', value: 'magpie'}}
        }}
      })
    })

    it('should allow DEFLATE-compressed columns', () => {
      let longString = '', actor = uuid()
      for (let i = 0; i < 1024; i++) longString += 'a'
      const [source1, p1, change1] = sourceBackend.applyLocalChange(source, {
        actor, seq: 1, time: 0, startOp: 1, deps: [], ops: [
          {action: 'set', obj: '_root', key: 'longString', value: longString, pred: []}
        ]
      })
      const compressedDoc = sourceBackend.save(source1)
      assert.ok(compressedDoc.byteLength < 200)
      const patch = destBackend.getPatch(destBackend.load(compressedDoc))
      assert.deepStrictEqual(patch, {
        clock: {[actor]: 1}, deps: [decodeChange(change1).hash], maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          longString: {[`1@${actor}`]: {type: 'value', value: longString}}
        }}
      })
    })

    // TODO need more tests for save() and load()
  })
}
