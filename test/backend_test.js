const assert = require('assert')
const Automerge = require('../src/automerge')
const Backend = require('../backend')
const uuid = require('../src/uuid')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'

describe('Automerge.Backend', () => {
  describe('incremental diffs', () => {
    it('should assign to a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        version: 1, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {[`1@${actor}`]: {value: 'magpie'}}
        }}
      })
    })

    it('should increment a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'counter', value: 1, datatype: 'counter'}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, deps: {}, ops: [
        {action: 'inc', obj: ROOT_ID, key: 'counter', value: 2}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        version: 2, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          counter: {[`1@${actor}`]: {value: 3, datatype: 'counter'}}
        }}
      })
    })

    it('should make a conflict on assignment to the same key', () => {
      const change1 = {actor: 'actor1', seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor: 'actor2', seq: 1, startOp: 2, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        version: 2, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {'1@actor1': {value: 'magpie'}, '2@actor2': {value: 'blackbird'}}
        }}
      })
    })

    it('should delete a key from a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, deps: {}, ops: [
        {action: 'del', obj: ROOT_ID, key: 'bird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        version: 2, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {bird: {}}}
      })
    })

    it('should create nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeMap', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        version: 1, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'map', props: {wrens: {[`2@${actor}`]: {value: 3}}}
        }}}}
      })
    })

    it('should assign to keys in nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeMap', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, deps: {}, ops: [
        {action: 'set',     obj: birds,   key: 'sparrows', value: 15}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        version: 2, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'map', props: {sparrows: {[`3@${actor}`]: {value: 15}}}
        }}}}
      })
    })

    it('should create lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set', obj: birds, key: '_head', insert: true, value: 'chaffinch'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        version: 1, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list',
          edits: [{action: 'insert', index: 0}],
          props: {0: {[`2@${actor}`]: {value: 'chaffinch'}}}
        }}}}
      })
    })

    it('should apply updates inside lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set', obj: birds, key: '_head', insert: true, value: 'chaffinch'}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, deps: {}, ops: [
        {action: 'set', obj: birds, key: `2@${actor}`, value: 'greenfinch'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        version: 2, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list', edits: [],
          props: {0: {[`3@${actor}`]: {value: 'greenfinch'}}}
        }}}}
      })
    })

    it('should delete list elements', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set', obj: birds, key: '_head', insert: true, value: 'chaffinch'}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, deps: {}, ops: [
        {action: 'del', obj: birds, key: `2@${actor}`}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        version: 2, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list', props: {},
          edits: [{action: 'remove', index: 0}]
        }}}}
      })
    })

    it('should handle list element insertion and deletion in the same change', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds', child: birds}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, deps: {}, ops: [
        {action: 'set', obj: birds, key: '_head', insert: true, value: 'chaffinch'},
        {action: 'del', obj: birds, key: `2@${actor}`}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        version: 2, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list', edits: [
            {action: 'insert', index: 0}, {action: 'remove', index: 0}
          ], props: {}
        }}}}
      })
    })

    it('should handle changes within conflicted objects', () => {
      const list = uuid(), map = uuid(), actor1 = uuid(), actor2 = uuid()
      const change1 = {actor: actor1, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'conflict', child: list}
      ]}
      const change2 = {actor: actor2, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeMap',  obj: ROOT_ID, key: 'conflict', child: map}
      ]}
      const change3 = {actor: actor2, seq: 2, startOp: 2, deps: {}, ops: [
        {action: 'set', obj: map, key: 'sparrows', value: 12}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      const [s3, patch3] = Backend.applyChanges(s2, [change3])
      assert.deepEqual(patch3, {
        version: 3, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {conflict: {
          [`1@${actor1}`]: {objectId: list, type: 'list'},
          [`1@${actor2}`]: {objectId: map, type: 'map', props: {sparrows: {[`2@${actor2}`]: {value: 12}}}}
        }}}
      })
    })

    it('should support Date objects at the root', () => {
      const now = new Date()
      const actor = uuid(), change = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'now', value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(patch, {
        version: 1, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          now: {[`1@${actor}`]: {value: now.getTime(), datatype: 'timestamp'}}
        }}
      })
    })

    it('should support Date objects in a list', () => {
      const now = new Date(), list = uuid(), actor = uuid()
      const change = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'list', child: list},
        {action: 'set', obj: list, key: '_head', insert: true, value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(patch, {
        version: 1, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {list: {[`1@${actor}`]: {
          objectId: list, type: 'list',
          edits: [{action: 'insert', index: 0}],
          props: {0: {[`2@${actor}`]: {value: now.getTime(), datatype: 'timestamp'}}}
        }}}}
      })
    })
  })

  describe('applyLocalChange()', () => {
    it('should apply change requests', () => {
      const actor = uuid()
      const change1 = {requestType: 'change', actor, seq: 1, version: 0, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      assert.deepEqual(patch1, {
        actor, seq: 1, version: 1, canUndo: true, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {[`1@${actor}`]: {value: 'magpie'}}
        }}
      })
    })

    it('should throw an exception on duplicate requests', () => {
      const actor = uuid()
      const change1 = {requestType: 'change', actor, seq: 1, version: 0, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {requestType: 'change', actor, seq: 2, version: 0, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'jay'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      const [s2, patch2] = Backend.applyLocalChange(s1, change2)
      assert.throws(() => Backend.applyLocalChange(s2, change1), /Change request has already been applied/)
      assert.throws(() => Backend.applyLocalChange(s2, change2), /Change request has already been applied/)
    })

    it('should handle frontend and backend changes happening concurrently', () => {
      const actor1 = uuid(), actor2 = uuid()
      const local1 = {requestType: 'change', actor: actor1, seq: 1, version: 0, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const local2 = {requestType: 'change', actor: actor1, seq: 2, version: 0, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'jay'}
      ]}
      const remote1 = {actor: actor2, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'fish', value: 'goldfish'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, local1)
      const [s2, patch2] = Backend.applyChanges(s1, [remote1])
      const [s3, patch3] = Backend.applyLocalChange(s2, local2)
    })

    it('should transform list indexes into element IDs', () => {
      const birds = uuid()
      const remote1 = {actor: 'actor2', seq: 1, startOp: 1, deps: {}, ops: [
        {obj: ROOT_ID, action: 'makeList', key: 'birds', child: birds}
      ]}
      const remote2 = {actor: 'actor2', seq: 2, startOp: 2, deps: {}, ops: [
        {obj: birds, action: 'set', key: '_head', insert: true, value: 'magpie'}
      ]}
      const local1 = {requestType: 'change', actor: 'actor1', seq: 1, version: 1, ops: [
        {obj: birds, action: 'set', key: 0, insert: true, value: 'goldfinch'}
      ]}
      const local2 = {requestType: 'change', actor: 'actor1', seq: 2, version: 1, ops: [
        {obj: birds, action: 'set', key: 1, insert: true, value: 'wagtail'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [remote1])
      const [s2, patch2] = Backend.applyLocalChange(s1, local1)
      const [s3, patch3] = Backend.applyChanges(s2, [remote2])
      const [s4, patch4] = Backend.applyLocalChange(s3, local2)
      assert.deepEqual(Backend.getChanges(s1, s2), [{actor: 'actor1', seq: 1, startOp: 2, deps: {actor2: 1}, ops: [
        {obj: birds, action: 'set', key: '_head', insert: true, value: 'goldfinch'}
      ]}])
      assert.deepEqual(Backend.getChanges(s3, s4), [{actor: 'actor1', seq: 2, startOp: 3, deps: {}, ops: [
        {obj: birds, action: 'set', key: '2@actor1', insert: true, value: 'wagtail'}
      ]}])
      const elemIds = s3.getIn(['opSet', 'byObject', birds, '_elemIds'])
      assert.strictEqual(elemIds.keyOf(0), '2@actor2')
      assert.strictEqual(elemIds.keyOf(1), '2@actor1')
    })
  })

  describe('getPatch()', () => {
    it('should include the most recent value for a key', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {[`2@${actor}`]: {value: 'blackbird'}}
        }}
      })
    })

    it('should include conflicting values for a key', () => {
      const change1 = {actor: 'actor1', seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor: 'actor2', seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {actor1: 1, actor2: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          bird: {'1@actor1': {value: 'magpie'}, '1@actor2': {value: 'blackbird'}}
        }}
      })
    })

    it('should handle counter increments at a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'counter', value: 1, datatype: 'counter'}
      ]}
      const change2 = {actor, seq: 2, startOp: 2, deps: {}, ops: [
        {action: 'inc', obj: ROOT_ID, key: 'counter', value: 2}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          counter: {[`1@${actor}`]: {value: 3, datatype: 'counter'}}
        }}
      })
    })

    it('should create nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeMap', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3}
      ]}
      const change2 = {actor, seq: 2, startOp: 3, deps: {}, ops: [
        {action: 'del',     obj: birds,   key: 'wrens'},
        {action: 'set',     obj: birds,   key: 'sparrows', value: 15}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'map', props: {sparrows: {[`4@${actor}`]: {value: 15}}}
        }}}}
      })
    })

    it('should create lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set', obj: birds, key: '_head', insert: true, value: 'chaffinch'}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list',
          edits: [{action: 'insert', index: 0}],
          props: {0: {[`2@${actor}`]: {value: 'chaffinch'}}}
        }}}}
      })
    })

    it('should include the latest state of a list', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'birds', child: birds},
        {action: 'set', obj: birds, key: '_head',      insert: true, value: 'chaffinch'},
        {action: 'set', obj: birds, key: `2@${actor}`, insert: true, value: 'goldfinch'}
      ]}
      const change2 = {actor, seq: 2, startOp: 6, deps: {}, ops: [
        {action: 'del', obj: birds, key: `2@${actor}`},
        {action: 'set', obj: birds, key: `2@${actor}`, insert: true, value: 'greenfinch'},
        {action: 'set', obj: birds, key: `3@${actor}`, value: 'goldfinches!!'}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list',
          edits: [{action: 'insert', index: 0}, {action: 'insert', index: 1}],
          props: {0: {[`7@${actor}`]: {value: 'greenfinch'}}, 1: {[`8@${actor}`]: {value: 'goldfinches!!'}}}
        }}}}
      })
    })

    it('should handle nested maps in lists', () => {
      const todos = uuid(), item = uuid(), actor = uuid()
      const change = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'todos', child: todos},
        {action: 'makeMap', obj: todos, key: '_head', insert: true, child: item},
        {action: 'set', obj: item, key: 'title', value: 'water plants'},
        {action: 'set', obj: item, key: 'done', value: false}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {todos: {[`1@${actor}`]: {
          objectId: todos, type: 'list',
          edits: [{action: 'insert', index: 0}],
          props: {0: {[`2@${actor}`]: {
            objectId: item, type: 'map', props: {
              title: {[`3@${actor}`]: {value: 'water plants'}},
              done:  {[`4@${actor}`]: {value: false}}
            }
          }}}
        }}}}
      })
    })

    it('should include Date objects at the root', () => {
      const now = new Date()
      const actor = uuid(), change = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'now', value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          now: {[`1@${actor}`]: {value: now.getTime(), datatype: 'timestamp'}}
        }}
      })
    })

    it('should include Date objects in a list', () => {
      const now = new Date(), list = uuid(), actor = uuid()
      const change = {actor, seq: 1, startOp: 1, deps: {}, ops: [
        {action: 'makeList', obj: ROOT_ID, key: 'list', child: list},
        {action: 'set', obj: list, key: '_head', insert: true, value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s1 = Backend.loadChanges(Backend.init(), [change])
      assert.deepEqual(Backend.getPatch(s1), {
        version: 0, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {list: {[`1@${actor}`]: {
          objectId: list, type: 'list',
          edits: [{action: 'insert', index: 0}],
          props: {0: {[`2@${actor}`]: {value: now.getTime(), datatype: 'timestamp'}}}
        }}}}
      })
    })
  })

  describe('getChangesForActor()', () => {
    let oneDoc, twoDoc, mergeDoc

    beforeEach(() => {
      oneDoc = Automerge.change(Automerge.init('actor1'), doc => doc.document = 'watch me now')
      twoDoc = Automerge.init('actor2')
      twoDoc = Automerge.change(twoDoc, doc => doc.document = 'i can mash potato')
      twoDoc = Automerge.change(twoDoc, doc => doc.document = 'i can do the twist')
      mergeDoc = Automerge.merge(oneDoc, twoDoc)
    })

    it('should get changes for a single actor', () => {
      const state = Automerge.Frontend.getBackendState(mergeDoc)
      const actorChanges = Backend.getChangesForActor(state, 'actor2')

      assert.equal(actorChanges.length, 2)
      assert.equal(actorChanges[0].actor, 'actor2')
    })
  })
})
