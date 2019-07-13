const assert = require('assert')
const Automerge = require('../src/automerge')
const Backend = require('../backend')
const uuid = require('../src/uuid')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'

describe('Automerge.Backend', () => {
  describe('incremental diffs', () => {
    it('should assign to a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [{action: 'set', obj: ROOT_ID, path: [], type: 'map', key: 'bird', value: 'magpie'}]
      })
    })

    it('should increment a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'counter', value: 1, datatype: 'counter'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'inc', obj: ROOT_ID, key: 'counter', value: 2}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'set', obj: ROOT_ID, path: [], type: 'map', key: 'counter', value: 3, datatype: 'counter'}]
      })
    })

    it('should make a conflict on assignment to the same key', () => {
      const change1 = {actor: 'actor1', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor: 'actor2', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {actor1: 1, actor2: 1}, deps: {actor1: 1, actor2: 1},
        diffs: [{action: 'set', obj: ROOT_ID, path: [], type: 'map', key: 'bird', value: 'blackbird',
          conflicts: [{actor: 'actor1', value: 'magpie'}]}
      ]})
    })

    it('should delete a key from a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'del', obj: ROOT_ID, key: 'bird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'remove', obj: ROOT_ID, path: [], type: 'map', key: 'bird'}]
      })
    })

    it('should create nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeMap', obj: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3},
        {action: 'link',    obj: ROOT_ID, key: 'birds', value: birds}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [
          {action: 'create', obj: birds,   type: 'map'},
          {action: 'set',    obj: birds,   type: 'map', path: null, key: 'wrens', value: 3},
          {action: 'set',    obj: ROOT_ID, type: 'map', path: [],   key: 'birds', value: birds, link: true}
        ]
      })
    })

    it('should assign to keys in nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeMap', obj: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3},
        {action: 'link',    obj: ROOT_ID, key: 'birds', value: birds}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'set',     obj: birds,   key: 'sparrows', value: 15}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'set', obj: birds, type: 'map', path: ['birds'], key: 'sparrows', value: 15}]
      })
    })

    it('should create lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'},
        {action: 'link',     obj: ROOT_ID, key: 'birds',      value: birds}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [
          {action: 'create', obj: birds,   type: 'list'},
          {action: 'insert', obj: birds,   type: 'list', path: null, index: 0, value: 'chaffinch', elemId: `${actor}:1`},
          {action: 'set',    obj: ROOT_ID, type: 'map',  path: [],   key: 'birds', value: birds, link: true}
        ]
      })
    })

    it('should apply updates inside lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'},
        {action: 'link',     obj: ROOT_ID, key: 'birds',      value: birds}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'greenfinch'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'set', obj: birds, type: 'list', path: ['birds'], index: 0, value: 'greenfinch'}]
      })
    })

    it('should delete list elements', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'},
        {action: 'link',     obj: ROOT_ID, key: 'birds',      value: birds}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'del',      obj: birds,   key: `${actor}:1`}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'remove', obj: birds, type: 'list', path: ['birds'], index: 0}]
      })
    })

    it('should handle list element insertion and deletion in the same change', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: birds},
        {action: 'link',     obj: ROOT_ID, key: 'birds', value: birds}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'ins', obj: birds, key: '_head', elem: 1},
        {action: 'del', obj: birds, key: `${actor}:1`}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'maxElem', obj: birds, value: 1, type: 'list', path: ['birds']}]
      })
    })

    it('should support Date objects at the root', () => {
      const now = new Date()
      const actor = uuid(), change = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'now', value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(patch, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [{action: 'set', obj: ROOT_ID, type: 'map', path: [], key: 'now', value: now.getTime(), datatype: 'timestamp'}]
      })
    })

    it('should support Date objects in a list', () => {
      const now = new Date(), list = uuid(), actor = uuid()
      const change = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: list},
        {action: 'ins',      obj: list,    key: '_head',      elem: 1},
        {action: 'set',      obj: list,    key: `${actor}:1`, value: now.getTime(), datatype: 'timestamp'},
        {action: 'link',     obj: ROOT_ID, key: 'list',       value: list}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(patch, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [
          {action: 'create', obj: list,    type: 'list'},
          {action: 'insert', obj: list,    type: 'list', path: null, index: 0,
            value: now.getTime(), elemId: `${actor}:1`, datatype: 'timestamp'},
          {action: 'set',    obj: ROOT_ID, type: 'map',  path: [],   key: 'list', value: list, link: true}
        ]
      })
    })
  })

  describe('applyLocalChange()', () => {
    it('should apply change requests', () => {
      const actor = uuid()
      const change1 = {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      assert.deepEqual(patch1, {
        actor, seq: 1, canUndo: true, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [{action: 'set', obj: ROOT_ID, path: [], type: 'map', key: 'bird', value: 'magpie'}]
      })
    })

    it('should throw an exception on duplicate requests', () => {
      const actor = uuid()
      const change1 = {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'jay'}
      ]}
      const s0 = Backend.init()
      const [s1, patch1] = Backend.applyLocalChange(s0, change1)
      const [s2, patch2] = Backend.applyLocalChange(s1, change2)
      assert.throws(() => Backend.applyLocalChange(s2, change1), /Change request has already been applied/)
      assert.throws(() => Backend.applyLocalChange(s2, change2), /Change request has already been applied/)
    })
  })

  describe('getPatch()', () => {
    it('should include the most recent value for a key', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'set', obj: ROOT_ID, type: 'map', key: 'bird', value: 'blackbird'}]
      })
    })

    it('should include conflicting values for a key', () => {
      const change1 = {actor: 'actor1', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor: 'actor2', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {actor1: 1, actor2: 1}, deps: {actor1: 1, actor2: 1},
        diffs: [{action: 'set', obj: ROOT_ID, type: 'map', key: 'bird', value: 'blackbird',
          conflicts: [{actor: 'actor1', value: 'magpie'}]}
      ]})
    })

    it('should handle increments for a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'counter', value: 1, datatype: 'counter'}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'inc', obj: ROOT_ID, key: 'counter', value: 2}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'set', obj: ROOT_ID, type: 'map', key: 'counter', value: 3, datatype: 'counter'}]
      })
    })

    it('should create nested maps', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeMap', obj: birds},
        {action: 'set',     obj: birds,   key: 'wrens', value: 3},
        {action: 'link',    obj: ROOT_ID, key: 'birds', value: birds}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'del',     obj: birds,   key: 'wrens'},
        {action: 'set',     obj: birds,   key: 'sparrows', value: 15}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [
          {action: 'create', obj: birds,   type: 'map'},
          {action: 'set',    obj: birds,   type: 'map', key: 'sparrows', value: 15},
          {action: 'set',    obj: ROOT_ID, type: 'map', key: 'birds',    value: birds, link: true}
        ]
      })
    })

    it('should create lists', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'},
        {action: 'link',     obj: ROOT_ID, key: 'birds',      value: birds}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [
          {action: 'create',  obj: birds,   type: 'list'},
          {action: 'insert',  obj: birds,   type: 'list', index: 0, value: 'chaffinch', elemId: `${actor}:1`},
          {action: 'maxElem', obj: birds,   type: 'list', value: 1},
          {action: 'set',     obj: ROOT_ID, type: 'map',  key: 'birds', value: birds, link: true}
        ]
      })
    })

    it('should include the latest state of a list', () => {
      const birds = uuid(), actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: birds},
        {action: 'ins',      obj: birds,   key: '_head',      elem: 1},
        {action: 'set',      obj: birds,   key: `${actor}:1`, value: 'chaffinch'},
        {action: 'ins',      obj: birds,   key: `${actor}:1`, elem: 2},
        {action: 'set',      obj: birds,   key: `${actor}:2`, value: 'goldfinch'},
        {action: 'link',     obj: ROOT_ID, key: 'birds',      value: birds}
      ]}
      const change2 = {actor, seq: 2, deps: {}, ops: [
        {action: 'del',      obj: birds,   key: `${actor}:1`},
        {action: 'ins',      obj: birds,   key: `${actor}:1`, elem: 3},
        {action: 'set',      obj: birds,   key: `${actor}:3`, value: 'greenfinch'},
        {action: 'set',      obj: birds,   key: `${actor}:2`, value: 'goldfinches!!'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [
          {action: 'create',  obj: birds,   type: 'list'},
          {action: 'insert',  obj: birds,   type: 'list', index: 0, value: 'greenfinch',    elemId: `${actor}:3`},
          {action: 'insert',  obj: birds,   type: 'list', index: 1, value: 'goldfinches!!', elemId: `${actor}:2`},
          {action: 'maxElem', obj: birds,   type: 'list', value: 3},
          {action: 'set',     obj: ROOT_ID, type: 'map',  key: 'birds', value: birds, link: true}
        ]
      })
    })

    it('should handle nested maps in lists', () => {
      const todos = uuid(), item = uuid(), actor = uuid()
      const change = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: todos},
        {action: 'ins',      obj: todos,   key: '_head',     elem: 1},
        {action: 'makeMap',  obj: item},
        {action: 'set',      obj: item,    key: 'title',     value: 'water plants'},
        {action: 'set',      obj: item,    key: 'done',      value: false},
        {action: 'link',     obj: todos,   key:`${actor}:1`, value: item},
        {action: 'link',     obj: ROOT_ID, key: 'todos',     value: todos}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [
          {action: 'create',  obj: item,    type: 'map'},
          {action: 'set',     obj: item,    type: 'map',  key: 'title', value: 'water plants'},
          {action: 'set',     obj: item,    type: 'map',  key: 'done',  value: false},
          {action: 'create',  obj: todos,   type: 'list'},
          {action: 'insert',  obj: todos,   type: 'list', index: 0,     value: item,  link: true, elemId: `${actor}:1`},
          {action: 'maxElem', obj: todos,   type: 'list', value: 1},
          {action: 'set',     obj: ROOT_ID, type: 'map',  key: 'todos', value: todos, link: true}
        ]
      })
    })

    it('should include Date objects at the root', () => {
      const now = new Date()
      const actor = uuid(), change = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'now', value: now.getTime(), datatype: 'timestamp'}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [{action: 'set', obj: ROOT_ID, type: 'map', key: 'now', value: now.getTime(), datatype: 'timestamp'}]
      })
    })

    it('should include Date objects in a list', () => {
      const now = new Date(), list = uuid(), actor = uuid()
      const change = {actor, seq: 1, deps: {}, ops: [
        {action: 'makeList', obj: list},
        {action: 'ins',      obj: list,    key: '_head',      elem: 1},
        {action: 'set',      obj: list,    key: `${actor}:1`, value: now.getTime(), datatype: 'timestamp'},
        {action: 'link',     obj: ROOT_ID, key: 'list',       value: list}
      ]}
      const s0 = Backend.init()
      const [s1, patch] = Backend.applyChanges(s0, [change])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [
          {action: 'create',  obj: list,    type: 'list'},
          {action: 'insert',  obj: list,    type: 'list', index: 0, value: now.getTime(), elemId: `${actor}:1`, datatype: 'timestamp'},
          {action: 'maxElem', obj: list,    type: 'list', value: 1},
          {action: 'set',     obj: ROOT_ID, type: 'map',  key: 'list', value: list, link: true}
        ]
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
