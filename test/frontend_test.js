const assert = require('assert')
const Frontend = require('../frontend')
const Backend = require('../backend')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'
const uuid = require('../src/uuid')
const { STATE } = require('../frontend/constants')

describe('Frontend', () => {
  it('should be an empty object by default', () => {
    const doc = Frontend.init()
    assert.deepEqual(doc, {})
    assert(!!Frontend.getActorId(doc).match(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/))
  })

  it('should allow actorId assignment to be deferred', () => {
    let doc0 = Frontend.init({deferActorId: true})
    assert.strictEqual(Frontend.getActorId(doc0), undefined)
    assert.throws(() => { Frontend.change(doc0, doc => doc.foo = 'bar') }, /Actor ID must be initialized with setActorId/)
    const doc1 = Frontend.setActorId(doc0, uuid())
    const [doc2, req] = Frontend.change(doc1, doc => doc.foo = 'bar')
    assert.deepEqual(doc2, {foo: 'bar'})
  })

  describe('performing changes', () => {
    it('should return the unmodified document if nothing changed', () => {
      const doc0 = Frontend.init()
      const [doc1, req] = Frontend.change(doc0, doc => {})
      assert.strictEqual(doc1, doc0)
    })

    it('should set root object properties', () => {
      const actor = uuid()
      const [doc, req] = Frontend.change(Frontend.init(actor), doc => doc.bird = 'magpie')
      assert.deepEqual(doc, {bird: 'magpie'})
      assert.deepEqual(req, {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {obj: ROOT_ID, action: 'set', key: 'bird', value: 'magpie'}
      ]})
    })

    it('should create nested maps', () => {
      const [doc, req] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 3})
      const birds = Frontend.getObjectId(doc.birds), actor = Frontend.getActorId(doc)
      assert.deepEqual(doc, {birds: {wrens: 3}})
      assert.deepEqual(req, {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {obj: birds,   action: 'makeMap'},
        {obj: birds,   action: 'set',  key: 'wrens', value: 3},
        {obj: ROOT_ID, action: 'link', key: 'birds', value: birds}
      ]})
    })

    it('should apply updates inside nested maps', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 3})
      const [doc2, req2] = Frontend.change(doc1, doc => {
        doc.birds.wrens = 4
        doc.birds.sparrows = 15
      })
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc1)
      assert.deepEqual(doc1, {birds: {wrens: 3}})
      assert.deepEqual(doc2, {birds: {wrens: 4, sparrows: 15}})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: birds, action: 'set', key: 'wrens',    value: 4},
        {obj: birds, action: 'set', key: 'sparrows', value: 15}
      ]})
    })

    it('should delete keys in maps', () => {
      const actor = uuid()
      const [doc1, req1] = Frontend.change(Frontend.init(actor), doc => { doc.magpies = 2; doc.sparrows = 15 })
      const [doc2, req2] = Frontend.change(doc1, doc => delete doc['magpies'])
      assert.deepEqual(doc1, {magpies: 2, sparrows: 15})
      assert.deepEqual(doc2, {sparrows: 15})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: ROOT_ID, action: 'del', key: 'magpies'}
      ]})
    })

    it('should create lists', () => {
      const [doc, req] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const birds = Frontend.getObjectId(doc.birds), actor = Frontend.getActorId(doc)
      assert.deepEqual(doc, {birds: ['chaffinch']})
      assert.deepEqual(req, {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {obj: birds,   action: 'makeList'},
        {obj: birds,   action: 'ins',  key: '_head', elem: 1},
        {obj: birds,   action: 'set',  key: `${actor}:1`, value: 'chaffinch'},
        {obj: ROOT_ID, action: 'link', key: 'birds', value: birds}
      ]})
    })

    it('should apply updates inside lists', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const [doc2, req2] = Frontend.change(doc1, doc => doc.birds[0] = 'greenfinch')
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {birds: ['chaffinch']})
      assert.deepEqual(doc2, {birds: ['greenfinch']})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: birds, action: 'set', key: `${actor}:1`, value: 'greenfinch'}
      ]})
    })

    it('should delete list elements', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch', 'goldfinch'])
      const [doc2, req2] = Frontend.change(doc1, doc => doc.birds.deleteAt(0))
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {birds: ['chaffinch', 'goldfinch']})
      assert.deepEqual(doc2, {birds: ['goldfinch']})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: birds, action: 'del', key: `${actor}:1`}
      ]})
    })

    it('should detect increments in maps', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 1})
      const [doc2, req2] = Frontend.change(doc1, doc => doc.birds.wrens += 1)
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {birds: {wrens: 1}})
      assert.deepEqual(doc2, {birds: {wrens: 2}})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: birds, action: 'inc', key: 'wrens', value: 1}
      ]})
    })

    it('should detect increments in lists', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.counts = [1])
      const [doc2, req2] = Frontend.change(doc1, doc => doc.counts[0]++)
      const counts = Frontend.getObjectId(doc2.counts), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {counts: [1]})
      assert.deepEqual(doc2, {counts: [2]})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: counts, action: 'inc', key: `${actor}:1`, value: 1}
      ]})
    })

    it('should coalesce assignments and increments', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = {})
      const [doc2, req2] = Frontend.change(doc1, doc => { doc.birds.wrens = 1; doc.birds.wrens += 2 })
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {birds: {}})
      assert.deepEqual(doc2, {birds: {wrens: 3}})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: birds, action: 'set', key: 'wrens', value: 3}
      ]})
    })

    it('should coalesce multiple increments', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 0})
      const [doc2, req2] = Frontend.change(doc1, doc => { doc.birds.wrens++; doc.birds.wrens += 2; doc.birds.wrens++ })
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {birds: {wrens: 0}})
      assert.deepEqual(doc2, {birds: {wrens: 4}})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: birds, action: 'inc', key: 'wrens', value: 4}
      ]})
    })

    it('should let an assignment override increments', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 1})
      const [doc2, req2] = Frontend.change(doc1, doc => { doc.birds.wrens++; doc.birds.wrens = 10 })
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepEqual(doc1, {birds: {wrens: 1}})
      assert.deepEqual(doc2, {birds: {wrens: 10}})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: birds, action: 'set', key: 'wrens', value: 10}
      ]})
    })
  })

  describe('backend concurrency', () => {
    function getRequests(doc) {
      return doc[STATE].requests.map(req => {
        req = Object.assign({}, req)
        delete req['before']
        delete req['diffs']
        return req
      })
    }

    it('should use dependencies and sequence number from the backend', () => {
      const local = uuid(), remote1 = uuid(), remote2 = uuid()
      const patch1 = {
        clock: {[local]: 4, [remote1]: 11, [remote2]: 41},
        deps: {[local]: 4, [remote2]: 41},
        diffs: [{action: 'set', obj: ROOT_ID, type: 'map', key: 'blackbirds', value: 24}]
      }
      let doc1 = Frontend.applyPatch(Frontend.init(local), patch1)
      let [doc2, req] = Frontend.change(doc1, doc => doc.partridges = 1)
      assert.deepEqual(getRequests(doc2), [
        {requestType: 'change', actor: local, seq: 5, deps: {[remote2]: 41}, ops: [
          {obj: ROOT_ID, action: 'set', key: 'partridges', value: 1}
        ]}
      ])
    })

    it('should remove pending requests once handled', () => {
      const actor = uuid()
      let [doc1, change1] = Frontend.change(Frontend.init(actor), doc => doc.blackbirds = 24)
      let [doc2, change2] = Frontend.change(doc1, doc => doc.partridges = 1)
      assert.deepEqual(getRequests(doc2), [
        {requestType: 'change', actor, seq: 1, deps: {}, ops: [{obj: ROOT_ID, action: 'set', key: 'blackbirds', value: 24}]},
        {requestType: 'change', actor, seq: 2, deps: {}, ops: [{obj: ROOT_ID, action: 'set', key: 'partridges', value: 1}]}
      ])

      const diffs1 = [{obj: ROOT_ID, type: 'map', action: 'set', key: 'blackbirds', value: 24}]
      doc2 = Frontend.applyPatch(doc2, {actor, seq: 1, diffs: diffs1})
      assert.deepEqual(doc2, {blackbirds: 24, partridges: 1})
      assert.deepEqual(getRequests(doc2), [
        {requestType: 'change', actor, seq: 2, deps: {}, ops: [{obj: ROOT_ID, action: 'set', key: 'partridges', value: 1}]}
      ])

      const diffs2 = [{obj: ROOT_ID, type: 'map', action: 'set', key: 'partridges', value: 1}]
      doc2 = Frontend.applyPatch(doc2, {actor, seq: 2, diffs: diffs2})
      assert.deepEqual(doc2, {blackbirds: 24, partridges: 1})
      assert.deepEqual(getRequests(doc2), [])
    })

    it('should leave the request queue unchanged on remote patches', () => {
      const actor = uuid(), other = uuid()
      let [doc, req] = Frontend.change(Frontend.init(actor), doc => doc.blackbirds = 24)
      assert.deepEqual(getRequests(doc), [
        {requestType: 'change', actor, seq: 1, deps: {}, ops: [{obj: ROOT_ID, action: 'set', key: 'blackbirds', value: 24}]}
      ])

      const diffs1 = [{obj: ROOT_ID, type: 'map', action: 'set', key: 'pheasants', value: 2}]
      doc = Frontend.applyPatch(doc, {actor: other, seq: 1, diffs: diffs1})
      assert.deepEqual(doc, {blackbirds: 24, pheasants: 2})
      assert.deepEqual(getRequests(doc), [
        {requestType: 'change', actor, seq: 1, deps: {}, ops: [{obj: ROOT_ID, action: 'set', key: 'blackbirds', value: 24}]}
      ])

      const diffs2 = [{obj: ROOT_ID, type: 'map', action: 'set', key: 'blackbirds', value: 24}]
      doc = Frontend.applyPatch(doc, {actor, seq: 1, diffs: diffs2})
      assert.deepEqual(doc, {blackbirds: 24, pheasants: 2})
      assert.deepEqual(getRequests(doc), [])
    })

    it('should not allow request patches to be applied out-of-order', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.blackbirds = 24)
      const [doc2, req2] = Frontend.change(doc1, doc => doc.partridges = 1)
      const actor = Frontend.getActorId(doc2)
      const diffs = [{obj: ROOT_ID, type: 'map', action: 'set', key: 'partridges', value: 1}]
      assert.throws(() => { Frontend.applyPatch(doc2, {actor, seq: 2, diffs}) }, /Mismatched sequence number/)
    })

    it('should transform concurrent insertions', () => {
      let [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = ['goldfinch'])
      const birds = Frontend.getObjectId(doc1.birds), actor = Frontend.getActorId(doc1)
      const diffs1 = [
        {obj: birds,   type: 'list', action: 'create'},
        {obj: birds,   type: 'list', action: 'insert', index: 0, value: 'goldfinch', elemId: `${actor}:1`},
        {obj: ROOT_ID, type: 'map',  action: 'set',    key: 'birds', value: birds, link: true}
      ]
      doc1 = Frontend.applyPatch(doc1, {actor, seq: 1, diffs: diffs1})
      assert.deepEqual(doc1, {birds: ['goldfinch']})
      assert.deepEqual(getRequests(doc1), [])

      const [doc2, req2] = Frontend.change(doc1, doc => {
        doc.birds.insertAt(0, 'chaffinch')
        doc.birds.insertAt(2, 'greenfinch')
      })
      assert.deepEqual(doc2, {birds: ['chaffinch', 'goldfinch', 'greenfinch']})

      const diffs3 = [{obj: birds, type: 'list', action: 'insert', index: 1, value: 'bullfinch', elemId: `${uuid()}:2`}]
      const doc3 = Frontend.applyPatch(doc2, {actor: uuid(), seq: 1, diffs: diffs3})
      // TODO this is not correct: order of 'bullfinch' and 'greenfinch' should depend on thier elemIds
      assert.deepEqual(doc3, {birds: ['chaffinch', 'goldfinch', 'bullfinch', 'greenfinch']})

      const diffs4 = [
        {obj: birds, type: 'list', action: 'insert', index: 0, value: 'chaffinch',  elemId: `${actor}:2`},
        {obj: birds, type: 'list', action: 'insert', index: 2, value: 'greenfinch', elemId: `${actor}:3`}
      ]
      const doc4 = Frontend.applyPatch(doc3, {actor, seq: 2, diffs: diffs4})
      assert.deepEqual(doc4, {birds: ['chaffinch', 'goldfinch', 'greenfinch', 'bullfinch']})
      assert.deepEqual(getRequests(doc4), [])
    })

    it('should allow interleaving of patches and changes', () => {
      const actor = uuid()
      const [doc1, req1] = Frontend.change(Frontend.init(actor), doc => doc.number = 1)
      const [doc2, req2] = Frontend.change(doc1, doc => doc.number = 2)
      assert.deepEqual(req1, {requestType: 'change', actor, seq: 1, deps: {}, ops: [{obj: ROOT_ID, action: 'set', key: 'number', value: 1}]})
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [{obj: ROOT_ID, action: 'set', key: 'number', value: 2}]})
      const state0 = Backend.init()
      const [state1, patch1] = Backend.applyLocalChange(state0, req1)
      const doc2a = Frontend.applyPatch(doc2, patch1)
      const [doc3, req3] = Frontend.change(doc2a, doc => doc.number = 3)
      assert.deepEqual(req3, {requestType: 'change', actor, seq: 3, deps: {}, ops: [{obj: ROOT_ID, action: 'set', key: 'number', value: 3}]})
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
