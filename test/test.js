const assert = require('assert')
const tesseract = require('../src/tesseract')

describe('Tesseract', () => {
  describe('sequential use', () => {
    let s1, s2
    beforeEach(() => {
      s1 = tesseract.init()
    })

    it('should initially be an empty map', () => {
      assert.deepEqual(s1, {})
    })

    it('should not mutate objects', () => {
      s2 = tesseract.set(s1, 'foo', 'bar')
      assert.strictEqual(s1.foo, undefined)
      assert.strictEqual(s2.foo, 'bar')
    })

    it('should not register any conflicts', () => {
      assert.deepEqual(s1._conflicts, {})
      s1 = tesseract.set(s1, 'foo', 'one')
      assert.deepEqual(s1._conflicts, {})
      s1 = tesseract.set(s1, 'foo', 'two')
      assert.deepEqual(s1._conflicts, {})
    })

    describe('root object', () => {
      it('should handle single-property assignment', () => {
        s1 = tesseract.set(s1, 'foo', 'bar')
        s1 = tesseract.set(s1, 'zip', 'zap')
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.zip, 'zap')
        assert.deepEqual(s1, {'foo': 'bar', 'zip': 'zap'})
      })

      it('should handle multi-property assignment', () => {
        s1 = tesseract.assign(s1, {foo: 'bar', answer: 42})
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.answer, 42)
        assert.deepEqual(s1, {'foo': 'bar', 'answer': 42})
      })

      it('should handle root property deletion', () => {
        s1 = tesseract.assign(s1, {foo: 'bar', something: null})
        s1 = tesseract.remove(s1, 'foo')
        assert.strictEqual(s1.foo, undefined)
        assert.strictEqual(s1.something, null)
        assert.deepEqual(s1, {something: null})
      })

      it('should allow the type of a property to be changed', () => {
        s1 = tesseract.set(s1, 'prop', 123)
        assert.strictEqual(s1.prop, 123)
        s1 = tesseract.set(s1, 'prop', '123')
        assert.strictEqual(s1.prop, '123')
        s1 = tesseract.set(s1, 'prop', null)
        assert.strictEqual(s1.prop, null)
        s1 = tesseract.set(s1, 'prop', true)
        assert.strictEqual(s1.prop, true)
      })

      it('should require property names to be strings', () => {
        assert.throws(() => { tesseract.set(s1, 0, 'x') }, /must be a string/)
        assert.throws(() => { tesseract.set(s1, {x:'y'}, 'x') }, /must be a string/)
        assert.throws(() => { tesseract.set(s1, [1,2,3], 'x') }, /must be a string/)
        assert.throws(() => { tesseract.set(s1, '', 'x') }, /must not be an empty string/)
      })

      it('should not allow strings to begin with underscore', () => {
        assert.throws(() => { tesseract.set(s1, '_foo', 'x') }, /Map entries starting with underscore are not allowed/)
      })
    })

    describe('nested maps', () => {
      it('should assign a UUID to nested maps', () => {
        s1 = tesseract.set(s1, 'nested', {})
        assert.deepEqual(s1, {nested: {}})
        assert.deepEqual(s1.nested, {})
        assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s1.nested._id))
        assert.notEqual(s1.nested._id, '00000000-0000-0000-0000-000000000000')
      })

      it('should handle assignment of a nested property', () => {
        s1 = tesseract.set(s1, 'nested', {})
        s1 = tesseract.set(s1.nested, 'foo', 'bar')
        s1 = tesseract.set(s1.nested, 'one', 1)
        assert.deepEqual(s1, {nested: {foo: 'bar', one: 1}})
        assert.deepEqual(s1.nested, {foo: 'bar', one: 1})
        assert.strictEqual(s1.nested.foo, 'bar')
        assert.strictEqual(s1.nested['foo'], 'bar')
        assert.strictEqual(s1.nested.one, 1)
        assert.strictEqual(s1.nested['one'], 1)
      })

      it('should handle assignment of an object literal', () => {
        s1 = tesseract.set(s1, 'textStyle', {bold: false, fontSize: 12})
        assert.deepEqual(s1, {textStyle: {bold: false, fontSize: 12}})
        assert.deepEqual(s1.textStyle, {bold: false, fontSize: 12})
        assert.strictEqual(s1.textStyle.bold, false)
        assert.strictEqual(s1.textStyle.fontSize, 12)
      })

      it('should handle assignment of multiple nested properties', () => {
        s1 = tesseract.set(s1, 'textStyle', {bold: false, fontSize: 12})
        s1 = tesseract.assign(s1.textStyle, {typeface: 'Optima', fontSize: 14})
        assert.strictEqual(s1.textStyle.typeface, 'Optima')
        assert.strictEqual(s1.textStyle.bold, false)
        assert.strictEqual(s1.textStyle.fontSize, 14)
        assert.deepEqual(s1, {textStyle: {typeface: 'Optima', bold: false, fontSize: 14}})
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = tesseract.set(s1, 'a', {b: {c: {d: {e: {f: {g: 'h'}}}}}})
        s1 = tesseract.set(s1.a.b.c.d.e.f, 'i', 'j')
        assert.deepEqual(s1, {a: {b: {c: {d: {e: {f: {g: 'h', i: 'j'}}}}}}})
        assert.strictEqual(s1.a.b.c.d.e.f.g, 'h')
        assert.strictEqual(s1.a.b.c.d.e.f.i, 'j')
      })

      it('should allow an old object to be replaced with a new one', () => {
        s1 = tesseract.set(s1, 'myPet', {species: 'dog', legs: 4, breed: 'dachshund'})
        s2 = tesseract.set(s1, 'myPet', {species: 'koi', variety: '紅白', colors: {red: true, white: true, black: false}})
        assert.deepEqual(s1, {myPet: {species: 'dog', legs: 4, breed: 'dachshund'}})
        assert.strictEqual(s1.myPet.breed, 'dachshund')
        assert.deepEqual(s2, {myPet: {species: 'koi', variety: '紅白', colors: {red: true, white: true, black: false}}})
        assert.strictEqual(s2.myPet.breed, undefined)
        assert.strictEqual(s2.myPet.variety, '紅白')
      })

      it('should allow fields to be changed between primitive and nested map', () => {
        s1 = tesseract.set(s1, 'color', '#ff7f00')
        assert.deepEqual(s1.color, '#ff7f00')
        s1 = tesseract.set(s1, 'color', {red: 255, green: 127, blue: 0})
        assert.deepEqual(s1.color, {red: 255, green: 127, blue: 0})
        s1 = tesseract.set(s1, 'color', '#ff7f00')
        assert.deepEqual(s1.color, '#ff7f00')
      })

      it('should allow several references to the same map object', () => {
        s1 = tesseract.set(s1, 'position', {x: 1, y: 1})
        s1 = tesseract.set(s1, 'size', s1.position)
        s2 = tesseract.set(s1.position, 'y', 2)
        assert.strictEqual(s1.size.y, 1)
        assert.strictEqual(s2.size.y, 2)
        assert.strictEqual(s1.position._id, s1.size._id)
      })

      it('should handle deletion of properties within a map', () => {
        s1 = tesseract.set(s1, 'textStyle', {typeface: 'Optima', bold: false, fontSize: 12})
        s1 = tesseract.remove(s1.textStyle, 'bold')
        assert.strictEqual(s1.textStyle.bold, undefined)
        assert.deepEqual(s1, {textStyle: {typeface: 'Optima', fontSize: 12}})
      })

      it('should handle deletion of references to a map', () => {
        s1 = tesseract.assign(s1, {title: 'Hello', textStyle: {typeface: 'Optima', fontSize: 12}})
        s1 = tesseract.remove(s1, 'textStyle')
        assert.strictEqual(s1.textStyle, undefined)
        assert.deepEqual(s1, {title: 'Hello'})
      })

      it('should validate field names', () => {
        s1 = tesseract.set(s1, 'nested', {})
        assert.throws(() => { tesseract.set(s1.nested, 0, 'x') }, /must be a string/)
        assert.throws(() => { tesseract.set(s1.nested, '', 'x') }, /must not be an empty string/)
        assert.throws(() => { tesseract.set(s1, 'nested', {'': 'x'}) }, /must not be an empty string/)
        assert.throws(() => { tesseract.set(s1.nested, '_foo', 'x') }, /Map entries starting with underscore are not allowed/)
        assert.throws(() => { tesseract.set(s1, 'nested', {'_foo': 'x'}) }, /Map entries starting with underscore are not allowed/)
      })

      it('should not allow insertion', () => {
        s1 = tesseract.set(s1, 'nested', {})
        assert.throws(() => { tesseract.insert(s1, 0, 'hello') }, /Cannot insert into a map/)
        assert.throws(() => { tesseract.insert(s1.nested, 0, 'hello') }, /Cannot insert into a map/)
      })
    })

    describe('lists', () => {
      it('should assign a UUID to nested lists', () => {
        s1 = tesseract.set(s1, 'list', [])
        assert.deepEqual(s1, {list: []})
        assert.deepEqual(s1.list, [])
        assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s1.list._id))
        assert.notEqual(s1.list._id, '00000000-0000-0000-0000-000000000000')
      })

      it('should have a length property', () => {
        s1 = tesseract.set(s1, 'list', [])
        assert.strictEqual(s1.list.length, 0)
        s1 = tesseract.insert(s1.list, 0, 'zero')
        assert.strictEqual(s1.list.length, 1)
        s1 = tesseract.insert(s1.list, 1, 'one')
        assert.strictEqual(s1.list.length, 2)
      })

      it('should insert new elements at the beginning', () => {
        s1 = tesseract.set(s1, 'noodles', [])
        s1 = tesseract.insert(s1.noodles, 0, 'udon')
        s1 = tesseract.insert(s1.noodles, 0, 'soba')
        s1 = tesseract.insert(s1.noodles, 0, 'ramen')
        assert.deepEqual(s1, {noodles: ['ramen', 'soba', 'udon']})
        assert.deepEqual(s1.noodles, ['ramen', 'soba', 'udon'])
        assert.strictEqual(s1.noodles[0], 'ramen')
        assert.strictEqual(s1.noodles[1], 'soba')
        assert.strictEqual(s1.noodles[2], 'udon')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should insert new elements at the end', () => {
        s1 = tesseract.set(s1, 'noodles', [])
        s1 = tesseract.insert(s1.noodles, 0, 'udon')
        s1 = tesseract.insert(s1.noodles, 1, 'soba')
        s1 = tesseract.insert(s1.noodles, 2, 'ramen')
        assert.deepEqual(s1, {noodles: ['udon', 'soba', 'ramen']})
        assert.deepEqual(s1.noodles, ['udon', 'soba', 'ramen'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'soba')
        assert.strictEqual(s1.noodles[2], 'ramen')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should insert new elements in the middle', () => {
        s1 = tesseract.set(s1, 'noodles', [])
        s1 = tesseract.insert(s1.noodles, 0, 'udon')
        s1 = tesseract.insert(s1.noodles, 1, 'soba')
        s1 = tesseract.insert(s1.noodles, 1, 'ramen')
        assert.deepEqual(s1, {noodles: ['udon', 'ramen', 'soba']})
        assert.deepEqual(s1.noodles, ['udon', 'ramen', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'soba')
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle assignment of a list literal', () => {
        s1 = tesseract.set(s1, 'noodles', ['udon', 'ramen', 'soba'])
        assert.deepEqual(s1, {noodles: ['udon', 'ramen', 'soba']})
        assert.deepEqual(s1.noodles, ['udon', 'ramen', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'soba')
        assert.strictEqual(s1.noodles[3], undefined)
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should only allow numeric indexes', () => {
        s1 = tesseract.set(s1, 'noodles', ['udon', 'ramen', 'soba'])
        assert.throws(() => { tesseract.set(s1.noodles, 'favourite', 'udon') }, /must be a numerical index/)
        assert.throws(() => { tesseract.set(s1.noodles, '',          'udon') }, /must be a numerical index/)
        assert.throws(() => { tesseract.set(s1.noodles, '1e6',       'udon') }, /must be a numerical index/)
      })

      it('should handle deletion of list elements', () => {
        s1 = tesseract.set(s1, 'noodles', ['udon', 'ramen', 'soba'])
        s1 = tesseract.remove(s1.noodles, 1)
        assert.deepEqual(s1, {noodles: ['udon', 'soba']})
        assert.deepEqual(s1.noodles, ['udon', 'soba'])
        assert.strictEqual(s1.noodles[0], 'udon')
        assert.strictEqual(s1.noodles[1], 'soba')
        assert.strictEqual(s1.noodles[2], undefined)
        assert.strictEqual(s1.noodles.length, 2)
      })

      it('should handle assignment of individual list indexes', () => {
        s1 = tesseract.set(s1, 'japaneseFood', ['udon', 'ramen', 'soba'])
        s1 = tesseract.set(s1.japaneseFood, 1, 'sushi')
        assert.deepEqual(s1, {japaneseFood: ['udon', 'sushi', 'soba']})
        assert.deepEqual(s1.japaneseFood, ['udon', 'sushi', 'soba'])
        assert.strictEqual(s1.japaneseFood[0], 'udon')
        assert.strictEqual(s1.japaneseFood[1], 'sushi')
        assert.strictEqual(s1.japaneseFood[2], 'soba')
        assert.strictEqual(s1.japaneseFood[3], undefined)
        assert.strictEqual(s1.japaneseFood.length, 3)
      })

      it('should allow bulk assignment of multiple list indexes', () => {
        s1 = tesseract.set(s1, 'noodles', ['udon', 'ramen', 'soba'])
        s1 = tesseract.assign(s1.noodles, {0: 'うどん', 2: 'そば'})
        assert.deepEqual(s1, {noodles: ['うどん', 'ramen', 'そば']})
        assert.strictEqual(s1.noodles[0], 'うどん')
        assert.strictEqual(s1.noodles[1], 'ramen')
        assert.strictEqual(s1.noodles[2], 'そば')
        assert.strictEqual(s1.noodles[3], undefined)
        assert.strictEqual(s1.noodles.length, 3)
      })

      it('should handle nested objects', () => {
        s1 = tesseract.set(s1, 'noodles', [{type: 'ramen', dishes: ['tonkotsu', 'shoyu']}])
        s1 = tesseract.insert(s1.noodles, 1, {type: 'udon', dishes: ['tempura udon']})
        s1 = tesseract.insert(s1.noodles[0].dishes, 2, 'miso')
        assert.deepEqual(s1, {noodles: [
          {type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']},
          {type: 'udon', dishes: ['tempura udon']}
        ]})
        assert.deepEqual(s1.noodles[0], {type: 'ramen', dishes: ['tonkotsu', 'shoyu', 'miso']})
        assert.deepEqual(s1.noodles[1], {type: 'udon', dishes: ['tempura udon']})
      })

      it('should handle nested lists', () => {
        s1 = tesseract.set(s1, 'noodleMatrix', [['ramen', 'tonkotsu', 'shoyu']])
        s1 = tesseract.insert(s1.noodleMatrix, 1, ['udon', 'tempura udon'])
        s1 = tesseract.insert(s1.noodleMatrix[0], 3, 'miso')
        assert.deepEqual(s1, {noodleMatrix: [['ramen', 'tonkotsu', 'shoyu', 'miso'], ['udon', 'tempura udon']]})
        assert.deepEqual(s1.noodleMatrix[0], ['ramen', 'tonkotsu', 'shoyu', 'miso'])
        assert.deepEqual(s1.noodleMatrix[1], ['udon', 'tempura udon'])
      })

      it('should handle replacement of the entire list', () => {
        s1 = tesseract.set(s1, 'noodles', ['udon', 'soba', 'ramen'])
        s1 = tesseract.set(s1, 'japaneseNoodles', s1.noodles)
        s1 = tesseract.set(s1, 'noodles', ['wonton', 'pho'])
        assert.deepEqual(s1, {noodles: ['wonton', 'pho'], japaneseNoodles: ['udon', 'soba', 'ramen']})
        assert.deepEqual(s1.noodles, ['wonton', 'pho'])
        assert.strictEqual(s1.noodles[0], 'wonton')
        assert.strictEqual(s1.noodles[1], 'pho')
        assert.strictEqual(s1.noodles[2], undefined)
        assert.strictEqual(s1.noodles.length, 2)
      })

      it('should allow assignment to change the type of a list element', () => {
        s1 = tesseract.set(s1, 'noodles', ['udon', 'soba', 'ramen'])
        assert.deepEqual(s1, {noodles: ['udon', 'soba', 'ramen']})
        s1 = tesseract.set(s1.noodles, 1, {type: 'soba', options: ['hot', 'cold']})
        assert.deepEqual(s1, {noodles: ['udon', {type: 'soba', options: ['hot', 'cold']}, 'ramen']})
        s1 = tesseract.set(s1.noodles, 1, ['hot soba', 'cold soba'])
        assert.deepEqual(s1, {noodles: ['udon', ['hot soba', 'cold soba'], 'ramen']})
        s1 = tesseract.set(s1.noodles, 1, 'soba is the best')
        assert.deepEqual(s1, {noodles: ['udon', 'soba is the best', 'ramen']})
      })

      it('should handle arbitrary-depth nesting', () => {
        s1 = tesseract.set(s1, 'maze', [[[[[[[['noodles', ['here']]]]]]]]])
        s1 = tesseract.insert(s1.maze[0][0][0][0][0][0][0][1], 0, 'found')
        assert.deepEqual(s1, {maze: [[[[[[[['noodles', ['found', 'here']]]]]]]]]})
        assert.deepEqual(s1.maze[0][0][0][0][0][0][0][1][1], 'here')
      })

      it('should allow several references to the same list object', () => {
        s1 = tesseract.set(s1, 'japaneseNoodles', ['udon', 'soba'])
        s1 = tesseract.set(s1, 'theBestNoodles', s1.japaneseNoodles)
        s1 = tesseract.insert(s1.theBestNoodles, 2, 'ramen')
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
      s1 = tesseract.set(s1, 'foo', 'bar')
      s2 = tesseract.set(s2, 'hello', 'world')
      s3 = tesseract.merge(s1, s2)
      assert.strictEqual(s3.foo, 'bar')
      assert.strictEqual(s3.hello, 'world')
      assert.deepEqual(s3, {'foo': 'bar', 'hello': 'world' })
    })

    it('should allow be able to have nested objects', () => {
      s1 = tesseract.set(s1, 'foo', {'hello': 'world'})
      assert.deepEqual(s1, {'foo': {'hello': 'world' }})
      s2 = tesseract.set(s2, 'aaa', {'bbb': 'ccc'})
      assert.deepEqual(s2, {'aaa': {'bbb': 'ccc'}})
      s3 = tesseract.merge(s3, s2)
      s3 = tesseract.merge(s3, s1)
      assert.deepEqual(s3, {'foo': {'hello': 'world'}, 'aaa': {'bbb': 'ccc'}})
      s3 = tesseract.set(s3.foo, 'key', 'val')
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
      s1 = tesseract.set(s1, 's1', 's1')
      s2 = tesseract.set(s2, 's2', 's2')
      assert.deepEqual(tesseract.getVClock(s1), {[s1._actor_id]: 1})
      assert.deepEqual(tesseract.getVClock(s2), {[s2._actor_id]: 1})
      const act1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      const act2 = tesseract.getDeltasAfter(s2, tesseract.getVClock(s1))
      assert.deepEqual(act1, [{
        action: 'set', actor: s1._actor_id, clock: {[s1._actor_id]: 1},
        obj: '00000000-0000-0000-0000-000000000000', key: 's1', value: 's1'
      }])
      assert.deepEqual(act2, [{
        action: 'set', actor: s2._actor_id, clock: {[s2._actor_id]: 1},
        obj: '00000000-0000-0000-0000-000000000000', key: 's2', value: 's2'
      }])
      s1 = tesseract.applyDeltas(s1, act2)
      s2 = tesseract.applyDeltas(s2, act1)
      assert.deepEqual(s1, {s1: 's1', s2: 's2'})
      assert.deepEqual(s2, {s1: 's1', s2: 's2'})
    })

    it('should set the local sequence number after loading from file', () => {
      s1 = tesseract.set(s1, 'bestFruit', 'banana')
      s2 = tesseract.load(tesseract.save(s1))
      s2 = tesseract.set(s2, 'bestFruit', 'pineapple')
      const deltas = tesseract.getDeltasAfter(s2, tesseract.getVClock(s1))
      assert.deepEqual(deltas, [{
        action: 'set', actor: s2._actor_id, clock: {[s1._actor_id]: 1, [s2._actor_id]: 1},
        obj: '00000000-0000-0000-0000-000000000000', key: 'bestFruit', value: 'pineapple'
      }])
    })

    it('should determine deltas missing from other stores', () => {
      s1 = tesseract.set(s1, 'cheeses', ['Comté', 'Stilton'])
      s2 = tesseract.merge(s2, s1)
      s2 = tesseract.insert(s2.cheeses, 2, 'Mozzarella')
      s1 = tesseract.merge(s1, s2)
      s1 = tesseract.remove(s1.cheeses, 2)
      s2 = tesseract.insert(s2.cheeses, 1, 'Jarlsberg')
      const act1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      const act2 = tesseract.getDeltasAfter(s2, tesseract.getVClock(s1))
      assert.deepEqual(act1.map(a => a.action), ['del'])
      assert.deepEqual(act2.map(a => a.action), ['ins', 'set'])
      assert.strictEqual(act2[1].value, 'Jarlsberg')
    })

    it('should ignore duplicate deliveries', () => {
      s1 = tesseract.set(s1, 'cheeses', [])
      s2 = tesseract.merge(s2, s1)
      s1 = tesseract.insert(s1.cheeses, 0, 'Wensleydale')
      const act1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      s2 = tesseract.applyDeltas(s2, act1)
      assert.deepEqual(s2, {cheeses: ['Wensleydale']})
      s2 = tesseract.applyDeltas(s2, act1)
      assert.deepEqual(s2, {cheeses: ['Wensleydale']})
    })

    it('should handle out-of-order delivery', () => {
      s1 = tesseract.set(s1, 'score', 1)
      s1 = tesseract.set(s1, 'score', 2)
      const act1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      assert.deepEqual(act1.map(a => a.action), ['set', 'set'])
      assert.deepEqual(act1.map(a => a.value), [1, 2])
      s2 = tesseract.applyDeltas(s2, [act1[1]])
      assert.deepEqual(s2, {})
      s2 = tesseract.applyDeltas(s2, [act1[0]])
      assert.deepEqual(s2, {score: 2})
    })

    it('should buffer actions until causally ready', () => {
      s1 = tesseract.set(s1, 'cheeses', [])
      s2 = tesseract.merge(s2, s1)
      s3 = tesseract.merge(s3, s1)
      s1 = tesseract.insert(s1.cheeses, 0, 'Paneer')
      const act1 = tesseract.getDeltasAfter(s1, tesseract.getVClock(s2))
      assert.deepEqual(act1.map(a => a.action), ['ins', 'set'])
      assert.strictEqual(act1[1].value, 'Paneer')
      s2 = tesseract.merge(s2, s1)
      s2 = tesseract.insert(s2.cheeses, 1, 'Feta')
      const act2 = tesseract.getDeltasAfter(s2, tesseract.getVClock(s1))
      assert.deepEqual(act2.map(a => a.action), ['ins', 'set'])
      assert.strictEqual(act2[1].value, 'Feta')
      s3 = tesseract.applyDeltas(s3, act2)
      assert.deepEqual(s3, {cheeses: []})
      s3 = tesseract.applyDeltas(s3, act1)
      assert.deepEqual(s3, {cheeses: ['Paneer', 'Feta']})
    })
  })
})
