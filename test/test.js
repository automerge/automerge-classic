const assert = require('assert')
const Automerge = require('../src/automerge')
const { equalsOneOf } = require('./helpers')

describe('Automerge', () => {
  describe('sequential use:', () => {
    let s1, s2
    beforeEach(() => {
      s1 = Automerge.init()
    })

    it('should initially be an empty map', () => {
      assert.deepEqual(s1, { _objectId: '00000000-0000-0000-0000-000000000000' })
    })

    it('should not mutate objects', () => {
      s2 = Automerge.change(s1, doc => doc.foo = 'bar')
      assert.strictEqual(s1.foo, undefined)
      assert.strictEqual(s2.foo, 'bar')
    })

    it('should not register any conflicts on repeated assignment', () => {
      assert.deepEqual(s1._conflicts, {})
      s1 = Automerge.change(s1, 'change', doc => doc.foo = 'one')
      assert.deepEqual(s1._conflicts, {})
      s1 = Automerge.change(s1, 'change', doc => doc.foo = 'two')
      assert.deepEqual(s1._conflicts, {})
    })

    describe('changes', () => {
      it('should group several changes', () => {
        s2 = Automerge.change(s1, 'change message', doc => {
          doc.first = 'one'
          assert.strictEqual(doc.first, 'one')
          doc.second = 'two'
          assert.deepEqual(doc, {
            _objectId: '00000000-0000-0000-0000-000000000000', first: 'one', second: 'two'
          })
        })
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000'})
        assert.deepEqual(s2, {
          _objectId: '00000000-0000-0000-0000-000000000000', first: 'one', second: 'two'
        })
      })

      it('should prevent mutations outside of a change block', () => {
        s2 = Automerge.change(s1, doc => doc.foo = 'bar')
        if (typeof window === 'object') {
          // Chrome and Firefox silently ignore modifications of a frozen object
          s2.foo = 'lemon'
          assert.strictEqual(s2.foo, 'bar')
          delete s2['foo']
          assert.strictEqual(s2.foo, 'bar')
          Automerge.change(s2, doc => {
            s2.foo = 'bar'
            assert.strictEqual(s2.foo, 'bar')
          })
        } else {
          // Node throws exceptions when trying to modify a frozen object
          assert.throws(() => { s2.foo = 'lemon' }, /Cannot assign to read only property/)
          assert.throws(() => { delete s2['foo'] }, /Cannot delete property/)
          assert.throws(() => { Automerge.change(s2, doc => s2.foo = 'bar') }, /Cannot assign to read only property/)
        }
        assert.throws(() => { Automerge.assign(s2, {x: 4}) }, /Automerge.assign requires a writable object/)
      })

      it('should allow repeated reading and writing of values', () => {
        s2 = Automerge.change(s1, 'change message', doc => {
          doc.counter = 1
          assert.strictEqual(doc.counter, 1)
          doc.counter += 1
          doc.counter += 1
          assert.strictEqual(doc.counter, 3)
        })
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000'})
        assert.deepEqual(s2, {_objectId: '00000000-0000-0000-0000-000000000000', counter: 3})
      })

      it('should not record conflicts when writing the same field several times within one change', () => {
        s1 = Automerge.change(s1, 'change message', doc => {
          doc.counter = 1
          doc.counter += 1
          doc.counter += 1
        })
        assert.strictEqual(s1.counter, 3)
        assert.deepEqual(s1._conflicts, {})
      })

      it('should sanity-check arguments', () => {
        s1 = Automerge.change(s1, doc => doc.nested = {})
        assert.throws(() => { Automerge.change({},        doc => doc.foo = 'bar') }, /must be the object to modify/)
        assert.throws(() => { Automerge.change(s1.nested, doc => doc.foo = 'bar') }, /must be the object to modify/)
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
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000', one: 1})
        assert.deepEqual(s2, {_objectId: '00000000-0000-0000-0000-000000000000', two: 2})
      })
    })

    describe('root object', () => {
      it('should handle single-property assignment', () => {
        s1 = Automerge.change(s1, 'set bar', doc => doc.foo = 'bar')
        s1 = Automerge.change(s1, 'set zap', doc => doc.zip = 'zap')
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.zip, 'zap')
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000', foo: 'bar', zip: 'zap'})
      })

      it('should handle multi-property assignment', () => {
        s1 = Automerge.change(s1, 'multi-assign', doc => {
          Automerge.assign(doc, {foo: 'bar', answer: 42})
        })
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.answer, 42)
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000', foo: 'bar', answer: 42})
      })

      it('should handle root property deletion', () => {
        s1 = Automerge.change(s1, 'set foo', doc => { doc.foo = 'bar'; doc.something = null })
        s1 = Automerge.change(s1, 'del foo', doc => { delete doc['foo'] })
        assert.strictEqual(s1.foo, undefined)
        assert.strictEqual(s1.something, null)
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000', something: null})
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
        assert.throws(() => {
          Automerge.change(s1, 'foo', doc => doc['_foo'] = 'x')
        }, /Map entries starting with underscore are not allowed/)
      })
    })

    describe('nested maps', () => {
      it('should assign a UUID to nested maps', () => {
        s1 = Automerge.change(s1, doc => { doc.nested = {} })
        assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s1.nested._objectId))
        assert.notEqual(s1.nested._objectId, '00000000-0000-0000-0000-000000000000')
        assert.deepEqual(s1, {
          _objectId: '00000000-0000-0000-0000-000000000000',
          nested: {_objectId: s1.nested._objectId}
        })
        assert.deepEqual(s1.nested, {_objectId: s1.nested._objectId})
      })

      it('should handle assignment of a nested property', () => {
        s1 = Automerge.change(s1, 'first change', doc => {
          doc.nested = {}
          doc.nested.foo = 'bar'
        })
        s1 = Automerge.change(s1, 'second change', doc => {
          doc.nested.one = 1
        })
        assert.deepEqual(s1, {
          _objectId: '00000000-0000-0000-0000-000000000000',
          nested: {_objectId: s1.nested._objectId, foo: 'bar', one: 1}
        })
        assert.deepEqual(s1.nested, {_objectId: s1.nested._objectId, foo: 'bar', one: 1})
        assert.strictEqual(s1.nested.foo, 'bar')
        assert.strictEqual(s1.nested['foo'], 'bar')
        assert.strictEqual(s1.nested.one, 1)
        assert.strictEqual(s1.nested['one'], 1)
      })

      it('should handle assignment of an object literal', () => {
        s1 = Automerge.change(s1, doc => {
          doc.textStyle = {bold: false, fontSize: 12}
        })
        assert.deepEqual(s1, {
          _objectId: '00000000-0000-0000-0000-000000000000',
          textStyle: {_objectId: s1.textStyle._objectId, bold: false, fontSize: 12}
        })
        assert.deepEqual(s1.textStyle, {_objectId: s1.textStyle._objectId, bold: false, fontSize: 12})
        assert.strictEqual(s1.textStyle.bold, false)
        assert.strictEqual(s1.textStyle.fontSize, 12)
      })

      it('should handle assignment of multiple nested properties', () => {
        s1 = Automerge.change(s1, doc => {
          doc['textStyle'] = {bold: false, fontSize: 12}
          Automerge.assign(doc.textStyle, {typeface: 'Optima', fontSize: 14})
        })
        assert.strictEqual(s1.textStyle.typeface, 'Optima')
        assert.strictEqual(s1.textStyle.bold, false)
        assert.strictEqual(s1.textStyle.fontSize, 14)
        assert.deepEqual(s1.textStyle, {
          _objectId: s1.textStyle._objectId, typeface: 'Optima', bold: false, fontSize: 14
        })
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = Automerge.change(s1, doc => {
          doc.a = {b: {c: {d: {e: {f: {g: 'h'}}}}}}
        })
        s1 = Automerge.change(s1, doc => {
          doc.a.b.c.d.e.f.i = 'j'
        })
        assert.deepEqual(s1, {
          _objectId: '00000000-0000-0000-0000-000000000000', a: {
            _objectId: s1.a._objectId, b: {
              _objectId: s1.a.b._objectId, c: {
                _objectId: s1.a.b.c._objectId, d: {
                  _objectId: s1.a.b.c.d._objectId, e: {
                    _objectId: s1.a.b.c.d.e._objectId, f: {
                      _objectId: s1.a.b.c.d.e.f._objectId,
                      g: 'h', i: 'j'}}}}}}})
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
          _objectId: s1.myPet._objectId, species: 'dog', legs: 4, breed: 'dachshund'
        })
        assert.strictEqual(s1.myPet.breed, 'dachshund')
        assert.deepEqual(s2.myPet, {
          _objectId: s2.myPet._objectId, species: 'koi', variety: '紅白',
          colors: {_objectId: s2.myPet.colors._objectId, red: true, white: true, black: false}
        })
        assert.strictEqual(s2.myPet.breed, undefined)
        assert.strictEqual(s2.myPet.variety, '紅白')
      })

      it('should allow fields to be changed between primitive and nested map', () => {
        s1 = Automerge.change(s1, doc => doc.color = '#ff7f00')
        assert.strictEqual(s1.color, '#ff7f00')
        s1 = Automerge.change(s1, doc => doc.color = {red: 255, green: 127, blue: 0})
        assert.deepEqual(s1.color, {_objectId: s1.color._objectId, red: 255, green: 127, blue: 0})
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
        assert.strictEqual(s1.position._objectId, s1.size._objectId)
      })

      it('should handle deletion of properties within a map', () => {
        s1 = Automerge.change(s1, 'set style', doc => {
          doc.textStyle = {typeface: 'Optima', bold: false, fontSize: 12}
        })
        s1 = Automerge.change(s1, 'non-bold', doc => delete doc.textStyle['bold'])
        assert.strictEqual(s1.textStyle.bold, undefined)
        assert.deepEqual(s1.textStyle, {_objectId: s1.textStyle._objectId, typeface: 'Optima', fontSize: 12})
      })

      it('should handle deletion of references to a map', () => {
        s1 = Automerge.change(s1, 'make rich text doc', doc => {
          Automerge.assign(doc, {title: 'Hello', textStyle: {typeface: 'Optima', fontSize: 12}})
        })
        s1 = Automerge.change(s1, doc => delete doc['textStyle'])
        assert.strictEqual(s1.textStyle, undefined)
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000', title: 'Hello'})
      })

      it('should validate field names', () => {
        s1 = Automerge.change(s1, doc => doc.nested = {})
        assert.throws(() => { Automerge.change(s1, doc => doc.nested[''] = 'x') }, /must not be an empty string/)
        assert.throws(() => { Automerge.change(s1, doc => doc.nested = {'': 'x'}) }, /must not be an empty string/)
        assert.throws(() => { Automerge.change(s1, doc => doc.nested._foo = 'x') }, /Map entries starting with underscore are not allowed/)
        assert.throws(() => { Automerge.change(s1, doc => doc.nested = {_foo: 'x'}) }, /Map entries starting with underscore are not allowed/)
      })
    })

    describe('lists', () => {
      it('should allow elements to be inserted', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = [])
        s1 = Automerge.change(s1, doc => doc.noodles.insertAt(0, 'udon', 'soba'))
        s1 = Automerge.change(s1, doc => doc.noodles.insertAt(1, 'ramen'))
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000', noodles: ['udon', 'ramen', 'soba']})
        assert.deepEqual(s1.noodles, ['udon', 'ramen', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'soba')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle assignment of a list literal', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000', noodles: ['udon', 'ramen', 'soba']})
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
        assert.throws(() => { Automerge.change(s1, doc => doc.japaneseFood[4] = 'ramen') }, /past the end of the list/)
      })

      it('should allow bulk assignment of multiple list indexes', () => {
        s1 = Automerge.change(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        s1 = Automerge.change(s1, doc => Automerge.assign(doc.noodles, {0: 'うどん', 2: 'そば'}))
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
        assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000', noodles: [
          {_objectId: s1.noodles[0]._objectId, type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']},
          {_objectId: s1.noodles[1]._objectId, type: 'udon', dishes: ['tempura udon']}
        ]})
        assert.deepEqual(s1.noodles[0], {
          _objectId: s1.noodles[0]._objectId, type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']
        })
        assert.deepEqual(s1.noodles[1], {
          _objectId: s1.noodles[1]._objectId, type: 'udon', dishes: ['tempura udon']
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
          _objectId: '00000000-0000-0000-0000-000000000000',
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
        assert.deepEqual(s1.noodles, ['udon', {_objectId: s1.noodles[1]._objectId, type: 'soba', options: ['hot', 'cold']}, 'ramen'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = ['hot soba', 'cold soba'])
        assert.deepEqual(s1.noodles, ['udon', ['hot soba', 'cold soba'], 'ramen'])
        s1 = Automerge.change(s1, doc => doc.noodles[1] = 'soba is the best')
        assert.deepEqual(s1.noodles, ['udon', 'soba is the best', 'ramen'])
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
          _objectId: '00000000-0000-0000-0000-000000000000',
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
      assert.deepEqual(s3, {_objectId: '00000000-0000-0000-0000-000000000000', foo: 'bar', hello: 'world' })
      assert.deepEqual(s3._conflicts, {})
    })

    it('should detect concurrent updates of the same field', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'one')
      s2 = Automerge.change(s2, doc => doc.field = 'two')
      s3 = Automerge.merge(s1, s2)
      if (s1._actorId > s2._actorId) {
        assert.deepEqual(s3, {_objectId: '00000000-0000-0000-0000-000000000000', field: 'one'})
        assert.deepEqual(s3._conflicts, {field: {[s2._actorId]: 'two'}})
      } else {
        assert.deepEqual(s3, {_objectId: '00000000-0000-0000-0000-000000000000', field: 'two'})
        assert.deepEqual(s3._conflicts, {field: {[s1._actorId]: 'one'}})
      }
    })

    it('should handle assignment conflicts of different types', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'string')
      s2 = Automerge.change(s2, doc => doc.field = ['list'])
      s3 = Automerge.change(s3, doc => doc.field = {thing: 'map'})
      s1 = Automerge.merge(Automerge.merge(s1, s2), s3)
      equalsOneOf(s1.field, 'string', ['list'], {_objectId: s3.field._objectId, thing: 'map'})
      if (s1.field === 'string') {
        assert.deepEqual(s1._conflicts, {field: {[s2._actorId]: ['list'], [s3._actorId]: {_objectId: s3.field._objectId, thing: 'map'}}})
      } else if (Automerge.equals(s1.field, ['list'])) {
        assert.deepEqual(s1._conflicts, {field: {[s1._actorId]: 'string', [s3._actorId]: {_objectId: s3.field._objectId, thing: 'map'}}})
      } else if (Automerge.equals(s1.field, {_objectId: s3.field._objectId, thing: 'map'})) {
        assert.deepEqual(s1._conflicts, {field: {[s1._actorId]: 'string', [s2._actorId]: ['list']}})
      } else {
        assert.fail(s1.field, 'string or list or map', 'not one of the expected values')
      }
    })

    it('should handle changes within a conflicting map field', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'string')
      s2 = Automerge.change(s2, doc => doc.field = {})
      s2 = Automerge.change(s2, doc => doc.field.innerKey = 42)
      s3 = Automerge.merge(s1, s2)
      equalsOneOf(s3.field, 'string', {_objectId: s2.field._objectId, innerKey: 42})
      if (s3.field === 'string') {
        assert.deepEqual(s3._conflicts, {field: {[s2._actorId]: {_objectId: s2.field._objectId, innerKey: 42}}})
      } else {
        assert.deepEqual(s3._conflicts, {field: {[s1._actorId]: 'string'}})
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
      equalsOneOf(s3.list,
        [{_objectId: s1.list[0]._objectId, map1: true, key: 1}],
        [{_objectId: s2.list[0]._objectId, map2: true, key: 2}]
      )
    })

    it('should not merge concurrently assigned nested maps', () => {
      s1 = Automerge.change(s1, doc => doc.config = {background: 'blue'})
      s2 = Automerge.change(s2, doc => doc.config = {logo_url: 'logo.png'})
      s3 = Automerge.merge(s1, s2)
      equalsOneOf(s3.config,
        {_objectId: s1.config._objectId, background: 'blue'},
        {_objectId: s2.config._objectId, logo_url: 'logo.png'}
      )
      if (s3.config.background === 'blue') {
        assert.deepEqual(s3._conflicts.config, {[s2._actorId]: {_objectId: s2.config._objectId, logo_url: 'logo.png'}})
      } else {
        assert.deepEqual(s3._conflicts.config, {[s1._actorId]: {_objectId: s1.config._objectId, background: 'blue'}})
      }
    })

    it('should clear conflicts after assigning a new value', () => {
      s1 = Automerge.change(s1, doc => doc.field = 'one')
      s2 = Automerge.change(s2, doc => doc.field = 'two')
      s3 = Automerge.merge(s1, s2)
      s3 = Automerge.change(s3, doc => doc.field = 'three')
      assert.deepEqual(s3, {_objectId: '00000000-0000-0000-0000-000000000000', field: 'three'})
      assert.deepEqual(s3._conflicts, {})
      s2 = Automerge.merge(s2, s3)
      assert.deepEqual(s2, {_objectId: '00000000-0000-0000-0000-000000000000', field: 'three'})
      assert.deepEqual(s2._conflicts, {})
    })

    it('should handle concurrent insertions at different list positions', () => {
      s1 = Automerge.change(s1, doc => doc.list = ['one', 'three'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.list.splice(1, 0, 'two'))
      s2 = Automerge.change(s2, doc => doc.list.push('four'))
      s3 = Automerge.merge(s1, s2)
      assert.deepEqual(s3, {
        _objectId: '00000000-0000-0000-0000-000000000000',
        list: ['one', 'two', 'three', 'four']
      })
      assert.deepEqual(s3._conflicts, {})
    })

    it('should handle concurrent insertions at the same list position', () => {
      s1 = Automerge.change(s1, doc => doc.birds = ['parakeet'])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.birds.push('starling'))
      s2 = Automerge.change(s2, doc => doc.birds.push('chaffinch'))
      s3 = Automerge.merge(s1, s2)
      equalsOneOf(s3.birds, ['parakeet', 'starling', 'chaffinch'], ['parakeet', 'chaffinch', 'starling'])
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
      assert.deepEqual(s1, {_objectId: '00000000-0000-0000-0000-000000000000'})
      assert.deepEqual(s2, {_objectId: '00000000-0000-0000-0000-000000000000', bestBird: 'magpie'})
      assert.deepEqual(s3, {_objectId: '00000000-0000-0000-0000-000000000000', bestBird: 'magpie'})
      assert.deepEqual(s3._conflicts, {})
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

    it('should handle concurrent updates at different levels of the tree', () => {
      // A delete higher up in the tree overrides an update in a subtree
      s1 = Automerge.change(s1, doc => doc.animals = {birds: {pink: 'flamingo', black: 'starling'}, mammals: ['badger']})
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.animals.birds.brown = 'sparrow')
      s2 = Automerge.change(s2, doc => delete doc.animals['birds'])
      s3 = Automerge.merge(s1, s2)
      assert.deepEqual(s1.animals, {
        _objectId: s1.animals._objectId,
        birds: {
          _objectId: s1.animals.birds._objectId,
          pink: 'flamingo', brown: 'sparrow', black: 'starling'
        },
        mammals: ['badger']
      })
      assert.deepEqual(s2.animals, {_objectId: s1.animals._objectId, mammals: ['badger']})
      assert.deepEqual(s3.animals, {_objectId: s1.animals._objectId, mammals: ['badger']})
    })

    it('should not interleave sequence insertions at the same position', () => {
      s1 = Automerge.change(s1, doc => doc.wisdom = [])
      s2 = Automerge.merge(s2, s1)
      s1 = Automerge.change(s1, doc => doc.wisdom.push('to', 'be', 'is', 'to', 'do'))
      s2 = Automerge.change(s2, doc => doc.wisdom.push('to', 'do', 'is', 'to', 'be'))
      s3 = Automerge.merge(s1, s2)
      equalsOneOf(s3.wisdom,
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
                       {_objectId: '00000000-0000-0000-0000-000000000000',
                        config: {_objectId: s.config._objectId, background: 'blue'}},
                       {_objectId: '00000000-0000-0000-0000-000000000000',
                        config: {_objectId: s.config._objectId, background: 'blue'},
                        birds: ['mallard']},
                       {_objectId: '00000000-0000-0000-0000-000000000000',
                        config: {_objectId: s.config._objectId, background: 'blue'},
                        birds: ['oystercatcher', 'mallard']}])
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
      assert.deepEqual(Automerge.diff(s1, s2), [
        {obj: s1.birds._objectId, type: 'list', action: 'insert', index: 0, value: 'Robin'}
      ])
      assert.deepEqual(Automerge.diff(s1, s3), [
        {obj: s1.birds._objectId, type: 'list', action: 'insert', index: 0, value: 'Robin'},
        {obj: s1.birds._objectId, type: 'list', action: 'insert', index: 1, value: 'Wagtail'}
      ])
    })

    it('should return list deletions by index', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.birds = ['Robin', 'Wagtail'])
      let s2 = Automerge.change(s1, doc => { doc.birds[1] = 'Pied Wagtail'; doc.birds.shift() })
      assert.deepEqual(Automerge.diff(s1, s2), [
        {obj: s1.birds._objectId, type: 'list', action: 'set',    index: 1, value: 'Pied Wagtail'},
        {obj: s1.birds._objectId, type: 'list', action: 'remove', index: 0}
      ])
    })

    it('should return object creation and linking information', () => {
      let s1 = Automerge.init()
      let s2 = Automerge.change(s1, doc => doc.birds = [{name: 'Chaffinch'}])
      let rootId = '00000000-0000-0000-0000-000000000000'
      assert.deepEqual(Automerge.diff(s1, s2), [
        {action: 'create', type: 'list', obj: s2.birds._objectId},
        {action: 'create', type: 'map',  obj: s2.birds[0]._objectId},
        {action: 'set',    type: 'map',  obj: s2.birds[0]._objectId, key: 'name',  value: 'Chaffinch'},
        {action: 'insert', type: 'list', obj: s2.birds._objectId,    index: 0,     value: s2.birds[0]._objectId, link: true},
        {action: 'set',    type: 'map',  obj: rootId,                key: 'birds', value: s2.birds._objectId,    link: true}
      ])
    })
  })

  describe('changes API', () => {
    it('should return an empty list on an empty document', () => {
      let changes = Automerge.getChanges(Automerge.init(), Automerge.init())
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
      let changes = Automerge.getChanges(Automerge.init(), s2)
      let s3 = Automerge.applyChanges(Automerge.init(), changes)
      assert.deepEqual(s3.birds, ['Chaffinch', 'Bullfinch'])
    })

    it('should return changes since the last given version', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes1 = Automerge.getChanges(Automerge.init(), s1)
      let changes2 = Automerge.getChanges(s1, s2)
      assert.deepEqual(changes1.map(c => c.message), ['Add Chaffinch'])
      assert.deepEqual(changes2.map(c => c.message), ['Add Bullfinch'])
    })

    it('should incrementally apply changes since the last given version', () => {
      let s1 = Automerge.change(Automerge.init(), 'Add Chaffinch', doc => doc.birds = ['Chaffinch'])
      let s2 = Automerge.change(s1, 'Add Bullfinch', doc => doc.birds.push('Bullfinch'))
      let changes1 = Automerge.getChanges(Automerge.init(), s1)
      let changes2 = Automerge.getChanges(s1, s2)
      let s3 = Automerge.applyChanges(Automerge.init(), changes1)
      let s4 = Automerge.applyChanges(s3, changes2)
      assert.deepEqual(s3.birds, ['Chaffinch'])
      assert.deepEqual(s4.birds, ['Chaffinch', 'Bullfinch'])
    })
  })
})
