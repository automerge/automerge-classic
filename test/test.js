const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { assertEqualsOneOf } = require('./helpers')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'
const UUID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

describe('Automerge', () => {

  describe('initialization ', () => {
    it('should initially be an empty map', () => {
      const doc = Automerge.init()
      assert.deepEqual(doc, {})
    })

    it('should allow instantiating from an existing object', () => {
      const initialState = { birds: { wrens: 3, magpies: 4 } }
      const doc = Automerge.from(initialState)
      assert.deepEqual(doc, initialState)
    })

    it('should allow merging of an object initialized with `from`', () => {
      let doc1 = Automerge.from({ cards: [] })
      let doc2 = Automerge.merge(Automerge.init(), doc1)
      assert.deepEqual(doc2, { cards: [] })
    })

    it('should allow passing an actorId when instantiating from an existing object', () => {
      const actorId = '123'
      let doc = Automerge.from({ foo: 1 }, actorId)
      assert.strictEqual(Automerge.getActorId(doc), '123')
    })

    it('accepts an empty object as initial state', () => {
      const doc = Automerge.from({})
      assert.deepEqual(doc, {})
    })

    it('accepts an array as initial state, but converts it to an object', () => {
      const doc = Automerge.from(['a', 'b', 'c'])
      assert.deepEqual(doc, { '0': 'a', '1': 'b', '2': 'c' })
    })

    it('accepts strings as initial values, but treats them as an array of characters', () => {
      const doc = Automerge.from('abc')
      assert.deepEqual(doc, { '0': 'a', '1': 'b', '2': 'c' })
    })

    it('ignores numbers provided as initial values', () => {
      const doc = Automerge.from(123)
      assert.deepEqual(doc, {})
    })

    it('ignores booleans provided as initial values', () => {
      const doc1 = Automerge.from(false)
      assert.deepEqual(doc1, {})
      const doc2 = Automerge.from(true)
      assert.deepEqual(doc2, {})
    })

    it('should not enable undo after Automerge.from', () => {
      let doc = Automerge.from({cards: []})
      assert.deepEqual(Automerge.canUndo(doc), false)
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
          assert.deepEqual(doc, {
            first: 'one', second: 'two'
          })
        })
        assert.deepEqual(s1, {})
        assert.deepEqual(s2, {first: 'one', second: 'two'})
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
        assert.deepEqual(s1, {})
        assert.deepEqual(s2, {value: 'c'})
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
        assert.strictEqual(Object.keys(Automerge.getConflicts(s1, 'field')).length, 1)
        const resolved = Automerge.change(s1, doc => doc.field = s1.field)
        assert.notStrictEqual(resolved, s1)
        assert.deepEqual(resolved, {field: s1.field})
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
        assertEqualsOneOf(Automerge.getConflicts(s1.list, 0),
                          {[Automerge.getActorId(s1)]: 123},
                          {[Automerge.getActorId(s2)]: 321})
        const resolved = Automerge.change(s1, doc => doc.list[0] = s1.list[0])
        assert.deepEqual(resolved, s1)
        assert.notStrictEqual(resolved, s1)
        assert.strictEqual(Automerge.getConflicts(resolved.list, 0), null)
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
      })

      it('should not interfere with each other when forking', () => {
        s1 = Automerge.change(s1, doc1 => {
          s2 = Automerge.change(s1, doc2 => doc2.two = 2)
          doc1.one = 1
        })
        assert.deepEqual(s1, {one: 1})
        assert.deepEqual(s2, {two: 2})
      })

      it('should work with Object.assign merges', () => {
        s1 = Automerge.change(s1, doc1 => {
          doc1.stuff = {foo: 'bar', baz: 'blur'}
        })
        s1 = Automerge.change(s1, doc1 => {
          doc1.stuff = Object.assign({}, doc1.stuff, {baz: 'updated!'})
        })
        assert.deepEqual(s1, {stuff: {foo: 'bar', baz: 'updated!'}})
      })

      it('should support Date objects in maps', () => {
        const now = new Date()
        s1 = Automerge.change(s1, doc => doc.now = now)
        let changes = Automerge.getAllChanges(s1)
        changes = JSON.parse(JSON.stringify(changes))
        s2 = Automerge.applyChanges(Automerge.init(), changes)
        assert.strictEqual(s2.now instanceof Date, true)
        assert.strictEqual(s2.now.getTime(), now.getTime())
      })

      it('should support Date objects in lists', () => {
        const now = new Date()
        s1 = Automerge.change(s1, doc => doc.list = [now])
        let changes = Automerge.getAllChanges(s1)
        changes = JSON.parse(JSON.stringify(changes))
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
        assert.deepEqual(s2, s1)
        assert.deepEqual(Automerge.getHistory(s2).map(state => state.change.message),
                         ['first change', 'empty change'])
      })

      it('should reference dependencies', () => {
        s1 = Automerge.change(s1, doc => doc.field = 123)
        s2 = Automerge.merge(Automerge.init(), s1)
        s2 = Automerge.change(s2, doc => doc.other = 'hello')
        s1 = Automerge.emptyChange(Automerge.merge(s1, s2))
        const history = Automerge.getHistory(s1)
        const emptyChange = history[history.length - 1].change
        assert.deepEqual(emptyChange.deps, {[Automerge.getActorId(s2)]: 1})
        assert.deepEqual(emptyChange.ops, [])
      })
    })

    describe('root object', () => {
      it('should handle single-property assignment', () => {
        s1 = Automerge.change(s1, 'set bar', doc => doc.foo = 'bar')
        s1 = Automerge.change(s1, 'set zap', doc => doc.zip = 'zap')
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.zip, 'zap')
        assert.deepEqual(s1, {foo: 'bar', zip: 'zap'})
      })

      it('should handle multi-property assignment', () => {
        s1 = Automerge.change(s1, 'multi-assign', doc => {
          Object.assign(doc, {foo: 'bar', answer: 42})
        })
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.answer, 42)
        assert.deepEqual(s1, {foo: 'bar', answer: 42})
      })

      it('should handle root property deletion', () => {
        s1 = Automerge.change(s1, 'set foo', doc => { doc.foo = 'bar'; doc.something = null })
        s1 = Automerge.change(s1, 'del foo', doc => { delete doc['foo'] })
        assert.strictEqual(s1.foo, undefined)
        assert.strictEqual(s1.something, null)
        assert.deepEqual(s1, {something: null})
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
      it('should assign a UUID to nested maps', () => {
        s1 = Automerge.change(s1, doc => { doc.nested = {} })
        assert.strictEqual(UUID_PATTERN.test(Automerge.getObjectId(s1.nested)), true)
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
        assert.deepEqual(s1, {nested: {foo: 'bar', one: 1}})
        assert.deepEqual(s1.nested, {foo: 'bar', one: 1})
        assert.strictEqual(s1.nested.foo, 'bar')
        assert.strictEqual(s1.nested['foo'], 'bar')
        assert.strictEqual(s1.nested.one, 1)
        assert.strictEqual(s1.nested['one'], 1)
      })

      it('should handle assignment of an object literal', () => {
        s1 = Automerge.change(s1, doc => {
          doc.textStyle = {bold: false, fontSize: 12}
        })
        assert.deepEqual(s1, {textStyle: {bold: false, fontSize: 12}})
        assert.deepEqual(s1.textStyle, {bold: false, fontSize: 12})
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
        assert.deepEqual(s1.textStyle, {typeface: 'Optima', bold: false, fontSize: 14})
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = Automerge.change(s1, doc => {
          doc.a = {b: {c: {d: {e: {f: {g: 'h'}}}}}}
        })
        s1 = Automerge.change(s1, doc => {
          doc.a.b.c.d.e.f.i = 'j'
        })
        assert.deepEqual(s1, {a: { b: { c: { d: { e: { f: { g: 'h', i: 'j'}}}}}}})
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
        assert.deepEqual(s1.myPet, {
          species: 'dog', legs: 4, breed: 'dachshund'
        })
        assert.strictEqual(s1.myPet.breed, 'dachshund')
        assert.deepEqual(s2.myPet, {
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
        assert.deepEqual(s1.color, {red: 255, green: 127, blue: 0})
        s1 = Automerge.change(s1, doc => doc.color = '#ff7f00')
        assert.strictEqual(s1.color, '#ff7f00')
      })

      it('should allow several references to the same map object', () => {
        s1 = Automerge.change(s1, 'create object', doc => {
          doc.position = {x: 1, y: 1}
          doc.size = doc.position
        })
        s2 = Automerge.change(s1, 'update y', doc => doc.position.y = 2)
        assert.strictEqual(s1.size.y, 1)
        assert.strictEqual(s2.size.y, 2)
        assert.strictEqual(Automerge.getObjectId(s1.position), Automerge.getObjectId(s1.size))
      })

      it('should handle deletion of properties within a map', () => {
        s1 = Automerge.change(s1, 'set style', doc => {
          doc.textStyle = {typeface: 'Optima', bold: false, fontSize: 12}
        })
        s1 = Automerge.change(s1, 'non-bold', doc => delete doc.textStyle['bold'])
        assert.strictEqual(s1.textStyle.bold, undefined)
        assert.deepEqual(s1.textStyle, {typeface: 'Optima', fontSize: 12})
      })

      it('should handle deletion of references to a map', () => {
        s1 = Automerge.change(s1, 'make rich text doc', doc => {
          Object.assign(doc, {title: 'Hello', textStyle: {typeface: 'Optima', fontSize: 12}})
        })
        s1 = Automerge.change(s1, doc => delete doc['textStyle'])
        assert.strictEqual(s1.textStyle, undefined)
        assert.deepEqual(s1, {title: 'Hello'})
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
        assert.deepEqual(s1, {noodles: ['udon', 'ramen', 'soba']})
        assert.deepEqual(s1.noodles, ['udon', 'ramen', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'soba')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle assignment of a list literal', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        assert.deepEqual(s1, {noodles: ['udon', 'ramen', 'soba']})
        assert.deepEqual(s1.noodles, ['udon', 'ramen', 'soba'])
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
        assert.deepEqual(s1.noodles, ['udon', 'soba'])
        s1 = Automerge.change(s1, doc => doc.noodles.deleteAt(1))
        assert.deepEqual(s1.noodles, ['udon'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], undefined)
        assert.strictEqual(s1.noodles[2], undefined)
        assert.strictEqual(s1.noodles.length, 1)
      })

      it('should handle assignment of individual list indexes', () => {
        s1 = Automerge.change(s1, doc => doc.japaneseFood = ['udon', 'ramen', 'soba'])
        s1 = Automerge.change(s1, doc => doc.japaneseFood[1] = 'sushi')
        assert.deepEqual(s1.japaneseFood, ['udon', 'sushi', 'soba'])
        assert.strictEqual(s1.japaneseFood[0], 'udon')
        assert.strictEqual(s1.japaneseFood[1], 'sushi')
        assert.strictEqual(s1.japaneseFood[2], 'soba')
        assert.strictEqual(s1.japaneseFood[3], undefined)
        assert.strictEqual(s1.japaneseFood.length, 3)
      })

      it('should treat out-by-one assignment as insertion', () => {
        s1 = Automerge.change(s1, doc => doc.japaneseFood = ['udon'])
        s1 = Automerge.change(s1, doc => doc.japaneseFood[1] = 'sushi')
        assert.deepEqual(s1.japaneseFood, ['udon', 'sushi'])
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
        assert.deepEqual(s1.noodles, ['うどん', 'ramen', 'そば'])
        assert.strictEqual(s1.noodles[0], 'うどん')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'そば')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle nested objects', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = [{type: 'ramen', dishes: ['tonkotsu', 'shoyu']}])
        s1 = Automerge.change(s1, doc => doc.noodles.push({type: 'udon', dishes: ['tempura udon']}))
        s1 = Automerge.change(s1, doc => doc.noodles[0].dishes.push('miso'))
        assert.deepEqual(s1, {noodles: [
          {type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']},
          {type: 'udon', dishes: ['tempura udon']}
        ]})
        assert.deepEqual(s1.noodles[0], {
          type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']
        })
        assert.deepEqual(s1.noodles[1], {
          type: 'udon', dishes: ['tempura udon']
        })
      })

      it('should handle nested lists', () => {
        s1 = Automerge.change(s1, doc => doc.noodleMatrix = [['ramen', 'tonkotsu', 'shoyu']])
        s1 = Automerge.change(s1, doc => doc.noodleMatrix.push(['udon', 'tempura udon']))
        s1 = Automerge.change(s1, doc => doc.noodleMatrix[0].push('miso'))
        assert.deepEqual(s1.noodleMatrix, [['ramen', 'tonkotsu', 'shoyu', 'miso'], ['udon', 'tempura udon']])
        assert.deepEqual(s1.noodleMatrix[0], ['ramen', 'tonkotsu', 'shoyu', 'miso'])
        assert.deepEqual(s1.noodleMatrix[1], ['udon', 'tempura udon'])
      })

      it('should handle replacement of the entire list', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'soba', 'ramen'])
        s1 = Automerge.change(s1, doc => doc.japaneseNoodles = doc.noodles)
        s1 = Automerge.change(s1, doc => doc.noodles = ['wonton', 'pho'])
        assert.deepEqual(s1, {
          noodles: ['wonton', 'pho'],
          japaneseNoodles: ['udon', 'soba', 'ramen']
        })
        assert.deepEqual(s1.noodles, ['wonton', 'pho'])
        assert.strictEqual(s1.noodles[0], 'wonton')
        assert.strictEqual(s1.noodles[1], 'pho')
        assert.strictEqual(s1.noodles[2], undefined)
        assert.strictEqual(s1.noodles.length, 2)
      })

      it('should allow assignment to change the type of a list element', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'soba', 'ramen'])
        assert.deepEqual(s1.noodles, ['udon', 'soba', 'ramen'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = {type: 'soba', options: ['hot', 'cold']})
        assert.deepEqual(s1.noodles, ['udon', {type: 'soba', options: ['hot', 'cold']}, 'ramen'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = ['hot soba', 'cold soba'])
        assert.deepEqual(s1.noodles, ['udon', ['hot soba', 'cold soba'], 'ramen'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = 'soba is the best')
        assert.deepEqual(s1.noodles, ['udon', 'soba is the best', 'ramen'])
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
        assert.deepEqual(s1, {noodles: []})
        // do the add-remove cycle twice, test for #151 (https://github.com/automerge/automerge/issues/151)
        s1 = Automerge.change(s1, doc => {
          doc.noodles.push('soba')
          doc.noodles.deleteAt(0)
        })
        assert.deepEqual(s1, {noodles: []})
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = Automerge.change(s1, doc => doc.maze = [[[[[[[['noodles', ['here']]]]]]]]])
        s1 = Automerge.change(s1, doc => doc.maze[0][0][0][0][0][0][0][1].unshift('found'))
        assert.deepEqual(s1.maze, [[[[[[[['noodles', ['found', 'here']]]]]]]]])
        assert.deepEqual(s1.maze[0][0][0][0][0][0][0][1][1], 'here')
      })

      it('should allow several references to the same list object', () => {
        s1 = Automerge.change(s1, doc => doc.japaneseNoodles = ['udon', 'soba'])
        s1 = Automerge.change(s1, doc => doc.theBestNoodles = doc.japaneseNoodles)
        s1 = Automerge.change(s1, doc => doc.theBestNoodles.push('ramen'))
        assert.deepEqual(s1, {
          japaneseNoodles: ['udon', 'soba', 'ramen'],
          theBestNoodles: ['udon', 'soba', 'ramen']
        })
        assert.strictEqual(s1.japaneseNoodles[2], 'ramen')
        assert.strictEqual(s1.japaneseNoodles.length, 3)
        assert.strictEqual(s1.theBestNoodles[2], 'ramen')
        assert.strictEqual(s1.theBestNoodles.length, 3)
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
      assert.deepEqual(s3, {foo: 'bar', hello: 'world'})
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
        assert.deepEqual(s3, {counter: new Automerge.Counter(1)})
        assert.deepEqual(Automerge.getConflicts(s3, 'counter'), {
          [Automerge.getActorId(s2)]: new Automerge.Counter(103)
        })
      } else {
        assert.deepEqual(s3, {counter: new Automerge.Counter(103)})
        assert.deepEqual(Automerge.getConflicts(s3, 'counter'), {
          [Automerge.getActorId(s1)]: new Automerge.Counter(1)
        })
      }
    })

    it('should detect concurrent updates of the same field', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'one')
      s2 = Automerge.change(s2, doc => doc.field = 'two')
      s3 = Automerge.merge(s1, s2)
      if (Automerge.getActorId(s1) > Automerge.getActorId(s2)) {
        assert.deepEqual(s3, {field: 'one'})
        assert.deepEqual(Automerge.getConflicts(s3, 'field'), {
          [Automerge.getActorId(s2)]: 'two'
        })
      } else {
        assert.deepEqual(s3, {field: 'two'})
        assert.deepEqual(Automerge.getConflicts(s3, 'field'), {
          [Automerge.getActorId(s1)]: 'one'
        })
      }
    })

    it('should detect concurrent updates of the same list element', () => {
      s1 = Automerge.change(s1, doc => doc.birds = ['finch'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds[0] = 'greenfinch')
      s2 = Automerge.change(s2, doc => doc.birds[0] = 'goldfinch')
      s3 = Automerge.merge(s1, s2)
      if (Automerge.getActorId(s1) > Automerge.getActorId(s2)) {
        assert.deepEqual(s3.birds, ['greenfinch'])
        assert.deepEqual(Automerge.getConflicts(s3.birds, 0), {
          [Automerge.getActorId(s2)]: 'goldfinch'
        })
      } else {
        assert.deepEqual(s3.birds, ['goldfinch'])
        assert.deepEqual(Automerge.getConflicts(s3.birds, 0), {
          [Automerge.getActorId(s1)]: 'greenfinch'
        })
      }
    })

    it('should handle assignment conflicts of different types', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'string')
      s2 = Automerge.change(s2, doc => doc.field = ['list'])
      s3 = Automerge.change(s3, doc => doc.field = {thing: 'map'})
      s1 = Automerge.merge(Automerge.merge(s1, s2), s3)
      assertEqualsOneOf(s1.field, 'string', ['list'], {thing: 'map'})

      if (s1.field === 'string') {
        assert.deepEqual(Automerge.getConflicts(s1, 'field'), {
          [Automerge.getActorId(s2)]: ['list'],
          [Automerge.getActorId(s3)]: {thing: 'map'}
        })
      } else if (Automerge.equals(s1.field, ['list'])) {
        assert.deepEqual(Automerge.getConflicts(s1, 'field'), {
          [Automerge.getActorId(s1)]: 'string',
          [Automerge.getActorId(s3)]: {thing: 'map'}
        })
      } else if (Automerge.equals(s1.field, {thing: 'map'})) {
        assert.deepEqual(Automerge.getConflicts(s1, 'field'), {
          [Automerge.getActorId(s1)]: 'string',
          [Automerge.getActorId(s2)]: ['list']
        })
      } else {
        assert.fail(s1.field, 'string or list or map', 'not one of the expected values')
      }
    })

    it('should handle changes within a conflicting map field', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'string')
      s2 = Automerge.change(s2, doc => doc.field = {})
      s2 = Automerge.change(s2, doc => doc.field.innerKey = 42)
      s3 = Automerge.merge(s1, s2)
      assertEqualsOneOf(s3.field, 'string', {innerKey: 42})
      if (s3.field === 'string') {
        assert.deepEqual(Automerge.getConflicts(s3, 'field'), {
          [Automerge.getActorId(s2)]: {innerKey: 42}
        })
      } else {
        assert.deepEqual(Automerge.getConflicts(s3, 'field'), {
          [Automerge.getActorId(s1)]: 'string'
        })
      }
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
        assert.deepEqual(s3.list, [{map1: true, key: 1}])
        assert.deepEqual(Automerge.getConflicts(s3.list, 0), {
          [Automerge.getActorId(s2)]: {map2: true, key: 2}
        })
      } else {
        assert.deepEqual(s3.list, [{map2: true, key: 2}])
        assert.deepEqual(Automerge.getConflicts(s3.list, 0), {
          [Automerge.getActorId(s1)]: {map1: true, key: 1}
        })
      }
    })

    it('should not merge concurrently assigned nested maps', () => {
      s1 = Automerge.change(s1, doc => doc.config = {background: 'blue'})
      s2 = Automerge.change(s2, doc => doc.config = {logo_url: 'logo.png'})
      s3 = Automerge.merge(s1, s2)
      assertEqualsOneOf(s3.config, {background: 'blue'}, {logo_url: 'logo.png'})
      if (s3.config.background === 'blue') {
        assert.deepEqual(Automerge.getConflicts(s3, 'config'), {
          [Automerge.getActorId(s2)]: {logo_url: 'logo.png'}
        })
      } else {
        assert.deepEqual(Automerge.getConflicts(s3, 'config'), {
          [Automerge.getActorId(s1)]: {background: 'blue'}
        })
      }
    })

    it('should clear conflicts after assigning a new value', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'one')
      s2 = Automerge.change(s2, doc => doc.field = 'two')
      s3 = Automerge.merge(s1, s2)
      s3 = Automerge.change(s3, doc => doc.field = 'three')
      assert.deepEqual(s3, {field: 'three'})
      assert.strictEqual(Automerge.getConflicts(s3, 'field'), undefined)
      s2 = Automerge.merge(s2, s3)
      assert.deepEqual(s2, {field: 'three'})
      assert.strictEqual(Automerge.getConflicts(s2, 'field'), undefined)
    })

    it('should handle concurrent insertions at different list positions', () => {
      s1 = Automerge.change(s1, doc => doc.list = ['one', 'three'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.list.splice(1, 0, 'two'))
      s2 = Automerge.change(s2, doc => doc.list.push('four'))
      s3 = Automerge.merge(s1, s2)
      assert.deepEqual(s3, {list: ['one', 'two', 'three', 'four']})
      assert.strictEqual(Automerge.getConflicts(s3, 'list'), undefined)
    })

    it('should handle concurrent insertions at the same list position', () => {
      s1 = Automerge.change(s1, doc => doc.birds = ['parakeet'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds.push('starling'))
      s2 = Automerge.change(s2, doc => doc.birds.push('chaffinch'))
      s3 = Automerge.merge(s1, s2)
      assertEqualsOneOf(s3.birds, ['parakeet', 'starling', 'chaffinch'], ['parakeet', 'chaffinch', 'starling'])
      s2 = Automerge.merge(s2, s1)
      assert.deepEqual(s2, s3)
    })

    it('should handle concurrent assignment and deletion of a map entry', () => {
      // Add-wins semantics
      s1 = Automerge.change(s1, doc => doc.bestBird = 'robin')
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => delete doc['bestBird'])
      s2 = Automerge.change(s2, doc => doc.bestBird = 'magpie')
      s3 = Automerge.merge(s1, s2)
      assert.deepEqual(s1, {})
      assert.deepEqual(s2, {bestBird: 'magpie'})
      assert.deepEqual(s3, {bestBird: 'magpie'})
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
      assert.deepEqual(s1.birds, ['blackbird', 'starling', 'goldfinch'])
      assert.deepEqual(s2.birds, ['blackbird', 'goldfinch'])
      assert.deepEqual(s3.birds, ['blackbird', 'starling', 'goldfinch'])
    })

    it('should handle concurrent deletion of the same element', () => {
      s1 = Automerge.change(s1, doc => doc.birds = ['albatross','buzzard', 'cormorant'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds.deleteAt(1)) // buzzard
      s2 = Automerge.change(s2, doc => doc.birds.deleteAt(1)) // buzzard
      s3 = Automerge.merge(s1, s2)
      assert.deepEqual(s3.birds, ['albatross','cormorant'])
    })

    it('should handle concurrent deletion of different elements', () => {
      s1 = Automerge.change(s1, doc => doc.birds =  ['albatross','buzzard', 'cormorant'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds.deleteAt(0)) // albatross
      s2 = Automerge.change(s2, doc => doc.birds.deleteAt(1)) // buzzard
      s3 = Automerge.merge(s1, s2)
      assert.deepEqual(s3.birds, ['cormorant'])
    })

    it('should handle concurrent updates at different levels of the tree', () => {
      // A delete higher up in the tree overrides an update in a subtree
      s1 = Automerge.change(s1, doc => doc.animals = {birds: {pink: 'flamingo', black: 'starling'}, mammals: ['badger']})
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.animals.birds.brown = 'sparrow')
      s2 = Automerge.change(s2, doc => delete doc.animals['birds'])
      s3 = Automerge.merge(s1, s2)
      assert.deepEqual(s1.animals, {
        birds: {
          pink: 'flamingo', brown: 'sparrow', black: 'starling'
        },
        mammals: ['badger']
      })
      assert.deepEqual(s2.animals, {mammals: ['badger']})
      assert.deepEqual(s3.animals, {mammals: ['badger']})
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
        s1 = Automerge.init('A')
        s2 = Automerge.init('B')
        s1 = Automerge.change(s1, doc => doc.list = ['two'])
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.splice(0, 0, 'one'))
        assert.deepEqual(s2.list, ['one', 'two'])
      })

      it('should handle insertion by lesser actor ID', () => {
        s1 = Automerge.init('B')
        s2 = Automerge.init('A')
        s1 = Automerge.change(s1, doc => doc.list = ['two'])
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.splice(0, 0, 'one'))
        assert.deepEqual(s2.list, ['one', 'two'])
      })

      it('should handle insertion regardless of actor ID', () => {
        s1 = Automerge.change(s1, doc => doc.list = ['two'])
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.splice(0, 0, 'one'))
        assert.deepEqual(s2.list, ['one', 'two'])
      })

      it('should make insertion order consistent with causality', () => {
        s1 = Automerge.change(s1, doc => doc.list = ['four'])
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.unshift('three'))
        s1 = Automerge.merge(s1, s2)
        s1 = Automerge.change(s1, doc => doc.list.unshift('two'))
        s2 = Automerge.merge(s2, s1)
        s2 = Automerge.change(s2, doc => doc.list.unshift('one'))
        assert.deepEqual(s2.list, ['one', 'two', 'three', 'four'])
      })
    })
  })

  describe('.undo()', () => {
    function getUndoStack(doc) {
      return Automerge.Frontend.getBackendState(doc).getIn(['opSet', 'undoStack'])
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
      assert.deepEqual(s1, {hello: 'world'})
      assert.deepEqual(getUndoStack(s1).last().toJS(),
                       [{action: 'del', obj: ROOT_ID, key: 'hello'}])
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {})
    })

    it('should undo a field update by reverting to the previous value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 3)
      s1 = Automerge.change(s1, doc => doc.value = 4)
      assert.deepEqual(s1, {value: 4})
      assert.deepEqual(getUndoStack(s1).last().toJS(),
                       [{action: 'set', obj: ROOT_ID, key: 'value', value: 3}])
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {value: 3})
    })

    it('should allow undoing multiple changes', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.value = 1)
      s1 = Automerge.change(s1, doc => doc.value = 2)
      s1 = Automerge.change(s1, doc => doc.value = 3)
      assert.deepEqual(s1, {value: 3})
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {value: 2})
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {value: 1})
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {})
      assert.strictEqual(Automerge.canUndo(s1), false)
    })

    it('should undo only local changes', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.s1 = 's1.old')
      s1 = Automerge.change(s1, doc => doc.s1 = 's1.new')
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.s2 = 's2')
      s1 = Automerge.merge(s1, s2)
      assert.deepEqual(s1, {s1: 's1.new', s2: 's2'})
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {s1: 's1.old', s2: 's2'})
    })

    it('should apply undos by growing the history', () => {
      let s1 = Automerge.change(Automerge.init(), 'set 1', doc => doc.value = 1)
      s1 = Automerge.change(s1, 'set 2', doc => doc.value = 2)
      let s2 = Automerge.merge(Automerge.init(), s1)
      assert.deepEqual(s2, {value: 2})
      s1 = Automerge.undo(s1, 'undo!')
      assert.deepEqual(Automerge.getHistory(s1).map(state => [state.change.seq, state.change.message]),
                       [[1, 'set 1'], [2, 'set 2'], [3, 'undo!']])
      s2 = Automerge.merge(s2, s1)
      assert.deepEqual(s1, {value: 1})
    })

    it("should ignore other actors' updates to an undo-reverted field", () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 1)
      s1 = Automerge.change(s1, doc => doc.value = 2)
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.value = 3)
      s1 = Automerge.merge(s1, s2)
      assert.deepEqual(s1, {value: 3})
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {value: 1})
    })

    it('should undo object creation by removing the link', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.settings = {background: 'white', text: 'black'})
      assert.deepEqual(s1, {settings: {background: 'white', text: 'black'}})
      assert.deepEqual(getUndoStack(s1).last().toJS(),
                       [{action: 'del', obj: ROOT_ID, key: 'settings'}])
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {})
    })

    it('should undo primitive field deletion by setting the old value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => { doc.k1 = 'v1'; doc.k2 = 'v2' })
      s1 = Automerge.change(s1, doc => delete doc.k2)
      assert.deepEqual(s1, {k1: 'v1'})
      assert.deepEqual(getUndoStack(s1).last().toJS(),
                       [{action: 'set', obj: ROOT_ID, key: 'k2', value: 'v2'}])
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {k1: 'v1', k2: 'v2'})
    })

    it('should undo link deletion by linking the old value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.fish = ['trout', 'sea bass'])
      s1 = Automerge.change(s1, doc => doc.birds = ['heron', 'magpie'])
      let s2 = Automerge.change(s1, doc => delete doc['fish'])
      assert.deepEqual(s2, {birds: ['heron', 'magpie']})
      assert.deepEqual(getUndoStack(s2).last().toJS(),
                       [{action: 'link', obj: ROOT_ID, key: 'fish', value: Automerge.getObjectId(s1.fish)}])
      s2 = Automerge.undo(s2)
      assert.deepEqual(s2, {fish: ['trout', 'sea bass'], birds: ['heron', 'magpie']})
    })

    it('should undo list insertion by removing the new element', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.list = ['A', 'B', 'C'])
      s1 = Automerge.change(s1, doc => doc.list.push('D'))
      assert.deepEqual(s1, {list: ['A', 'B', 'C', 'D']})
      const elemId = Automerge.Frontend.getElementIds(s1.list)[3]
      assert.deepEqual(getUndoStack(s1).last().toJS(),
                       [{action: 'del', obj: Automerge.getObjectId(s1.list), key: elemId}])
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {list: ['A', 'B', 'C']})
    })

    it('should undo list element deletion by re-assigning the old value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.list = ['A', 'B', 'C'])
      const elemId = Automerge.Frontend.getElementIds(s1.list)[1]
      s1 = Automerge.change(s1, doc => doc.list.splice(1, 1))
      assert.deepEqual(s1, {list: ['A', 'C']})
      assert.deepEqual(getUndoStack(s1).last().toJS(),
                       [{action: 'set', obj: Automerge.getObjectId(s1.list), key: elemId, value: 'B'}])
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {list: ['A', 'B', 'C']})
    })

    it('should undo counter increments', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.counter = new Automerge.Counter())
      s1 = Automerge.change(s1, doc => doc.counter.increment())
      assert.deepEqual(s1, {counter: new Automerge.Counter(1)})
      assert.deepEqual(getUndoStack(s1).last().toJS(),
                       [{action: 'inc', obj: ROOT_ID, key: 'counter', value: -1}])
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {counter: new Automerge.Counter(0)})
    })
  })

  describe('.redo()', () => {
    function getRedoStack(doc) {
      return Automerge.Frontend.getBackendState(doc).getIn(['opSet', 'redoStack'])
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
      assert.deepEqual(s1, {birds: ['peregrine falcon', 'sparrowhawk']})
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {birds: ['peregrine falcon']})
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {birds: []})
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {birds: ['peregrine falcon']})
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {birds: ['peregrine falcon', 'sparrowhawk']})
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
          assert.deepEqual(s1, states[undo])
        }
        for (let redo = 1; redo < states.length; redo++) {
          s1 = Automerge.redo(s1)
          assert.deepEqual(s1, states[redo])
        }
      }
    })

    it('should undo/redo an initial field assignment', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.hello = 'world')
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'set', obj: ROOT_ID, key: 'hello', value: 'world'}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(getRedoStack(s1).size, 0)
      assert.deepEqual(s1, {hello: 'world'})
    })

    it('should undo/redo a field update', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 3)
      s1 = Automerge.change(s1, doc => doc.value = 4)
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {value: 3})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'set', obj: ROOT_ID, key: 'value', value: 4}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {value: 4})
    })

    it('should undo/redo a field deletion', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 123)
      s1 = Automerge.change(s1, doc => delete doc.value)
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {value: 123})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'del', obj: ROOT_ID, key: 'value'}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {})
    })

    it('should undo/redo object creation and linking', () => {
      let s1 = Automerge.init()
      s1 = Automerge.change(s1, doc => doc.settings = {background: 'white', text: 'black'})
      let s2 = Automerge.undo(s1)
      assert.deepEqual(s2, {})
      assert.deepEqual(getRedoStack(s2).last().toJS(),
                       [{action: 'link', obj: ROOT_ID, key: 'settings', value: Automerge.getObjectId(s1.settings)}])
      s2 = Automerge.redo(s2)
      assert.deepEqual(s2, {settings: {background: 'white', text: 'black'}})
    })

    it('should undo/redo link deletion', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.fish = ['trout', 'sea bass'])
      s1 = Automerge.change(s1, doc => doc.birds = ['heron', 'magpie'])
      s1 = Automerge.change(s1, doc => delete doc['fish'])
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {fish: ['trout', 'sea bass'], birds: ['heron', 'magpie']})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'del', obj: ROOT_ID, key: 'fish'}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {birds: ['heron', 'magpie']})
    })

    it('should undo/redo a list element insertion', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.list = ['A', 'B', 'C'])
      s1 = Automerge.change(s1, doc => doc.list.push('D'))
      const elemId = Automerge.Frontend.getElementIds(s1.list)[3]
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {list: ['A', 'B', 'C']})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'set', obj: Automerge.getObjectId(s1.list), key: elemId, value: 'D'}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {list: ['A', 'B', 'C', 'D']})
    })

    it('should undo/redo a list element deletion', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.list = ['A', 'B', 'C'])
      s1 = Automerge.change(s1, doc => doc.list.deleteAt(1))
      s1 = Automerge.undo(s1)
      const elemId = Automerge.Frontend.getElementIds(s1.list)[1]
      assert.deepEqual(s1, {list: ['A', 'B', 'C']})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'del', obj: Automerge.getObjectId(s1.list), key: elemId}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {list: ['A', 'C']})
    })

    it('should undo/redo counter increments', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.counter = new Automerge.Counter(5))
      s1 = Automerge.change(s1, doc => doc.counter.increment())
      s1 = Automerge.change(s1, doc => doc.counter.increment())
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {counter: new Automerge.Counter(6)})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'inc', obj: ROOT_ID, key: 'counter', value: 1}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {counter: new Automerge.Counter(7)})
    })

    it('should redo assignments by other actors that precede the undo', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 1)
      s1 = Automerge.change(s1, doc => doc.value = 2)
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.value = 3)
      s1 = Automerge.merge(s1, s2)
      s1 = Automerge.undo(s1)
      assert.deepEqual(s1, {value: 1})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'set', obj: ROOT_ID, key: 'value', value: 3}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {value: 3})
    })

    it('should overwrite assignments by other actors that follow the undo', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.value = 1)
      s1 = Automerge.change(s1, doc => doc.value = 2)
      s1 = Automerge.undo(s1)
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.value = 3)
      s1 = Automerge.merge(s1, s2)
      assert.deepEqual(s1, {value: 3})
      assert.deepEqual(getRedoStack(s1).last().toJS(),
                       [{action: 'set', obj: ROOT_ID, key: 'value', value: 2}])
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {value: 2})
    })

    it('should merge with concurrent changes to other fields', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc['trout'] = 2)
      s1 = Automerge.change(s1, doc => doc['trout'] = 3)
      s1 = Automerge.undo(s1)
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc['salmon'] = 1)
      s1 = Automerge.merge(s1, s2)
      assert.deepEqual(s1, {trout: 2, salmon: 1})
      s1 = Automerge.redo(s1)
      assert.deepEqual(s1, {trout: 3, salmon: 1})
    })

    it('should apply redos by growing the history', () => {
      let s1 = Automerge.change(Automerge.init(), 'set 1', doc => doc.value = 1)
      s1 = Automerge.change(s1, 'set 2', doc => doc.value = 2)
      s1 = Automerge.undo(s1, 'undo')
      s1 = Automerge.redo(s1, 'redo!')
      assert.deepEqual(Automerge.getHistory(s1).map(state => [state.change.seq, state.change.message]),
                       [[1, 'set 1'], [2, 'set 2'], [3, 'undo'], [4, 'redo!']])
    })
  })

  describe('saving and loading', () => {
    it('should save and restore an empty document', () => {
      let s = Automerge.load(Automerge.save(Automerge.init()))
      assert.deepEqual(s, {})
    })

    it('should generate a new random actor ID', () => {
      let s1 = Automerge.init()
      let s2 = Automerge.load(Automerge.save(s1))
      assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(s1).toString()), true)
      assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(s2).toString()), true)
      assert.notEqual(Automerge.getActorId(s1), Automerge.getActorId(s2))
    })

    it('should allow a custom actor ID to be set', () => {
      let s = Automerge.load(Automerge.save(Automerge.init()), 'actor3')
      assert.strictEqual(Automerge.getActorId(s), 'actor3')
    })

    it('should reconstitute complex datatypes', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.todos = [{title: 'water plants', done: false}])
      let s2 = Automerge.load(Automerge.save(s1))
      assert.deepEqual(s2, {todos: [{title: 'water plants', done: false}]})
    })

    it('should reconstitute conflicts', () => {
      let s1 = Automerge.change(Automerge.init('actor1'), doc => doc.x = 3)
      let s2 = Automerge.change(Automerge.init('actor2'), doc => doc.x = 5)
      s1 = Automerge.merge(s1, s2)
      let s3 = Automerge.load(Automerge.save(s1))
      assert.strictEqual(s1.x, 5)
      assert.strictEqual(s3.x, 5)
      assert.deepEqual(Automerge.getConflicts(s1, 'x'), {actor1: 3})
      assert.deepEqual(Automerge.getConflicts(s3, 'x'), {actor1: 3})
    })

    it('should reconstitute element ID counters', () => {
      let s = Automerge.init('actorid')
      s = Automerge.change(s, doc => doc.list = ['a'])
      assert.strictEqual(Automerge.Frontend.getElementIds(s.list)[0], 'actorid:1')
      s = Automerge.change(s, doc => doc.list.deleteAt(0))
      s = Automerge.load(Automerge.save(s), 'actorid')
      s = Automerge.change(s, doc => doc.list.push('b'))
      assert.deepEqual(s, {list: ['b']})
      assert.strictEqual(Automerge.Frontend.getElementIds(s.list)[0], 'actorid:2')
    })

    it('should allow a reloaded list to be mutated', () => {
      let doc = Automerge.change(Automerge.init(), doc => doc.foo = [])
      doc = Automerge.load(Automerge.save(doc))
      doc = Automerge.change(doc, 'add', doc => doc.foo.push(1))
      doc = Automerge.load(Automerge.save(doc))
      assert.deepEqual(doc.foo, [1])
    })
  })

  describe('history API', () => {
    it('should return an empty history for an empty document', () => {
      assert.deepEqual(Automerge.getHistory(Automerge.init()), [])
    })

    it('should make past document states accessible', () => {
      let s = Automerge.init()
      s = Automerge.change(s, doc => doc.config = {background: 'blue'})
      s = Automerge.change(s, doc => doc.birds = ['mallard'])
      s = Automerge.change(s, doc => doc.birds.unshift('oystercatcher'))
      assert.deepEqual(Automerge.getHistory(s).map(state => state.snapshot), [
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
      assert.deepEqual(s.books, ['Nineteen Eighty-Four', 'Brave New World'])
      assert.deepEqual(Automerge.getHistory(s).map(state => state.change.message),
                       ['Empty Bookshelf', 'Add Orwell', 'Add Huxley'])
    })
  })

  describe('.diff()', () => {
    it('should return an empty diff for the same document', () => {
      let s = Automerge.change(Automerge.init(), doc => doc.birds = [])
      assert.deepEqual(Automerge.diff(s, s), [])
    })

    it('should refuse to diff diverged documents', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = [])
      let s2 = Automerge.change(s1, doc => doc.birds.push('Robin'))
      let s3 = Automerge.merge(Automerge.init(), s1)
      let s4 = Automerge.change(s3, doc => doc.birds.push('Wagtail'))
      assert.throws(() => Automerge.diff(s2, s4), /Cannot diff two states that have diverged/)
    })

    it('should return list insertions by index', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = [])
      let s2 = Automerge.change(s1, doc => doc.birds.push('Robin'))
      let s3 = Automerge.change(s2, doc => doc.birds.push('Wagtail'))
      const obj = Automerge.getObjectId(s1.birds)
      assert.deepEqual(Automerge.diff(s1, s2), [
        {obj, path: ['birds'], type: 'list', action: 'insert', index: 0, value: 'Robin', elemId: `${Automerge.getActorId(s1)}:1`}
      ])
      assert.deepEqual(Automerge.diff(s1, s3), [
        {obj, path: ['birds'], type: 'list', action: 'insert', index: 0, value: 'Robin', elemId: `${Automerge.getActorId(s1)}:1`},
        {obj, path: ['birds'], type: 'list', action: 'insert', index: 1, value: 'Wagtail', elemId: `${Automerge.getActorId(s1)}:2`}
      ])
    })

    it('should return list deletions by index', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['Robin', 'Wagtail'])
      let s2 = Automerge.change(s1, doc => { doc.birds[1] = 'Pied Wagtail'; doc.birds.shift() })
      const obj = Automerge.getObjectId(s1.birds)
      assert.deepEqual(Automerge.diff(s1, s2), [
        {obj, path: ['birds'], type: 'list', action: 'set',    index: 1, value: 'Pied Wagtail'},
        {obj, path: ['birds'], type: 'list', action: 'remove', index: 0}
      ])
    })

    it('should return object creation and linking information', () => {
      let s1 = Automerge.init()
      let s2 = Automerge.change(s1, doc => doc.birds = [{name: 'Chaffinch'}])
      let rootId = ROOT_ID
      assert.deepEqual(Automerge.diff(s1, s2), [
        {action: 'create', type: 'list', obj: Automerge.getObjectId(s2.birds)},
        {action: 'create', type: 'map',  obj: Automerge.getObjectId(s2.birds[0])},
        {action: 'set',    type: 'map',  obj: Automerge.getObjectId(s2.birds[0]), path: null, key: 'name',  value: 'Chaffinch'},
        {action: 'insert', type: 'list', obj: Automerge.getObjectId(s2.birds),    path: null, index: 0,     value: Automerge.getObjectId(s2.birds[0]), link: true, elemId: `${Automerge.getActorId(s2)}:1`},
        {action: 'set',    type: 'map',  obj: rootId,                             path: [],   key: 'birds', value: Automerge.getObjectId(s2.birds),    link: true}
      ])
    })

    it('should include the path to the modified object', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = [{name: 'Chaffinch', habitat: ['woodland']}])
      let s2 = Automerge.change(s1, doc => doc.birds[0].habitat.push('gardens'))
      assert.deepEqual(Automerge.diff(s1, s2), [{
        action: 'insert',
        type:   'list',
        obj:    Automerge.getObjectId(s2.birds[0].habitat),
        elemId: `${Automerge.getActorId(s2)}:2`,
        path:   ['birds', 0, 'habitat'],
        index:  1,
        value:  'gardens'
      }])
    })
  })

  describe('changes API', () => {
    it('should return an empty list on an empty document', () => {
      let changes = Automerge.getAllChanges(Automerge.init())
      assert.deepEqual(changes, [])
    })

    it('should return an empty list when nothing changed', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['Chaffinch'])
      assert.deepEqual(Automerge.getChanges(s1, s1), [])
    })

    it('should do nothing when applying an empty list of changes', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['Chaffinch'])
      assert.deepEqual(Automerge.applyChanges(s1, []), s1)
    })

    it('should return all changes when compared to an empty document', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes = Automerge.getChanges(Automerge.init(), s2)
      assert.deepEqual(changes.map(c => c.message), ['Add Chaffinch', 'Add Bullfinch'])
    })

    it('should allow a document copy to be reconstructed from scratch', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes = Automerge.getAllChanges(s2)
      let s3 = Automerge.applyChanges(Automerge.init(), changes)
      assert.deepEqual(s3.birds, ['Chaffinch', 'Bullfinch'])
    })

    it('should return changes since the last given version', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes1 = Automerge.getAllChanges(s1)
      let changes2 = Automerge.getChanges(s1, s2)
      assert.deepEqual(changes1.map(c => c.message), ['Add Chaffinch'])
      assert.deepEqual(changes2.map(c => c.message), ['Add Bullfinch'])
    })

    it('should incrementally apply changes since the last given version', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes1 = Automerge.getAllChanges(s1)
      let changes2 = Automerge.getChanges(s1, s2)
      let s3 = Automerge.applyChanges(Automerge.init(), changes1)
      let s4 = Automerge.applyChanges(s3, changes2)
      assert.deepEqual(s3.birds, ['Chaffinch'])
      assert.deepEqual(s4.birds, ['Chaffinch', 'Bullfinch'])
    })

    it('should report missing dependencies', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.merge(Automerge.init(), s1)
      s2 = Automerge.change(s2, doc => doc.birds.push('Bullfinch'))
      let changes = Automerge.getAllChanges(s2)
      let s3 = Automerge.applyChanges(Automerge.init(), [changes[1]])
      assert.deepEqual(s3, {})
      assert.deepEqual(Automerge.getMissingDeps(s3), {[Automerge.getActorId(s1)]: 1})
      s3 = Automerge.applyChanges(s3, [changes[0]])
      assert.deepEqual(s3.birds, ['Chaffinch', 'Bullfinch'])
      assert.deepEqual(Automerge.getMissingDeps(s3), {})
    })

    it('should report missing dependencies with out-of-order applyChanges', () => {
      let s0 = Automerge.init()
      let s1 = Automerge.change(s0, doc => doc.test = ['a'])
      let s2 = Automerge.change(s1, doc => doc.test = ['b'])
      let s3 = Automerge.change(s2, doc => doc.test = ['c'])
      let changes1to2 = Automerge.getChanges(s1, s2)
      let changes2to3 = Automerge.getChanges(s2, s3)
      let s4 = Automerge.init()
      let s5 = Automerge.applyChanges(s4, changes2to3)
      let s6 = Automerge.applyChanges(s5, changes1to2)
      assert.deepEqual(Automerge.getMissingDeps(s6), {[Automerge.getActorId(s0)]: 2})
    })
  })
})
