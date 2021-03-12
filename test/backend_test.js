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
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 1,
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 2,
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
        clock: {111111: 1, 222222: 1}, deps: [hash(change2)], maxOp: 2,
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 2,
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
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 2,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'map', props: {wrens: {[`2@${actor}`]: {type: 'value', value: 3}}}
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'map', props: {sparrows: {[`3@${actor}`]: {type: 'value', value: 15}}}
        }}}}
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
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 2,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [{action: 'insert', index: 0, elemId: `2@${actor}`, value: {type: 'value', value: 'chaffinch'}}],
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
            objectId: `1@${actor}`, type: 'list', edits: [{
                action: 'update',
                opId: `3@${actor}`,
                value: {type: 'value', value: 'greenfinch'},
                index: 0,
            }],
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [{action: 'remove', index: 0, count: 1}]
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 3,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, value: {type: 'value', value: 'chaffinch'}},
            {action: 'remove', index: 0, count: 1}
          ], 
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
        clock: {[actor1]: 1, [actor2]: 2}, maxOp: 2,
        deps: [hash(change1), hash(change3)].sort(), 
        diffs: {objectId: '_root', type: 'map', props: {conflict: {
          [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'list', edits: []},
          [`1@${actor2}`]: {objectId: `1@${actor2}`, type: 'map', props: {sparrows: {[`2@${actor2}`]: {type: 'value', value: 12}}}}
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
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 1,
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
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 2,
        diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [{action: 'insert', index: 0, elemId: `2@${actor}`, value: {type: 'value', value: now.getTime(), datatype: 'timestamp'}}],
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
        clock: {[actor1]: 2, [actor2]: 1}, maxOp: 3,
        deps: [hash(change2), hash(change3)].sort(),
        diffs: {objectId: '_root', type: 'map'}
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
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 5,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, value: {type: 'value', value: 'first'}},
            {action: 'insert', index: 1, elemId: `3@${actor}`, value: {
              type: 'map',
              objectId: `3@${actor}`,
              props: {
                title: {[`4@${actor}`]: {type: 'value', value: 'water plants'}},
                done:  {[`5@${actor}`]: {type: 'value', value: false}}
              }
            }}
          ],
        }}}}
      })
    })

    it('should support inserting multiple elements in one op', () => {
      const actor = uuid() 
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], values: [1, 2, 3,  4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 6,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: [1, 2, 3, 4, 5]},
          ],
        }}}}
      })
    })

    it('should support deleting multiple elements in one op', () => {
      const actor = uuid() 
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], values: [1, 2, 3,  4, 5]},
      ]}
      const change2 = {actor, seq: 2, startOp: 7, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: `1@${actor}`, elemId: `3@${actor}`, multiOp: 3, pred: [
          `3@${actor}`,
          `4@${actor}`,
          `5@${actor}`,
        ]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [encodeChange(change1)])
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(change2)])
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 9,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'remove', index: 1, count: 3}
          ],
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
      const changes01 = Backend.getChanges(s1, []).map(decodeChange)
      assert.deepStrictEqual(patch1, {
        actor: '111111', seq: 1, clock: {'111111': 1}, deps: [], maxOp: 1,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {['1@111111']: {type: 'value', value: 'magpie'}}
        }}
      })
      assert.deepStrictEqual(changes01, [{
        hash: '6fc48e6635e2bab050a340119fff7a559679ed4f26734623c2b4738815f48371',
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
      const changes01 = Backend.getChanges(s1, []).map(decodeChange)
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(remote1)])
      const changes12 = Backend.getChanges(s2, [changes01[0].hash]).map(decodeChange)
      const [s3, patch3] = Backend.applyLocalChange(s2, local2)
      const changes23 = Backend.getChanges(s3, [changes01[0].hash, changes12[0].hash]).map(decodeChange)
      assert.deepStrictEqual(changes01, [{
        hash: '6fc48e6635e2bab050a340119fff7a559679ed4f26734623c2b4738815f48371',
        actor: '111111', seq: 1, startOp: 1, time: 0, message: '', deps: [], ops: [
          {action: 'set', obj: '_root', key: 'bird', insert: false, value: 'magpie', pred: []}
        ]
      }])
      assert.deepStrictEqual(changes12, [{
        hash: 'aca4a51a8d538f2b16b6f9b923cf6dd5a4bb5ad550b6e618aa529a036b45ea1f',
        actor: '222222', seq: 1, startOp: 1, time: 0, message: '', deps: [], ops: [
          {action: 'set', obj: '_root', key: 'fish', insert: false, value: 'goldfish', pred: []}
        ]
      }])
      assert.deepStrictEqual(changes23, [{
        hash: '1caeeaf4fb120b8bed4c6c92311f679264f070637b5531979e95ec8249499f5a',
        actor: '111111', seq: 2, startOp: 2, time: 0, message: '', deps: [changes01[0].hash], ops: [
          {action: 'set', obj: '_root', key: 'bird', insert: false, value: 'jay', pred: ['1@111111']}
        ]
      }])
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
      const changes01 = Backend.getChanges(s1, []).map(decodeChange)
      remote1.deps.push(changes01[0].hash)
      const [s2, patch2] = Backend.applyChanges(s1, [encodeChange(remote1)])
      const changes12 = Backend.getChanges(s2, [changes01[0].hash]).map(decodeChange)
      const [s3, patch3] = Backend.applyLocalChange(s2, local2)
      const changes23 = Backend.getChanges(s3, [changes12[0].hash]).map(decodeChange)
      assert.deepStrictEqual(patch3, {
        actor: '111111', seq: 2, clock: {'111111': 2, '222222': 1}, deps: [hash(remote1)], maxOp: 2,
        diffs: {objectId: '_root', type: 'map', props: {
          bird: {'2@222222': {type: 'value', value: 'magpie'}, '2@111111': {type: 'value', value: 'jay'}}
        }}
      })
      assert.deepStrictEqual(changes23, [{
        hash: 'b6f22ff5606622a9b8f4efed87a5202128bc5e35021d09e04529b9076ec98d0e',
        actor: '111111', seq: 2, startOp: 2, time: 0, message: '', deps: [changes01[0].hash], ops: [
          {action: 'set', obj: '_root', key: 'bird', insert: false, value: 'jay', pred: ['1@111111']}
        ]
      }])
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
      const changes12 = Backend.getChanges(s2, [hash(remote1)]).map(decodeChange)
      const [s3, patch3] = Backend.applyChanges(s2, [encodeChange(remote2)])
      const [s4, patch4] = Backend.applyLocalChange(s3, local2)
      const changes34 = Backend.getChanges(s4, [hash(remote2), changes12[0].hash]).map(decodeChange)
      const [s5, patch5] = Backend.applyLocalChange(s4, local3)
      const changes45 = Backend.getChanges(s5, [hash(remote2), changes34[0].hash]).map(decodeChange)
      assert.deepStrictEqual(changes12, [{
        hash: '96db9a3bb6471912a2acbe3948365d202b89145816efa37bd0ccaa3be8ebee14',
        actor: '111111', seq: 1, startOp: 2, time: 0, message: '', deps: [hash(remote1)], ops: [
          {obj: '1@222222', action: 'set', elemId: '_head', insert: true, value: 'goldfinch', pred: []}
        ]
      }])
      assert.deepStrictEqual(changes34, [{
        hash: '57e8ec00028e0a0a1ae325ad2c86dd4d8f63ace7c3ccb67a351682f0f6879cfd',
        actor: '111111', seq: 2, startOp: 3, time: 0, message: '', deps: [changes12[0].hash], ops: [
          {obj: '1@222222', action: 'set', elemId: '2@111111', insert: true, value: 'wagtail', pred: []}
        ]
      }])
      assert.deepStrictEqual(changes45, [{
        hash: 'd999eeeb5f69689f65b0e47b1f4dcc69c29b4b3ccaca69884425e5a6443e8d5d',
        actor: '111111', seq: 3, startOp: 4, time: 0, message: '',
        deps: [hash(remote2), changes34[0].hash].sort(), ops: [
          {obj: '1@222222', action: 'set', elemId: '2@222222', insert: false, value: 'Magpie',    pred: ['2@222222']},
          {obj: '1@222222', action: 'set', elemId: '2@111111', insert: false, value: 'Goldfinch', pred: ['2@111111']}
        ]
      }])
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
      const changes = Backend.getChanges(s2, []).map(decodeChange)
      assert.deepStrictEqual(patch2, {
        actor: '111111', seq: 2, clock: {'111111': 2}, deps: [], maxOp: 3,
        diffs: {objectId: '_root', type: 'map', props: {
          birds: {['1@111111']: {objectId: '1@111111', type: 'list',
            edits: [
              {action: 'insert', index: 0, elemId: '2@111111', value: {type: 'value', value: 'magpie'}},
              {action: 'remove', index: 0, count: 1}],
          }}
        }}
      })
      assert.deepStrictEqual(changes, [{
        hash: changes[0].hash, actor: '111111', seq: 1, startOp: 1, time: 0, message: '', deps: [], ops: [
          {obj: '_root', action: 'makeList', key: 'birds', insert: false, pred: []}
        ]
      }, {
        hash: 'd96f0023f949581eb10459c2ad8467148857f1d230abc0f0fd446ab95fdbf7ea',
        actor: '111111', seq: 2, startOp: 2, time: 0, message: '', deps: [changes[0].hash], ops: [
          {obj: '1@111111', action: 'set', elemId: '_head', insert: true, value: 'magpie', pred: []},
          {obj: '1@111111', action: 'del', elemId: '2@111111', insert: false, pred: ['2@111111']}
        ]
      }])
    })

    it('should support inserting multiple elements in one change', () => {
      const actor = uuid() 
      const localChange = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], values: [1, 2, 3,  4, 5]},
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, localChange)
      const changes = Backend.getChanges(s1, []).map(decodeChange)
      assert.deepStrictEqual(patch1, {
        clock: {[actor]: 1}, deps: [], maxOp: 6, actor, seq: 1,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: [1, 2, 3, 4, 5]},
          ],
        }}}}
      })
    })

    it('should support deleting multiple elements in one op', () => {
      const actor = uuid() 
      const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
        {action: 'makeList', obj: '_root', key: 'todos', pred: []},
        {action: 'set', obj: `1@${actor}`, insert: true, elemId: '_head', pred: [], values: [1, 2, 3,  4, 5]}
      ]}
      const change2 = {actor, seq: 2, startOp: 7, time: 0, deps: [hash(change1)], ops: [
        {action: 'del', obj: `1@${actor}`, elemId: `3@${actor}`, multiOp: 3, pred: [
          `3@${actor}`,
          `4@${actor}`,
          `5@${actor}`,
        ]}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      const [s2, patch2] = Backend.applyLocalChange(s1, change2)
      assert.deepStrictEqual(patch2, {
        clock: {[actor]: 2}, deps: [], maxOp: 9, actor, seq: 2,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'remove', index: 1, count: 3}
          ],
        }}}}
      })
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 2,
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
        deps: [hash(change1), hash(change2)].sort(), maxOp: 1,
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 2,
        diffs: {objectId: '_root', type: 'map', props: {
          counter: {[`1@${actor}`]: {value: 3, datatype: 'counter'}}
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
        clock: {[actor]: 3}, deps: [hash(change3)], maxOp: 3,
        diffs: {objectId: '_root', type: 'map'}
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 4,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'map', props: {sparrows: {[`4@${actor}`]: {type: 'value', value: 15}}}
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
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 2,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [{action: 'insert', index: 0, elemId: `2@${actor}`, value: {type: 'value', value: 'chaffinch'}}],
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
        clock: {[actor]: 2}, deps: [hash(change2)], maxOp: 6,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'multi-insert', index: 0, elemId: `5@${actor}`, values: ['greenfinch', 'goldfinches!!']},
          ],
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
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 4,
        diffs: {objectId: '_root', type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, value: {
              type: 'map',
              objectId: `2@${actor}`,
              props: {
                title: {[`3@${actor}`]: {type: 'value', value: 'water plants'}},
                done:  {[`4@${actor}`]: {type: 'value', value: false}}
              }
            }}
          ],
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
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 1,
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
        clock: {[actor]: 1}, deps: [hash(change)], maxOp: 2,
        diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [{action: 'insert', index: 0, elemId: `2@${actor}`, 
            value: {type: 'value', value: now.getTime(), datatype: 'timestamp'}}],
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
        clock: {[actor]: 1}, deps: [hash(change1)], maxOp: 5,
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'list',
          edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: [
              'chaffinch',
              'goldfinch',
              'bullfinch',
              'greenfinch',
            ]}
          ],
        }}}}
      })
    })
  })
})
