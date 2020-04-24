const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { assertEqualsOneOf } = require('./helpers')
const { decodeChange } = require('../backend/columnar')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'
const UUID_PATTERN = /^[0-9a-f]{32}$/
const OPID_PATTERN = /^[0-9]+@[0-9a-f]{32}$/

describe('Automerge', () => {

  describe('initialization ', () => {
    it('should initially be an empty map', () => {
      const doc = Automerge.init()
      assert.deepStrictEqual(doc, {})
    })

    it('should allow instantiating from an existing object', () => {
      const initialState = { birds: { wrens: 3, magpies: 4 } }
      const doc = Automerge.from(initialState)
      assert.deepStrictEqual(doc, initialState)
    })

    it('should allow merging of an object initialized with `from`', () => {
      let doc1 = Automerge.from({ cards: [] })
      let doc2 = Automerge.merge(Automerge.init(), doc1)
      assert.deepStrictEqual(doc2, { cards: [] })
    })

    it('should allow passing an actorId when instantiating from an existing object', () => {
      const actorId = '1234'
      let doc = Automerge.from({ foo: 1 }, actorId)
      assert.strictEqual(Automerge.getActorId(doc), '1234')
    })

    it('accepts an empty object as initial state', () => {
      const doc = Automerge.from({})
      assert.deepStrictEqual(doc, {})
    })

    it('accepts an array as initial state, but converts it to an object', () => {
      const doc = Automerge.from(['a', 'b', 'c'])
      assert.deepStrictEqual(doc, { '0': 'a', '1': 'b', '2': 'c' })
    })

    it('accepts strings as initial values, but treats them as an array of characters', () => {
      const doc = Automerge.from('abc')
      assert.deepStrictEqual(doc, { '0': 'a', '1': 'b', '2': 'c' })
    })

    it('ignores numbers provided as initial values', () => {
      const doc = Automerge.from(123)
      assert.deepStrictEqual(doc, {})
    })

    it('ignores booleans provided as initial values', () => {
      const doc1 = Automerge.from(false)
      assert.deepStrictEqual(doc1, {})
      const doc2 = Automerge.from(true)
      assert.deepStrictEqual(doc2, {})
    })

    it('should not enable undo after Automerge.from', () => {
      let doc = Automerge.from({cards: []})
      assert.deepStrictEqual(Automerge.canUndo(doc), false)
    })
  })

  describe('sequential use', () => {
    let s1, s2
    beforeEach(() => {
      s1 = Automerge.init()
    })

    it('should not mutate objects', () => {
      s2 = Automerge.change(s1, doc => doc.foo = 'bar')
      assert.strictEqual(s1.foo, undefined)
      assert.strictEqual(s2.foo, 'bar')
    })

    it('should not register any conflicts on repeated assignment', () => {
      assert.strictEqual(Automerge.getConflicts(s1, 'foo'), undefined)
      s1 = Automerge.change(s1, 'change', doc => doc.foo = 'one')
      assert.strictEqual(Automerge.getConflicts(s1, 'foo'), undefined)
      s1 = Automerge.change(s1, 'change', doc => doc.foo = 'two')
      assert.strictEqual(Automerge.getConflicts(s1, 'foo'), undefined)
    })

    describe('changes', () => {
      it('should group several changes', () => {
        s2 = Automerge.change(s1, 'change message', doc => {
          doc.first = 'one'
          assert.strictEqual(doc.first, 'one')
          doc.second = 'two'
          assert.deepStrictEqual(doc, {
            first: 'one', second: 'two'
          })
        })
        assert.deepStrictEqual(s1, {})
        assert.deepStrictEqual(s2, {first: 'one', second: 'two'})
      })

      it('should freeze objects if desired', () => {
        s1 = Automerge.init({freeze: true})
        s2 = Automerge.change(s1, doc => doc.foo = 'bar')
        try {
          s2.foo = 'lemon'
        } catch (e) {}
        assert.strictEqual(s2.foo, 'bar')

        let deleted = false
        try {
          deleted = delete s2['foo']
        } catch (e) {}
        assert.strictEqual(s2.foo, 'bar')
        assert.strictEqual(deleted, false)

        Automerge.change(s2, doc => {
          try {
            s2.foo = 'lemon'
          } catch (e) {}
          assert.strictEqual(s2.foo, 'bar')
        })

        assert.throws(() => { Object.assign(s2, {x: 4}) })
        assert.strictEqual(s2.x, undefined)
      })

      it('should allow repeated reading and writing of values', () => {
        s2 = Automerge.change(s1, 'change message', doc => {
          doc.value = 'a'
          assert.strictEqual(doc.value, 'a')
          doc.value = 'b'
          doc.value = 'c'
          assert.strictEqual(doc.value, 'c')
        })
        assert.deepStrictEqual(s1, {})
        assert.deepStrictEqual(s2, {value: 'c'})
      })

      it('should not record conflicts when writing the same field several times within one change', () => {
        s1 = Automerge.change(s1, 'change message', doc => {
          doc.value = 'a'
          doc.value = 'b'
          doc.value = 'c'
        })
        assert.strictEqual(s1.value, 'c')
        assert.strictEqual(Automerge.getConflicts(s1, 'value'), undefined)
      })

      it('should return the unchanged state object if nothing changed', () => {
        s2 = Automerge.change(s1, doc => {})
        assert.strictEqual(s2, s1)
      })

      it('should ignore field updates that write the existing value', () => {
        s1 = Automerge.change(s1, doc => doc.field = 123)
        s2 = Automerge.change(s1, doc => doc.field = 123)
        assert.strictEqual(s2, s1)
      })

      it('should not ignore field updates that resolve a conflict', () => {
        s2 = Automerge.merge(Automerge.init(), s1)
        s1 = Automerge.change(s1, doc => doc.field = 123)
        s2 = Automerge.change(s2, doc => doc.field = 321)
        s1 = Automerge.merge(s1, s2)
        assert.strictEqual(Object.keys(Automerge.getConflicts(s1, 'field')).length, 2)
        const resolved = Automerge.change(s1, doc => doc.field = s1.field)
        assert.notStrictEqual(resolved, s1)
        assert.deepStrictEqual(resolved, {field: s1.field})
        assert.strictEqual(Automerge.getConflicts(resolved, 'field'), undefined)
      })

      it('should ignore list element updates that write the existing value', () => {
        s1 = Automerge.change(s1, doc => doc.list = [123])
        s2 = Automerge.change(s1, doc => doc.list[0] = 123)
        assert.strictEqual(s2, s1)
      })

      it('should not ignore list element updates that resolve a conflict', () => {
        s1 = Automerge.change(s1, doc => doc.list = [1])
        s2 = Automerge.merge(Automerge.init(), s1)
        s1 = Automerge.change(s1, doc => doc.list[0] = 123)
        s2 = Automerge.change(s2, doc => doc.list[0] = 321)
        s1 = Automerge.merge(s1, s2)
        assert.deepStrictEqual(Automerge.getConflicts(s1.list, 0), {
          [`3@${Automerge.getActorId(s1)}`]: 123,
          [`3@${Automerge.getActorId(s2)}`]: 321
        })
        const resolved = Automerge.change(s1, doc => doc.list[0] = s1.list[0])
        assert.deepStrictEqual(resolved, s1)
        assert.notStrictEqual(resolved, s1)
        assert.strictEqual(Automerge.getConflicts(resolved.list, 0), undefined)
      })

      it('should sanity-check arguments', () => {
        s1 = Automerge.change(s1, doc => doc.nested = {})
        assert.throws(() => { Automerge.change({},        doc => doc.foo = 'bar') }, /must be the document root/)
        assert.throws(() => { Automerge.change(s1.nested, doc => doc.foo = 'bar') }, /must be the document root/)
      })

      it('should not allow nested change blocks', () => {
        assert.throws(() => {
          Automerge.change(s1, doc1 => {
            Automerge.change(doc1, doc2 => {
              doc2.foo = 'bar'
            })
          })
        }, /Calls to Automerge.change cannot be nested/)
        assert.throws(() => {
          s1 = Automerge.change(s1, doc1 => {
            s2 = Automerge.change(s1, doc2 => doc2.two = 2)
            doc1.one = 1
          })
        }, /Attempting to use an outdated Automerge document/)
      })

      it('should not allow the same base document to be used for multiple changes', () => {
        assert.throws(() => {
          Automerge.change(s1, doc => doc.one = 1)
          Automerge.change(s1, doc => doc.two = 2)
        }, /Attempting to use an outdated Automerge document/)
      })

      it('should allow a document to be cloned', () => {
        s1 = Automerge.change(s1, doc => doc.zero = 0)
        s2 = Automerge.clone(s1)
        s1 = Automerge.change(s1, doc => doc.one = 1)
        s2 = Automerge.change(s2, doc => doc.two = 2)
        assert.deepStrictEqual(s1, {zero: 0, one: 1})
        assert.deepStrictEqual(s2, {zero: 0, two: 2})
        Automerge.free(s1)
        Automerge.free(s2)
      })

      it('should work with Object.assign merges', () => {
        s1 = Automerge.change(s1, doc1 => {
          doc1.stuff = {foo: 'bar', baz: 'blur'}
        })
        s1 = Automerge.change(s1, doc1 => {
          doc1.stuff = Object.assign({}, doc1.stuff, {baz: 'updated!'})
        })
        assert.deepStrictEqual(s1, {stuff: {foo: 'bar', baz: 'updated!'}})
      })

      it('should support Date objects in maps', () => {
        const now = new Date()
        s1 = Automerge.change(s1, doc => doc.now = now)
        let changes = Automerge.getAllChanges(s1)
        s2 = Automerge.applyChanges(Automerge.init(), changes)
        assert.strictEqual(s2.now instanceof Date, true)
        assert.strictEqual(s2.now.getTime(), now.getTime())
      })

      it('should support Date objects in lists', () => {
        const now = new Date()
        s1 = Automerge.change(s1, doc => doc.list = [now])
        let changes = Automerge.getAllChanges(s1)
        s2 = Automerge.applyChanges(Automerge.init(), changes)
        assert.strictEqual(s2.list[0] instanceof Date, true)
        assert.strictEqual(s2.list[0].getTime(), now.getTime())
      })
    })

    describe('emptyChange()', () => {
      it('should append an empty change to the history', () => {
        s1 = Automerge.change(s1, 'first change', doc => doc.field = 123)
        s2 = Automerge.emptyChange(s1, 'empty change')
        assert.notStrictEqual(s2, s1)
        assert.deepStrictEqual(s2, s1)
        assert.deepStrictEqual(Automerge.getHistory(s2).map(state => state.change.message),
                         ['first change', 'empty change'])
      })

      it('should reference dependencies', () => {
        s1 = Automerge.change(s1, doc => doc.field = 123)
        s2 = Automerge.merge(Automerge.init(), s1)
        s2 = Automerge.change(s2, doc => doc.other = 'hello')
        s1 = Automerge.emptyChange(Automerge.merge(s1, s2))
        const history = Automerge.getHistory(s1)
        const emptyChange = history[2].change
        assert.deepStrictEqual(emptyChange.deps, [history[1].change.hash])
        assert.deepStrictEqual(emptyChange.ops, [])
      })
    })

    describe('root object', () => {
      it('should handle single-property assignment', () => {
        s1 = Automerge.change(s1, 'set bar', doc => doc.foo = 'bar')
        s1 = Automerge.change(s1, 'set zap', doc => doc.zip = 'zap')
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.zip, 'zap')
        assert.deepStrictEqual(s1, {foo: 'bar', zip: 'zap'})
      })

      it('should handle multi-property assignment', () => {
        s1 = Automerge.change(s1, 'multi-assign', doc => {
          Object.assign(doc, {foo: 'bar', answer: 42})
        })
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.answer, 42)
        assert.deepStrictEqual(s1, {foo: 'bar', answer: 42})
      })

      it('should handle root property deletion', () => {
        s1 = Automerge.change(s1, 'set foo', doc => { doc.foo = 'bar'; doc.something = null })
        s1 = Automerge.change(s1, 'del foo', doc => { delete doc['foo'] })
        assert.strictEqual(s1.foo, undefined)
        assert.strictEqual(s1.something, null)
        assert.deepStrictEqual(s1, {something: null})
      })

      it('should follow JS delete behavior', () => {
        s1 = Automerge.change(s1, 'set foo', doc => { doc.foo = 'bar' })
        let deleted
        s1 = Automerge.change(s1, 'del foo', doc => {
          deleted = delete doc['foo']
        })
        assert.strictEqual(deleted, true)
        let deleted2
        assert.doesNotThrow(() => {
          s1 = Automerge.change(s1, 'del baz', doc => {
            deleted2 = delete doc['baz']
          })
        })
        assert.strictEqual(deleted2, true)
      })

      it('should allow the type of a property to be changed', () => {
        s1 = Automerge.change(s1, 'set number', doc => doc.prop = 123)
        assert.strictEqual(s1.prop, 123)
        s1 = Automerge.change(s1, 'set string', doc => doc.prop = '123')
        assert.strictEqual(s1.prop, '123')
        s1 = Automerge.change(s1, 'set null', doc => doc.prop = null)
        assert.strictEqual(s1.prop, null)
        s1 = Automerge.change(s1, 'set bool', doc => doc.prop = true)
        assert.strictEqual(s1.prop, true)
      })

      it('should require property names to be valid', () => {
        assert.throws(() => {
          Automerge.change(s1, 'foo', doc => doc[''] = 'x')
        }, /must not be an empty string/)
      })

      it('should not allow assignment of unsupported datatypes', () => {
        Automerge.change(s1, doc => {
          assert.throws(() => { doc.foo = undefined },         /Unsupported type of value: undefined/)
          assert.throws(() => { doc.foo = {prop: undefined} }, /Unsupported type of value: undefined/)
          assert.throws(() => { doc.foo = () => {} },          /Unsupported type of value: function/)
          assert.throws(() => { doc.foo = Symbol('foo') },     /Unsupported type of value: symbol/)
        })
      })
    })

    describe('nested maps', () => {
      it('should assign an objectId to nested maps', () => {
        s1 = Automerge.change(s1, doc => { doc.nested = {} })
        assert.strictEqual(OPID_PATTERN.test(Automerge.getObjectId(s1.nested)), true)
        assert.notEqual(Automerge.getObjectId(s1.nested), ROOT_ID)
      })

      it('should handle assignment of a nested property', () => {
        s1 = Automerge.change(s1, 'first change', doc => {
          doc.nested = {}
          doc.nested.foo = 'bar'
        })
        s1 = Automerge.change(s1, 'second change', doc => {
          doc.nested.one = 1
        })
        assert.deepStrictEqual(s1, {nested: {foo: 'bar', one: 1}})
        assert.deepStrictEqual(s1.nested, {foo: 'bar', one: 1})
        assert.strictEqual(s1.nested.foo, 'bar')
        assert.strictEqual(s1.nested['foo'], 'bar')
        assert.strictEqual(s1.nested.one, 1)
        assert.strictEqual(s1.nested['one'], 1)
      })

      it('should handle assignment of an object literal', () => {
        s1 = Automerge.change(s1, doc => {
          doc.textStyle = {bold: false, fontSize: 12}
        })
        assert.deepStrictEqual(s1, {textStyle: {bold: false, fontSize: 12}})
        assert.deepStrictEqual(s1.textStyle, {bold: false, fontSize: 12})
        assert.strictEqual(s1.textStyle.bold, false)
        assert.strictEqual(s1.textStyle.fontSize, 12)
      })

      it('should handle assignment of multiple nested properties', () => {
        s1 = Automerge.change(s1, doc => {
          doc['textStyle'] = {bold: false, fontSize: 12}
          Object.assign(doc.textStyle, {typeface: 'Optima', fontSize: 14})
        })
        assert.strictEqual(s1.textStyle.typeface, 'Optima')
        assert.strictEqual(s1.textStyle.bold, false)
        assert.strictEqual(s1.textStyle.fontSize, 14)
        assert.deepStrictEqual(s1.textStyle, {typeface: 'Optima', bold: false, fontSize: 14})
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = Automerge.change(s1, doc => {
          doc.a = {b: {c: {d: {e: {f: {g: 'h'}}}}}}
        })
        s1 = Automerge.change(s1, doc => {
          doc.a.b.c.d.e.f.i = 'j'
        })
        assert.deepStrictEqual(s1, {a: { b: { c: { d: { e: { f: { g: 'h', i: 'j'}}}}}}})
        assert.strictEqual(s1.a.b.c.d.e.f.g, 'h')
        assert.strictEqual(s1.a.b.c.d.e.f.i, 'j')
      })

      it('should allow an old object to be replaced with a new one', () => {
        s1 = Automerge.change(s1, 'change 1', doc => {
          doc.myPet = {species: 'dog', legs: 4, breed: 'dachshund'}
        })
        s2 = Automerge.change(s1, 'change 2', doc => {
          doc.myPet = {species: 'koi', variety: '紅白', colors: {red: true, white: true, black: false}}
        })
        assert.deepStrictEqual(s1.myPet, {
          species: 'dog', legs: 4, breed: 'dachshund'
        })
        assert.strictEqual(s1.myPet.breed, 'dachshund')
        assert.deepStrictEqual(s2.myPet, {
          species: 'koi', variety: '紅白',
          colors: {red: true, white: true, black: false}
        })
        assert.strictEqual(s2.myPet.breed, undefined)
        assert.strictEqual(s2.myPet.variety, '紅白')
      })

      it('should allow fields to be changed between primitive and nested map', () => {
        s1 = Automerge.change(s1, doc => doc.color = '#ff7f00')
        assert.strictEqual(s1.color, '#ff7f00')
        s1 = Automerge.change(s1, doc => doc.color = {red: 255, green: 127, blue: 0})
        assert.deepStrictEqual(s1.color, {red: 255, green: 127, blue: 0})
        s1 = Automerge.change(s1, doc => doc.color = '#ff7f00')
        assert.strictEqual(s1.color, '#ff7f00')
      })

      it('should not allow several references to the same map object', () => {
        s1 = Automerge.change(s1, doc => doc.object = {})
        assert.throws(() => {
          Automerge.change(s1, doc => { doc.x = doc.object })
        }, /Cannot create a reference to an existing document object/)
        assert.throws(() => {
          Automerge.change(s1, doc => { doc.x = s1.object })
        }, /Cannot create a reference to an existing document object/)
        assert.throws(() => {
          Automerge.change(s1, doc => { doc.x = {}; doc.y = doc.x })
        }, /Cannot create a reference to an existing document object/)
      })

      it('should handle deletion of properties within a map', () => {
        s1 = Automerge.change(s1, 'set style', doc => {
          doc.textStyle = {typeface: 'Optima', bold: false, fontSize: 12}
        })
        s1 = Automerge.change(s1, 'non-bold', doc => delete doc.textStyle['bold'])
        assert.strictEqual(s1.textStyle.bold, undefined)
        assert.deepStrictEqual(s1.textStyle, {typeface: 'Optima', fontSize: 12})
      })

      it('should handle deletion of references to a map', () => {
        s1 = Automerge.change(s1, 'make rich text doc', doc => {
          Object.assign(doc, {title: 'Hello', textStyle: {typeface: 'Optima', fontSize: 12}})
        })
        s1 = Automerge.change(s1, doc => delete doc['textStyle'])
        assert.strictEqual(s1.textStyle, undefined)
        assert.deepStrictEqual(s1, {title: 'Hello'})
      })

      it('should validate field names', () => {
        s1 = Automerge.change(s1, doc => doc.nested = {})
        assert.throws(() => { Automerge.change(s1, doc => doc.nested[''] = 'x') }, /must not be an empty string/)
        assert.throws(() => { Automerge.change(s1, doc => doc.nested = {'': 'x'}) }, /must not be an empty string/)
      })
    })

    describe('lists', () => {
      it('should allow elements to be inserted', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = [])
        s1 = Automerge.change(s1, doc => doc.noodles.insertAt(0, 'udon', 'soba'))
        s1 = Automerge.change(s1, doc => doc.noodles.insertAt(1, 'ramen'))
        assert.deepStrictEqual(s1, {noodles: ['udon', 'ramen', 'soba']})
        assert.deepStrictEqual(s1.noodles, ['udon', 'ramen', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'soba')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle assignment of a list literal', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        assert.deepStrictEqual(s1, {noodles: ['udon', 'ramen', 'soba']})
        assert.deepStrictEqual(s1.noodles, ['udon', 'ramen', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'soba')
        assert.strictEqual(s1.noodles[3], undefined)
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should only allow numeric indexes', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = 'Ramen!')
        assert.strictEqual(s1.noodles[1], 'Ramen!')
        s1 = Automerge.change(s1, doc => doc.noodles['1'] = 'RAMEN!!!')
        assert.strictEqual(s1.noodles[1], 'RAMEN!!!')
        assert.throws(() => { Automerge.change(s1, doc => doc.noodles['favourite'] = 'udon') }, /list index must be a number/)
        assert.throws(() => { Automerge.change(s1, doc => doc.noodles[''         ] = 'udon') }, /list index must be a number/)
        assert.throws(() => { Automerge.change(s1, doc => doc.noodles['1e6'      ] = 'udon') }, /list index must be a number/)
      })

      it('should handle deletion of list elements', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        s1 = Automerge.change(s1, doc => delete doc.noodles[1])
        assert.deepStrictEqual(s1.noodles, ['udon', 'soba'])
        s1 = Automerge.change(s1, doc => doc.noodles.deleteAt(1))
        assert.deepStrictEqual(s1.noodles, ['udon'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], undefined)
        assert.strictEqual(s1.noodles[2], undefined)
        assert.strictEqual(s1.noodles.length, 1)
      })

      it('should handle assignment of individual list indexes', () => {
        s1 = Automerge.change(s1, doc => doc.japaneseFood = ['udon', 'ramen', 'soba'])
        s1 = Automerge.change(s1, doc => doc.japaneseFood[1] = 'sushi')
        assert.deepStrictEqual(s1.japaneseFood, ['udon', 'sushi', 'soba'])
        assert.strictEqual(s1.japaneseFood[0], 'udon')
        assert.strictEqual(s1.japaneseFood[1], 'sushi')
        assert.strictEqual(s1.japaneseFood[2], 'soba')
        assert.strictEqual(s1.japaneseFood[3], undefined)
        assert.strictEqual(s1.japaneseFood.length, 3)
      })

      it('should treat out-by-one assignment as insertion', () => {
        s1 = Automerge.change(s1, doc => doc.japaneseFood = ['udon'])
        s1 = Automerge.change(s1, doc => doc.japaneseFood[1] = 'sushi')
        assert.deepStrictEqual(s1.japaneseFood, ['udon', 'sushi'])
        assert.strictEqual(s1.japaneseFood[0], 'udon')
        assert.strictEqual(s1.japaneseFood[1], 'sushi')
        assert.strictEqual(s1.japaneseFood[2], undefined)
        assert.strictEqual(s1.japaneseFood.length, 2)
      })

      it('should not allow out-of-range assignment', () => {
        s1 = Automerge.change(s1, doc => doc.japaneseFood = ['udon'])
        assert.throws(() => { Automerge.change(s1, doc => doc.japaneseFood[4] = 'ramen') }, /is out of bounds/)
      })

      it('should allow bulk assignment of multiple list indexes', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        s1 = Automerge.change(s1, doc => Object.assign(doc.noodles, {0: 'うどん', 2: 'そば'}))
        assert.deepStrictEqual(s1.noodles, ['うどん', 'ramen', 'そば'])
        assert.strictEqual(s1.noodles[0], 'うどん')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'そば')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle nested objects', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = [{type: 'ramen', dishes: ['tonkotsu', 'shoyu']}])
        s1 = Automerge.change(s1, doc => doc.noodles.push({type: 'udon', dishes: ['tempura udon']}))
        s1 = Automerge.change(s1, doc => doc.noodles[0].dishes.push('miso'))
        assert.deepStrictEqual(s1, {noodles: [
          {type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']},
          {type: 'udon', dishes: ['tempura udon']}
        ]})
        assert.deepStrictEqual(s1.noodles[0], {
          type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']
        })
        assert.deepStrictEqual(s1.noodles[1], {
          type: 'udon', dishes: ['tempura udon']
        })
      })

      it('should handle nested lists', () => {
        s1 = Automerge.change(s1, doc => doc.noodleMatrix = [['ramen', 'tonkotsu', 'shoyu']])
        s1 = Automerge.change(s1, doc => doc.noodleMatrix.push(['udon', 'tempura udon']))
        s1 = Automerge.change(s1, doc => doc.noodleMatrix[0].push('miso'))
        assert.deepStrictEqual(s1.noodleMatrix, [['ramen', 'tonkotsu', 'shoyu', 'miso'], ['udon', 'tempura udon']])
        assert.deepStrictEqual(s1.noodleMatrix[0], ['ramen', 'tonkotsu', 'shoyu', 'miso'])
        assert.deepStrictEqual(s1.noodleMatrix[1], ['udon', 'tempura udon'])
      })

      it('should handle replacement of the entire list', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'soba', 'ramen'])
        s1 = Automerge.change(s1, doc => doc.japaneseNoodles = doc.noodles.slice())
        s1 = Automerge.change(s1, doc => doc.noodles = ['wonton', 'pho'])
        assert.deepStrictEqual(s1, {
          noodles: ['wonton', 'pho'],
          japaneseNoodles: ['udon', 'soba', 'ramen']
        })
        assert.deepStrictEqual(s1.noodles, ['wonton', 'pho'])
        assert.strictEqual(s1.noodles[0], 'wonton')
        assert.strictEqual(s1.noodles[1], 'pho')
        assert.strictEqual(s1.noodles[2], undefined)
        assert.strictEqual(s1.noodles.length, 2)
      })

      it('should allow assignment to change the type of a list element', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'soba', 'ramen'])
        assert.deepStrictEqual(s1.noodles, ['udon', 'soba', 'ramen'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = {type: 'soba', options: ['hot', 'cold']})
        assert.deepStrictEqual(s1.noodles, ['udon', {type: 'soba', options: ['hot', 'cold']}, 'ramen'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = ['hot soba', 'cold soba'])
        assert.deepStrictEqual(s1.noodles, ['udon', ['hot soba', 'cold soba'], 'ramen'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = 'soba is the best')
        assert.deepStrictEqual(s1.noodles, ['udon', 'soba is the best', 'ramen'])
      })

      it('should allow list creation and assignment in the same change callback', () => {
        s1 = Automerge.change(Automerge.init(), doc => {
          doc.letters = ['a', 'b', 'c']
          doc.letters[1] = 'd'
        })
        assert.strictEqual(s1.letters[1], 'd')
      })

      it('should allow adding and removing list elements in the same change callback', () => {
        s1 = Automerge.change(Automerge.init(), doc => doc.noodles = [])
        s1 = Automerge.change(s1, doc => {
          doc.noodles.push('udon')
          doc.noodles.deleteAt(0)
        })
        assert.deepStrictEqual(s1, {noodles: []})
        // do the add-remove cycle twice, test for #151 (https://github.com/automerge/automerge/issues/151)
        s1 = Automerge.change(s1, doc => {
          doc.noodles.push('soba')
          doc.noodles.deleteAt(0)
        })
        assert.deepStrictEqual(s1, {noodles: []})
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = Automerge.change(s1, doc => doc.maze = [[[[[[[['noodles', ['here']]]]]]]]])
        s1 = Automerge.change(s1, doc => doc.maze[0][0][0][0][0][0][0][1].unshift('found'))
        assert.deepStrictEqual(s1.maze, [[[[[[[['noodles', ['found', 'here']]]]]]]]])
        assert.deepStrictEqual(s1.maze[0][0][0][0][0][0][0][1][1], 'here')
      })

      it('should not allow several references to the same list object', () => {
        s1 = Automerge.change(s1, doc => doc.list = [])
        assert.throws(() => {
          Automerge.change(s1, doc => { doc.x = doc.list })
        }, /Cannot create a reference to an existing document object/)
        assert.throws(() => {
          Automerge.change(s1, doc => { doc.x = s1.list })
        }, /Cannot create a reference to an existing document object/)
        assert.throws(() => {
          Automerge.change(s1, doc => { doc.x = []; doc.y = doc.x })
        }, /Cannot create a reference to an existing document object/)
      })
    })

    describe('counters', () => {
      it('should coalesce assignments and increments', () => {
        const s1 = Automerge.change(Automerge.init(), doc => doc.birds = {})
        const s2 = Automerge.change(s1, doc => {
          doc.birds.wrens = new Automerge.Counter(1)
          doc.birds.wrens.increment(2)
        })
        assert.deepStrictEqual(s1, {birds: {}})
        assert.deepStrictEqual(s2, {birds: {wrens: new Automerge.Counter(3)}})
        const changes = Automerge.getAllChanges(s2).map(decodeChange)
        assert.deepStrictEqual(changes[1], {
          hash: changes[1].hash, actor: Automerge.getActorId(s2), seq: 2, startOp: 2,
          time: changes[1].time, message: '', deps: [changes[0].hash], ops: [
            {obj: Automerge.getObjectId(s2.birds), action: 'set', key: 'wrens', value: 3, datatype: 'counter', pred: []}
          ]
        })
      })

      it('should coalesce multiple increments', () => {
        const s1 = Automerge.change(Automerge.init(), doc => doc.birds = {wrens: new Automerge.Counter()})
        const s2 = Automerge.change(s1, doc => {
          doc.birds.wrens.increment(2)
          doc.birds.wrens.decrement()
          doc.birds.wrens.increment(3)
        })
        assert.deepStrictEqual(s1, {birds: {wrens: new Automerge.Counter(0)}})
        assert.deepStrictEqual(s2, {birds: {wrens: new Automerge.Counter(4)}})
        const changes = Automerge.getAllChanges(s2).map(decodeChange), actor = Automerge.getActorId(s2)
        assert.deepStrictEqual(changes[1], {
          hash: changes[1].hash, actor, seq: 2, startOp: 3, time: changes[1].time,
          message: '', deps: [changes[0].hash], ops: [
            {obj: Automerge.getObjectId(s2.birds), action: 'inc', key: 'wrens', value: 4, pred: [`2@${actor}`]}
          ]
        })
      })
    })
  })

  describe('concurrent use', () => {
    let s1, s2, s3
    beforeEach(() => {
      s1 = Automerge.init()
      s2 = Automerge.init()
      s3 = Automerge.init()
    })

    it('should merge concurrent updates of different properties', () => {
      s1 = Automerge.change(s1, doc => doc.foo = 'bar')
      s2 = Automerge.change(s2, doc => doc.hello = 'world')
      s3 = Automerge.merge(s1, s2)
      assert.strictEqual(s3.foo, 'bar')
      assert.strictEqual(s3.hello, 'world')
      assert.deepStrictEqual(s3, {foo: 'bar', hello: 'world'})
      assert.strictEqual(Automerge.getConflicts(s3, 'foo'), undefined)
      assert.strictEqual(Automerge.getConflicts(s3, 'hello'), undefined)
    })

    it('should add concurrent increments of the same property', () => {
      s1 = Automerge.change(s1, doc => doc.counter = new Automerge.Counter())
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.counter.increment())
      s2 = Automerge.change(s2, doc => doc.counter.increment(2))
      s3 = Automerge.merge(s1, s2)
      assert.strictEqual(s1.counter.value, 1)
      assert.strictEqual(s2.counter.value, 2)
      assert.strictEqual(s3.counter.value, 3)
      assert.strictEqual(Automerge.getConflicts(s3, 'counter'), undefined)
    })

    it('should add increments only to the values they precede', () => {
      s1 = Automerge.change(s1, doc => doc.counter = new Automerge.Counter(0))
      s1 = Automerge.change(s1, doc => doc.counter.increment())
      s2 = Automerge.change(s2, doc => doc.counter = new Automerge.Counter(100))
      s2 = Automerge.change(s2, doc => doc.counter.increment(3))
      s3 = Automerge.merge(s1, s2)
      if (Automerge.getActorId(s1) > Automerge.getActorId(s2)) {
        assert.deepStrictEqual(s3, {counter: new Automerge.Counter(1)})
      } else {
        assert.deepStrictEqual(s3, {counter: new Automerge.Counter(103)})
      }
      assert.deepStrictEqual(Automerge.getConflicts(s3, 'counter'), {
        [`1@${Automerge.getActorId(s1)}`]: new Automerge.Counter(1),
        [`1@${Automerge.getActorId(s2)}`]: new Automerge.Counter(103)
      })
    })

    it('should detect concurrent updates of the same field', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'one')
      s2 = Automerge.change(s2, doc => doc.field = 'two')
      s3 = Automerge.merge(s1, s2)
      if (Automerge.getActorId(s1) > Automerge.getActorId(s2)) {
        assert.deepStrictEqual(s3, {field: 'one'})
      } else {
        assert.deepStrictEqual(s3, {field: 'two'})
      }
      assert.deepStrictEqual(Automerge.getConflicts(s3, 'field'), {
        [`1@${Automerge.getActorId(s1)}`]: 'one',
        [`1@${Automerge.getActorId(s2)}`]: 'two'
      })
    })

    it('should detect concurrent updates of the same list element', () => {
      s1 = Automerge.change(s1, doc => doc.birds = ['finch'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds[0] = 'greenfinch')
      s2 = Automerge.change(s2, doc => doc.birds[0] = 'goldfinch')
      s3 = Automerge.merge(s1, s2)
      if (Automerge.getActorId(s1) > Automerge.getActorId(s2)) {
        assert.deepStrictEqual(s3.birds, ['greenfinch'])
      } else {
        assert.deepStrictEqual(s3.birds, ['goldfinch'])
      }
      assert.deepStrictEqual(Automerge.getConflicts(s3.birds, 0), {
        [`3@${Automerge.getActorId(s1)}`]: 'greenfinch',
        [`3@${Automerge.getActorId(s2)}`]: 'goldfinch'
      })
    })

    it('should handle assignment conflicts of different types', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'string')
      s2 = Automerge.change(s2, doc => doc.field = ['list'])
      s3 = Automerge.change(s3, doc => doc.field = {thing: 'map'})
      s1 = Automerge.merge(Automerge.merge(s1, s2), s3)
      assertEqualsOneOf(s1.field, 'string', ['list'], {thing: 'map'})
      assert.deepStrictEqual(Automerge.getConflicts(s1, 'field'), {
        [`1@${Automerge.getActorId(s1)}`]: 'string',
        [`1@${Automerge.getActorId(s2)}`]: ['list'],
        [`1@${Automerge.getActorId(s3)}`]: {thing: 'map'}
      })
    })

    it('should handle changes within a conflicting map field', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'string')
      s2 = Automerge.change(s2, doc => doc.field = {})
      s2 = Automerge.change(s2, doc => doc.field.innerKey = 42)
      s3 = Automerge.merge(s1, s2)
      assertEqualsOneOf(s3.field, 'string', {innerKey: 42})
      assert.deepStrictEqual(Automerge.getConflicts(s3, 'field'), {
        [`1@${Automerge.getActorId(s1)}`]: 'string',
        [`1@${Automerge.getActorId(s2)}`]: {innerKey: 42}
      })
    })

    it('should handle changes within a conflicting list element', () => {
      s1 = Automerge.change(s1, doc => doc.list = ['hello'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.list[0] = {map1: true})
      s1 = Automerge.change(s1, doc => doc.list[0].key = 1)
      s2 = Automerge.change(s2, doc => doc.list[0] = {map2: true})
      s2 = Automerge.change(s2, doc => doc.list[0].key = 2)
      s3 = Automerge.merge(s1, s2)
      if (Automerge.getActorId(s1) > Automerge.getActorId(s2)) {
        assert.deepStrictEqual(s3.list, [{map1: true, key: 1}])
      } else {
        assert.deepStrictEqual(s3.list, [{map2: true, key: 2}])
      }
      assert.deepStrictEqual(Automerge.getConflicts(s3.list, 0), {
        [`3@${Automerge.getActorId(s1)}`]: {map1: true, key: 1},
        [`3@${Automerge.getActorId(s2)}`]: {map2: true, key: 2}
      })
    })

    it('should not merge concurrently assigned nested maps', () => {
      s1 = Automerge.change(s1, doc => doc.config = {background: 'blue'})
      s2 = Automerge.change(s2, doc => doc.config = {logo_url: 'logo.png'})
      s3 = Automerge.merge(s1, s2)
      assertEqualsOneOf(s3.config, {background: 'blue'}, {logo_url: 'logo.png'})
      assert.deepStrictEqual(Automerge.getConflicts(s3, 'config'), {
        [`1@${Automerge.getActorId(s1)}`]: {background: 'blue'},
        [`1@${Automerge.getActorId(s2)}`]: {logo_url: 'logo.png'}
      })
    })

    it('should clear conflicts after assigning a new value', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'one')
      s2 = Automerge.change(s2, doc => doc.field = 'two')
      s3 = Automerge.merge(s1, s2)
      s3 = Automerge.change(s3, doc => doc.field = 'three')
      assert.deepStrictEqual(s3, {field: 'three'})
      assert.strictEqual(Automerge.getConflicts(s3, 'field'), undefined)
      s2 = Automerge.merge(s2, s3)
      assert.deepStrictEqual(s2, {field: 'three'})
      assert.strictEqual(Automerge.getConflicts(s2, 'field'), undefined)
    })

    it('should handle concurrent insertions at different list positions', () => {
      s1 = Automerge.change(s1, doc => doc.list = ['one', 'three'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.list.splice(1, 0, 'two'))
      s2 = Automerge.change(s2, doc => doc.list.push('four'))
      s3 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s3, {list: ['one', 'two', 'three', 'four']})
      assert.strictEqual(Automerge.getConflicts(s3, 'list'), undefined)
    })

    it('should handle concurrent insertions at the same list position', () => {
      s1 = Automerge.change(s1, doc => doc.birds = ['parakeet'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds.push('starling'))
      s2 = Automerge.change(s2, doc => doc.birds.push('chaffinch'))
      s3 = Automerge.merge(s1, s2)
      assertEqualsOneOf(s3.birds, ['parakeet', 'starling', 'chaffinch'], ['parakeet', 'chaffinch', 'starling'])
      s2 = Automerge.merge(s2, s3)
      assert.deepStrictEqual(s2, s3)
    })

    it('should handle concurrent assignment and deletion of a map entry', () => {
      // Add-wins semantics
      s1 = Automerge.change(s1, doc => doc.bestBird = 'robin')
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => delete doc['bestBird'])
      s2 = Automerge.change(s2, doc => doc.bestBird = 'magpie')
      s3 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s1, {})
      assert.deepStrictEqual(s2, {bestBird: 'magpie'})
      assert.deepStrictEqual(s3, {bestBird: 'magpie'})
      assert.strictEqual(Automerge.getConflicts(s3, 'bestBird'), undefined)
    })

    it('should handle concurrent assignment and deletion of a list element', () => {
      // Concurrent assignment ressurects a deleted list element. Perhaps a little
      // surprising, but consistent with add-wins semantics of maps (see test above)
      s1 = Automerge.change(s1, doc => doc.birds = ['blackbird', 'thrush', 'goldfinch'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds[1] = 'starling')
      s2 = Automerge.change(s2, doc => doc.birds.splice(1, 1))
      s3 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s1.birds, ['blackbird', 'starling', 'goldfinch'])
      assert.deepStrictEqual(s2.birds, ['blackbird', 'goldfinch'])
      assert.deepStrictEqual(s3.birds, ['blackbird', 'starling', 'goldfinch'])
    })

    it('should handle insertion after a deleted list element', () => {
      s1 = Automerge.change(s1, doc => doc.birds = ['blackbird', 'thrush', 'goldfinch'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds.splice(1, 2))
      s2 = Automerge.change(s2, doc => doc.birds.splice(2, 0, 'starling'))
      s3 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s3, {birds: ['blackbird', 'starling']})
      assert.deepStrictEqual(Automerge.merge(s2, s3), {birds: ['blackbird', 'starling']})
    })

    it('should handle concurrent deletion of the same element', () => {
      s1 = Automerge.change(s1, doc => doc.birds = ['albatross','buzzard', 'cormorant'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds.deleteAt(1)) // buzzard
      s2 = Automerge.change(s2, doc => doc.birds.deleteAt(1)) // buzzard
      s3 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s3.birds, ['albatross','cormorant'])
    })

    it('should handle concurrent deletion of different elements', () => {
      s1 = Automerge.change(s1, doc => doc.birds =  ['albatross','buzzard', 'cormorant'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds.deleteAt(0)) // albatross
      s2 = Automerge.change(s2, doc => doc.birds.deleteAt(1)) // buzzard
      s3 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s3.birds, ['cormorant'])
    })

    it('should handle concurrent updates at different levels of the tree', () => {
      // A delete higher up in the tree overrides an update in a subtree
      s1 = Automerge.change(s1, doc => doc.animals = {birds: {pink: 'flamingo', black: 'starling'}, mammals: ['badger']})
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.animals.birds.brown = 'sparrow')
      s2 = Automerge.change(s2, doc => delete doc.animals['birds'])
      s3 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s1.animals, {
        birds: {
          pink: 'flamingo', brown: 'sparrow', black: 'starling'
        },
        mammals: ['badger']
      })
      assert.deepStrictEqual(s2.animals, {mammals: ['badger']})
      assert.deepStrictEqual(s3.animals, {mammals: ['badger']})
    })

    it('should not interleave sequence insertions at the same position', () => {
      s1 = Automerge.change(s1, doc => doc.wisdom = [])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.wisdom.push('to', 'be', 'is', 'to', 'do'))
      s2 = Automerge.change(s2, doc => doc.wisdom.push('to', 'do', 'is', 'to', 'be'))
      s3 = Automerge.merge(s1, s2)
      assertEqualsOneOf(s3.wisdom,
        ['to', 'be', 'is', 'to', 'do', 'to', 'do', 'is', 'to', 'be'],
        ['to', 'do', 'is', 'to', 'be', 'to', 'be', 'is', 'to', 'do'])
      // In case you're wondering: http://quoteinvestigator.com/2013/09/16/do-be-do/
    })

    describe('multiple insertions at the same list position', () => {
      it('should handle insertion by greater actor ID', () => {
        s1 = Automerge.init('aaaa')
        s2 = Automerge.init('bbbb')
        s1 = Automerge.change(s1, doc => doc.list = ['two'])
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.splice(0, 0, 'one'))
        assert.deepStrictEqual(s2.list, ['one', 'two'])
      })

      it('should handle insertion by lesser actor ID', () => {
        s1 = Automerge.init('bbbb')
        s2 = Automerge.init('aaaa')
        s1 = Automerge.change(s1, doc => doc.list = ['two'])
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.splice(0, 0, 'one'))
        assert.deepStrictEqual(s2.list, ['one', 'two'])
      })

      it('should handle insertion regardless of actor ID', () => {
        s1 = Automerge.change(s1, doc => doc.list = ['two'])
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.splice(0, 0, 'one'))
        assert.deepStrictEqual(s2.list, ['one', 'two'])
      })

      it('should make insertion order consistent with causality', () => {
        s1 = Automerge.change(s1, doc => doc.list = ['four'])
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.unshift('three'))
        s1 = Automerge.merge(s1, s2)
        s1 = Automerge.change(s1, doc => doc.list.unshift('two'))
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.unshift('one'))
        assert.deepStrictEqual(s2.list, ['one', 'two', 'three', 'four'])
      })
    })
  })

  describe('.undo()', () => {
    function getTopOfUndoStack(doc) {
      const stack = Automerge.Backend.getUndoStack(Automerge.Frontend.getBackendState(doc))
      return stack[stack.length - 1]
    }

    it('should allow undo if there have been local changes', () => {
      let s1 = Automerge.init()
      assert.strictEqual(Automerge.canUndo(s1), false)
      assert.throws(() => Automerge.undo(s1), /there is nothing to be undone/)
      s1 = Automerge.change(s1, doc => doc.hello = 'world')
      assert.strictEqual(Automerge.canUndo(s1), true)
      let s2 = Automerge.merge(Automerge.init(), s1)
      assert.strictEqual(Automerge.canUndo(s2), false)
      assert.throws(() => Automerge.undo(s2), /there is nothing to be undone/)
    })

    it('should undo an initial field assignment by deleting the field', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.hello = 'world')
      assert.deepStrictEqual(s1, {hello: 'world'})
      assert.deepStrictEqual(getTopOfUndoStack(s1),
                             [{action: 'del', obj: ROOT_ID, key: 'hello'}])
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {})
    })

    it('should undo a field update by reverting to the previous value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 3)
      s1 = Automerge.change(s1, doc => doc.value = 4)
      assert.deepStrictEqual(s1, {value: 4})
      assert.deepStrictEqual(getTopOfUndoStack(s1),
                             [{action: 'set', obj: ROOT_ID, key: 'value', value: 3}])
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {value: 3})
    })

    it('should allow undoing multiple changes', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.value = 1)
      s1 = Automerge.change(s1, doc => doc.value = 2)
      s1 = Automerge.change(s1, doc => doc.value = 3)
      assert.deepStrictEqual(s1, {value: 3})
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {value: 2})
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {value: 1})
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {})
      assert.strictEqual(Automerge.canUndo(s1), false)
    })

    it('should undo only local changes', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.s1 = 's1.old')
      s1 = Automerge.change(s1, doc => doc.s1 = 's1.new')
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.s2 = 's2')
      s1 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s1, {s1: 's1.new', s2: 's2'})
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {s1: 's1.old', s2: 's2'})
    })

    it('should apply undos by growing the history', () => {
      let s1 = Automerge.change(Automerge.init(), 'set 1', doc => doc.value = 1)
      s1 = Automerge.change(s1, 'set 2', doc => doc.value = 2)
      let s2 = Automerge.merge(Automerge.init(), s1)
      assert.deepStrictEqual(s2, {value: 2})
      s1 = Automerge.undo(s1, 'undo!')
      assert.deepStrictEqual(Automerge.getHistory(s1).map(state => [state.change.seq, state.change.message]),
                             [[1, 'set 1'], [2, 'set 2'], [3, 'undo!']])
      s2 = Automerge.merge(s2, s1)
      assert.deepStrictEqual(s1, {value: 1})
    })

    it("should ignore other actors' updates to an undo-reverted field", () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 1)
      s1 = Automerge.change(s1, doc => doc.value = 2)
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.value = 3)
      s1 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s1, {value: 3})
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {value: 1})
    })

    it('should undo object creation by removing the link', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.settings = {background: 'white', text: 'black'})
      assert.deepStrictEqual(s1, {settings: {background: 'white', text: 'black'}})
      assert.deepStrictEqual(getTopOfUndoStack(s1),
                             [{action: 'del', obj: ROOT_ID, key: 'settings'}])
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {})
    })

    it('should undo primitive field deletion by setting the old value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => { doc.k1 = 'v1'; doc.k2 = 'v2' })
      s1 = Automerge.change(s1, doc => delete doc.k2)
      assert.deepStrictEqual(s1, {k1: 'v1'})
      assert.deepStrictEqual(getTopOfUndoStack(s1),
                             [{action: 'set', obj: ROOT_ID, key: 'k2', value: 'v2'}])
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {k1: 'v1', k2: 'v2'})
    })

    it('should undo link deletion by linking the old value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.fish = ['trout', 'sea bass'])
      s1 = Automerge.change(s1, doc => doc.birds = ['heron', 'magpie'])
      let s2 = Automerge.change(s1, doc => delete doc['fish'])
      assert.deepStrictEqual(s2, {birds: ['heron', 'magpie']})
      assert.deepStrictEqual(getTopOfUndoStack(s2),
                             [{action: 'link', obj: ROOT_ID, key: 'fish', child: Automerge.getObjectId(s1.fish)}])
      s2 = Automerge.undo(s2)
      assert.deepStrictEqual(s2, {fish: ['trout', 'sea bass'], birds: ['heron', 'magpie']})
    })

    it('should undo list insertion by removing the new element', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.list = ['A', 'B', 'C'])
      s1 = Automerge.change(s1, doc => doc.list.push('D'))
      assert.deepStrictEqual(s1, {list: ['A', 'B', 'C', 'D']})
      const actor = Automerge.Frontend.getActorId(s1)
      assert.deepStrictEqual(getTopOfUndoStack(s1),
                             [{action: 'del', obj: Automerge.getObjectId(s1.list), key: `5@${actor}`}])
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {list: ['A', 'B', 'C']})
    })

    it('should undo list element deletion by re-assigning the old value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.list = ['A', 'B', 'C'])
      const actor = Automerge.Frontend.getActorId(s1)
      s1 = Automerge.change(s1, doc => doc.list.splice(1, 1))
      assert.deepStrictEqual(s1, {list: ['A', 'C']})
      assert.deepStrictEqual(getTopOfUndoStack(s1),
                             [{action: 'set', obj: Automerge.getObjectId(s1.list), key: `3@${actor}`, value: 'B'}])
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {list: ['A', 'B', 'C']})
    })

    it('should undo counter increments', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.counter = new Automerge.Counter())
      s1 = Automerge.change(s1, doc => doc.counter.increment())
      assert.deepStrictEqual(s1, {counter: new Automerge.Counter(1)})
      assert.deepStrictEqual(getTopOfUndoStack(s1),
                             [{action: 'inc', obj: ROOT_ID, key: 'counter', value: -1}])
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {counter: new Automerge.Counter(0)})
    })
  })

  describe('.redo()', () => {
    function getTopOfRedoStack(doc) {
      const stack = Automerge.Backend.getRedoStack(Automerge.Frontend.getBackendState(doc))
      return stack[stack.length - 1]
    }

    it('should allow redo if the last change was an undo', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['peregrine falcon'])
      assert.strictEqual(Automerge.canRedo(s1), false)
      assert.throws(() => Automerge.redo(s1), /there is no prior undo/)
      s1 = Automerge.undo(s1)
      assert.strictEqual(Automerge.canRedo(s1), true)
      s1 = Automerge.redo(s1)
      assert.strictEqual(Automerge.canRedo(s1), false)
      assert.throws(() => Automerge.redo(s1), /there is no prior undo/)
    })

    it('should allow several undos to be matched by several redos', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = [])
      s1 = Automerge.change(s1, doc => doc.birds.push('peregrine falcon'))
      s1 = Automerge.change(s1, doc => doc.birds.push('sparrowhawk'))
      assert.deepStrictEqual(s1, {birds: ['peregrine falcon', 'sparrowhawk']})
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {birds: ['peregrine falcon']})
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {birds: []})
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {birds: ['peregrine falcon']})
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {birds: ['peregrine falcon', 'sparrowhawk']})
    })

    it('should allow winding history backwards and forwards repeatedly', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc['sparrows'] = 1)
      s1 = Automerge.change(s1, doc => doc['skylarks'] = 1)
      s1 = Automerge.change(s1, doc => doc['sparrows'] = 2)
      s1 = Automerge.change(s1, doc => delete doc['skylarks'])
      const states = [{}, {sparrows: 1}, {sparrows: 1, skylarks: 1}, {sparrows: 2, skylarks: 1}, {sparrows: 2}]
      for (let iteration = 0; iteration < 3; iteration++) {
        for (let undo = states.length - 2; undo >= 0; undo--) {
          s1 = Automerge.undo(s1)
          assert.deepStrictEqual(s1, states[undo])
        }
        for (let redo = 1; redo < states.length; redo++) {
          s1 = Automerge.redo(s1)
          assert.deepStrictEqual(s1, states[redo])
        }
      }
    })

    it('should undo/redo an initial field assignment', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.hello = 'world')
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'set', obj: ROOT_ID, key: 'hello', value: 'world'}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(Automerge.Backend.getRedoStack(Automerge.Frontend.getBackendState(s1)).length, 0)
      assert.deepStrictEqual(s1, {hello: 'world'})
    })

    it('should undo/redo a field update', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 3)
      s1 = Automerge.change(s1, doc => doc.value = 4)
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {value: 3})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'set', obj: ROOT_ID, key: 'value', value: 4}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {value: 4})
    })

    it('should undo/redo a field deletion', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 123)
      s1 = Automerge.change(s1, doc => delete doc.value)
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {value: 123})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'del', obj: ROOT_ID, key: 'value'}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {})
    })

    it('should undo/redo object creation and linking', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.settings = {background: 'white', text: 'black'})
      let s2 = Automerge.undo(s1)
      assert.deepStrictEqual(s2, {})
      assert.deepStrictEqual(getTopOfRedoStack(s2),
                             [{action: 'link', obj: ROOT_ID, key: 'settings', child: Automerge.getObjectId(s1.settings)}])
      s2 = Automerge.redo(s2)
      assert.deepStrictEqual(s2, {settings: {background: 'white', text: 'black'}})
    })

    it('should undo/redo link deletion', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.fish = ['trout', 'sea bass'])
      s1 = Automerge.change(s1, doc => doc.birds = ['heron', 'magpie'])
      s1 = Automerge.change(s1, doc => delete doc['fish'])
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {fish: ['trout', 'sea bass'], birds: ['heron', 'magpie']})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'del', obj: ROOT_ID, key: 'fish'}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {birds: ['heron', 'magpie']})
    })

    it('should undo/redo a list element insertion', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.list = ['A', 'B', 'C'])
      s1 = Automerge.change(s1, doc => doc.list.push('D'))
      const actor = Automerge.Frontend.getActorId(s1)
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {list: ['A', 'B', 'C']})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'set', obj: Automerge.getObjectId(s1.list), key: `5@${actor}`, value: 'D'}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {list: ['A', 'B', 'C', 'D']})
    })

    it('should undo/redo a list element deletion', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.list = ['A', 'B', 'C'])
      s1 = Automerge.change(s1, doc => doc.list.deleteAt(1))
      s1 = Automerge.undo(s1)
      const actor = Automerge.Frontend.getActorId(s1)
      assert.deepStrictEqual(s1, {list: ['A', 'B', 'C']})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'del', obj: Automerge.getObjectId(s1.list), key: `3@${actor}`}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {list: ['A', 'C']})
    })

    it('should undo/redo counter increments', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.counter = new Automerge.Counter(5))
      s1 = Automerge.change(s1, doc => doc.counter.increment())
      s1 = Automerge.change(s1, doc => doc.counter.increment())
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {counter: new Automerge.Counter(6)})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'inc', obj: ROOT_ID, key: 'counter', value: 1}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {counter: new Automerge.Counter(7)})
    })

    it('should redo assignments by other actors that precede the undo', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 1)
      s1 = Automerge.change(s1, doc => doc.value = 2)
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.value = 3)
      s1 = Automerge.merge(s1, s2)
      s1 = Automerge.undo(s1)
      assert.deepStrictEqual(s1, {value: 1})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'set', obj: ROOT_ID, key: 'value', value: 3}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {value: 3})
    })

    it('should overwrite assignments by other actors that follow the undo', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 1)
      s1 = Automerge.change(s1, doc => doc.value = 2)
      s1 = Automerge.undo(s1)
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.value = 3)
      s1 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s1, {value: 3})
      assert.deepStrictEqual(getTopOfRedoStack(s1),
                             [{action: 'set', obj: ROOT_ID, key: 'value', value: 2}])
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {value: 2})
    })

    it('should merge with concurrent changes to other fields', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc['trout'] = 2)
      s1 = Automerge.change(s1, doc => doc['trout'] = 3)
      s1 = Automerge.undo(s1)
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc['salmon'] = 1)
      s1 = Automerge.merge(s1, s2)
      assert.deepStrictEqual(s1, {trout: 2, salmon: 1})
      s1 = Automerge.redo(s1)
      assert.deepStrictEqual(s1, {trout: 3, salmon: 1})
    })

    it('should apply redos by growing the history', () => {
      let s1 = Automerge.change(Automerge.init(), 'set 1', doc => doc.value = 1)
      s1 = Automerge.change(s1, 'set 2', doc => doc.value = 2)
      s1 = Automerge.undo(s1, 'undo')
      s1 = Automerge.redo(s1, 'redo!')
      assert.deepStrictEqual(Automerge.getHistory(s1).map(state => [state.change.seq, state.change.message]),
                       [[1, 'set 1'], [2, 'set 2'], [3, 'undo'], [4, 'redo!']])
    })
  })

  describe('saving and loading', () => {
    it('should save and restore an empty document', () => {
      let s = Automerge.load(Automerge.save(Automerge.init()))
      assert.deepStrictEqual(s, {})
    })

    it('should generate a new random actor ID', () => {
      let s1 = Automerge.init()
      let s2 = Automerge.load(Automerge.save(s1))
      assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(s1).toString()), true)
      assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(s2).toString()), true)
      assert.notEqual(Automerge.getActorId(s1), Automerge.getActorId(s2))
    })

    it('should allow a custom actor ID to be set', () => {
      let s = Automerge.load(Automerge.save(Automerge.init()), '333333')
      assert.strictEqual(Automerge.getActorId(s), '333333')
    })

    it('should reconstitute complex datatypes', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.todos = [{title: 'water plants', done: false}])
      let s2 = Automerge.load(Automerge.save(s1))
      assert.deepStrictEqual(s2, {todos: [{title: 'water plants', done: false}]})
    })

    it('should reconstitute conflicts', () => {
      let s1 = Automerge.change(Automerge.init('111111'), doc => doc.x = 3)
      let s2 = Automerge.change(Automerge.init('222222'), doc => doc.x = 5)
      s1 = Automerge.merge(s1, s2)
      let s3 = Automerge.load(Automerge.save(s1))
      assert.strictEqual(s1.x, 5)
      assert.strictEqual(s3.x, 5)
      assert.deepStrictEqual(Automerge.getConflicts(s1, 'x'), {'1@111111': 3, '1@222222': 5})
      assert.deepStrictEqual(Automerge.getConflicts(s3, 'x'), {'1@111111': 3, '1@222222': 5})
    })

    it('should reconstitute element ID counters', () => {
      const s1 = Automerge.init('01234567')
      const s2 = Automerge.change(s1, doc => doc.list = ['a'])
      const listId = Automerge.getObjectId(s2.list)
      const changes12 = Automerge.getAllChanges(s2).map(decodeChange)
      assert.deepStrictEqual(changes12, [{
        hash: changes12[0].hash, actor: '01234567', seq: 1, startOp: 1,
        time: changes12[0].time, message: '', deps: [], ops: [
          {obj: ROOT_ID, action: 'makeList', key: 'list', pred: []},
          {obj: listId,  action: 'set', key: '_head', insert: true, value: 'a', pred: []}
        ]
      }])
      const s3 = Automerge.change(s2, doc => doc.list.deleteAt(0))
      const s4 = Automerge.load(Automerge.save(s3), '01234567')
      const s5 = Automerge.change(s4, doc => doc.list.push('b'))
      const changes45 = Automerge.getAllChanges(s5).map(decodeChange)
      assert.deepStrictEqual(s5, {list: ['b']})
      assert.deepStrictEqual(changes45[2], {
        hash: changes45[2].hash, actor: '01234567', seq: 3, startOp: 4,
        time: changes45[2].time, message: '', deps: [changes45[1].hash], ops: [
          {obj: listId, action: 'set', key: '_head', insert: true, value: 'b', pred: []}
        ]
      })
    })

    it('should allow a reloaded list to be mutated', () => {
      let doc = Automerge.change(Automerge.init(), doc => doc.foo = [])
      doc = Automerge.load(Automerge.save(doc))
      doc = Automerge.change(doc, 'add', doc => doc.foo.push(1))
      doc = Automerge.load(Automerge.save(doc))
      assert.deepStrictEqual(doc.foo, [1])
    })
  })

  describe('history API', () => {
    it('should return an empty history for an empty document', () => {
      assert.deepStrictEqual(Automerge.getHistory(Automerge.init()), [])
    })

    it('should make past document states accessible', () => {
      let s = Automerge.init()
      s = Automerge.change(s, doc => doc.config = {background: 'blue'})
      s = Automerge.change(s, doc => doc.birds = ['mallard'])
      s = Automerge.change(s, doc => doc.birds.unshift('oystercatcher'))
      assert.deepStrictEqual(Automerge.getHistory(s).map(state => state.snapshot), [
        {config: {background: 'blue'}},
        {config: {background: 'blue'}, birds: ['mallard']},
        {config: {background: 'blue'}, birds: ['oystercatcher', 'mallard']}
      ])
    })

    it('should make change messages accessible', () => {
      let s = Automerge.init()
      s = Automerge.change(s, 'Empty Bookshelf', doc => doc.books = [])
      s = Automerge.change(s, 'Add Orwell', doc => doc.books.push('Nineteen Eighty-Four'))
      s = Automerge.change(s, 'Add Huxley', doc => doc.books.push('Brave New World'))
      assert.deepStrictEqual(s.books, ['Nineteen Eighty-Four', 'Brave New World'])
      assert.deepStrictEqual(Automerge.getHistory(s).map(state => state.change.message),
                       ['Empty Bookshelf', 'Add Orwell', 'Add Huxley'])
    })
  })

  describe('changes API', () => {
    it('should return an empty list on an empty document', () => {
      let changes = Automerge.getAllChanges(Automerge.init())
      assert.deepStrictEqual(changes, [])
    })

    it('should return an empty list when nothing changed', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['Chaffinch'])
      assert.deepStrictEqual(Automerge.getChanges(s1, s1), [])
    })

    it('should do nothing when applying an empty list of changes', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['Chaffinch'])
      assert.deepStrictEqual(Automerge.applyChanges(s1, []), s1)
    })

    it('should return all changes when compared to an empty document', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes = Automerge.getChanges(Automerge.init(), s2)
      assert.strictEqual(changes.length, 2)
    })

    it('should allow a document copy to be reconstructed from scratch', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes = Automerge.getAllChanges(s2)
      let s3 = Automerge.applyChanges(Automerge.init(), changes)
      assert.deepStrictEqual(s3.birds, ['Chaffinch', 'Bullfinch'])
    })

    it('should return changes since the last given version', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let changes1 = Automerge.getAllChanges(s1)
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes2 = Automerge.getChanges(s1, s2)
      assert.strictEqual(changes1.length, 1) // Add Chaffinch
      assert.strictEqual(changes2.length, 1) // Add Bullfinch
    })

    it('should incrementally apply changes since the last given version', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let changes1 = Automerge.getAllChanges(s1)
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes2 = Automerge.getChanges(s1, s2)
      let s3 = Automerge.applyChanges(Automerge.init(), changes1)
      let s4 = Automerge.applyChanges(s3, changes2)
      assert.deepStrictEqual(s3.birds, ['Chaffinch'])
      assert.deepStrictEqual(s4.birds, ['Chaffinch', 'Bullfinch'])
    })

    it('should report missing dependencies', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.birds.push('Bullfinch'))
      let changes = Automerge.getAllChanges(s2)
      let s3 = Automerge.applyChanges(Automerge.init(), [changes[1]])
      assert.deepStrictEqual(s3, {})
      assert.deepStrictEqual(Automerge.getMissingDeps(s3), decodeChange(changes[1]).deps)
      s3 = Automerge.applyChanges(s3, [changes[0]])
      assert.deepStrictEqual(s3.birds, ['Chaffinch', 'Bullfinch'])
      assert.deepStrictEqual(Automerge.getMissingDeps(s3), [])
    })

    it('should report missing dependencies with out-of-order applyChanges', () => {
      let s0 = Automerge.init()
      let s1 = Automerge.change(s0, doc => doc.test = ['a'])
      let changes01 = Automerge.getAllChanges(s1)
      let s2 = Automerge.change(s1, doc => doc.test = ['b'])
      let changes12 = Automerge.getChanges(s1, s2)
      let s3 = Automerge.change(s2, doc => doc.test = ['c'])
      let changes23 = Automerge.getChanges(s2, s3)
      let s4 = Automerge.init()
      let s5 = Automerge.applyChanges(s4, changes23)
      let s6 = Automerge.applyChanges(s5, changes12)
      assert.deepStrictEqual(Automerge.getMissingDeps(s6), [decodeChange(changes01[0]).hash])
    })
  })
})
