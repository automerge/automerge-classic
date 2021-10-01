/* eslint-disable no-unused-vars */
const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const Backend = Automerge.Backend
const { encodeChange, decodeChange } = require('../backend/columnar')
const uuid = require('../src/uuid')

function hash(change) {
  return decodeChange(encodeChange(change)).hash
}

describe('Automerge.Backend', () => {
  describe('incremental diffs', () => {
    it('should assign to a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {[`1@${actor}`]: {type: 'value', value: 'magpie'}}
        }}
      })
    })

    it('should increment a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'counter', value: 1, datatype: 'counter', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
        {action: 'inc', obj: '_root', key: 'counter', value: 2, pred: [`1@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          counter: {[`1@${actor}`]: {type: 'value', value: 3, datatype: 'counter'}}
        }}
      })
    })

    it('should make a conflict on assignment to the same key', () => {
      const change1 = {actor: '111111', seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const change2 = {actor: '222222', seq: 1, startOp: 2, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'blackbird', pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {111111: 1, 222222: 1}, deps: [hash(change2)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {
            '1@111111': {type: 'value', value: 'magpie'},
            '2@222222': {type: 'value', value: 'blackbird'}
          }
        }}
      })
    })

    it('should delete a key from a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: '_root', key: 'bird', pred: [`1@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {bird: {}}}
      })
    })

    it('should create nested maps', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, key: 'wrens', value: 3, pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'map', props: {wrens: {[`2@${actor}`]: {type: 'value', value: 3, datatype: 'int'}}}
        }}}}
      })
    })

    it('should assign to keys in nested maps', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, key: 'wrens', value: 3, pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: `1@${actor}`, key: 'sparrows', value: 15, pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'map', props: {sparrows: {[`3@${actor}`]: {type: 'value', value: 15, datatype: 'int'}}}
        }}}}
      })
    })

    it('should handle deletion of nested maps', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, key: 'wrens', value: 3, pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: '_root', key: 'birds', pred: [`1@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1, change2].map(encodeChange))
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {}}}
      })
    })

    it('should handle conflicts on nested maps', () => {
      const actor1 = uuid(), actor2 = uuid()
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor1}`, key: 'wrens', value: 3, pred: []}
      ]}
      const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: [`1@${actor1}`]},
        {action: 'set', obj: `3@${actor1}`, key: 'hawks', value: 1, pred: []}
      ]}
      const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: [`1@${actor1}`]},
        {action: 'set', obj: `3@${actor2}`, key: 'sparrows', value: 15, pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1, change2, change3].map(encodeChange))
      assert.deepStrictEqual(patch1, {
        clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), maxOp: 4, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {
          [`3@${actor1}`]: {objectId: `3@${actor1}`, type: 'map', props: {
            hawks: {[`4@${actor1}`]: {type: 'value', value: 1, datatype: 'int'}}
          }},
          [`3@${actor2}`]: {objectId: `3@${actor2}`, type: 'map', props: {
            sparrows: {[`4@${actor2}`]: {type: 'value', value: 15, datatype: 'int'}}
          }}
        }}}
      })
    })

    it('should handle updates inside conflicted map keys', () => {
      const actor1 = uuid(), actor2 = uuid()
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor1}`, key: 'hawks', value: 1, pred: []}
      ]}
      const change2 = {actor: actor2, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor2}`, key: 'sparrows', value: 15, pred: []}
      ]}
      const change3 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1), hash(change2)].sort(), ops: [
        {action: 'set', obj: `1@${actor2}`, key: 'sparrows', value: 17, pred: [`2@${actor2}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1), encodeChange(change2)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change3)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change3)], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {
          [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {}},
          [`1@${actor2}`]: {objectId: `1@${actor2}`, type: 'map', props: {
            sparrows: {[`3@${actor1}`]: {type: 'value', value: 17, datatype: 'int'}}
          }}
        }}}
      })
    })

    it('should handle updates inside deleted maps', () => {
      const actor1 = uuid(), actor2 = uuid()
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor1}`, key: 'hawks', value: 1, pred: []}
      ]}
      const change2 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: '_root', key: 'birds', pred: [`1@${actor1}`]}
      ]}
      const change3 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: `1@${actor1}`, key: 'hawks', value: 2, pred: [`2@${actor1}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1), encodeChange(change2)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change3)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change2)], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {}}}
      })
      assert.deepStrictEqual(patch2, {
        clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {}}
      })
    })

    it('should create lists', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: 'chaffinch', pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {type: 'value', value: 'chaffinch'}}
          ]
        }}}}
      })
    })

    it('should apply updates inside lists', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: 'chaffinch', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: `1@${actor}`, elemId: `2@${actor}`, value: 'greenfinch', pred: [`2@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'update', opId: `3@${actor}`, index: 0, value: {type: 'value', value: 'greenfinch'}}
          ]
        }}}}
      })
    })

    it('should apply updates to objects inside list elements', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'makeMap', obj: `1@${actor}`, elemId: '_head', insert: true, pred: []},
        {action: 'set', obj: `2@${actor}`, key: 'title', value: 'buy milk', pred: []},
        {action: 'set', obj: `2@${actor}`, key: 'done', value: false, pred: []}
      ]}
      // insert a new list element and update the existing list element in the same change
      const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
        {action: 'makeMap', obj: `1@${actor}`, elemId: '_head', insert: true, pred: []},
        {action: 'set', obj: `5@${actor}`, key: 'title', value: 'water plants', pred: []},
        {action: 'set', obj: `5@${actor}`, key: 'done', value: false, pred: []},
        {action: 'set', obj: `2@${actor}`, key: 'done', value: true, pred: [`4@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 8, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `5@${actor}`, opId: `5@${actor}`, value: {
              objectId: `5@${actor}`, type: 'map', props: {
                title: {[`6@${actor}`]: {type: 'value', value: 'water plants'}},
                done: {[`7@${actor}`]: {type: 'value', value: false}}
              }
            }},
            {action: 'update', index: 1, opId: `2@${actor}`, value: {
              objectId: `2@${actor}`, type: 'map', props: {
                done: {[`8@${actor}`]: {type: 'value', value: true}}
              }
            }}
          ]
        }}}}
      })
    })

    it('should apply updates inside conflicted list elements', () => {
      const actor1 = '01234567', actor2 = '89abcdef'
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'makeMap', obj: `1@${actor1}`, elemId: '_head', insert: true, pred: []}
      ]}
      const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'makeMap', obj: `1@${actor1}`, elemId: `2@${actor1}`, pred: [`2@${actor1}`]},
        {action: 'set', obj: `3@${actor1}`, key: 'title', value: 'buy milk', pred: []},
        {action: 'set', obj: `3@${actor1}`, key: 'done', value: false, pred: []}
      ]}
      const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'makeMap', obj: `1@${actor1}`, elemId: `2@${actor1}`, pred: [`2@${actor1}`]},
        {action: 'set', obj: `3@${actor2}`, key: 'title', value: 'water plants', pred: []},
        {action: 'set', obj: `3@${actor2}`, key: 'done', value: false, pred: []}
      ]}
      const change4 = {actor: actor1, seq: 3, startOp: 6, time: 0, deps: [hash(change2), hash(change3)].sort(), ops: [
        {action: 'set', obj: `3@${actor1}`, key: 'done', value: true, pred: [`5@${actor1}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1, change2, change3].map(encodeChange))
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change4)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor1]: 3, [actor2]: 1}, deps: [hash(change4)], maxOp: 6, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor1}`]: {
          objectId: `1@${actor1}`, type: 'list', edits: [
            {action: 'update', index: 0, opId: `3@${actor1}`, value: {
              objectId: `3@${actor1}`, type: 'map', props: {
                done: {[`6@${actor1}`]: {type: 'value', value: true}}
              }
            }},
            {action: 'update', index: 0, opId: `3@${actor2}`, value: {
              objectId: `3@${actor2}`, type: 'map', props: {}
            }}
          ]
        }}}}
      })
    })

    it('should overwrite list elements', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'makeMap', obj: `1@${actor}`, elemId: '_head', insert: true, pred: []},
        {action: 'set', obj: `2@${actor}`, key: 'title', value: 'buy milk', pred: []},
        {action: 'set', obj: `2@${actor}`, key: 'done', value: false, pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
        {action: 'makeMap', obj: `1@${actor}`, elemId: `2@${actor}`, insert: false, pred: [`2@${actor}`]},
        {action: 'set', obj: `5@${actor}`, key: 'title', value: 'water plants', pred: []},
        {action: 'set', obj: `5@${actor}`, key: 'done', value: false, pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1), encodeChange(change2)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 7, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `5@${actor}`, value: {
              objectId: `5@${actor}`, type: 'map', props: {
                title: {[`6@${actor}`]: {type: 'value', value: 'water plants'}},
                done: {[`7@${actor}`]: {type: 'value', value: false}}
              }
            }}
          ]
        }}}}
      })
    })

    it('should delete list elements', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: 'chaffinch', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: `1@${actor}`, elemId: `2@${actor}`, pred: [`2@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'remove', index: 0, count: 1}
          ]
        }}}}
      })
    })

    it('should handle list element insertion and deletion in the same change', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: 'chaffinch', pred: []},
        {action: 'del', obj: `1@${actor}`, elemId: `2@${actor}`, pred: [`2@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {type: 'value', value: 'chaffinch'}},
            {action: 'remove', index: 0, count: 1}
          ]
        }}}}
      })
    })

    it('should handle changes within conflicted objects', () => {
      const actor1 = uuid(), actor2 = uuid()
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'conflict', pred: []}
      ]}
      const change2 = {actor: actor2, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap',  obj: '_root', key: 'conflict', pred: []}
      ]}
      const change3 = {actor: actor2, seq: 2, startOp: 2, time: 0, deps: [hash(change2)], ops: [
        {action: 'set', obj: `1@${actor2}`, key: 'sparrows', value: 12, pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      const [s3, patch3] = Backend.applyChanges(s2, [encodeChange(change3)])
      assert.deepStrictEqual(patch3, {
        clock: {[actor1]: 1, [actor2]: 2}, maxOp: 2, pendingChanges: 0,
        deps: [hash(change1), hash(change3)].sort(),
        diffs: {objectId: '_root', type: 'map', props: {conflict: {
          [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'list', edits: []},
          [`1@${actor2}`]: {objectId: `1@${actor2}`, type: 'map', props: {sparrows: {[`2@${actor2}`]: {type: 'value', value: 12, datatype: 'int'}}}}
        }}}
      })
    })

    it('should support Date objects at the root', () => {
      const now = new Date()
      const actor = uuid(), change = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'now', value: now.getTime(), datatype: 'timestamp', pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [encodeChange(change)])
      assert.deepStrictEqual(patch, {
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          now: {[`1@${actor}`]: {type: 'value', value: now.getTime(), datatype: 'timestamp'}}
        }}
      })
    })

    it('should support Date objects in a list', () => {
      const now = new Date(), actor = uuid()
      const change = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'list', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: now.getTime(), datatype: 'timestamp', pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [encodeChange(change)])
      assert.deepStrictEqual(patch, {
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`,
              value: {type: 'value', value: now.getTime(), datatype: 'timestamp'}}
          ]
        }}}}
      })
    })

    it('should handle updates to an object that has been deleted', () => {
      const actor1 = uuid(), actor2 = uuid()
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor1}`, key: 'blackbirds', value: 2, pred: []}
      ]}
      const change2 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: '_root', key: 'birds', pred: [`1@${actor1}`]}
      ]}
      const change3 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: `1@${actor1}`, key: 'blackbirds', value: 2, pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      const [s3, patch3] = Backend.applyChanges(s2, [encodeChange(change3)])
      assert.deepStrictEqual(patch3, {
        clock: {[actor1]: 2, [actor2]: 1}, maxOp: 3, pendingChanges: 0,
        deps: [hash(change2), hash(change3)].sort(),
        diffs: {objectId: '_root', type: 'map', props: {}}
      })
    })

    it('should handle updates to a deleted list element', () => {
      const actor1 = uuid(), actor2 = uuid()
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'makeMap', obj: `1@${actor1}`, elemId: '_head', insert: true, pred: []},
        {action: 'set', obj: `2@${actor1}`, key: 'title', value: 'buy milk', pred: []},
        {action: 'set', obj: `2@${actor1}`, key: 'done', value: false, pred: []}
      ]}
      const change2 = {actor: actor2, seq: 1, startOp: 5, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: `1@${actor1}`, elemId: `2@${actor1}`, pred: [`2@${actor1}`]}
      ]}
      const change3 = {actor: actor1, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: `2@${actor1}`, key: 'done', value: true, pred: [`4@${actor1}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1, change2].map(encodeChange))
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change3)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change2)], maxOp: 5, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor1}`]: {
          objectId: `1@${actor1}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {
              objectId: `2@${actor1}`, type: 'map', props: {
                title: {[`3@${actor1}`]: {type: 'value', value: 'buy milk'}},
                done: {[`4@${actor1}`]: {type: 'value', value: false}}
              }
            }},
            {action: 'remove', index: 0, count: 1}
          ]
        }}}}
      })
      assert.deepStrictEqual(patch2, {
        clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), maxOp: 5, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {}}
      })
    })

    it('should handle nested maps in lists', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], value: 'first'},
        {action: 'makeMap', obj: `1@${actor}`, elemId: `2@${actor}`, insert: true, pred: []},
        {action: 'set', obj: `3@${actor}`, key: 'title', value: 'water plants', pred: []},
        {action: 'set', obj: `3@${actor}`, key: 'done', value: false, pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 5, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {type: 'value', value: 'first'}},
            {action: 'insert', index: 1, elemId: `3@${actor}`, opId: `3@${actor}`, value: {
              type: 'map',
              objectId: `3@${actor}`,
              props: {
                title: {[`4@${actor}`]: {type: 'value', value: 'water plants'}},
                done:  {[`5@${actor}`]: {type: 'value', value: false}}
              }
            }}
          ]
        }}}}
      })
    })

    it('should support inserting multiple elements in one op (int)', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'int', values: [1, 2, 3, 4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 6, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, datatype: 'int', values: [1, 2, 3, 4, 5]}
          ]
        }}}}
      })
    })

    it('should support inserting multiple elements in one op (bool)', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], values: [true, true, false, true, false]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 6, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: [true, true, false, true, false]}
          ]
        }}}}
      })
    })

    it('should support inserting multiple elements in one op (null)', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], values: [null, null, null]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 4, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: [null, null, null]}
          ]
        }}}}
      })
    })

    it('should support inserting multiple elements in one op (uint)', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'uint', values: [1, 2, 3, 4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 6, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, datatype: 'uint', values: [1, 2, 3, 4, 5]}
          ]
        }}}}
      })
    })

    it('should support inserting multiple elements in one op (float64)', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'float64', values: [1, 2, 3, 4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 6, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, datatype: 'float64', values: [1, 2, 3, 4, 5]}
          ]
        }}}}
      })
    })

    it('should support inserting multiple elements in one op (timestamp)', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'timestamp', values: [1, 2, 3, 4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 6, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, datatype: 'timestamp', values: [1, 2, 3, 4, 5]}
          ]
        }}}}
      })
    })

    it('should support inserting multiple elements in one op (counter)', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'counter', values: [1, 2, 3, 4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 6, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, datatype: 'counter', values: [1, 2, 3, 4, 5]}
          ]
        }}}}
      })
    })

    it('should throw an error if the datatype does not match the values', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'int', values: [1, true, 'hello']},
      ]}
      const s0 = Backend.init()
      assert.throws(() => { Backend.applyLocalChange(s0, change1) }, /Decode failed/)
    })

    it('should support deleting multiple elements in one op', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'int', values: [1, 2, 3, 4, 5]},
      ]}
      const change2 = {actor, seq: 2, startOp: 7, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: `1@${actor}`, elemId: `3@${actor}`, multiOp: 3, pred: [`3@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 9, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'remove', index: 1, count: 3}
          ]
        }}}}
      })
    })
  })

  describe('applyLocalChange()', () => {
    it('should apply change requests', () => {
      const change1 = {actor: '111111', seq: 1, time: 0, startOp: 1, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      const changes01 = Backend.getAllChanges(s1).map(decodeChange)
      assert.deepStrictEqual(patch1, {
        actor: '111111', seq: 1, clock: {'111111': 1}, deps: [], maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {'1@111111': {type: 'value', value: 'magpie'}}
        }}
      })
      assert.deepStrictEqual(changes01, [{
        hash: '2c2845859ce4336936f56410f9161a09ba269f48aee5826782f1c389ec01d054',
        actor: '111111', seq: 1, startOp: 1, time: 0, message: '', deps: [], ops: [
          {action: 'set', obj: '_root', key: 'bird', insert: false, value: 'magpie', pred: []}
        ]
      }])
    })

    it('should throw an exception on duplicate requests', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, time: 0, startOp: 1, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const change2 = {actor, seq: 2, time: 0, startOp: 2, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'jay', pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      const [s2, patch2] = Backend.applyLocalChange(s1, change2)
      assert.throws(() => Backend.applyLocalChange(s2, change1), /Change request has already been applied/)
      assert.throws(() => Backend.applyLocalChange(s2, change2), /Change request has already been applied/)
    })

    it('should handle frontend and backend changes happening concurrently', () => {
      const local1 = {actor: '111111', seq: 1, time: 0, startOp: 1, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const local2 = {actor: '111111', seq: 2, time: 0, startOp: 2, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'jay', pred: ['1@111111']}
      ]}
      const remote1 = {actor: '222222', seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'fish', value: 'goldfish', pred: []}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, local1)
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(remote1)])
      const [s3, patch3] = Backend.applyLocalChange(s2, local2)
      const changes = Backend.getAllChanges(s3).map(decodeChange)
      assert.deepStrictEqual(changes, [
        {hash: '2c2845859ce4336936f56410f9161a09ba269f48aee5826782f1c389ec01d054',
        actor: '111111', seq: 1, startOp: 1, time: 0, message: '', deps: [], ops: [
          {action: 'set', obj: '_root', key: 'bird', insert: false, value: 'magpie', pred: []}
        ]},
        {hash: 'efc7e9b1b809364fb1b7029d2838dd3c7cf539eea595b22f9ae665505187f6c4',
        actor: '222222', seq: 1, startOp: 1, time: 0, message: '', deps: [], ops: [
          {action: 'set', obj: '_root', key: 'fish', insert: false, value: 'goldfish', pred: []}
        ]},
        {hash: 'e7ed7a790432aba39fe7ad75fa9e02a9fc8d8e9ee4ec8c81dcc93da15a561f8a',
        actor: '111111', seq: 2, startOp: 2, time: 0, message: '', deps: [changes[0].hash], ops: [
          {action: 'set', obj: '_root', key: 'bird', insert: false, value: 'jay', pred: ['1@111111']}
        ]}
      ])
    })

    it('should detect conflicts based on the frontend version', () => {
      const local1 = {requestType: 'change', actor: '111111', seq: 1, time: 0, startOp: 1, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'goldfinch', pred: []}
      ]}
      // remote1 depends on local1; the deps field is filled in below when we've computed the hash
      const remote1 = {actor: '222222', seq: 1, startOp: 2, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: ['1@111111']}
      ]}
      // local2 is concurrent with remote1 (because version < 2)
      const local2 = {requestType: 'change', actor: '111111', seq: 2, time: 0, startOp: 2, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'jay', pred: ['1@111111']}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, local1)
      remote1.deps.push(Backend.getAllChanges(s1).map(decodeChange)[0].hash)
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(remote1)])
      const [s3, patch3] = Backend.applyLocalChange(s2, local2)
      const changes = Backend.getAllChanges(s3).map(decodeChange)
      assert.deepStrictEqual(patch3, {
        actor: '111111', seq: 2, clock: {'111111': 2, '222222': 1},
        deps: [hash(remote1)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {'2@222222': {type: 'value', value: 'magpie'}, '2@111111': {type: 'value', value: 'jay'}}
        }}
      })
      assert.deepStrictEqual(changes[2], {
        hash: '7a00e28d7fbf179708a1b0045c7f9bad93366c0e69f9af15e830dae9970a9d19',
        actor: '111111', seq: 2, startOp: 2, time: 0, message: '', deps: [changes[0].hash], ops: [
          {action: 'set', obj: '_root', key: 'bird', insert: false, value: 'jay', pred: ['1@111111']}
        ]
      })
    })

    it('should transform list indexes into element IDs', () => {
      const remote1 = {actor: '222222', seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {obj: '_root', action: 'makeList', key: 'birds', pred: []}
      ]}
      const remote2 = {actor: '222222', seq: 2, startOp: 2, time: 0, deps: [hash(remote1)], ops: [
        {obj: '1@222222', action: 'set', elemId: '_head', insert: true, value: 'magpie', pred: []}
      ]}
      const local1 = {actor: '111111', seq: 1, startOp: 2, time: 0, deps: [hash(remote1)], ops: [
        {obj: '1@222222', action: 'set', elemId: '_head', insert: true, value: 'goldfinch', pred: []}
      ]}
      const local2 = {actor: '111111', seq: 2, startOp: 3, time: 0, deps: [], ops: [
        {obj: '1@222222', action: 'set', elemId: '2@111111', insert: true, value: 'wagtail', pred: []}
      ]}
      const local3 = {actor: '111111', seq: 3, startOp: 4, time: 0, deps: [hash(remote2)], ops: [
        {obj: '1@222222', action: 'set', elemId: '2@222222', value: 'Magpie', pred: ['2@222222']},
        {obj: '1@222222', action: 'set', elemId: '2@111111', value: 'Goldfinch', pred: ['2@111111']}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(remote1)])
      const [s2, patch2] = Backend.applyLocalChange(s1, local1)
      const [s3, patch3] = Backend.applyChanges(s2, [encodeChange(remote2)])
      const [s4, patch4] = Backend.applyLocalChange(s3, local2)
      const [s5, patch5] = Backend.applyLocalChange(s4, local3)
      const changes = Backend.getAllChanges(s5).map(decodeChange)
      assert.deepStrictEqual(changes[1], {
        hash: '06392148c4a0dfff8b346ad58a3261cc15187cbf8a58779f78d54251126d4ccc',
        actor: '111111', seq: 1, startOp: 2, time: 0, message: '', deps: [hash(remote1)], ops: [
          {obj: '1@222222', action: 'set', elemId: '_head', insert: true, value: 'goldfinch', pred: []}
        ]
      })
      assert.deepStrictEqual(changes[3], {
        hash: '2801c386ec2a140376f3bef285a6e6d294a2d8fb7a180da4fbb6e2bc4f550dd9',
        actor: '111111', seq: 2, startOp: 3, time: 0, message: '', deps: [changes[1].hash], ops: [
          {obj: '1@222222', action: 'set', elemId: '2@111111', insert: true, value: 'wagtail', pred: []}
        ]
      })
      assert.deepStrictEqual(changes[4], {
        hash: '734f1dad5fb2f10970bae2baa6ce100c3b85b43072b3799d8f2e15bcd21297fc',
        actor: '111111', seq: 3, startOp: 4, time: 0, message: '',
        deps: [hash(remote2), changes[3].hash].sort(), ops: [
          {obj: '1@222222', action: 'set', elemId: '2@222222', insert: false, value: 'Magpie',    pred: ['2@222222']},
          {obj: '1@222222', action: 'set', elemId: '2@111111', insert: false, value: 'Goldfinch', pred: ['2@111111']}
        ]
      })
    })

    it('should handle list element insertion and deletion in the same change', () => {
      const local1 = {requestType: 'change', actor: '111111', seq: 1, startOp: 1, deps: [], time: 0, ops: [
        {obj: '_root', action: 'makeList', key: 'birds', pred: []}
      ]}
      const local2 = {requestType: 'change', actor: '111111', seq: 2, startOp: 2, deps: [], time: 0, ops: [
        {obj: '1@111111', action: 'set', elemId: '_head', insert: true, value: 'magpie', pred: []},
        {obj: '1@111111', action: 'del', elemId: '2@111111', pred: ['2@111111']}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, local1)
      const [s2, patch2] = Backend.applyLocalChange(s1, local2)
      const changes = Backend.getAllChanges(s2).map(decodeChange)
      assert.deepStrictEqual(patch2, {
        actor: '111111', seq: 2, clock: {'111111': 2}, deps: [], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          birds: {'1@111111': {objectId: '1@111111', type: 'list',
            edits: [
              {action: 'insert', index: 0, elemId: '2@111111', opId: '2@111111', value: {type: 'value', value: 'magpie'}},
              {action: 'remove', index: 0, count: 1}
            ]}}
        }}
      })
      assert.deepStrictEqual(changes, [{
        hash: changes[0].hash, actor: '111111', seq: 1, startOp: 1, time: 0, message: '', deps: [], ops: [
          {obj: '_root', action: 'makeList', key: 'birds', insert: false, pred: []}
        ]
      }, {
        hash: 'deef4c9b9ca378844144c4bbc5d82a52f30c95a8624f13f243fe8f1214e8e833',
        actor: '111111', seq: 2, startOp: 2, time: 0, message: '', deps: [changes[0].hash], ops: [
          {obj: '1@111111', action: 'set', elemId: '_head', insert: true, value: 'magpie', pred: []},
          {obj: '1@111111', action: 'del', elemId: '2@111111', insert: false, pred: ['2@111111']}
        ]
      }])
    })

    it('should compress changes with DEFLATE', () => {
      let longString = ''
      for (let i = 0; i < 1024; i++) longString += 'a'
      const change1 = {actor: '111111', seq: 1, time: 0, startOp: 1, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'longString', value: longString, pred: []}
      ]}
      const [s1, patch1] = Backend.applyLocalChange(Backend.init(), change1)
      const changes = Backend.getAllChanges(s1)
      const [s2, patch2] = Backend.applyChanges(Backend.init(), changes)
      assert.ok(changes[0].byteLength < 100)
      assert.deepStrictEqual(patch2, {
        clock: {'111111': 1}, deps: [hash(change1)], maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          longString: {'1@111111': {type: 'value', value: longString}}
        }}
      })
    })

    it('should support inserting multiple elements in one change (int)', () => {
      const actor = uuid()
      const localChange = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'int', values: [1, 2, 3, 4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, localChange)
      const changes = Backend.getChanges(s1, []).map(decodeChange)
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [], maxOp: 6, actor, seq: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, datatype: 'int', values: [1, 2, 3, 4, 5]}
          ]
        }}}}
      })
    })

    it('should support inserting multiple elements in one change (float64)', () => {
      const actor = uuid()
      const localChange = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'float64', values: [1, 2, 3.3, 4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, localChange)
      const changes = Backend.getChanges(s1, []).map(decodeChange)
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [], maxOp: 6, actor, seq: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, datatype: 'float64', values: [1, 2, 3.3, 4, 5]}
          ]
        }}}}
      })
    })

    it('should support deleting multiple elements in one op', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], datatype: 'int', values: [1, 2, 3, 4, 5]}
      ]}
      const change2 = {actor, seq: 2, startOp: 7, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: `1@${actor}`, elemId: `3@${actor}`, multiOp: 3, pred: [`3@${actor}`]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      const [s2, patch2] = Backend.applyLocalChange(s1, change2)
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [], maxOp: 9, actor, seq: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'remove', index: 1, count: 3}
          ]
        }}}}
      })
    })

    it('should allow a conflict to be resolved', () => {
      const change1 = {actor: '111111', seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const change2 = {actor: '222222', seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'blackbird', pred: []}
      ]}
      const change3 = {actor: '333333', seq: 1, startOp: 2, time: 0, deps: [hash(change1), hash(change2)], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'robin', pred: ['1@111111', '1@222222']}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1), encodeChange(change2)])
      const [s2, patch2] = Backend.applyLocalChange(s1, change3)
      assert.deepStrictEqual(patch2, {
        clock: {111111: 1, 222222: 1, 333333: 1}, deps: [], actor: '333333', seq: 1, maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {'2@333333': {type: 'value', value: 'robin'}}
        }}
      })

      // Check that we can change the order of `pred` without affecting the outcome
      change3.ops[0].pred.reverse()
      const s3 = Backend.init()
      const [s4, patch4] = Backend.applyChanges(s3, [encodeChange(change1), encodeChange(change2)])
      const [s5, patch5] = Backend.applyLocalChange(s4, change3)
      assert.deepStrictEqual(Backend.getHeads(s2), Backend.getHeads(s5))
    })
  })

  describe('save() and load()', () => {
    it('should reconstruct changes that resolve conflicts', () => {
      const actor1 = '8765', actor2 = '1234'
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const change2 = {actor: actor2, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'blackbird', pred: []}
      ]}
      const change3 = {actor: actor1, seq: 2, startOp: 2, time: 0, deps: [hash(change1), hash(change2)], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'robin', pred: [`1@${actor1}`, `1@${actor2}`]}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2, change3].map(encodeChange))
      const s2 = Backend.load(Backend.save(s1))
      assert.deepStrictEqual(Backend.getHeads(s2), [hash(change3)])
    })

    it('should compress columns with DEFLATE', () => {
      let longString = ''
      for (let i = 0; i < 1024; i++) longString += 'a'
      const change1 = {actor: '111111', seq: 1, time: 0, startOp: 1, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'longString', value: longString, pred: []}
      ]}
      const doc = Backend.save(Backend.loadChanges(Backend.init(), [encodeChange(change1)]))
      const patch = Backend.getPatch(Backend.load(doc))
      assert.ok(doc.byteLength < 200)
      assert.deepStrictEqual(patch, {
        clock: {'111111': 1}, deps: [hash(change1)], maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          longString: {'1@111111': {type: 'value', value: longString}}
        }}
      })
    })

    it('should load floats correctly', () => {
        // This was generated from saving a document in the Rust backend
        // Rust code:
        // ```
        // let initial_state_json: serde_json::Value = serde_json::from_str(r#"{ "birds": 3.0 }"#).unwrap();
        // let value = Value::from_json(&initial_state_json);
        // let (mut frontend, change) = Frontend::new_with_initial_state(value).unwrap();
        // let mut backend = Backend::init();
        // backend.apply_local_change(change).unwrap();
        // let bytes = backend.save().unwrap();
        // ```
        const bytes = Uint8Array.from([133, 111, 74, 131, 233, 181, 157, 86, 0, 144, 1, 1, 16, 228, 91, 238, 197, 233, 52, 66, 187, 138, 75, 115, 104, 190, 195, 159, 200, 1, 221, 158, 172, 238, 121, 38, 160, 123, 25, 33, 97, 124, 142, 27, 86, 224, 238, 83, 14, 157, 207, 233, 8, 110, 91, 151, 172, 38, 120, 221, 38, 162, 7, 1, 2, 3, 2, 19, 2, 35, 7, 53, 16, 64, 2, 86, 2, 8, 21, 7, 33, 2, 35, 2, 52, 1, 66, 2, 86, 3, 87, 8, 128, 1, 2, 127, 0, 127, 1, 127, 1, 127, 243, 145, 234, 194, 149, 47, 127, 14, 73, 110, 105, 116, 105, 97, 108, 105, 122, 97, 116, 105, 111, 110, 127, 0, 127, 7, 127, 5, 98, 105, 114, 100, 115, 127, 0, 127, 1, 1, 127, 1, 127, 133, 1, 0, 0, 0, 0, 0, 0, 8, 64, 127, 0])
        const doc = Automerge.load(bytes)
        assert.deepStrictEqual(doc, { birds: 3.0 })
    });
  })

  describe('getPatch()', () => {
    it('should include the most recent value for a key', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'blackbird', pred: [`1@${actor}`]}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {[`2@${actor}`]: {type: 'value', value: 'blackbird'}}
        }}
      })
    })

    it('should include conflicting values for a key', () => {
      const change1 = {actor: '111111', seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'magpie', pred: []}
      ]}
      const change2 = {actor: '222222', seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'bird', value: 'blackbird', pred: []}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {111111: 1, 222222: 1},
        deps: [hash(change1), hash(change2)].sort(), maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {'1@111111': {type: 'value', value: 'magpie'}, '1@222222': {type: 'value', value: 'blackbird'}}
        }}
      })
    })

    it('should handle counter increments at a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'counter', value: 1, datatype: 'counter', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
        {action: 'inc', obj: '_root', key: 'counter', value: 2, pred: [`1@${actor}`]}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          counter: {[`1@${actor}`]: {type: 'value', value: 3, datatype: 'counter'}}
        }}
      })
    })

    it('should handle deletion of a counter', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'counter', value: 1, datatype: 'counter', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
        {action: 'inc', obj: '_root', key: 'counter', value: 2, pred: [`1@${actor}`]}
      ]}
      const change3 = {actor, seq: 3, startOp: 3, time: 0, deps: [hash(change2)], ops: [
        {action: 'del', obj: '_root', key: 'counter', pred: [`1@${actor}`]}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2, change3].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 3}, deps: [hash(change3)], maxOp: 3, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {}}
      })
    })

    it('should create nested maps', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeMap', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, key: 'wrens', value: 3,     pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: `1@${actor}`, key: 'wrens', pred: [`2@${actor}`]},
        {action: 'set', obj: `1@${actor}`, key: 'sparrows', value: 15, pred: []}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 4, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'map', props: {sparrows: {[`4@${actor}`]: {type: 'value', value: 15, datatype: 'int'}}}
        }}}}
      })
    })

    it('should create lists', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: 'chaffinch', pred: []}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [encodeChange(change1)])
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {type: 'value', value: 'chaffinch'}}
          ]
        }}}}
      })
    })

    it('should include the latest state of a list', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head',      insert: true, value: 'chaffinch', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: `2@${actor}`, insert: true, value: 'goldfinch', pred: []}
      ]}
      const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: `1@${actor}`, elemId: `2@${actor}`, pred: [`2@${actor}`]},
        {action: 'set', obj: `1@${actor}`, elemId: `2@${actor}`, insert: true, value: 'greenfinch', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: `3@${actor}`, value: 'goldfinches!!', pred: [`3@${actor}`]}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 6, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'insert', index: 0, elemId: `5@${actor}`, opId: `5@${actor}`, value: {type: 'value', value: 'greenfinch'}},
            {action: 'insert', index: 1, elemId: `3@${actor}`, opId: `6@${actor}`, value: {type: 'value', value: 'goldfinches!!'}}
          ]
        }}}}
      })
    })

    it('should handle conflicts on list elements', () => {
      const actor1 = '01234567', actor2 = '89abcdef'
      const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor1}`, elemId: '_head',      insert: true, value: 'chaffinch', pred: []},
        {action: 'set', obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: true, value: 'magpie', pred: []}
      ]}
      const change2 = {actor: actor1, seq: 2, startOp: 4, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: `1@${actor1}`, elemId: `2@${actor1}`, value: 'greenfinch', pred: [`2@${actor1}`]}
      ]}
      const change3 = {actor: actor2, seq: 1, startOp: 4, time: 0, deps: [hash(change1)], ops: [
        {action: 'set', obj: `1@${actor1}`, elemId: `2@${actor1}`, value: 'goldfinch', pred: [`2@${actor1}`]}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2, change3].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), maxOp: 4, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor1}`]: {
          objectId: `1@${actor1}`, type: 'list',
          edits: [
            {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `4@${actor1}`, value: {type: 'value', value: 'greenfinch'}},
            {action: 'update', index: 0, opId: `4@${actor2}`, value: {type: 'value', value: 'goldfinch'}},
            {action: 'insert', index: 1, elemId: `3@${actor1}`, opId: `3@${actor1}`, value: {type: 'value', value: 'magpie'}}
          ]
        }}}}
      })
    })

    it('should handle nested maps in lists', () => {
      const actor = uuid()
      const change = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'makeMap', obj: `1@${actor}`, elemId: '_head', insert: true, pred: []},
        {action: 'set', obj: `2@${actor}`, key: 'title', value: 'water plants', pred: []},
        {action: 'set', obj: `2@${actor}`, key: 'done', value: false, pred: []}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [encodeChange(change)])
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 4, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {
              type: 'map',
              objectId: `2@${actor}`,
              props: {
                title: {[`3@${actor}`]: {type: 'value', value: 'water plants'}},
                done:  {[`4@${actor}`]: {type: 'value', value: false}}
              }
            }}
          ]
        }}}}
      })
    })

    it('should include Date objects at the root', () => {
      const now = new Date()
      const actor = uuid(), change = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'set', obj: '_root', key: 'now', value: now.getTime(), datatype: 'timestamp', pred: []}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [encodeChange(change)])
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 1, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {
          now: {[`1@${actor}`]: {type: 'value', value: now.getTime(), datatype: 'timestamp'}}
        }}
      })
    })

    it('should include Date objects in a list', () => {
      const now = new Date(), actor = uuid()
      const change = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'list', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head', insert: true, value: now.getTime(), datatype: 'timestamp', pred: []}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [encodeChange(change)])
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 2, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`,
             value: {type: 'value', value: now.getTime(), datatype: 'timestamp'}}
          ]
        }}}}
      })
    })

    it('should condense multiple inserts into a single edit', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head',      insert: true, value: 'chaffinch', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: `2@${actor}`, insert: true, value: 'goldfinch', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: `3@${actor}`, insert: true, values: ['bullfinch', 'greenfinch'], pred: []}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 5, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: [
              'chaffinch',
              'goldfinch',
              'bullfinch',
              'greenfinch',
            ]}
          ]
        }}}}
      })
    })

    it('should use a multi-insert only for consecutive elemIds', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'birds', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head',      insert: true, value: 'chaffinch', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: `2@${actor}`, insert: true, value: 'goldfinch', pred: []},
        {action: 'set', obj: `1@${actor}`, elemId: '_head',      insert: true, values: ['bullfinch', 'greenfinch'], pred: []}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1].map(encodeChange))
      assert.deepStrictEqual(Backend.getPatch(s1), {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 5, pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `4@${actor}`, values: ['bullfinch', 'greenfinch']},
            {action: 'multi-insert', index: 2, elemId: `2@${actor}`, values: ['chaffinch', 'goldfinch']}
          ]
        }}}}
      })
    })
  })
})
