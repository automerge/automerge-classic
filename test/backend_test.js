const assert = require('assert')
const Automerge = require('../src/automerge')
const Backend = require('../backend')
const uuid = require('../src/uuid')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'

describe('Backend', () => {
  describe('incremental diffs', () => {
    it('should assign to a key in a map', () => {
      const actor = uuid()
      const change1 = {actor, seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const s0 = Backend.init(actor)
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(patch1, {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [{action: 'set', obj: ROOT_ID, path: [], type: 'map', key: 'bird', value: 'magpie'}]
      })
    })

    it('should make a conflict on assignment to the same key', () => {
      const change1 = {actor: 'actor1', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'magpie'}
      ]}
      const change2 = {actor: 'actor2', seq: 1, deps: {}, ops: [
        {action: 'set', obj: ROOT_ID, key: 'bird', value: 'blackbird'}
      ]}
      const s0 = Backend.init('actor1')
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
      const s0 = Backend.init(actor)
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
      const s0 = Backend.init(actor)
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
      const s0 = Backend.init(actor)
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
      const s0 = Backend.init(actor)
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
      const s0 = Backend.init(actor)
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
      const s0 = Backend.init(actor)
      const [s1, patch1] = Backend.applyChanges(s0, [change1])
      const [s2, patch2] = Backend.applyChanges(s1, [change2])
      assert.deepEqual(patch2, {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [{action: 'remove', obj: birds, type: 'list', path: ['birds'], index: 0}]
      })
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
      const s0 = Backend.init(actor)
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
      const s0 = Backend.init('actor1')
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {actor1: 1, actor2: 1}, deps: {actor1: 1, actor2: 1},
        diffs: [{action: 'set', obj: ROOT_ID, type: 'map', key: 'bird', value: 'blackbird',
          conflicts: [{actor: 'actor1', value: 'magpie'}]}
      ]})
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
      const s0 = Backend.init(actor)
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
      const s0 = Backend.init(actor)
      const [s1, patch] = Backend.applyChanges(s0, [change1])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 1}, deps: {[actor]: 1},
        diffs: [
          {action: 'create', obj: birds,   type: 'list'},
          {action: 'insert', obj: birds,   type: 'list', index: 0, value: 'chaffinch', elemId: `${actor}:1`},
          {action: 'set',    obj: ROOT_ID, type: 'map',  key: 'birds', value: birds, link: true}
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
      const s0 = Backend.init(actor)
      const [s1, patch] = Backend.applyChanges(s0, [change1, change2])
      assert.deepEqual(Backend.getPatch(s1), {
        canUndo: false, canRedo: false, clock: {[actor]: 2}, deps: {[actor]: 2},
        diffs: [
          {action: 'create', obj: birds,   type: 'list'},
          {action: 'insert', obj: birds,   type: 'list', index: 0, value: 'greenfinch',    elemId: `${actor}:3`},
          {action: 'insert', obj: birds,   type: 'list', index: 1, value: 'goldfinches!!', elemId: `${actor}:2`},
          {action: 'set',    obj: ROOT_ID, type: 'map',  key: 'birds', value: birds, link: true}
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
