const assert = require('assert')
const Frontend = require('../frontend')
const { Backend } = require('../src/automerge')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'
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
      const [doc2, req] = Frontend.change(doc1, doc => doc.foo = 'bar')
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
      const [doc1, req] = Frontend.change(doc0, doc => {})
      assert.strictEqual(doc1, doc0)
    })

    it('should set root object properties', () => {
      const actor = uuid()
      const [doc, req] = Frontend.change(Frontend.init(actor), doc => doc.bird = 'magpie')
      assert.deepStrictEqual(doc, {bird: 'magpie'})
      assert.deepStrictEqual(req, {
        requestType: 'change', actor, seq: 1, time: req.time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'bird', value: 'magpie'}
        ]
      })
    })

    it('should create nested maps', () => {
      const [doc, req] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 3})
      const birds = Frontend.getObjectId(doc.birds), actor = Frontend.getActorId(doc)
      assert.deepStrictEqual(doc, {birds: {wrens: 3}})
      assert.deepStrictEqual(req, {
        requestType: 'change', actor, seq: 1, time: req.time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'makeMap', key: 'birds', child: birds},
          {obj: birds,   action: 'set',     key: 'wrens', value: 3}
        ]
      })
    })

    it('should apply updates inside nested maps', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = {wrens: 3})
      const [doc2, req2] = Frontend.change(doc1, doc => doc.birds.sparrows = 15)
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc1)
      assert.deepStrictEqual(doc1, {birds: {wrens: 3}})
      assert.deepStrictEqual(doc2, {birds: {wrens: 3, sparrows: 15}})
      assert.deepStrictEqual(req2, {
        requestType: 'change', actor, seq: 2, time: req2.time, message: '', version: 0, ops: [
          {obj: birds, action: 'set', key: 'sparrows', value: 15}
        ]
      })
    })

    it('should delete keys in maps', () => {
      const actor = uuid()
      const [doc1, req1] = Frontend.change(Frontend.init(actor), doc => { doc.magpies = 2; doc.sparrows = 15 })
      const [doc2, req2] = Frontend.change(doc1, doc => delete doc['magpies'])
      assert.deepStrictEqual(doc1, {magpies: 2, sparrows: 15})
      assert.deepStrictEqual(doc2, {sparrows: 15})
      assert.deepStrictEqual(req2, {
        requestType: 'change', actor, seq: 2, time: req2.time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'del', key: 'magpies'}
        ]
      })
    })

    it('should create lists', () => {
      const [doc, req] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const birds = Frontend.getObjectId(doc.birds), actor = Frontend.getActorId(doc)
      assert.deepStrictEqual(doc, {birds: ['chaffinch']})
      assert.deepStrictEqual(req, {
        requestType: 'change', actor, seq: 1, time: req.time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'makeList', key: 'birds', child: birds},
          {obj: birds, action: 'set', key: 0, insert: true, value: 'chaffinch'}
        ]
      })
    })

    it('should apply updates inside lists', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch'])
      const [doc2, req2] = Frontend.change(doc1, doc => doc.birds[0] = 'greenfinch')
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch']})
      assert.deepStrictEqual(doc2, {birds: ['greenfinch']})
      assert.deepStrictEqual(req2, {
        requestType: 'change', actor, seq: 2, time: req2.time, message: '', version: 0, ops: [
          {obj: birds, action: 'set', key: 0, value: 'greenfinch'}
        ]
      })
    })

    it('should delete list elements', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = ['chaffinch', 'goldfinch'])
      const [doc2, req2] = Frontend.change(doc1, doc => doc.birds.deleteAt(0))
      const birds = Frontend.getObjectId(doc2.birds), actor = Frontend.getActorId(doc2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch', 'goldfinch']})
      assert.deepStrictEqual(doc2, {birds: ['goldfinch']})
      assert.deepStrictEqual(req2, {
        requestType: 'change', actor, seq: 2, time: req2.time, message: '', version: 0, ops: [
          {obj: birds, action: 'del', key: 0}
        ]
      })
    })

    it('should store Date objects as timestamps', () => {
      const now = new Date()
      const [doc, req] = Frontend.change(Frontend.init(), doc => doc.now = now)
      const actor = Frontend.getActorId(doc)
      assert.strictEqual(doc.now instanceof Date, true)
      assert.strictEqual(doc.now.getTime(), now.getTime())
      assert.deepStrictEqual(req, {
        requestType: 'change', actor, seq: 1, time: req.time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'now', value: now.getTime(), datatype: 'timestamp'}
        ]
      })
    })

    describe('counters', () => {
      it('should handle counters inside maps', () => {
        const [doc1, req1] = Frontend.change(Frontend.init(), doc => {
          doc.wrens = new Frontend.Counter()
          assert.strictEqual(doc.wrens.value, 0)
        })
        const [doc2, req2] = Frontend.change(doc1, doc => {
          doc.wrens.increment()
          assert.strictEqual(doc.wrens.value, 1)
        })
        const actor = Frontend.getActorId(doc2)
        assert.deepStrictEqual(doc1, {wrens: new Frontend.Counter(0)})
        assert.deepStrictEqual(doc2, {wrens: new Frontend.Counter(1)})
        assert.deepStrictEqual(req1, {
          requestType: 'change', actor, seq: 1, time: req1.time, message: '', version: 0, ops: [
            {obj: ROOT_ID, action: 'set', key: 'wrens', value: 0, datatype: 'counter'}
          ]
        })
        assert.deepStrictEqual(req2, {
          requestType: 'change', actor, seq: 2, time: req2.time, message: '', version: 0, ops: [
            {obj: ROOT_ID, action: 'inc', key: 'wrens', value: 1}
          ]
        })
      })

      it('should handle counters inside lists', () => {
        const [doc1, req1] = Frontend.change(Frontend.init(), doc => {
          doc.counts = [new Frontend.Counter(1)]
          assert.strictEqual(doc.counts[0].value, 1)
        })
        const [doc2, req2] = Frontend.change(doc1, doc => {
          doc.counts[0].increment(2)
          assert.strictEqual(doc.counts[0].value, 3)
        })
        const counts = Frontend.getObjectId(doc2.counts), actor = Frontend.getActorId(doc2)
        assert.deepStrictEqual(doc1, {counts: [new Frontend.Counter(1)]})
        assert.deepStrictEqual(doc2, {counts: [new Frontend.Counter(3)]})
        assert.deepStrictEqual(req1, {
          requestType: 'change', actor, seq: 1, time: req1.time, message: '', version: 0, ops: [
            {obj: ROOT_ID, action: 'makeList', key: 'counts', child: counts},
            {obj: counts, action: 'set', key: 0, insert: true, value: 1, datatype: 'counter'}
          ]
        })
        assert.deepStrictEqual(req2, {
          requestType: 'change', actor, seq: 2, time: req2.time, message: '', version: 0, ops: [
            {obj: counts, action: 'inc', key: 0, value: 2}
          ]
        })
      })

      it('should refuse to overwrite a property with a counter value', () => {
        const [doc1, req1] = Frontend.change(Frontend.init(), doc => {
          doc.counter = new Frontend.Counter()
          doc.list = [new Frontend.Counter()]
        })
        assert.throws(() => Frontend.change(doc1, doc => doc.counter++), /Cannot overwrite a Counter object/)
        assert.throws(() => Frontend.change(doc1, doc => doc.list[0] = 3), /Cannot overwrite a Counter object/)
      })

      it('should make counter objects behave like primitive numbers', () => {
        const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = new Frontend.Counter(3))
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
        const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = new Frontend.Counter())
        assert.strictEqual(JSON.stringify(doc1), '{"birds":0}')
      })
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

    it('should use version and sequence number from the backend', () => {
      const local = uuid(), remote1 = uuid(), remote2 = uuid()
      const patch1 = {
        version: 3, canUndo: false, canRedo: false,
        clock: {[local]: 4, [remote1]: 11, [remote2]: 41},
        diffs: {objectId: ROOT_ID, type: 'map', props: {blackbirds: {[local]: {value: 24}}}}
      }
      let doc1 = Frontend.applyPatch(Frontend.init(local), patch1)
      let [doc2, req] = Frontend.change(doc1, doc => doc.partridges = 1)
      let requests = getRequests(doc2)
      assert.deepStrictEqual(requests, [
        {requestType: 'change', actor: local, seq: 5, time: requests[0].time, message: '', version: 3, ops: [
          {obj: ROOT_ID, action: 'set', key: 'partridges', value: 1}
        ]}
      ])
    })

    it('should remove pending requests once handled', () => {
      const actor = uuid()
      let [doc1, change1] = Frontend.change(Frontend.init(actor), doc => doc.blackbirds = 24)
      let [doc2, change2] = Frontend.change(doc1, doc => doc.partridges = 1)
      let requests = getRequests(doc2)
      assert.deepStrictEqual(requests, [
        {requestType: 'change', actor, seq: 1, time: requests[0].time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'blackbirds', value: 24}
        ]},
        {requestType: 'change', actor, seq: 2, time: requests[1].time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'partridges', value: 1}
        ]}
      ])

      doc2 = Frontend.applyPatch(doc2, {
        actor, seq: 1, version: 1, clock: {[actor]: 1}, canUndo: true, canRedo: false, diffs: {
          objectId: ROOT_ID, type: 'map', props: {blackbirds: {[actor]: {value: 24}}}
        }
      })
      requests = getRequests(doc2)
      assert.deepStrictEqual(doc2, {blackbirds: 24, partridges: 1})
      assert.deepStrictEqual(requests, [
        {requestType: 'change', actor, seq: 2, time: requests[0].time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'partridges', value: 1}
        ]}
      ])

      doc2 = Frontend.applyPatch(doc2, {
        actor, seq: 2, version: 2, clock: {[actor]: 2}, canUndo: true, canRedo: false, diffs: {
          objectId: ROOT_ID, type: 'map', props: {partridges: {[actor]: {value: 1}}}
        }
      })
      assert.deepStrictEqual(doc2, {blackbirds: 24, partridges: 1})
      assert.deepStrictEqual(getRequests(doc2), [])
    })

    it('should leave the request queue unchanged on remote patches', () => {
      const actor = uuid(), other = uuid()
      let [doc, req] = Frontend.change(Frontend.init(actor), doc => doc.blackbirds = 24)
      let requests = getRequests(doc)
      assert.deepStrictEqual(requests, [
        {requestType: 'change', actor, seq: 1, time: requests[0].time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'blackbirds', value: 24}
        ]}
      ])

      doc = Frontend.applyPatch(doc, {
        version: 1, clock: {[other]: 1}, canUndo: false, canRedo: false, diffs: {
          objectId: ROOT_ID, type: 'map', props: {pheasants: {[other]: {value: 2}}}
        }
      })
      requests = getRequests(doc)
      assert.deepStrictEqual(doc, {blackbirds: 24})
      assert.deepStrictEqual(requests, [
        {requestType: 'change', actor, seq: 1, time: requests[0].time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'blackbirds', value: 24}
        ]}
      ])

      doc = Frontend.applyPatch(doc, {
        actor, seq: 1, version: 2, clock: {[actor]: 1, [other]: 1}, canUndo: true, canRedo: false, diffs: {
          objectId: ROOT_ID, type: 'map', props: {blackbirds: {[actor]: {value: 24}}}
        }
      })
      assert.deepStrictEqual(doc, {blackbirds: 24, pheasants: 2})
      assert.deepStrictEqual(getRequests(doc), [])
    })

    it('should not allow request patches to be applied out of order', () => {
      const [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.blackbirds = 24)
      const [doc2, req2] = Frontend.change(doc1, doc => doc.partridges = 1)
      const actor = Frontend.getActorId(doc2)
      const diffs = {objectId: ROOT_ID, type: 'map', props: {partridges: {[actor]: {value: 1}}}}
      assert.throws(() => {
        Frontend.applyPatch(doc2, {actor, seq: 2, clock: {[actor]: 2}, diffs})
      }, /Mismatched sequence number/)
    })

    it('should handle concurrent insertions into lists', () => {
      let [doc1, req1] = Frontend.change(Frontend.init(), doc => doc.birds = ['goldfinch'])
      const birds = Frontend.getObjectId(doc1.birds), actor = Frontend.getActorId(doc1)
      doc1 = Frontend.applyPatch(doc1, {
        actor, seq: 1, version: 1, clock: {[actor]: 1}, canUndo: true, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          birds: {[actor]: {objectId: birds, type: 'list',
            edits: [{action: 'insert', index: 0}],
            props: {0: {[actor]: {value: 'goldfinch'}}}
          }}
        }}
      })
      assert.deepStrictEqual(doc1, {birds: ['goldfinch']})
      assert.deepStrictEqual(getRequests(doc1), [])

      const [doc2, req2] = Frontend.change(doc1, doc => {
        doc.birds.insertAt(0, 'chaffinch')
        doc.birds.insertAt(2, 'greenfinch')
      })
      assert.deepStrictEqual(doc2, {birds: ['chaffinch', 'goldfinch', 'greenfinch']})

      const remoteActor = uuid()
      const doc3 = Frontend.applyPatch(doc2, {
        version: 2, clock: {[actor]: 1, [remoteActor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          birds: {[actor]: {objectId: birds, type: 'list',
            edits: [{action: 'insert', index: 1}],
            props: {1: {[remoteActor]: {value: 'bullfinch'}}}
          }}
        }}
      })
      // The addition of 'bullfinch' does not take effect yet: it is queued up until the pending
      // request has made its round-trip through the backend.
      assert.deepStrictEqual(doc3, {birds: ['chaffinch', 'goldfinch', 'greenfinch']})

      const doc4 = Frontend.applyPatch(doc3, {
        actor, seq: 2, version: 3, clock: {[actor]: 2, [remoteActor]: 1}, canUndo: true, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          birds: {[actor]: {objectId: birds, type: 'list',
            edits: [{action: 'insert', index: 0}, {action: 'insert', index: 2}],
            props: {0: {[actor]: {value: 'chaffinch'}}, 2: {[actor]: {value: 'greenfinch'}}}
          }}
        }}
      })
      assert.deepStrictEqual(doc4, {birds: ['chaffinch', 'goldfinch', 'greenfinch', 'bullfinch']})
      assert.deepStrictEqual(getRequests(doc4), [])
    })

    it('should allow interleaving of patches and changes', () => {
      const actor = uuid()
      const [doc1, req1] = Frontend.change(Frontend.init(actor), doc => doc.number = 1)
      const [doc2, req2] = Frontend.change(doc1, doc => doc.number = 2)
      assert.deepStrictEqual(req1, {
        requestType: 'change', actor, seq: 1, time: req1.time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'number', value: 1}
        ]
      })
      assert.deepStrictEqual(req2, {
        requestType: 'change', actor, seq: 2, time: req2.time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'set', key: 'number', value: 2}
        ]
      })
      const state0 = Backend.init()
      const [state1, patch1] = Backend.applyLocalChange(state0, req1)
      const doc2a = Frontend.applyPatch(doc2, patch1)
      const [doc3, req3] = Frontend.change(doc2a, doc => doc.number = 3)
      assert.deepStrictEqual(req3, {
        requestType: 'change', actor, seq: 3, time: req3.time, message: '', version: 1, ops: [
          {obj: ROOT_ID, action: 'set', key: 'number', value: 3}
        ]
      })
    })
  })

  describe('applying patches', () => {
    it('should set root object properties', () => {
      const actor = uuid()
      const patch = {
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {bird: {[actor]: {value: 'magpie'}}}}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch)
      assert.deepStrictEqual(doc, {bird: 'magpie'})
    })

    it('should reveal conflicts on root object properties', () => {
      const patch = {
        version: 1, clock: {actor1: 1, actor2: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          favoriteBird: {actor1: {value: 'robin'}, actor2: {value: 'wagtail'}}
        }}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch)
      assert.deepStrictEqual(doc, {favoriteBird: 'wagtail'})
      assert.deepStrictEqual(Frontend.getConflicts(doc, 'favoriteBird'), {actor1: 'robin', actor2: 'wagtail'})
    })

    it('should create nested maps', () => {
      const birds = uuid(), actor = uuid()
      const patch = {
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {wrens: {[actor]: {value: 3}}}
        }}}}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch)
      assert.deepStrictEqual(doc, {birds: {wrens: 3}})
    })

    it('should apply updates inside nested maps', () => {
      const birds = uuid(), actor = uuid()
      const patch1 = {
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {wrens: {[actor]: {value: 3}}}
        }}}}
      }
      const patch2 = {
        version: 2, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'map', props: {sparrows: {[actor]: {value: 15}}}
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
        version: 1, clock: {[birds1]: 1, [birds2]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {favoriteBirds: {
          actor1: {objectId: birds1, type: 'map', props: {blackbirds: {actor1: {value: 1}}}},
          actor2: {objectId: birds2, type: 'map', props: {wrens:      {actor2: {value: 3}}}}
        }}}
      }
      const patch2 = {
        version: 2, clock: {[birds1]: 2, [birds2]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {favoriteBirds: {
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
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          birds:   {[actor]: {objectId: birds,     type: 'map', props: {wrens:   {[actor]: {value: 3}}}}},
          mammals: {[actor]: {objectId: mammals,   type: 'map', props: {badgers: {[actor]: {value: 1}}}}}
        }}
      }
      const patch2 = {
        version: 2, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
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
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          magpies: {[actor]: {value: 2}}, sparrows: {[actor]: {value: 15}}
        }}
      }
      const patch2 = {
        version: 2, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
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
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list',
          edits: [{action: 'insert', index: 0}],
          props: {0: {[actor]: {value: 'chaffinch'}}}
        }}}}
      }
      const doc = Frontend.applyPatch(Frontend.init(), patch)
      assert.deepStrictEqual(doc, {birds: ['chaffinch']})
    })

    it('should apply updates inside lists', () => {
      const birds = uuid(), actor = uuid()
      const patch1 = {
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list',
          edits: [{action: 'insert', index: 0}],
          props: {0: {[actor]: {value: 'chaffinch'}}}
        }}}}
      }
      const patch2 = {
        version: 2, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', edits: [],
          props: {0: {[actor]: {value: 'greenfinch'}}}
        }}}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch']})
      assert.deepStrictEqual(doc2, {birds: ['greenfinch']})
    })

    it('should apply updates inside list element conflicts', () => {
      const birds = uuid(), item1 = uuid(), item2 = uuid(), actor = uuid()
      const patch1 = {
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list',
          edits: [{action: 'insert', index: 0}],
          props: {0: {
            actor1: {objectId: item1, type: 'map', props: {species: {actor1: {value: 'woodpecker'}}, numSeen: {actor1: {value: 1}}}},
            actor2: {objectId: item2, type: 'map', props: {species: {actor2: {value: 'lapwing'   }}, numSeen: {actor2: {value: 2}}}}
          }}
        }}}}
      }
      const patch2 = {
        version: 2, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', edits: [],
          props: {0: {
            actor1: {objectId: item1, type: 'map', props: {numSeen: {actor1: {value: 2}}}},
            actor2: {objectId: item2, type: 'map'}
          }}
        }}}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {birds: [{species: 'lapwing', numSeen: 2}]})
      assert.deepStrictEqual(doc2, {birds: [{species: 'lapwing', numSeen: 2}]})
      assert.strictEqual(doc1.birds[0], doc2.birds[0])
      assert.deepStrictEqual(Frontend.getConflicts(doc1.birds, 0), {
        actor1: {species: 'woodpecker', numSeen: 1},
        actor2: {species: 'lapwing',    numSeen: 2}
      })
      assert.deepStrictEqual(Frontend.getConflicts(doc2.birds, 0), {
        actor1: {species: 'woodpecker', numSeen: 2},
        actor2: {species: 'lapwing',    numSeen: 2}
      })
    })

    it('should delete list elements', () => {
      const birds = uuid(), actor = uuid()
      const patch1 = {
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list',
          edits: [{action: 'insert', index: 0}, {action: 'insert', index: 1}],
          props: {
            0: {[actor]: {value: 'chaffinch'}},
            1: {[actor]: {value: 'goldfinch'}}
          }
        }}}}
      }
      const patch2 = {
        version: 2, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {birds: {[actor]: {
          objectId: birds, type: 'list', props: {},
          edits: [{action: 'remove', index: 0}]
        }}}}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {birds: ['chaffinch', 'goldfinch']})
      assert.deepStrictEqual(doc2, {birds: ['goldfinch']})
    })

    it('should apply updates at different levels of the object tree', () => {
      const counts = uuid(), details = uuid(), detail1 = uuid(), actor = uuid()
      const patch1 = {
        version: 1, clock: {[actor]: 1}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          counts: {[actor]: {objectId: counts, type: 'map', props: {
            magpies: {[actor]: {value: 2}}
          }}},
          details: {[actor]: {objectId: details, type: 'list',
            edits: [{action: 'insert', index: 0}],
            props: {0: {[actor]: {objectId: detail1, type: 'map', props: {
              species: {[actor]: {value: 'magpie'}},
              family:  {[actor]: {value: 'corvidae'}}
            }}}}
          }}
        }}
      }
      const patch2 = {
        version: 2, clock: {[actor]: 2}, canUndo: false, canRedo: false,
        diffs: {objectId: ROOT_ID, type: 'map', props: {
          counts: {[actor]: {objectId: counts, type: 'map', props: {
            magpies: {[actor]: {value: 3}}
          }}},
          details: {[actor]: {objectId: details, type: 'list', edits: [],
            props: {0: {[actor]: {objectId: detail1, type: 'map', props: {
              species: {[actor]: {value: 'Eurasian magpie'}}
            }}}}
          }}
        }}
      }
      const doc1 = Frontend.applyPatch(Frontend.init(), patch1)
      const doc2 = Frontend.applyPatch(doc1, patch2)
      assert.deepStrictEqual(doc1, {counts: {magpies: 2}, details: [{species: 'magpie', family: 'corvidae'}]})
      assert.deepStrictEqual(doc2, {counts: {magpies: 3}, details: [{species: 'Eurasian magpie', family: 'corvidae'}]})
    })
  })

  describe('undo and redo', () => {
    it('should allow undo in the frontend', () => {
      const doc0 = Frontend.init(), b0 = Backend.init(), actor = Frontend.getActorId(doc0)
      assert.strictEqual(Frontend.canUndo(doc0), false)
      const [doc1, req1] = Frontend.change(doc0, doc => doc.number = 1)
      const [b1, patch1] = Backend.applyLocalChange(b0, req1)
      const doc1a = Frontend.applyPatch(doc1, patch1)
      assert.strictEqual(Frontend.canUndo(doc1a), true)
      const [doc2, req2] = Frontend.undo(doc1a)
      assert.deepStrictEqual(req2, {actor, requestType: 'undo', seq: 2, time: req2.time, message: '', version: 1})
      const [b2, patch2] = Backend.applyLocalChange(b1, req2)
      const doc2a = Frontend.applyPatch(doc2, patch2)
      assert.deepStrictEqual(doc2a, {})
    })

    function apply(backend, change) {
      const [doc, req] = change
      const [newBackend, patch] = Backend.applyLocalChange(backend, req)
      return [newBackend, Frontend.applyPatch(doc, patch)]
    }

    it('should perform multiple undos and redos', () => {
      const doc0 = Frontend.init(), b0 = Backend.init()
      const [b1, doc1] = apply(b0, Frontend.change(doc0, doc => doc.number = 1))
      const [b2, doc2] = apply(b1, Frontend.change(doc1, doc => doc.number = 2))
      const [b3, doc3] = apply(b2, Frontend.change(doc2, doc => doc.number = 3))
      const [b4, doc4] = apply(b3, Frontend.undo(doc3))
      const [b5, doc5] = apply(b4, Frontend.undo(doc4))
      const [b6, doc6] = apply(b5, Frontend.redo(doc5))
      const [b7, doc7] = apply(b6, Frontend.redo(doc6))
      assert.deepStrictEqual(doc1, {number: 1})
      assert.deepStrictEqual(doc2, {number: 2})
      assert.deepStrictEqual(doc3, {number: 3})
      assert.deepStrictEqual(doc4, {number: 2})
      assert.deepStrictEqual(doc5, {number: 1})
      assert.deepStrictEqual(doc6, {number: 2})
      assert.deepStrictEqual(doc7, {number: 3})
    })
  })
})
