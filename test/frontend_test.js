const assert = require('assert')
const Frontend = require('../src/frontend')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'
const uuid = require('../src/uuid')

describe('Frontend', () => {
  it('should be an empty object by default', () => {
    assert.deepEqual(Frontend.init(), {})
  })

  describe('performing changes', () => {
    it('should return the unmodified document if nothing changed', () => {
      const doc0 = Frontend.init()
      const doc1 = Frontend.change(doc0, doc => {})
      assert.strictEqual(doc1, doc0)
    })

    it('should set root object properties', () => {
      const doc = Frontend.change(Frontend.init(), doc => doc.bird = 'magpie')
      assert.deepEqual(doc, {bird: 'magpie'})
      assert.deepEqual(Frontend.getRequests(doc), [{
        requestId: 1,
        ops: [{obj: ROOT_ID, action: 'set', key: 'bird', value: 'magpie'}]
      }])
    })

    it('should create nested maps', () => {
      const doc = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 3})
      const birds = Frontend.getObjectId(doc.birds)
      assert.deepEqual(doc, {birds: {wrens: 3}})
      assert.deepEqual(Frontend.getRequests(doc), [{
        requestId: 1,
        ops: [
          {obj: birds,   action: 'makeMap'},
          {obj: birds,   action: 'set',  key: 'wrens', value: 3},
          {obj: ROOT_ID, action: 'link', key: 'birds', value: birds}
        ]
      }])
    })

    it('should apply updates inside nested maps', () => {
      const doc1 = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 3})
      const doc2 = Frontend.change(doc1, doc => doc.birds.sparrows = 15)
      const birds = Frontend.getObjectId(doc2.birds)
      assert.deepEqual(doc1, {birds: {wrens: 3}})
      assert.deepEqual(doc2, {birds: {wrens: 3, sparrows: 15}})
      assert.deepEqual(Frontend.getRequests(doc2)[1], {
        requestId: 2,
        ops: [{obj: birds, action: 'set', key: 'sparrows', value: 15}]
      })
    })

    it('should delete keys in maps', () => {
      const doc1 = Frontend.change(Frontend.init(), doc => { doc.magpies = 2; doc.sparrows = 15 })
      const doc2 = Frontend.change(doc1, doc => delete doc['magpies'])
      assert.deepEqual(doc1, {magpies: 2, sparrows: 15})
      assert.deepEqual(doc2, {sparrows: 15})
      assert.deepEqual(Frontend.getRequests(doc2)[1], {
        requestId: 2,
        ops: [{obj: ROOT_ID, action: 'del', key: 'magpies'}]
      })
    })

    it('should create lists', () => {
      const doc = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const birds = Frontend.getObjectId(doc.birds), actor = Frontend.getActorId(doc)
      assert.deepEqual(doc, {birds: ['chaffinch']})
      assert.deepEqual(Frontend.getRequests(doc), [{
        requestId: 1,
        ops: [
          {obj: birds,   action: 'makeList'},
          {obj: birds,   action: 'ins',  key: '_head', elem: 1},
          {obj: birds,   action: 'set',  key: `${actor}:1`, value: 'chaffinch'},
          {obj: ROOT_ID, action: 'link', key: 'birds', value: birds}
        ]
      }])
    })

    it('should apply updates inside lists', () => {
      const doc1 = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const doc2 = Frontend.change(doc1, doc => doc.birds[0] = 'greenfinch')
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {birds: ['chaffinch']})
      assert.deepEqual(doc2, {birds: ['greenfinch']})
      assert.deepEqual(Frontend.getRequests(doc2)[1], {
        requestId: 2,
        ops: [{obj: birds, action: 'set', key: `${actor}:1`, value: 'greenfinch'}]
      })
    })

    it('should delete list elements', () => {
      const doc1 = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch', 'goldfinch'])
      const doc2 = Frontend.change(doc1, doc => doc.birds.deleteAt(0))
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {birds: ['chaffinch', 'goldfinch']})
      assert.deepEqual(doc2, {birds: ['goldfinch']})
      assert.deepEqual(Frontend.getRequests(doc2)[1], {
        requestId: 2,
        ops: [{obj: birds, action: 'del', key: `${actor}:1`}]
      })
    })
  })

  describe('applying patches', () => {
    it('should set root object properties', () => {
      const diffs = [
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'bird', value: 'magpie'}
      ]
      const doc = Frontend.applyPatch(Frontend.init(), {diffs})
      assert.deepEqual(doc, {bird: 'magpie'})
    })

    it('should reveal conflicts on root object properties', () => {
      const actor = uuid()
      const diffs = [
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'favoriteBird', value: 'wagtail', conflicts: [{actor, value: 'robin'}]}
      ]
      const doc = Frontend.applyPatch(Frontend.init(), {diffs})
      assert.deepEqual(doc, {favoriteBird: 'wagtail'})
      assert.deepEqual(Frontend.getConflicts(doc), {favoriteBird: {[actor]: 'robin'}})
    })

    it('should create nested maps', () => {
      const birds = uuid()
      const diffs = [
        {obj: birds,   type: 'map', action: 'create'},
        {obj: birds,   type: 'map', action: 'set', key: 'wrens', value: 3},
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'birds', value: birds, link: true}
      ]
      const doc = Frontend.applyPatch(Frontend.init(), {diffs})
      assert.deepEqual(doc, {birds: {wrens: 3}})
    })

    it('should apply updates inside nested maps', () => {
      const birds = uuid()
      const diffs1 = [
        {obj: birds,   type: 'map', action: 'create'},
        {obj: birds,   type: 'map', action: 'set', key: 'wrens', value: 3},
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'birds', value: birds, link: true}
      ]
      const diffs2 = [
        {obj: birds, type: 'map', action: 'set', key: 'sparrows', value: 15}
      ]
      const doc1 = Frontend.applyPatch(Frontend.init(), {diffs: diffs1})
      const doc2 = Frontend.applyPatch(doc1, {diffs: diffs2})
      assert.deepEqual(doc1, {birds: {wrens: 3}})
      assert.deepEqual(doc2, {birds: {wrens: 3, sparrows: 15}})
    })

    it('should apply updates inside map key conflicts', () => {
      const birds1 = uuid(), birds2 = uuid(), actor = uuid()
      const diffs1 = [
        {obj: birds1,  type: 'map', action: 'create'},
        {obj: birds1,  type: 'map', action: 'set', key: 'wrens', value: 3},
        {obj: birds2,  type: 'map', action: 'create'},
        {obj: birds2,  type: 'map', action: 'set', key: 'blackbirds', value: 1},
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'favoriteBirds', value: birds1, link: true,
          conflicts: [{actor, value: birds2, link: true}]}
      ]
      const diffs2 = [
        {obj: birds2, type: 'map', action: 'set', key: 'blackbirds', value: 2}
      ]
      const doc1 = Frontend.applyPatch(Frontend.init(), {diffs: diffs1})
      const doc2 = Frontend.applyPatch(doc1, {diffs: diffs2})
      assert.deepEqual(doc1, {favoriteBirds: {wrens: 3}})
      assert.deepEqual(doc2, {favoriteBirds: {wrens: 3}})
      assert.deepEqual(Frontend.getConflicts(doc1), {favoriteBirds: {[actor]: {blackbirds: 1}}})
      assert.deepEqual(Frontend.getConflicts(doc2), {favoriteBirds: {[actor]: {blackbirds: 2}}})
    })

    it('should structure-share unmodified objects', () => {
      const birds = uuid(), mammals = uuid()
      const diffs1 = [
        {obj: birds,   type: 'map', action: 'create'},
        {obj: birds,   type: 'map', action: 'set', key: 'wrens',   value: 3},
        {obj: mammals, type: 'map', action: 'create'},
        {obj: mammals, type: 'map', action: 'set', key: 'badgers', value: 1},
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'birds',   value: birds,   link: true},
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'mammals', value: mammals, link: true}
      ]
      const diffs2 = [
        {obj: birds, type: 'map', action: 'set', key: 'sparrows', value: 15}
      ]
      const doc1 = Frontend.applyPatch(Frontend.init(), {diffs: diffs1})
      const doc2 = Frontend.applyPatch(doc1, {diffs: diffs2})
      assert.deepEqual(doc1, {birds: {wrens: 3}, mammals: {badgers: 1}})
      assert.deepEqual(doc2, {birds: {wrens: 3, sparrows: 15}, mammals: {badgers: 1}})
      assert.strictEqual(doc1.mammals, doc2.mammals)
    })

    it('should delete keys in maps', () => {
      const diffs1 = [
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'magpies',  value: 2},
        {obj: ROOT_ID, type: 'map', action: 'set', key: 'sparrows', value: 15}
      ]
      const diffs2 = [
        {obj: ROOT_ID, type: 'map', action: 'remove', key: 'magpies'}
      ]
      const doc1 = Frontend.applyPatch(Frontend.init(), {diffs: diffs1})
      const doc2 = Frontend.applyPatch(doc1, {diffs: diffs2})
      assert.deepEqual(doc1, {magpies: 2, sparrows: 15})
      assert.deepEqual(doc2, {sparrows: 15})
    })

    it('should create lists', () => {
      const birds = uuid(), actor = uuid()
      const diffs = [
        {obj: birds,   type: 'list', action: 'create'},
        {obj: birds,   type: 'list', action: 'insert', index: 0, value: 'chaffinch', elemId: `${actor}:1`},
        {obj: ROOT_ID, type: 'map',  action: 'set',    key: 'birds', value: birds, link: true}
      ]
      const doc = Frontend.applyPatch(Frontend.init(), {diffs})
      assert.deepEqual(doc, {birds: ['chaffinch']})
    })

    it('should apply updates inside lists', () => {
      const birds = uuid(), actor = uuid()
      const diffs1 = [
        {obj: birds,   type: 'list', action: 'create'},
        {obj: birds,   type: 'list', action: 'insert', index: 0, value: 'chaffinch', elemId: `${actor}:1`},
        {obj: ROOT_ID, type: 'map',  action: 'set',    key: 'birds', value: birds, link: true}
      ]
      const diffs2 = [
        {obj: birds,   type: 'list', action: 'set',    index: 0, value: 'greenfinch'}
      ]
      const doc1 = Frontend.applyPatch(Frontend.init(), {diffs: diffs1})
      const doc2 = Frontend.applyPatch(doc1, {diffs: diffs2})
      assert.deepEqual(doc1, {birds: ['chaffinch']})
      assert.deepEqual(doc2, {birds: ['greenfinch']})
    })

    it('should apply updates inside list element conflicts', () => {
      const birds = uuid(), item1 = uuid(), item2 = uuid(), actor = uuid()
      const diffs1 = [
        {obj: item1,   type: 'map',  action: 'create'},
        {obj: item1,   type: 'map',  action: 'set', key: 'species', value: 'lapwing'},
        {obj: item1,   type: 'map',  action: 'set', key: 'numSeen', value: 2},
        {obj: item2,   type: 'map',  action: 'create'},
        {obj: item2,   type: 'map',  action: 'set', key: 'species', value: 'woodpecker'},
        {obj: item2,   type: 'map',  action: 'set', key: 'numSeen', value: 1},
        {obj: birds,   type: 'list', action: 'create'},
        {obj: birds,   type: 'list', action: 'insert', index: 0, value: item1, link: true, elemId: `${actor}:1`,
          conflicts: [{actor, value: item2, link: true}]},
        {obj: ROOT_ID, type: 'map',  action: 'set', key: 'birds', value: birds, link: true}
      ]
      const diffs2 = [
        {obj: item2, type: 'map', action: 'set', key: 'numSeen', value: 2}
      ]
      const doc1 = Frontend.applyPatch(Frontend.init(), {diffs: diffs1})
      const doc2 = Frontend.applyPatch(doc1, {diffs: diffs2})
      assert.deepEqual(doc1, {birds: [{species: 'lapwing', numSeen: 2}]})
      assert.deepEqual(doc2, {birds: [{species: 'lapwing', numSeen: 2}]})
      assert.strictEqual(doc1.birds[0], doc2.birds[0])
      assert.deepEqual(Frontend.getConflicts(doc1.birds), [{[actor]: {species: 'woodpecker', numSeen: 1}}])
      assert.deepEqual(Frontend.getConflicts(doc2.birds), [{[actor]: {species: 'woodpecker', numSeen: 2}}])
    })

    it('should delete list elements', () => {
      const birds = uuid(), actor = uuid()
      const diffs1 = [
        {obj: birds,   type: 'list', action: 'create'},
        {obj: birds,   type: 'list', action: 'insert', index: 0, value: 'chaffinch', elemId: `${actor}:1`},
        {obj: birds,   type: 'list', action: 'insert', index: 1, value: 'goldfinch', elemId: `${actor}:2`},
        {obj: ROOT_ID, type: 'map',  action: 'set',    key: 'birds', value: birds, link: true}
      ]
      const diffs2 = [
        {obj: birds,   type: 'list', action: 'remove', index: 0}
      ]
      const doc1 = Frontend.applyPatch(Frontend.init(), {diffs: diffs1})
      const doc2 = Frontend.applyPatch(doc1, {diffs: diffs2})
      assert.deepEqual(doc1, {birds: ['chaffinch', 'goldfinch']})
      assert.deepEqual(doc2, {birds: ['goldfinch']})
    })

    it('should apply updates at different levels of the object tree', () => {
      const counts = uuid(), details = uuid(), detail1 = uuid(), actor = uuid()
      const diffs1 = [
        {obj: counts,  type: 'map',  action: 'create'},
        {obj: counts,  type: 'map',  action: 'set', key: 'magpies', value: 2},
        {obj: detail1, type: 'map',  action: 'create'},
        {obj: detail1, type: 'map',  action: 'set', key: 'species', value: 'magpie'},
        {obj: detail1, type: 'map',  action: 'set', key: 'family',  value: 'corvidae'},
        {obj: details, type: 'list', action: 'create'},
        {obj: details, type: 'list', action: 'insert',  index: 0,   value: detail1, link: true, elemId: `${actor}:1`},
        {obj: ROOT_ID, type: 'map',  action: 'set', key: 'counts',  value: counts,  link: true},
        {obj: ROOT_ID, type: 'map',  action: 'set', key: 'details', value: details, link: true}
      ]
      const diffs2 = [
        {obj: counts,  type: 'map',  action: 'set', key: 'magpies', value: 3},
        {obj: detail1, type: 'map',  action: 'set', key: 'species', value: 'Eurasian magpie'}
      ]
      const doc1 = Frontend.applyPatch(Frontend.init(), {diffs: diffs1})
      const doc2 = Frontend.applyPatch(doc1, {diffs: diffs2})
      assert.deepEqual(doc1, {counts: {magpies: 2}, details: [{species: 'magpie', family: 'corvidae'}]})
      assert.deepEqual(doc2, {counts: {magpies: 3}, details: [{species: 'Eurasian magpie', family: 'corvidae'}]})
    })
  })
})
