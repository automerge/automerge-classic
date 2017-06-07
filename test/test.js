const assert = require('assert')
const tesseract = require('../src/tesseract')

describe('Tesseract', () => {
  describe('sequential use:', () => {
    let s1, s2
    beforeEach(() => {
      s1 = tesseract.init()
    })

    it('should initially be an empty map', () => {
      assert.deepEqual(s1, {})
    })

    it('should not mutate objects', () => {
      s2 = tesseract.changeset(s1, doc => doc.foo = 'bar')
      assert.strictEqual(s1.foo, undefined)
      assert.strictEqual(s2.foo, 'bar')
    })

    it('should not register any conflicts on repeated assignment', () => {
      assert.deepEqual(s1._conflicts, {})
      s1 = tesseract.changeset(s1, 'change', doc => doc.foo = 'one')
      assert.deepEqual(s1._conflicts, {})
      s1 = tesseract.changeset(s1, 'change', doc => doc.foo = 'two')
      assert.deepEqual(s1._conflicts, {})
    })

    describe('changesets', () => {
      it('should group several changes', () => {
        s2 = tesseract.changeset(s1, 'changeset message', doc => {
          doc.first = 'one'
          assert.strictEqual(doc.first, 'one')
          doc.second = 'two'
          assert.deepEqual(doc, {first: 'one', second: 'two'})
        })
        assert.deepEqual(s1, {})
        assert.deepEqual(s2, {first: 'one', second: 'two'})
      })

      it('should prevent mutations outside of a changeset block', () => {
        s2 = tesseract.changeset(s1, doc => doc.foo = 'bar')
        assert.throws(() => { s2.foo = 'lemon' }, /this object is read-only/)
        assert.throws(() => { delete s2['foo'] }, /this object is read-only/)
        assert.throws(() => { tesseract.changeset(s2, doc => s2.foo = 'bar') }, /this object is read-only/)
        assert.throws(() => { tesseract.assign(s2, {x: 4}) }, /tesseract.assign requires a writable object/)
      })

      it('should allow repeated reading and writing of values', () => {
        s2 = tesseract.changeset(s1, 'changeset message', doc => {
          doc.counter = 1
          assert.strictEqual(doc.counter, 1)
          doc.counter += 1
          doc.counter += 1
          assert.strictEqual(doc.counter, 3)
        })
        assert.deepEqual(s1, {})
        assert.deepEqual(s2, {counter: 3})
      })

      it('should sanity-check arguments', () => {
        s1 = tesseract.changeset(s1, doc => doc.nested = {})
        assert.throws(() => { tesseract.changeset({},        doc => doc.foo = 'bar') }, /must be the object to modify/)
        assert.throws(() => { tesseract.changeset(s1.nested, doc => doc.foo = 'bar') }, /must be the document root/)
      })

      it('should not allow nested changeset blocks', () => {
        assert.throws(() => {
          tesseract.changeset(s1, doc1 => {
            tesseract.changeset(doc1, doc2 => {
              doc2.foo = 'bar'
            })
          })
        }, /Calls to tesseract.changeset cannot be nested/)
      })

      it('should not interfere with each other when forking', () => {
        s1 = tesseract.changeset(s1, doc1 => {
          s2 = tesseract.changeset(s1, doc2 => doc2.two = 2)
          doc1.one = 1
        })
        assert.deepEqual(s1, {one: 1})
        assert.deepEqual(s2, {two: 2})
      })
    })

    describe('root object', () => {
      it('should handle single-property assignment', () => {
        s1 = tesseract.changeset(s1, 'set bar', doc => doc.foo = 'bar')
        s1 = tesseract.changeset(s1, 'set zap', doc => doc.zip = 'zap')
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.zip, 'zap')
        assert.deepEqual(s1, {'foo': 'bar', 'zip': 'zap'})
      })

      it('should handle multi-property assignment', () => {
        s1 = tesseract.changeset(s1, 'multi-assign', doc => {
          tesseract.assign(doc, {foo: 'bar', answer: 42})
        })
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.answer, 42)
        assert.deepEqual(s1, {'foo': 'bar', 'answer': 42})
      })

      it('should handle root property deletion', () => {
        s1 = tesseract.changeset(s1, 'set foo', doc => { doc.foo = 'bar'; doc.something = null })
        s1 = tesseract.changeset(s1, 'del foo', doc => { delete doc['foo'] })
        assert.strictEqual(s1.foo, undefined)
        assert.strictEqual(s1.something, null)
        assert.deepEqual(s1, {something: null})
      })

      it('should allow the type of a property to be changed', () => {
        s1 = tesseract.changeset(s1, 'set number', doc => doc.prop = 123)
        assert.strictEqual(s1.prop, 123)
        s1 = tesseract.changeset(s1, 'set string', doc => doc.prop = '123')
        assert.strictEqual(s1.prop, '123')
        s1 = tesseract.changeset(s1, 'set null', doc => doc.prop = null)
        assert.strictEqual(s1.prop, null)
        s1 = tesseract.changeset(s1, 'set bool', doc => doc.prop = true)
        assert.strictEqual(s1.prop, true)
      })

      it('should require property names to be valid', () => {
        assert.throws(() => {
          tesseract.changeset(s1, 'foo', doc => doc[''] = 'x')
        }, /must not be an empty string/)
        assert.throws(() => {
          tesseract.changeset(s1, 'foo', doc => doc['_foo'] = 'x')
        }, /Map entries starting with underscore are not allowed/)
      })
    })

    describe('nested maps', () => {
      it('should assign a UUID to nested maps', () => {
        s1 = tesseract.changeset(s1, doc => { doc.nested = {} })
        assert.deepEqual(s1, {nested: {}})
        assert.deepEqual(s1.nested, {})
        assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s1.nested._id))
        assert.notEqual(s1.nested._id, '00000000-0000-0000-0000-000000000000')
      })

      it('should handle assignment of a nested property', () => {
        s1 = tesseract.changeset(s1, 'first change', doc => {
          doc.nested = {}
          doc.nested.foo = 'bar'
        })
        s1 = tesseract.changeset(s1, 'second change', doc => {
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
        s1 = tesseract.changeset(s1, doc => {
          doc.textStyle = {bold: false, fontSize: 12}
        })
        assert.deepEqual(s1, {textStyle: {bold: false, fontSize: 12}})
        assert.deepEqual(s1.textStyle, {bold: false, fontSize: 12})
        assert.strictEqual(s1.textStyle.bold, false)
        assert.strictEqual(s1.textStyle.fontSize, 12)
      })

      it('should handle assignment of multiple nested properties', () => {
        s1 = tesseract.changeset(s1, doc => {
          doc['textStyle'] = {bold: false, fontSize: 12}
          tesseract.assign(doc.textStyle, {typeface: 'Optima', fontSize: 14})
        })
        assert.strictEqual(s1.textStyle.typeface, 'Optima')
        assert.strictEqual(s1.textStyle.bold, false)
        assert.strictEqual(s1.textStyle.fontSize, 14)
        assert.deepEqual(s1, {textStyle: {typeface: 'Optima', bold: false, fontSize: 14}})
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = tesseract.changeset(s1, doc => {
          doc.a = {b: {c: {d: {e: {f: {g: 'h'}}}}}}
        })
        s1 = tesseract.changeset(s1, doc => {
          doc.a.b.c.d.e.f.i = 'j'
        })
        assert.deepEqual(s1, {a: {b: {c: {d: {e: {f: {g: 'h', i: 'j'}}}}}}})
        assert.strictEqual(s1.a.b.c.d.e.f.g, 'h')
        assert.strictEqual(s1.a.b.c.d.e.f.i, 'j')
      })

      it('should allow an old object to be replaced with a new one', () => {
        s1 = tesseract.changeset(s1, 'change 1', doc => {
          doc.myPet = {species: 'dog', legs: 4, breed: 'dachshund'}
        })
        s2 = tesseract.changeset(s1, 'change 2', doc => {
          doc.myPet = {species: 'koi', variety: '紅白', colors: {red: true, white: true, black: false}}
        })
        assert.deepEqual(s1, {myPet: {species: 'dog', legs: 4, breed: 'dachshund'}})
        assert.strictEqual(s1.myPet.breed, 'dachshund')
        assert.deepEqual(s2, {myPet: {species: 'koi', variety: '紅白', colors: {red: true, white: true, black: false}}})
        assert.strictEqual(s2.myPet.breed, undefined)
        assert.strictEqual(s2.myPet.variety, '紅白')
      })

      it('should allow fields to be changed between primitive and nested map', () => {
        s1 = tesseract.changeset(s1, doc => doc.color = '#ff7f00')
        assert.deepEqual(s1.color, '#ff7f00')
        s1 = tesseract.changeset(s1, doc => doc.color = {red: 255, green: 127, blue: 0})
        assert.deepEqual(s1.color, {red: 255, green: 127, blue: 0})
        s1 = tesseract.changeset(s1, doc => doc.color = '#ff7f00')
        assert.deepEqual(s1.color, '#ff7f00')
      })

      it('should allow several references to the same map object', () => {
        s1 = tesseract.changeset(s1, 'create object', doc => {
          doc.position = {x: 1, y: 1}
          doc.size = doc.position
        })
        s2 = tesseract.changeset(s1, 'update y', doc => doc.position.y = 2)
        assert.strictEqual(s1.size.y, 1)
        assert.strictEqual(s2.size.y, 2)
        assert.strictEqual(s1.position._id, s1.size._id)
      })

      it('should handle deletion of properties within a map', () => {
        s1 = tesseract.changeset(s1, 'set style', doc => {
          doc.textStyle = {typeface: 'Optima', bold: false, fontSize: 12}
        })
        s1 = tesseract.changeset(s1, 'non-bold', doc => delete doc.textStyle['bold'])
        assert.strictEqual(s1.textStyle.bold, undefined)
        assert.deepEqual(s1, {textStyle: {typeface: 'Optima', fontSize: 12}})
      })

      it('should handle deletion of references to a map', () => {
        s1 = tesseract.changeset(s1, 'make rich text doc', doc => {
          tesseract.assign(doc, {title: 'Hello', textStyle: {typeface: 'Optima', fontSize: 12}})
        })
        s1 = tesseract.changeset(s1, doc => delete doc['textStyle'])
        assert.strictEqual(s1.textStyle, undefined)
        assert.deepEqual(s1, {title: 'Hello'})
      })

      it('should validate field names', () => {
        s1 = tesseract.changeset(s1, doc => doc.nested = {})
        assert.throws(() => { tesseract.changeset(s1, doc => doc.nested[''] = 'x') }, /must not be an empty string/)
        assert.throws(() => { tesseract.changeset(s1, doc => doc.nested = {'': 'x'}) }, /must not be an empty string/)
        assert.throws(() => { tesseract.changeset(s1, doc => doc.nested._foo = 'x') }, /Map entries starting with underscore are not allowed/)
        assert.throws(() => { tesseract.changeset(s1, doc => doc.nested = {_foo: 'x'}) }, /Map entries starting with underscore are not allowed/)
      })
    })

    describe('lists', () => {
      it('should assign a UUID to nested lists', () => {
        s1 = tesseract.changeset(s1, doc => doc.list = [])
        assert.deepEqual(s1, {list: []})
        assert.deepEqual(s1.list, [])
        assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s1.list._id))
        assert.notEqual(s1.list._id, '00000000-0000-0000-0000-000000000000')
      })

      it('should have a length property', () => {
        s1 = tesseract.changeset(s1, doc => doc.list = [])
        assert.strictEqual(s1.list.length, 0)
        s1 = tesseract.changeset(s1, doc => doc.list.push('zero'))
        assert.strictEqual(s1.list.length, 1)
        s1 = tesseract.changeset(s1, doc => doc.list.push('one'))
        assert.strictEqual(s1.list.length, 2)
      })

      it('should insert new elements at the beginning', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = [])
        s1 = tesseract.changeset(s1, doc => doc.noodles.unshift('udon'))
        s1 = tesseract.changeset(s1, doc => doc.noodles.unshift('soba'))
        s1 = tesseract.changeset(s1, doc => doc.noodles.unshift('ramen'))
        assert.deepEqual(s1, {noodles: ['ramen', 'soba', 'udon']})
        assert.deepEqual(s1.noodles, ['ramen', 'soba', 'udon'])
        assert.strictEqual(s1.noodles[0], 'ramen')
        assert.strictEqual(s1.noodles[1], 'soba')
        assert.strictEqual(s1.noodles[2], 'udon')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should insert new elements at the end', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = [])
        s1 = tesseract.changeset(s1, doc => doc.noodles.push('udon'))
        s1 = tesseract.changeset(s1, doc => doc.noodles.push('soba'))
        s1 = tesseract.changeset(s1, doc => doc.noodles.push('ramen'))
        assert.deepEqual(s1, {noodles: ['udon', 'soba', 'ramen']})
        assert.deepEqual(s1.noodles, ['udon', 'soba', 'ramen'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'soba')
        assert.strictEqual(s1.noodles[2], 'ramen')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should insert new elements in the middle', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = [])
        s1 = tesseract.changeset(s1, doc => doc.noodles.push('udon', 'soba'))
        s1 = tesseract.changeset(s1, doc => doc.noodles.splice(1, 0, 'ramen'))
        assert.deepEqual(s1, {noodles: ['udon', 'ramen', 'soba']})
        assert.deepEqual(s1.noodles, ['udon', 'ramen', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'soba')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle assignment of a list literal', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        assert.deepEqual(s1, {noodles: ['udon', 'ramen', 'soba']})
        assert.deepEqual(s1.noodles, ['udon', 'ramen', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'soba')
        assert.strictEqual(s1.noodles[3], undefined)
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should only allow numeric indexes', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        s1 = tesseract.changeset(s1, doc => doc.noodles[1] = 'Ramen!')
        assert.strictEqual(s1.noodles[1], 'Ramen!')
        s1 = tesseract.changeset(s1, doc => doc.noodles['1'] = 'RAMEN!!!')
        assert.strictEqual(s1.noodles[1], 'RAMEN!!!')
        assert.throws(() => { tesseract.changeset(s1, doc => doc.noodles['favourite'] = 'udon') }, /list index must be a number/)
        assert.throws(() => { tesseract.changeset(s1, doc => doc.noodles[''         ] = 'udon') }, /list index must be a number/)
        assert.throws(() => { tesseract.changeset(s1, doc => doc.noodles['1e6'      ] = 'udon') }, /list index must be a number/)
      })

      it('should handle deletion of list elements', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        s1 = tesseract.changeset(s1, doc => delete doc.noodles[1])
        assert.deepEqual(s1, {noodles: ['udon', 'soba']})
        s1 = tesseract.changeset(s1, doc => doc.noodles.splice(1, 1))
        assert.deepEqual(s1, {noodles: ['udon']})
        assert.deepEqual(s1.noodles, ['udon'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], undefined)
        assert.strictEqual(s1.noodles[2], undefined)
        assert.strictEqual(s1.noodles.length, 1)
      })

      it('should handle assignment of individual list indexes', () => {
        s1 = tesseract.changeset(s1, doc => doc.japaneseFood = ['udon', 'ramen', 'soba'])
        s1 = tesseract.changeset(s1, doc => doc.japaneseFood[1] = 'sushi')
        assert.deepEqual(s1, {japaneseFood: ['udon', 'sushi', 'soba']})
        assert.deepEqual(s1.japaneseFood, ['udon', 'sushi', 'soba'])
        assert.strictEqual(s1.japaneseFood[0], 'udon')
        assert.strictEqual(s1.japaneseFood[1], 'sushi')
        assert.strictEqual(s1.japaneseFood[2], 'soba')
        assert.strictEqual(s1.japaneseFood[3], undefined)
        assert.strictEqual(s1.japaneseFood.length, 3)
      })

      it('should treat out-by-one assignment as insertion', () => {
        s1 = tesseract.changeset(s1, doc => doc.japaneseFood = ['udon'])
        s1 = tesseract.changeset(s1, doc => doc.japaneseFood[1] = 'sushi')
        assert.deepEqual(s1, {japaneseFood: ['udon', 'sushi']})
        assert.deepEqual(s1.japaneseFood, ['udon', 'sushi'])
        assert.strictEqual(s1.japaneseFood[0], 'udon')
        assert.strictEqual(s1.japaneseFood[1], 'sushi')
        assert.strictEqual(s1.japaneseFood[2], undefined)
        assert.strictEqual(s1.japaneseFood.length, 2)
      })

      it('should not allow out-of-range assignment', () => {
        s1 = tesseract.changeset(s1, doc => doc.japaneseFood = ['udon'])
        assert.throws(() => { tesseract.changeset(s1, doc => doc.japaneseFood[4] = 'ramen') }, /past the end of the list/)
      })

      it('should allow bulk assignment of multiple list indexes', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = ['udon', 'ramen', 'soba'])
        s1 = tesseract.changeset(s1, doc => tesseract.assign(doc.noodles, {0: 'うどん', 2: 'そば'}))
        assert.deepEqual(s1, {noodles: ['うどん', 'ramen', 'そば']})
        assert.strictEqual(s1.noodles[0], 'うどん')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'そば')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle nested objects', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = [{type: 'ramen', dishes: ['tonkotsu', 'shoyu']}])
        s1 = tesseract.changeset(s1, doc => doc.noodles.push({type: 'udon', dishes: ['tempura udon']}))
        s1 = tesseract.changeset(s1, doc => doc.noodles[0].dishes.push('miso'))
        assert.deepEqual(s1, {noodles: [
          {type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']},
          {type: 'udon', dishes: ['tempura udon']}
        ]})
        assert.deepEqual(s1.noodles[0], {type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']})
        assert.deepEqual(s1.noodles[1], {type: 'udon', dishes: ['tempura udon']})
      })

      it('should handle nested lists', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodleMatrix = [['ramen', 'tonkotsu', 'shoyu']])
        s1 = tesseract.changeset(s1, doc => doc.noodleMatrix.push(['udon', 'tempura udon']))
        s1 = tesseract.changeset(s1, doc => doc.noodleMatrix[0].push('miso'))
        assert.deepEqual(s1, {noodleMatrix: [['ramen', 'tonkotsu', 'shoyu', 'miso'], ['udon', 'tempura udon']]})
        assert.deepEqual(s1.noodleMatrix[0], ['ramen', 'tonkotsu', 'shoyu', 'miso'])
        assert.deepEqual(s1.noodleMatrix[1], ['udon', 'tempura udon'])
      })

      it('should handle replacement of the entire list', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = ['udon', 'soba', 'ramen'])
        s1 = tesseract.changeset(s1, doc => doc.japaneseNoodles = doc.noodles)
        s1 = tesseract.changeset(s1, doc => doc.noodles = ['wonton', 'pho'])
        assert.deepEqual(s1, {noodles: ['wonton', 'pho'], japaneseNoodles: ['udon', 'soba', 'ramen']})
        assert.deepEqual(s1.noodles, ['wonton', 'pho'])
        assert.strictEqual(s1.noodles[0], 'wonton')
        assert.strictEqual(s1.noodles[1], 'pho')
        assert.strictEqual(s1.noodles[2], undefined)
        assert.strictEqual(s1.noodles.length, 2)
      })

      it('should allow assignment to change the type of a list element', () => {
        s1 = tesseract.changeset(s1, doc => doc.noodles = ['udon', 'soba', 'ramen'])
        assert.deepEqual(s1, {noodles: ['udon', 'soba', 'ramen']})
        s1 = tesseract.changeset(s1, doc => doc.noodles[1] = {type: 'soba', options: ['hot', 'cold']})
        assert.deepEqual(s1, {noodles: ['udon', {type: 'soba', options: ['hot', 'cold']}, 'ramen']})
        s1 = tesseract.changeset(s1, doc => doc.noodles[1] = ['hot soba', 'cold soba'])
        assert.deepEqual(s1, {noodles: ['udon', ['hot soba', 'cold soba'], 'ramen']})
        s1 = tesseract.changeset(s1, doc => doc.noodles[1] = 'soba is the best')
        assert.deepEqual(s1, {noodles: ['udon', 'soba is the best', 'ramen']})
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = tesseract.changeset(s1, doc => doc.maze = [[[[[[[['noodles', ['here']]]]]]]]])
        s1 = tesseract.changeset(s1, doc => doc.maze[0][0][0][0][0][0][0][1].unshift('found'))
        assert.deepEqual(s1, {maze: [[[[[[[['noodles', ['found', 'here']]]]]]]]]})
        assert.deepEqual(s1.maze[0][0][0][0][0][0][0][1][1], 'here')
      })

      it('should allow several references to the same list object', () => {
        s1 = tesseract.changeset(s1, doc => doc.japaneseNoodles = ['udon', 'soba'])
        s1 = tesseract.changeset(s1, doc => doc.theBestNoodles = s1.japaneseNoodles)
        s1 = tesseract.changeset(s1, doc => doc.theBestNoodles.push('ramen'))
        assert.deepEqual(s1, {japaneseNoodles: ['udon', 'soba', 'ramen'], theBestNoodles: ['udon', 'soba', 'ramen']})
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
      s1 = tesseract.init()
      s2 = tesseract.init()
      s3 = tesseract.init()
    })

    it('should merge concurrent updates of different properties', () => {
      s1 = tesseract.changeset(s1, doc => doc.foo = 'bar')
      s2 = tesseract.changeset(s2, doc => doc.hello = 'world')
      s3 = tesseract.merge(s1, s2)
      assert.strictEqual(s3.foo, 'bar')
      assert.strictEqual(s3.hello, 'world')
      assert.deepEqual(s3, {'foo': 'bar', 'hello': 'world' })
    })

    it('should allow nested objects', () => {
      s1 = tesseract.changeset(s1, doc => doc.foo = {'hello': 'world'})
      assert.deepEqual(s1, {'foo': {'hello': 'world' }})
      s2 = tesseract.changeset(s2, doc => doc.aaa = {'bbb': 'ccc'})
      assert.deepEqual(s2, {'aaa': {'bbb': 'ccc'}})
      s3 = tesseract.merge(s3, s2)
      s3 = tesseract.merge(s3, s1)
      assert.deepEqual(s3, {'foo': {'hello': 'world'}, 'aaa': {'bbb': 'ccc'}})
      s3 = tesseract.changeset(s3, doc => doc.foo.key = 'val')
      assert.deepEqual(s3, {'foo': {'key': 'val', 'hello': 'world'}, 'aaa': {'bbb': 'ccc'}})
    })
  })

  describe('network communication API', () => {
    let s1, s2, s3
    beforeEach(() => {
      s1 = tesseract.init()
      s2 = tesseract.init()
      s3 = tesseract.init()
    })

    it('should do nothing when the store is empty', () => {
      assert.deepEqual(tesseract.getVClock(s1), {})
      assert.deepEqual(tesseract.getDeltasAfter(s2, tesseract.getVClock(s1)), [])
      assert.deepEqual(tesseract.applyDeltas(s1, []), {})
    })

    it('should generate deltas representing changes', () => {
      s1 = tesseract.changeset(s1, 'change 1', doc => doc.s1 = 's1')
      s2 = tesseract.changeset(s2, 'change 2', doc => doc.s2 = 's2')
      assert.deepEqual(tesseract.getVClock(s1), {[s1._actor_id]: 1})
      assert.deepEqual(tesseract.getVClock(s2), {[s2._actor_id]: 1})
      const delta1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      const delta2 = tesseract.getDeltasAfter(s2, tesseract.getVClock(s1))
      assert.deepEqual(delta1, [{
        actor: s1._actor_id, clock: {[s1._actor_id]: 1}, message: 'change 1',
        ops: [{action: 'set', obj: '00000000-0000-0000-0000-000000000000', key: 's1', value: 's1'}]
      }])
      assert.deepEqual(delta2, [{
        actor: s2._actor_id, clock: {[s2._actor_id]: 1}, message: 'change 2',
        ops: [{action: 'set', obj: '00000000-0000-0000-0000-000000000000', key: 's2', value: 's2'}]
      }])
      s1 = tesseract.applyDeltas(s1, delta2)
      s2 = tesseract.applyDeltas(s2, delta1)
      assert.deepEqual(s1, {s1: 's1', s2: 's2'})
      assert.deepEqual(s2, {s1: 's1', s2: 's2'})
    })

    it('should set the local sequence number after loading from file', () => {
      s1 = tesseract.changeset(s1, 'yay bananas', doc => doc.bestFruit = 'banana')
      s2 = tesseract.load(tesseract.save(s1))
      s2 = tesseract.changeset(s2, 'omg pineapples', doc => doc.bestFruit = 'pineapple')
      const deltas = tesseract.getDeltasAfter(s2, tesseract.getVClock(s1))
      assert.deepEqual(deltas, [{
        actor: s2._actor_id, clock: {[s1._actor_id]: 1, [s2._actor_id]: 1}, message: 'omg pineapples',
        ops: [{action: 'set', obj: '00000000-0000-0000-0000-000000000000', key: 'bestFruit', value: 'pineapple'}]
      }])
    })

    it('should determine deltas missing from other stores', () => {
      s1 = tesseract.changeset(s1, doc => doc.cheeses = ['Comté', 'Stilton'])
      s2 = tesseract.merge(s2, s1)
      s2 = tesseract.changeset(s2, doc => doc.cheeses.push('Mozzarella'))
      s1 = tesseract.merge(s1, s2)
      s1 = tesseract.changeset(s1, doc => doc.cheeses.splice(2, 1))
      s2 = tesseract.changeset(s2, doc => doc.cheeses.splice(1, 0, 'Jarlsberg'))
      const delta1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      const delta2 = tesseract.getDeltasAfter(s2, tesseract.getVClock(s1))
      assert.deepEqual(delta1.map(d => d.ops.map(op => op.action)), [['del']])
      assert.deepEqual(delta2.map(d => d.ops.map(op => op.action)), [['ins', 'set']])
      assert.strictEqual(delta2[0].ops[1].value, 'Jarlsberg')
    })

    it('should ignore duplicate deliveries', () => {
      s1 = tesseract.changeset(s1, doc => doc.cheeses = [])
      s2 = tesseract.merge(s2, s1)
      s1 = tesseract.changeset(s1, doc => doc.cheeses.unshift('Wensleydale'))
      const delta1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      s2 = tesseract.applyDeltas(s2, delta1)
      assert.deepEqual(s2, {cheeses: ['Wensleydale']})
      s2 = tesseract.applyDeltas(s2, delta1)
      assert.deepEqual(s2, {cheeses: ['Wensleydale']})
    })

    it('should handle out-of-order delivery', () => {
      s1 = tesseract.changeset(s1, doc => doc.score = 1)
      s1 = tesseract.changeset(s1, doc => doc.score = 2)
      const delta1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      assert.deepEqual(delta1.map(d => d.ops.map(op => op.action)), [['set'], ['set']])
      assert.deepEqual(delta1.map(d => d.ops.map(op => op.value)), [[1], [2]])
      s2 = tesseract.applyDeltas(s2, [delta1[1]])
      assert.deepEqual(s2, {})
      s2 = tesseract.applyDeltas(s2, [delta1[0]])
      assert.deepEqual(s2, {score: 2})
    })

    it('should buffer actions until causally ready', () => {
      s1 = tesseract.changeset(s1, doc => doc.cheeses = [])
      s2 = tesseract.merge(s2, s1)
      s3 = tesseract.merge(s3, s1)
      s1 = tesseract.changeset(s1, doc => doc.cheeses.push('Paneer'))
      const delta1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      assert.deepEqual(delta1.map(d => d.ops.map(op => op.action)), [['ins', 'set']])
      assert.strictEqual(delta1[0].ops[1].value, 'Paneer')
      s2 = tesseract.merge(s2, s1)
      s2 = tesseract.changeset(s2, doc => doc.cheeses.push('Feta'))
      const delta2 = tesseract.getDeltasAfter(s2, tesseract.getVClock(s1))
      assert.deepEqual(delta2.map(d => d.ops.map(op => op.action)), [['ins', 'set']])
      assert.strictEqual(delta2[0].ops[1].value, 'Feta')
      s3 = tesseract.applyDeltas(s3, delta2)
      assert.deepEqual(s3, {cheeses: []})
      s3 = tesseract.applyDeltas(s3, delta1)
      assert.deepEqual(s3, {cheeses: ['Paneer', 'Feta']})
    })
  })
})
