import * as assert from 'assert'
import * as Automerge from 'automerge'
import { Backend, Frontend, Counter, Doc } from 'automerge'

const UUID_PATTERN = /^[0-9a-f]{32}$/
const ROOT_ID = '00000000-0000-0000-0000-000000000000'

interface BirdList {
  birds: Automerge.List<string>
}

interface NumberBox {
  number: number
}

describe('TypeScript support', () => {
  describe('Automerge.init()', () => {
    it('should allow a document to be `any`', () => {
      let s1 = Automerge.init<any>()
      s1 = Automerge.change(s1, doc => (doc.key = 'value'))
      assert.strictEqual(s1.key, 'value')
      assert.strictEqual(s1.nonexistent, undefined)
      assert.deepStrictEqual(s1, { key: 'value' })
    })

    it('should allow a document type to be specified as a parameter to `init`', () => {
      let s1 = Automerge.init<BirdList>()

      // Note: Technically, `s1` is not really a `BirdList` yet but just an empty object.
      assert.equal(s1.hasOwnProperty('birds'), false)

      // Since we're pulling the wool over TypeScript's eyes, it can't give us compile-time protection
      // from something like this:
      // assert.equal(s1.birds.length, 0) // Runtime error: Cannot read property 'length' of undefined

      // Nevertheless this way seems more ergonomical (than having `init` return a type of `{}` or
      // `Partial<T>`, for example) because it allows us to have a single type for the object
      // throughout its life, rather than having to recast it once its required fields have
      // been populated.
      s1 = Automerge.change(s1, doc => (doc.birds = ['goldfinch']))
      assert.deepStrictEqual(s1.birds, ['goldfinch'])
    })

    it('should allow a document type to be specified on the result of `init`', () => {
      // This is equivalent to passing the type parameter to `init`; note that the result is a
      // `Doc`, which is frozen
      let s1: Doc<BirdList> = Automerge.init()
      let s2 = Automerge.change(s1, doc => (doc.birds = ['goldfinch']))
      assert.deepStrictEqual(s2.birds, ['goldfinch'])
    })

    it('should allow a document to be initialized with `from`', () => {
      const s1 = Automerge.from<BirdList>({ birds: [] })
      assert.strictEqual(s1.birds.length, 0)
      const s2 = Automerge.change(s1, doc => doc.birds.push('magpie'))
      assert.strictEqual(s2.birds[0], 'magpie')
    })

    it('should allow passing options when initializing with `from`', () => {
      const actorId = '1234'
      const s1 = Automerge.from<BirdList>({ birds: [] }, actorId)
      assert.strictEqual(Automerge.getActorId(s1), '1234')
      const s2 = Automerge.from<BirdList>({ birds: [] }, { actorId })
      assert.strictEqual(Automerge.getActorId(s2), '1234')
    })

    it('should allow the actorId to be configured', () => {
      let s1 = Automerge.init<BirdList>('111111')
      assert.strictEqual(Automerge.getActorId(s1), '111111')
      let s2 = Automerge.init<BirdList>()
      assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(s2)), true)
    })

    it('should allow the freeze option to be passed in', () => {
      let s1 = Automerge.init<BirdList>({ freeze: true })
      let s2 = Automerge.change(s1, doc => (doc.birds = []))
      assert.strictEqual(Object.isFrozen(s2), true)
      assert.strictEqual(Object.isFrozen(s2.birds), true)
    })

    it('should allow a frontend to be `any`', () => {
      const s0 = Frontend.init<any>()
      const [s1, req1] = Frontend.change(s0, doc => (doc.key = 'value'))
      assert.strictEqual(s1.key, 'value')
      assert.strictEqual(s1.nonexistent, undefined)
      assert.strictEqual(UUID_PATTERN.test(Frontend.getActorId(s1)), true)
    })

    it('should allow a frontend type to be specified', () => {
      const s0 = Frontend.init<BirdList>()
      const [s1, req1] = Frontend.change(s0, doc => (doc.birds = ['goldfinch']))
      assert.strictEqual(s1.birds[0], 'goldfinch')
      assert.deepStrictEqual(s1, { birds: ['goldfinch'] })
    })

    it('should allow a frontend actorId to be configured', () => {
      const s0 = Frontend.init<NumberBox>('111111')
      assert.strictEqual(Frontend.getActorId(s0), '111111')
    })

    it('should allow frontend actorId assignment to be deferred', () => {
      const s0 = Frontend.init<NumberBox>({ deferActorId: true })
      assert.strictEqual(Frontend.getActorId(s0), undefined)
      const s1 = Frontend.setActorId(s0, 'abcdef1234')
      const [s2, req] = Frontend.change(s1, doc => (doc.number = 15))
      assert.deepStrictEqual(s2, { number: 15 })
    })

    it('should allow a frontend to be initialized with `from`', () => {
      const [s1, req1] = Frontend.from<BirdList>({ birds: [] })
      assert.strictEqual(s1.birds.length, 0)
      const [s2, req2] = Frontend.change(s1, doc => doc.birds.push('magpie'))
      assert.strictEqual(s2.birds[0], 'magpie')
    })

    it('should allow options to be passed to Frontend.from()', () => {
      const [s1, req1] = Frontend.from<BirdList>({ birds: []}, { actorId: '1234' })
      assert.strictEqual(Frontend.getActorId(s1), '1234')
      assert.deepStrictEqual(s1, { birds: [] })
      const [s2, req2] = Frontend.from<BirdList>({ birds: []}, '1234')
      assert.strictEqual(Frontend.getActorId(s2), '1234')
    })
  })

  describe('saving and loading', () => {
    it('should allow an `any` type document to be loaded', () => {
      let s1 = Automerge.init<any>()
      s1 = Automerge.change(s1, doc => (doc.key = 'value'))
      let s2: any = Automerge.load(Automerge.save(s1))
      assert.strictEqual(s2.key, 'value')
      assert.deepStrictEqual(s2, { key: 'value' })
    })

    it('should allow a document of declared type to be loaded', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => (doc.birds = ['goldfinch']))
      let s2 = Automerge.load<BirdList>(Automerge.save(s1))
      assert.strictEqual(s2.birds[0], 'goldfinch')
      assert.deepStrictEqual(s2, { birds: ['goldfinch'] })
      assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(s2)), true)
    })

    it('should allow the actorId to be configured', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => (doc.birds = ['goldfinch']))
      let s2 = Automerge.load<BirdList>(Automerge.save(s1), '111111')
      assert.strictEqual(Automerge.getActorId(s2), '111111')
    })

    it('should allow the freeze option to be passed in', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => (doc.birds = ['goldfinch']))
      let s2 = Automerge.load<BirdList>(Automerge.save(s1), { freeze: true })
      assert.strictEqual(Object.isFrozen(s2), true)
      assert.strictEqual(Object.isFrozen(s2.birds), true)
    })
  })

  describe('making changes', () => {
    it('should accept an optional message', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, 'hello', doc => (doc.birds = []))
      assert.strictEqual(Automerge.getHistory(s1)[0].change.message, 'hello')
    })

    it('should support list modifications', () => {
      let s1: Doc<BirdList> = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => (doc.birds = ['goldfinch']))
      s1 = Automerge.change(s1, doc => {
        doc.birds.insertAt(1, 'greenfinch', 'bullfinch', 'chaffinch')
        doc.birds.deleteAt(0)
        doc.birds.deleteAt(0, 2)
      })
      assert.deepStrictEqual(s1, { birds: ['chaffinch'] })
    })

    it('should allow empty changes', () => {
      let s1 = Automerge.init()
      s1 = Automerge.emptyChange(s1, 'my message')
      assert.strictEqual(Automerge.getHistory(s1)[0].change.message, 'my message')
    })

    it('should allow inspection of conflicts', () => {
      let s1 = Automerge.init<NumberBox>('111111')
      s1 = Automerge.change(s1, doc => (doc.number = 3))
      let s2 = Automerge.init<NumberBox>('222222')
      s2 = Automerge.change(s2, doc => (doc.number = 42))
      let s3 = Automerge.merge(s1, s2)
      assert.strictEqual(s3.number, 42)
      assert.deepStrictEqual(
        Automerge.getConflicts(s3, 'number'),
        { '1@111111': 3, '1@222222': 42 })
    })

    it('should allow changes in the frontend', () => {
      const s0 = Frontend.init<BirdList>()
      const [s1, req1] = Frontend.change(s0, doc => (doc.birds = ['goldfinch']))
      const [s2, req2] = Frontend.change(s1, doc => doc.birds.push('chaffinch'))
      assert.strictEqual(s2.birds[1], 'chaffinch')
      assert.deepStrictEqual(s2, { birds: ['goldfinch', 'chaffinch'] })
      assert.strictEqual(req2.actor, Frontend.getActorId(s0))
      assert.strictEqual(req2.seq, 2)
      assert.strictEqual(req2.time > 0, true)
      assert.strictEqual(req2.message, '')
    })

    it('should accept a message in the frontend', () => {
      const s0 = Frontend.init<NumberBox>()
      const [s1, req1] = Frontend.change(s0, 'test message', doc => (doc.number = 1))
      assert.strictEqual(req1.message, 'test message')
      assert.strictEqual(req1.actor, Frontend.getActorId(s0))
      assert.strictEqual(req1.ops.length, 1)
    })

    it('should allow empty changes in the frontend', () => {
      const s0 = Frontend.init<NumberBox>()
      const [s1, req1] = Frontend.emptyChange(s0, 'nothing happened')
      assert.strictEqual(req1.message, 'nothing happened')
      assert.strictEqual(req1.actor, Frontend.getActorId(s0))
      assert.strictEqual(req1.ops.length, 0)
    })

    it('should work with split frontend and backend', () => {
      const s0 = Frontend.init<NumberBox>(),
        b0 = Backend.init()
      const [s1, req1] = Frontend.change(s0, doc => (doc.number = 1))
      const [b1, patch1] = Backend.applyLocalChange(b0, req1)
      const s2 = Frontend.applyPatch(s1, patch1)
      assert.strictEqual(s2.number, 1)
      assert.strictEqual(patch1.actor, Automerge.getActorId(s0))
      assert.strictEqual(patch1.seq, 1)
      assert.strictEqual(patch1.version, 1)
      assert.strictEqual(patch1.canUndo, true)
      assert.strictEqual(patch1.canRedo, false)
      assert.strictEqual(patch1.diffs.objectId, ROOT_ID)
      assert.strictEqual(patch1.diffs.type, 'map')
      assert.deepStrictEqual(Object.keys(patch1.diffs.props), ['number'])
      const value = patch1.diffs.props.number[`1@${Automerge.getActorId(s0)}`]
      assert.strictEqual((value as Automerge.ValueDiff).value, 1)
    })
  })

  describe('getting and applying changes', () => {
    it('should return an array of change objects', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => (doc.birds = ['goldfinch']))
      let s2 = Automerge.change(s1, 'add chaffinch', doc => doc.birds.push('chaffinch'))
      const changes = Automerge.getChanges(s1, s2)
      assert.strictEqual(changes.length, 1)
      const change = Automerge.decodeChange(changes[0])[0]
      assert.strictEqual(change.message, 'add chaffinch')
      assert.strictEqual(change.actor, Automerge.getActorId(s2))
      assert.strictEqual(change.seq, 2)
    })

    it('should include operations in changes', () => {
      let s1 = Automerge.init<NumberBox>()
      s1 = Automerge.change(s1, doc => (doc.number = 3))
      const changes = Automerge.getAllChanges(s1)
      assert.strictEqual(changes.length, 1)
      const change = Automerge.decodeChange(changes[0])[0]
      assert.strictEqual(change.ops.length, 1)
      assert.strictEqual(change.ops[0].action, 'set')
      assert.strictEqual(change.ops[0].obj, ROOT_ID)
      assert.strictEqual(change.ops[0].key, 'number')
      assert.strictEqual(change.ops[0].value, 3)
    })

    it('should allow changes to be re-applied', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => (doc.birds = []))
      let s2 = Automerge.change(s1, doc => doc.birds.push('goldfinch'))
      const changes = Automerge.getAllChanges(s2)
      let s3 = Automerge.applyChanges(Automerge.init<BirdList>(), changes)
      assert.deepStrictEqual(s3.birds, ['goldfinch'])
    })

    it('should allow concurrent changes to be merged', () => {
      let s1 = Automerge.init<BirdList>()
      s1 = Automerge.change(s1, doc => (doc.birds = ['goldfinch']))
      let s2 = Automerge.merge(Automerge.init<BirdList>(), s1)
      s1 = Automerge.change(s1, doc => doc.birds.unshift('greenfinch'))
      s2 = Automerge.change(s2, doc => doc.birds.push('chaffinch'))
      let s3 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s3.birds, ['greenfinch', 'goldfinch', 'chaffinch'])
    })
  })

  describe('undo and redo', () => {
    it('should undo field assignment', () => {
      let s1 = Automerge.change(Automerge.init<NumberBox>(), doc => (doc.number = 3))
      s1 = Automerge.change(s1, doc => (doc.number = 4))
      assert.strictEqual(s1.number, 4)
      assert.strictEqual(Automerge.canUndo(s1), true)
      s1 = Automerge.undo(s1)
      assert.strictEqual(s1.number, 3)
      assert.strictEqual(Automerge.canUndo(s1), true)
      s1 = Automerge.undo(s1)
      assert.strictEqual(s1.number, undefined)
      assert.strictEqual(Automerge.canUndo(s1), false)
    })

    it('should redo previous undos', () => {
      let s1 = Automerge.change(Automerge.init<NumberBox>(), doc => (doc.number = 3))
      s1 = Automerge.change(s1, doc => (doc.number = 4))
      assert.strictEqual(Automerge.canRedo(s1), false)
      s1 = Automerge.undo(s1)
      assert.strictEqual(s1.number, 3)
      assert.strictEqual(Automerge.canRedo(s1), true)
      s1 = Automerge.redo(s1)
      assert.strictEqual(s1.number, 4)
      assert.strictEqual(Automerge.canRedo(s1), false)
    })

    it('should allow an optional message on undos', () => {
      let s1 = Automerge.change(Automerge.init<NumberBox>(), doc => (doc.number = 3))
      s1 = Automerge.change(s1, doc => (doc.number = 4))
      s1 = Automerge.undo(s1, 'go back to 3')
      assert.strictEqual(Automerge.getHistory(s1).length, 3)
      assert.strictEqual(Automerge.getHistory(s1)[2].change.message, 'go back to 3')
      assert.deepStrictEqual(s1, { number: 3 })
    })

    it('should generate undo requests in the frontend', () => {
      const doc0 = Frontend.init<NumberBox>(),
        b0 = Backend.init()
      assert.strictEqual(Frontend.canUndo(doc0), false)
      const [doc1, req1] = Frontend.change(doc0, doc => (doc.number = 1))
      const [b1, patch1] = Backend.applyLocalChange(b0, req1)
      const doc1a = Frontend.applyPatch(doc1, patch1)
      assert.strictEqual(Frontend.canUndo(doc1a), true)
      const [doc2, req2] = Frontend.undo(doc1a)
      assert.strictEqual(req2.requestType, 'undo')
      assert.strictEqual(req2.actor, Frontend.getActorId(doc0))
      assert.strictEqual(req2.seq, 2)
      const [b2, patch2] = Backend.applyLocalChange(b1, req2)
      const doc2a = Frontend.applyPatch(doc2, patch2)
      assert.deepStrictEqual(doc2a, {})
    })
  })

  describe('history inspection', () => {
    it('should inspect document history', () => {
      const s0 = Automerge.init<NumberBox>()
      const s1 = Automerge.change(s0, 'one', doc => (doc.number = 1))
      const s2 = Automerge.change(s1, 'two', doc => (doc.number = 2))
      const history = Automerge.getHistory(s2)
      assert.strictEqual(history.length, 2)
      assert.strictEqual(history[0].change.message, 'one')
      assert.strictEqual(history[1].change.message, 'two')
      assert.strictEqual(history[0].snapshot.number, 1)
      assert.strictEqual(history[1].snapshot.number, 2)
    })
  })

  describe('state inspection', () => {
    it('should support looking up objects by ID', () => {
      const s0 = Automerge.init<BirdList>()
      const s1 = Automerge.change(s0, doc => (doc.birds = ['goldfinch']))
      const obj = Automerge.getObjectId(s1.birds)
      assert.strictEqual(Automerge.getObjectById(s1, obj).length, 1)
      assert.strictEqual(Automerge.getObjectById(s1, obj), s1.birds)
    })
  })

  describe('Automerge.Text', () => {
    interface TextDoc {
      text: Automerge.Text
    }

    let doc: Doc<TextDoc>

    beforeEach(() => {
      doc = Automerge.change(Automerge.init<TextDoc>(), doc => (doc.text = new Automerge.Text()))
    })

    describe('insertAt', () => {
      it('should support inserting a single element', () => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'abc'))
        assert.strictEqual(JSON.stringify(doc.text), '"abc"')
      })

      it('should support inserting multiple elements', () => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
        assert.strictEqual(JSON.stringify(doc.text), '"abc"')
      })
    })

    describe('deleteAt', () => {
      beforeEach(() => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'a', 'b', 'c', 'd', 'e', 'f', 'g'))
      })

      it('should support deleting a single element without specifying `numDelete`', () => {
        doc = Automerge.change(doc, doc => doc.text.deleteAt(2))
        assert.strictEqual(JSON.stringify(doc.text), '"abdefg"')
      })

      it('should support deleting multiple elements', () => {
        doc = Automerge.change(doc, doc => doc.text.deleteAt(3, 2))
        assert.strictEqual(JSON.stringify(doc.text), '"abcfg"')
      })
    })

    describe('get', () => {
      it('should get the element at the given index', () => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, 'a', 'b', 'cdefg', 'hi', 'jkl'))
        assert.strictEqual(doc.text.get(0), 'a')
        assert.strictEqual(doc.text.get(2), 'cdefg')
      })
    })

    describe('delegated read-only operations from `Array`', () => {
      const a = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
      beforeEach(() => {
        doc = Automerge.change(doc, doc => doc.text.insertAt(0, ...a))
      })

      it('supports `indexOf`', () => assert.strictEqual(doc.text.indexOf('c'), 2))
      it('supports `length`', () => assert.strictEqual(doc.text.length, 9))
      it('supports `concat`', () => assert.strictEqual(doc.text.concat(['j']).length, 10))
      it('supports `includes`', () => assert.strictEqual(doc.text.includes('q'), false))
    })
  })

  describe('Automerge.Table', () => {
    interface Book {
      authors: string | string[]
      title: string
      isbn?: string
    }

    interface BookDb {
      books: Automerge.Table<Book>
    }

    // Example data
    const DDIA: Book = {
      authors: ['Kleppmann, Martin'],
      title: 'Designing Data-Intensive Applications',
      isbn: '1449373321',
    }
    const RSDP: Book = {
      authors: ['Cachin, Christian', 'Guerraoui, Rachid', 'Rodrigues, Luís'],
      title: 'Introduction to Reliable and Secure Distributed Programming',
      isbn: '3-642-15259-7',
    }

    let s1: Doc<BookDb>
    let id: Automerge.UUID
    let ddiaWithId: Book & Automerge.TableRow

    beforeEach(() => {
      s1 = Automerge.change(Automerge.init<BookDb>(), doc => {
        doc.books = new Automerge.Table()
        id = doc.books.add(DDIA)
      })
      ddiaWithId = Object.assign({id}, DDIA)
    })

    it('supports `byId`', () => assert.deepStrictEqual(s1.books.byId(id), ddiaWithId))
    it('supports `count`', () => assert.strictEqual(s1.books.count, 1))
    it('supports `ids`', () => assert.deepStrictEqual(s1.books.ids, [id]))
    it('supports iteration', () => assert.deepStrictEqual([...s1.books], [ddiaWithId]))

    it('allows adding row properties', () => {
      // Note that if we add columns and want to actually use them, we need to recast the table to a
      // new type e.g. without the `ts-ignore` flag, this would throw a type error:

      // @ts-ignore - Property 'publisher' does not exist on type book
      const p2 = s1.books.byId(id).publisher 

      // So we need to create new types
      interface BookDeluxe extends Book {
        // ... existing properties, plus:
        publisher?: string
      }
      interface BookDeluxeDb {
        books: Automerge.Table<BookDeluxe>
      }

      const s2 = s1 as Doc<BookDeluxeDb> // Cast existing table to new type
      const s3 = Automerge.change(
        s2,
        doc => (doc.books.byId(id).publisher = "O'Reilly")
      )

      // Now we're off to the races
      const p3 = s3.books.byId(id).publisher
      assert.strictEqual(p3, "O'Reilly")
    })

    it('supports `remove`', () => {
      const s2 = Automerge.change(s1, doc => doc.books.remove(id))
      assert.strictEqual(s2.books.count, 0)
    })

    describe('supports `add`', () => {
      it('accepts value passed as object', () => {
        let bookId: string
        const s2 = Automerge.change(s1, doc => (bookId = doc.books.add(RSDP)))
        assert.deepStrictEqual(s2.books.byId(bookId), Object.assign({id: bookId}, RSDP))
        assert.strictEqual(s2.books.byId(bookId).id, bookId)
      })
    })

    describe('standard array operations on rows', () => {
      it('supports `filter`', () =>
        assert.deepStrictEqual(s1.books.filter(book => book.authors.length === 1), [ddiaWithId]))
      it('supports `find`', () =>
        assert.deepStrictEqual(s1.books.find(book => book.isbn === '1449373321'), ddiaWithId))
      it('supports `map`', () =>
        assert.deepStrictEqual(s1.books.map<string>(book => book.title), [DDIA.title]))
    })
  })

  describe('Automerge.Counter', () => {
    interface CounterMap {
      [name: string]: Counter
    }

    interface CounterList {
      counts: Counter[]
    }

    interface BirdCounterMap {
      birds: CounterMap
    }

    it('should handle counters inside maps', () => {
      const doc1 = Automerge.change(Automerge.init<CounterMap>(), doc => {
        doc.wrens = new Counter()
      })
      assert.equal(doc1.wrens, 0)

      const doc2 = Automerge.change(doc1, doc => {
        doc.wrens.increment()
      })
      assert.equal(doc2.wrens, 1)
    })

    it('should handle counters inside lists', () => {
      const doc1 = Automerge.change(Automerge.init<CounterList>(), doc => {
        doc.counts = [new Counter(1)]
      })
      assert.equal(doc1.counts[0], 1)

      const doc2 = Automerge.change(doc1, doc => {
        doc.counts[0].increment(2)
      })
      assert.equal(doc2.counts[0].value, 3)
    })

    it('should coalesce assignments and increments', () => {
      const doc1 = Automerge.change(Automerge.init<BirdCounterMap>(), doc => {
        doc.birds = {}
      })
      const doc2 = Automerge.change(doc1, doc => {
        doc.birds.wrens = new Counter(1)
        doc.birds.wrens.increment(2)
      })
      assert.deepStrictEqual(doc1, { birds: {} })
      assert.deepStrictEqual(doc2, { birds: { wrens: new Counter(3) } })
    })

    it('should coalesce multiple increments', () => {
      const doc1 = Automerge.change(Automerge.init<BirdCounterMap>(), doc => {
        doc.birds = { wrens: new Counter(0) }
      })
      const doc2 = Automerge.change(doc1, doc => {
        doc.birds.wrens.increment(2)
        doc.birds.wrens.decrement(1)
        doc.birds.wrens.increment(3)
      })
      assert.equal(doc1.birds.wrens, 0)
      assert.equal(doc2.birds.wrens, 4)
    })

    describe('counter as numeric primitive', () => {
      let doc1: CounterMap
      beforeEach(() => {
        doc1 = Automerge.change(Automerge.init<CounterMap>(), doc => {
          doc.birds = new Counter(3)
        })
      })

      it('is equal (==) but not strictly equal (===) to its numeric value', () => {
        assert.equal(doc1.birds, 3)
        assert.notStrictEqual(doc1.birds, 3)
      })

      it('has to be explicitly cast to be used as a number', () => {
        let birdCount: number

        // This is valid javascript, but without the `ts-ignore` flag, it fails to compile:
        // @ts-ignore
        birdCount = doc1.birds // Type 'Counter' is not assignable to type 'number'.ts(2322)

        // This is because TypeScript doesn't know about the `.valueOf()` trick.
        // https://github.com/Microsoft/TypeScript/issues/2361

        // If we want to treat a counter value as a number, we have to explicitly cast it to keep
        // TypeScript happy.

        // We can cast by putting a `+` in front of it:
        birdCount = +doc1.birds
        assert.equal(birdCount < 4, true)
        assert.equal(birdCount >= 0, true)

        // Or we can be explicit (have to cast as unknown, then number):
        birdCount = (doc1.birds as unknown) as number
        assert.equal(birdCount <= 2, false)
        assert.equal(birdCount + 10, 13)
      })

      it('is converted to a string using its numeric value', () => {
        assert.equal(doc1.birds.toString(), '3')
        assert.equal(`I saw ${doc1.birds} birds`, 'I saw 3 birds')
        assert.equal(['I saw', doc1.birds, 'birds'].join(' '), 'I saw 3 birds')
      })
    })
  })
})
