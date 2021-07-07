const assert = require('assert')
const Frontend = require('../frontend')
const { decodeChange } = require('../backend/columnar')
const { Backend } = require('../src/automerge')
const uuid = require('../src/uuid')
const { STATE } = require('../frontend/constants')
const UUID_PATTERN = /^[0-9a-f]{32}$/

describe('Automerge.Frontend', () => {
  describe('initializing', () => {
    it('should be an empty object by default', () => {
      const doc = Frontend.init()
      assert.deepStrictEqual(doc, {})
      assert(UUID_PATTERN.test(Frontend.getActorId(doc).toString()))
    })

    it('should allow actorId assignment to be deferred', () => {
      let doc0 = Frontend.init({ deferActorId: true })
      assert.strictEqual(Frontend.getActorId(doc0), undefined)
      assert.throws(() => { Frontend.change(doc0, doc => doc.foo = 'bar') }, /Actor ID must be initialized with setActorId/)
      const doc1 = Frontend.setActorId(doc0, uuid())
      const [doc2] = Frontend.change(doc1, doc => doc.foo = 'bar')
      assert.deepStrictEqual(doc2, { foo: 'bar' })
    })

    it('should allow instantiating from an existing object', () => {
      const initialState = {
        birds: {
          wrens: 3,
          magpies: 4
        }
      }
      const [doc] = Frontend.from(initialState)
      assert.deepStrictEqual(doc, initialState)
    })

    it('should accept an empty object as initial state', () => {
      const [doc] = Frontend.from({})
      assert.deepStrictEqual(doc, {})
    })
  })

  describe('performing changes', () => {
    it('should return the unmodified document if nothing changed', () => {
      const doc0 = Frontend.init()
      const [doc1] = Frontend.change(doc0, () => {})
      assert.strictEqual(doc1, doc0)
    })

    it('should set root object properties', () => {
      const actor = uuid()
      const [doc, change] = Frontend.change(Frontend.init(actor), doc => doc.bird = 'magpie')
      assert.deepStrictEqual(doc, {bird: 'magpie'})
      assert.deepStrictEqual(change, {
        actor, seq: 1, time: change.time, message: '', startOp: 1, deps: [], ops: [
          {obj: '_root', action: 'set', key: 'bird', insert: false, value: 'magpie', pred: []}
        ]
      })
    })

    it('should create nested maps', () => {
      const [doc, change] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 3})
      const birds = Frontend.getObjectId(doc.birds), actor = Frontend.getActorId(doc)
      assert.deepStrictEqual(doc, {birds: {wrens: 3}})
      assert.deepStrictEqual(change, {
        actor, seq: 1, time: change.time, message: '', startOp: 1, deps: [], ops: [
          {obj: '_root', action: 'makeMap', key: 'birds', insert: false, pred: []},
          {obj: birds,   action: 'set',     key: 'wrens', insert: false, datatype: 'int', value: 3, pred: []}
        ]
      })
    })

    it('should apply updates inside nested maps', () => {
      const [doc1] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 3})
      const [doc2, change2] = Frontend.change(doc1, doc => doc.birds.sparrows = 15)
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc1)
      assert.deepStrictEqual(doc1, {birds: {wrens: 3}})
      assert.deepStrictEqual(doc2, {birds: {wrens: 3, sparrows: 15}})
      assert.deepStrictEqual(change2, {
        actor, seq: 2, time: change2.time, message: '', startOp: 3, deps: [], ops: [
          {obj: birds, action: 'set', key: 'sparrows', insert: false, datatype: 'int', value: 15, pred: []}
        ]
      })
    })

    it('should delete keys in maps', () => {
      const actor = uuid()
      const [doc1] = Frontend.change(Frontend.init(actor), doc => { doc.magpies = 2; doc.sparrows = 15 })
      const [doc2, change2] = Frontend.change(doc1, doc => delete doc.magpies)
      assert.deepStrictEqual(doc1, {magpies: 2, sparrows: 15})
      assert.deepStrictEqual(doc2, {sparrows: 15})
      assert.deepStrictEqual(change2, {
        actor, seq: 2, time: change2.time, message: '', startOp: 3, deps: [], ops: [
          {obj: '_root', action: 'del', key: 'magpies', insert: false, pred: [ `1@${actor}`]}
        ]
      })
    })

    it('should create lists', () => {
      const [doc, change] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const actor = Frontend.getActorId(doc)
      assert.deepStrictEqual(doc, {birds: ['chaffinch']})
      assert.deepStrictEqual(change, {
        actor, seq: 1, time: change.time, message: '', startOp: 1, deps: [], ops: [
          {obj: '_root', action: 'makeList', key: 'birds', insert: false, pred: []},
          {obj: `1@${actor}`, action: 'set', elemId: '_head', insert: true, value: 'chaffinch', pred: []}
        ]
      })
    })

    it('should apply updates inside lists', () => {
      const [doc1] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const [doc2, change2] = Frontend.change(doc1, doc => doc.birds[0] = 'greenfinch')
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch']})
      assert.deepStrictEqual(doc2, {birds: ['greenfinch']})
      assert.deepStrictEqual(change2, {
        actor, seq: 2, time: change2.time, message: '', startOp: 3, deps: [], ops: [
          {obj: birds, action: 'set', elemId: `2@${actor}`, insert: false, value: 'greenfinch', pred: [ `2@${actor}` ]}
        ]
      })
    })

    it('should insert nulls when indexing out of upper-bound range', () => {
      const [doc1] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const [doc2, change2] = Frontend.change(doc1, doc => doc.birds[3] = 'greenfinch')
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch']})
      assert.deepStrictEqual(doc2, {birds: ['chaffinch', null, null, 'greenfinch']})
      assert.deepStrictEqual(change2, {
        actor, seq: 2, startOp: 3, deps: [], time: change2.time, message: '',  ops: [
          {action: 'set', obj: birds, elemId: `2@${actor}`, insert: true, values: [null, null, 'greenfinch'], pred: []}
        ]
      })
    })

    it('should delete list elements', () => {
      const [doc1] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch', 'goldfinch'])
      const [doc2, change2] = Frontend.change(doc1, doc => doc.birds.deleteAt(0))
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch', 'goldfinch']})
      assert.deepStrictEqual(doc2, {birds: ['goldfinch']})
      assert.deepStrictEqual(change2, {
        actor, seq: 2, time: change2.time, message: '', startOp: 4, deps: [], ops: [
          {obj: birds, action: 'del', elemId: `2@${actor}`, insert: false, pred: [`2@${actor}`]}
        ]
      })
    })

    it('should store Date objects as timestamps', () => {
      const now = new Date()
      const [doc, change] = Frontend.change(Frontend.init(), doc => doc.now = now)
      const actor = Frontend.getActorId(doc)
      assert.strictEqual(doc.now instanceof Date, true)
      assert.strictEqual(doc.now.getTime(), now.getTime())
      assert.deepStrictEqual(change, {
        actor, seq: 1, time: change.time, message: '', startOp: 1, deps: [], ops: [
          {obj: '_root', action: 'set', key: 'now', insert: false, value: now.getTime(), datatype: 'timestamp', pred: []}
        ]
      })
    })

    describe('counters', () => {
      it('should handle counters inside maps', () => {
        const [doc1, change1] = Frontend.change(Frontend.init(), doc => {
          doc.wrens = new Frontend.Counter()
          assert.strictEqual(doc.wrens.value, 0)
        })
        const [doc2, change2] = Frontend.change(doc1, doc => {
          doc.wrens.increment()
          assert.strictEqual(doc.wrens.value, 1)
        })
        const actor = Frontend.getActorId(doc2)
        assert.deepStrictEqual(doc1, {wrens: new Frontend.Counter(0)})
        assert.deepStrictEqual(doc2, {wrens: new Frontend.Counter(1)})
        assert.deepStrictEqual(change1, {
          actor, seq: 1, time: change1.time, message: '', startOp: 1, deps: [], ops: [
            {obj: '_root', action: 'set', key: 'wrens', insert: false, value: 0, datatype: 'counter', pred: []}
          ]
        })
        assert.deepStrictEqual(change2, {
          actor, seq: 2, time: change2.time, message: '', startOp: 2, deps: [], ops: [
            {obj: '_root', action: 'inc', key: 'wrens', insert: false, value: 1, pred: [`1@${actor}`]}
          ]
        })
      })

      it('should handle counters inside lists', () => {
        const [doc1, change1] = Frontend.change(Frontend.init(), doc => {
          doc.counts = [new Frontend.Counter(1)]
          assert.strictEqual(doc.counts[0].value, 1)
        })
        const [doc2, change2] = Frontend.change(doc1, doc => {
          doc.counts[0].increment(2)
          assert.strictEqual(doc.counts[0].value, 3)
        })
        const counts = Frontend.getObjectId(doc2.counts), actor = Frontend.getActorId(doc2)
        assert.deepStrictEqual(doc1, {counts: [new Frontend.Counter(1)]})
        assert.deepStrictEqual(doc2, {counts: [new Frontend.Counter(3)]})
        assert.deepStrictEqual(change1, {
          actor, deps: [], seq: 1, time: change1.time, message: '', startOp: 1, ops: [
            {obj: '_root', action: 'makeList', key: 'counts', insert: false, pred: []},
            {obj: counts, action: 'set', elemId: '_head', insert: true, value: 1, datatype: 'counter', pred: []}
          ]
        })
        assert.deepStrictEqual(change2, {
          actor, deps: [], seq: 2, time: change2.time, message: '', startOp: 3, ops: [
            {obj: counts, action: 'inc', elemId: `2@${actor}`, insert: false, value: 2, pred: [`2@${actor}`]}
          ]
        })
      })

      it('should refuse to overwrite a property with a counter value', () => {
        const [doc1] = Frontend.change(Frontend.init(), doc => {
          doc.counter = new Frontend.Counter()
          doc.list = [new Frontend.Counter()]
        })
        assert.throws(() => Frontend.change(doc1, doc => doc.counter++), /Cannot overwrite a Counter object/)
        assert.throws(() => Frontend.change(doc1, doc => doc.list[0] = 3), /Cannot overwrite a Counter object/)
      })

      it('should make counter objects behave like primitive numbers', () => {
        const [doc1] = Frontend.change(Frontend.init(), doc => doc.birds = new Frontend.Counter(3))
        assert.equal(doc1.birds, 3) // they are equal according to ==, but not strictEqual according to ===
        assert.notStrictEqual(doc1.birds, 3)
        assert(doc1.birds < 4)
        assert(doc1.birds >= 0)
        assert(!(doc1.birds <= 2))
        assert.strictEqual(doc1.birds + 10, 13)
        assert.strictEqual(`I saw ${doc1.birds} birds`, 'I saw 3 birds')
        assert.strictEqual(['I saw', doc1.birds, 'birds'].join(' '), 'I saw 3 birds')
      })

      it('should allow counters to be serialized to JSON', () => {
        const [doc1] = Frontend.change(Frontend.init(), doc => doc.birds = new Frontend.Counter())
        assert.strictEqual(JSON.stringify(doc1), '{"birds":0}')
      })
    })
  })

  describe('backend concurrency', () => {
    function getRequests(doc) {
      return doc[STATE].requests.map(req => ({actor: req.actor, seq: req.seq}))
    }

    it('should use version and sequence number from the backend', () => {
      const local = uuid(), remote1 = uuid(), remote2 = uuid()
      const patch1 = {
        clock: {[local]: 4, [remote1]: 11, [remote2]: 41}, maxOp: 4, deps: [],
        diffs: {objectId: '_root', type: 'map', props: {blackbirds: {[local]: {type: 'value', value: 24}}}}
      }
      let doc1 = Frontend.applyPatch(Frontend.init(local), patch1)
      let [doc2, change] = Frontend.change(doc1, doc => doc.partridges = 1)
      assert.deepStrictEqual(change, {
        actor: local, seq: 5, deps: [], startOp: 5, time: change.time, message: '', ops: [
          {obj: '_root', action: 'set', key: 'partridges', insert: false, datatype: 'int', value: 1, pred: []}
        ]
      })
      assert.deepStrictEqual(getRequests(doc2), [{actor: local, seq: 5}])
    })

    it('should remove pending requests once handled', () => {
      const actor = uuid()
      let [doc1, change1] = Frontend.change(Frontend.init(actor), doc => doc.blackbirds = 24)
      let [doc2, change2] = Frontend.change(doc1, doc => doc.partridges = 1)
      assert.deepStrictEqual(change1, {
        actor, seq: 1, deps: [], startOp: 1, time: change1.time, message: '', ops: [
          {obj: '_root', action: 'set', key: 'blackbirds', insert: false, datatype: 'int', value: 24, pred: []}
        ]
      })
      assert.deepStrictEqual(change2, {
        actor, seq: 2, deps: [], startOp: 2, time: change2.time, message: '', ops: [
          {obj: '_root', action: 'set', key: 'partridges', insert: false, datatype: 'int', value: 1, pred: []}
        ]
      })
      assert.deepStrictEqual(getRequests(doc2), [{actor, seq: 1}, {actor, seq: 2}])

      doc2 = Frontend.applyPatch(doc2, {
        actor, seq: 1, clock: {[actor]: 1}, diffs: {
          objectId: '_root', type: 'map', props: {blackbirds: {[actor]: {type: 'value', value: 24}}}
        }
      })
      assert.deepStrictEqual(getRequests(doc2), [{actor, seq: 2}])
      assert.deepStrictEqual(doc2, {blackbirds: 24, partridges: 1})

      doc2 = Frontend.applyPatch(doc2, {
        actor, seq: 2, clock: {[actor]: 2}, diffs: {
          objectId: '_root', type: 'map', props: {partridges: {[actor]: {type: 'value', value: 1}}}
        }
      })
      assert.deepStrictEqual(doc2, {blackbirds: 24, partridges: 1})
      assert.deepStrictEqual(getRequests(doc2), [])
    })

    it('should leave the request queue unchanged on remote patches', () => {
      const actor = uuid(), other = uuid()
      let [doc, req] = Frontend.change(Frontend.init(actor), doc => doc.blackbirds = 24)
      assert.deepStrictEqual(req, {
        actor, seq: 1, deps: [], startOp: 1, time: req.time, message: '', ops: [
          {obj: '_root', action: 'set', key: 'blackbirds', insert: false, datatype: 'int', value: 24, pred: []}
        ]
      })
      assert.deepStrictEqual(getRequests(doc), [{actor, seq: 1}])

      doc = Frontend.applyPatch(doc, {
        clock: {[other]: 1}, diffs: {
          objectId: '_root', type: 'map', props: {pheasants: {[other]: {type: 'value', value: 2}}}
        }
      })
      assert.deepStrictEqual(doc, {blackbirds: 24})
      assert.deepStrictEqual(getRequests(doc), [{actor, seq: 1}])

      doc = Frontend.applyPatch(doc, {
        actor, seq: 1, clock: {[actor]: 1, [other]: 1}, diffs: {
          objectId: '_root', type: 'map', props: {blackbirds: {[actor]: {type: 'value', value: 24}}}
        }
      })
      assert.deepStrictEqual(doc, {blackbirds: 24, pheasants: 2})
      assert.deepStrictEqual(getRequests(doc), [])
    })

    it('should not allow request patches to be applied out of order', () => {
      const [doc1] = Frontend.change(Frontend.init(), doc => doc.blackbirds = 24)
      const [doc2] = Frontend.change(doc1, doc => doc.partridges = 1)
      const actor = Frontend.getActorId(doc2)
      const diffs = {objectId: '_root', type: 'map', props: {partridges: {[actor]: {type: 'value', value: 1}}}}
      assert.throws(() => {
        Frontend.applyPatch(doc2, {actor, seq: 2, clock: {[actor]: 2}, diffs})
      }, /Mismatched sequence number/)
    })

    it('should handle concurrent insertions into lists', () => {
      let [doc1] = Frontend.change(Frontend.init(), doc => doc.birds = ['goldfinch'])
      const birds = Frontend.getObjectId(doc1.birds), actor = Frontend.getActorId(doc1)
      doc1 = Frontend.applyPatch(doc1, {
        actor, seq: 1, clock: {[actor]: 1}, maxOp: 2,
        diffs: {objectId: '_root', type: 'map', props: {
          birds: {[actor]: {objectId: birds, type: 'list', edits: [
            {action: 'insert', elemId: `2@${actor}`, opId: `2@${actor}`, index: 0, value: {type: 'value', value: 'goldfinch'}}
          ]}}
        }}
      })
      assert.deepStrictEqual(doc1, {birds: ['goldfinch']})
      assert.deepStrictEqual(getRequests(doc1), [])

      const [doc2] = Frontend.change(doc1, doc => {
        doc.birds.insertAt(0, 'chaffinch')
        doc.birds.insertAt(2, 'greenfinch')
      })
      assert.deepStrictEqual(doc2, {birds: ['chaffinch', 'goldfinch', 'greenfinch']})

      const remoteActor = uuid()
      const doc3 = Frontend.applyPatch(doc2, {
        clock: {[actor]: 1, [remoteActor]: 1}, maxOp: 4,
        diffs: {objectId: '_root', type: 'map', props: {
          birds: {[actor]: {objectId: birds, type: 'list', edits: [
            {action: 'insert', elemId: `1@${remoteActor}`, opId: `1@${remoteActor}`, index: 1, value: {type: 'value', value: 'bullfinch'}}
          ]}}
        }}
      })
      // The addition of 'bullfinch' does not take effect yet: it is queued up until the pending
      // request has made its round-trip through the backend.
      assert.deepStrictEqual(doc3, {birds: ['chaffinch', 'goldfinch', 'greenfinch']})

      const doc4 = Frontend.applyPatch(doc3, {
        actor, seq: 2, clock: {[actor]: 2, [remoteActor]: 1}, maxOp: 4,
        diffs: {objectId: '_root', type: 'map', props: {
          birds: {[actor]: {objectId: birds, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `3@${actor}`, opId: `3@${actor}`, value: {type: 'value', value: 'chaffinch'}},
            {action: 'insert', index: 2, elemId: `4@${actor}`, opId: `4@${actor}`, value: {type: 'value', value: 'greenfinch'}}
          ]}}
        }}
      })
      assert.deepStrictEqual(doc4, {birds: ['chaffinch', 'goldfinch', 'greenfinch', 'bullfinch']})
      assert.deepStrictEqual(getRequests(doc4), [])
    })

    it('should allow interleaving of patches and changes', () => {
      const actor = uuid()
      const [doc1, change1] = Frontend.change(Frontend.init(actor), doc => doc.number = 1)
      const [doc2, change2] = Frontend.change(doc1, doc => doc.number = 2)
      assert.deepStrictEqual(change1, {
        actor, deps: [], startOp: 1, seq: 1, time: change1.time, message: '', ops: [
          {obj: '_root', action: 'set', key: 'number', insert: false, datatype: 'int', value: 1, pred: []}
        ]
      })
      assert.deepStrictEqual(change2, {
        actor, deps: [], startOp: 2, seq: 2, time: change2.time, message: '', ops: [
          {obj: '_root', action: 'set', key: 'number', insert: false, datatype: 'int', value: 2, pred: [`1@${actor}`]}
        ]
      })
      const state0 = Backend.init()
      const [/* state1 */, patch1, /* binChange1 */] = Backend.applyLocalChange(state0, change1)
      const doc2a = Frontend.applyPatch(doc2, patch1)
      const [/* doc3 */, change3] = Frontend.change(doc2a, doc => doc.number = 3)
      assert.deepStrictEqual(change3, {
        actor, seq: 3, startOp: 3, time: change3.time, message: '', deps: [], ops: [
          {obj: '_root', action: 'set', key: 'number', insert: false, datatype: 'int', value: 3, pred: [`2@${actor}`]}
        ]
      })
    })

    it('deps are filled in if the frontend does not have the latest patch', () => {
      const actor1 = uuid(), actor2 = uuid()
      const [/* doc1 */, change1] = Frontend.change(Frontend.init(actor1), doc => doc.number = 1)
      const [/* state1 */, /* patch1 */, binChange1] = Backend.applyLocalChange(Backend.init(), change1)

      const [state1a, patch1a] = Backend.applyChanges(Backend.init(), [binChange1])
      const doc1a = Frontend.applyPatch(Frontend.init(actor2), patch1a)
      const [doc2, change2] = Frontend.change(doc1a, doc => doc.number = 2)
      const [doc3, change3] = Frontend.change(doc2, doc => doc.number = 3)
      assert.deepStrictEqual(change2, {
        actor: actor2, seq: 1, startOp: 2, deps: [decodeChange(binChange1).hash], time: change2.time, message: '', ops: [
          {obj: '_root', action: 'set', key: 'number', insert: false, datatype: 'int', value: 2, pred: [`1@${actor1}`]}
        ]
      })
      assert.deepStrictEqual(change3, {
        actor: actor2, seq: 2, startOp: 3, deps: [], time: change3.time, message: '', ops: [
          {obj: '_root', action: 'set', key: 'number', insert: false, datatype: 'int', value: 3, pred: [`2@${actor2}`]}
        ]
      })

      const [state2, patch2, binChange2] = Backend.applyLocalChange(state1a, change2)
      const [state3, patch3, binChange3] = Backend.applyLocalChange(state2, change3)
      assert.deepStrictEqual(decodeChange(binChange2).deps, [decodeChange(binChange1).hash])
      assert.deepStrictEqual(decodeChange(binChange3).deps, [decodeChange(binChange2).hash])
      assert.deepStrictEqual(patch1a.deps, [decodeChange(binChange1).hash])
      assert.deepStrictEqual(patch2.deps, [])

      const doc2a = Frontend.applyPatch(doc3, patch2)
      const doc3a = Frontend.applyPatch(doc2a, patch3)
      const [/* doc4 */, change4] = Frontend.change(doc3a, doc => doc.number = 4)
      assert.deepStrictEqual(change4, {
        actor: actor2, seq: 3, startOp: 4, time: change4.time, message: '', deps: [], ops: [
          {obj: '_root', action: 'set', key: 'number', insert: false, datatype: 'int', value: 4, pred: [`3@${actor2}`]}
        ]
      })
      const [/* state4 */, /* patch4 */, binChange4] = Backend.applyLocalChange(state3, change4)
      assert.deepStrictEqual(decodeChange(binChange4).deps, [decodeChange(binChange3).hash])
    })
  })

  describe('applying patches', () => {
    it('should set root object properties', () => {
      const actor = uuid()
      const patch = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {bird: {[actor]: {type: 'value', value: 'magpie'}}}}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch)
      assert.deepStrictEqual(doc, {bird: 'magpie'})
    })

    it('should reveal conflicts on root object properties', () => {
      const patch = {
        clock: {actor1: 1, actor2: 1},
        diffs: {objectId: '_root', type: 'map', props: {
          favoriteBird: {actor1: {type: 'value', value: 'robin'}, actor2: {type: 'value', value: 'wagtail'}}
        }}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch)
      assert.deepStrictEqual(doc, {favoriteBird: 'wagtail'})
      assert.deepStrictEqual(Frontend.getConflicts(doc, 'favoriteBird'), {actor1: 'robin', actor2: 'wagtail'})
    })

    it('should create nested maps', () => {
      const birds = uuid(), actor = uuid()
      const patch = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {wrens: {[actor]: {value: 3}}}
        }}}}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch)
      assert.deepStrictEqual(doc, {birds: {wrens: 3}})
    })

    it('should apply updates inside nested maps', () => {
      const birds = uuid(), actor = uuid()
      const patch1 = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {wrens: {[actor]: {type: 'value', value: 3}}}
        }}}}
      }
      const patch2 = {
        clock: {[actor]: 2},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {sparrows: {[actor]: {type: 'value', value: 15}}}
        }}}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {birds: {wrens: 3}})
      assert.deepStrictEqual(doc2, {birds: {wrens: 3, sparrows: 15}})
    })

    it('should apply updates inside map key conflicts', () => {
      const birds1 = uuid(), birds2 = uuid()
      const patch1 = {
        clock: {[birds1]: 1, [birds2]: 1},
        diffs: {objectId: '_root', type: 'map', props: {favoriteBirds: {
          actor1: {objectId: birds1, type: 'map', props: {blackbirds: {actor1: {type: 'value', value: 1}}}},
          actor2: {objectId: birds2, type: 'map', props: {wrens:      {actor2: {type: 'value', value: 3}}}}
        }}}
      }
      const patch2 = {
        clock: {[birds1]: 2, [birds2]: 1},
        diffs: {objectId: '_root', type: 'map', props: {favoriteBirds: {
          actor1: {objectId: birds1, type: 'map', props: {blackbirds: {actor1: {value: 2}}}},
          actor2: {objectId: birds2, type: 'map'}
        }}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {favoriteBirds: {wrens: 3}})
      assert.deepStrictEqual(doc2, {favoriteBirds: {wrens: 3}})
      assert.deepStrictEqual(Frontend.getConflicts(doc1, 'favoriteBirds'), {actor1: {blackbirds: 1}, actor2: {wrens: 3}})
      assert.deepStrictEqual(Frontend.getConflicts(doc2, 'favoriteBirds'), {actor1: {blackbirds: 2}, actor2: {wrens: 3}})
    })

    it('should structure-share unmodified objects', () => {
      const birds = uuid(), mammals = uuid(), actor = uuid()
      const patch1 = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {
          birds:   {[actor]: {objectId: birds,     type: 'map', props: {wrens:   {[actor]: {value: 3}}}}},
          mammals: {[actor]: {objectId: mammals,   type: 'map', props: {badgers: {[actor]: {value: 1}}}}}
        }}
      }
      const patch2 = {
        clock: {[actor]: 2},
        diffs: {objectId: '_root', type: 'map', props: {
          birds:   {[actor]: {objectId: birds,     type: 'map', props: {sparrows: {[actor]: {value: 15}}}}}
        }}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {birds: {wrens: 3}, mammals: {badgers: 1}})
      assert.deepStrictEqual(doc2, {birds: {wrens: 3, sparrows: 15}, mammals: {badgers: 1}})
      assert.strictEqual(doc1.mammals, doc2.mammals)
    })

    it('should delete keys in maps', () => {
      const actor = uuid()
      const patch1 = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {
          magpies: {[actor]: {value: 2}}, sparrows: {[actor]: {value: 15}}
        }}
      }
      const patch2 = {
        clock: {[actor]: 2},
        diffs: {objectId: '_root', type: 'map', props: {
          magpies: {}
        }}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {magpies: 2, sparrows: 15})
      assert.deepStrictEqual(doc2, {sparrows: 15})
    })

    it('should create lists', () => {
      const birds = uuid(), actor = uuid()
      const patch = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {value: 'chaffinch'}}
          ]
        }}}}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch)
      assert.deepStrictEqual(doc, {birds: ['chaffinch']})
    })

    it('should apply updates inside lists', () => {
      const birds = uuid(), actor = uuid()
      const patch1 = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {value: 'chaffinch'}}
          ]
        }}}}
      }
      const patch2 = {
        clock: {[actor]: 2},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list',
          edits: [{action: 'update', index: 0, opId: `3@${actor}`, value: {value: 'greenfinch'}}]
        }}}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch']})
      assert.deepStrictEqual(doc2, {birds: ['greenfinch']})
    })

    it('should apply updates inside list element conflicts', () => {
      const actor1 = '01234567', actor2 = '89abcdef', birds = `1@${actor1}`
      const patch1 = {
        clock: {[actor1]: 2, [actor2]: 1}, diffs: {objectId: '_root', type: 'map', props: {birds: {[birds]: {
          objectId: birds, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {
              objectId: `2@${actor1}`, type: 'map', props: {
                species: {[`3@${actor1}`]: {type: 'value', value: 'woodpecker'}},
                numSeen: {[`4@${actor1}`]: {type: 'value', value: 1}}
              }
            }},
            {action: 'update', index: 0, opId: `2@${actor2}`, value: {
              objectId: `2@${actor2}`, type: 'map', props: {
                species: {[`3@${actor2}`]: {type: 'value', value: 'lapwing'}},
                numSeen: {[`4@${actor2}`]: {type: 'value', value: 2}}
              }
            }}
          ]
        }}}}
      }
      const patch2 = {
        clock: {[actor1]: 3, [actor2]: 1}, diffs: {objectId: '_root', type: 'map', props: {birds: {[birds]: {
          objectId: birds, type: 'list', edits: [
            {action: 'update', index: 0, opId: `2@${actor1}`, value: {
              objectId: `2@${actor1}`, type: 'map', props: {
                numSeen: {[`5@${actor1}`]: {type: 'value', value: 2}}
              }
            }},
            {action: 'update', index: 0, opId: `2@${actor2}`, value: {
              objectId: `2@${actor2}`, type: 'map', props: {}
            }}
          ]
        }}}}
      }
      const patch3 = {
        clock: {[actor1]: 3, [actor2]: 1}, diffs: {objectId: '_root', type: 'map', props: {birds: {[birds]: {
          objectId: birds, type: 'list', edits: [
            {action: 'update', index: 0, opId: `2@${actor1}`, value: {
              objectId: `2@${actor1}`, type: 'map', props: {
                numSeen: {[`6@${actor1}`]: {type: 'value', value: 2}}
              }
            }}
          ]
        }}}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      const doc3 = Frontend.applyPatch(doc2, patch3)
      assert.deepStrictEqual(doc1, {birds: [{species: 'lapwing', numSeen: 2}]})
      assert.deepStrictEqual(doc2, {birds: [{species: 'lapwing', numSeen: 2}]})
      assert.deepStrictEqual(doc3, {birds: [{species: 'woodpecker', numSeen: 2}]})
      assert.strictEqual(doc1.birds[0], doc2.birds[0])
      assert.deepStrictEqual(Frontend.getConflicts(doc1.birds, 0), {
        [`2@${actor1}`]: {species: 'woodpecker', numSeen: 1},
        [`2@${actor2}`]: {species: 'lapwing',    numSeen: 2}
      })
      assert.deepStrictEqual(Frontend.getConflicts(doc2.birds, 0), {
        [`2@${actor1}`]: {species: 'woodpecker', numSeen: 2},
        [`2@${actor2}`]: {species: 'lapwing',    numSeen: 2}
      })
      assert.deepStrictEqual(Frontend.getConflicts(doc3.birds, 0), undefined)
    })

    it('should apply multiinserts on lists', () => {
      const actor = uuid()
      const patch1 = {
        clock: {[actor]: 1}, diffs: {objectId: '_root', type: 'map', props: {birds: {[`@${actor}`]: {
          objectId: `1@${actor}`, type: 'list', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ["chaffinch", "goldfinch", "wren"]}
          ]
        }}}}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch1)
      assert.deepStrictEqual(doc, {birds: ["chaffinch", "goldfinch", "wren"]})
    })

    it('should delete list elements', () => {
      const birds = uuid(), actor = uuid()
      const patch1 = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list',
          edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {value: 'chaffinch'}},
            {action: 'insert', index: 1, elemId: `3@${actor}`, opId: `3@${actor}`, value: {value: 'goldfinch'}}
          ]
        }}}}
      }
      const patch2 = {
        clock: {[actor]: 2},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list', props: {},
          edits: [{action: 'remove', index: 0, count: 1}]
        }}}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch', 'goldfinch']})
      assert.deepStrictEqual(doc2, {birds: ['goldfinch']})
    })

    it('should delete multiple list elements', () => {
      const birds = uuid(), actor = uuid()
      const patch1 = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list', edits: [
            {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {value: 'chaffinch'}},
            {action: 'insert', index: 1, elemId: `3@${actor}`, opId: `3@${actor}`, value: {value: 'goldfinch'}}
          ]
        }}}}
      }
      const patch2 = {
        clock: {[actor]: 2},
        diffs: {objectId: '_root', type: 'map', props: {birds: {[`1@${actor}`]: {
          objectId: birds, type: 'list', props: {},
          edits: [{action: 'remove', index: 0, count: 2}]
        }}}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch', 'goldfinch']})
      assert.deepStrictEqual(doc2, {birds: []})
    })

    it('should apply updates at different levels of the object tree', () => {
      const actor = uuid()
      const patch1 = {
        clock: {[actor]: 1},
        diffs: {objectId: '_root', type: 'map', props: {
          counts: {[`1@${actor}`]: {objectId: `1@${actor}`, type: 'map', props: {
            magpies: {[`2@${actor}`]: {value: 2}}
          }}},
          details: {[`3@${actor}`]: {objectId: `3@${actor}`, type: 'list',
            edits: [{action: 'insert', index: 0, elemId: `4@${actor}`, opId: `4@${actor}`, value: {
              objectId: `4@${actor}`, type: 'map', props: {
                species: {[`5@${actor}`]: {type: 'value', value: 'magpie'}},
                family: {[`6@${actor}`]: {type: 'value', value: 'corvidae'}}
              }
            }}]}}
        }}
      }
      const patch2 = {
        clock: {[actor]: 2},
        diffs: {objectId: '_root', type: 'map', props: {
          counts: {[`1@${actor}`]: {objectId: `1@${actor}`, type: 'map', props: {
            magpies: {[`7@${actor}`]: {type: 'value', value: 3}}
          }}},
          details: {[`3@${actor}`]: {objectId: `3@${actor}`, type: 'list', edits: [
            {action: 'update', index: 0, opId: `4@${actor}`, value: {
              objectId: `4@${actor}`, type: 'map', props: {
                species: {[`8@${actor}`]: {type: 'value', value: 'Eurasian magpie'}}
              }
            }}
          ]}}
        }}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {counts: {magpies: 2}, details: [{species: 'magpie', family: 'corvidae'}]})
      assert.deepStrictEqual(doc2, {counts: {magpies: 3}, details: [{species: 'Eurasian magpie', family: 'corvidae'}]})
    })
  })

  it('should create text objects', () => {
    const actor = uuid()
    const patch1 = {
      clock: {[actor]: 1},
      diffs: {objectId: '_root', type: 'map', props: {
        text: {[`1@${actor}`]: {objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {type: 'value', value: '1'}},
          {action: 'multi-insert', index: 1, elemId: `3@${actor}`, values: ['2', '3', '4']}
        ]}}
      }}
    }
    const doc = Frontend.applyPatch(Frontend.init(), patch1)
    assert.deepStrictEqual(doc.text.toString(), '1234')
  })
})
