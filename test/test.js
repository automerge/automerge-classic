const assert = require('assert')
const tesseract = require('../src/tesseract')

// Assertion that succeeds if the first argument deepEquals at least one of the
// subsequent arguments (but we don't care which one)
function equalsOneOf(actual, ...expected) {
  assert(expected.length > 0)
  for (let i = 0; i < expected.length; i++) {
    try {
      assert.deepEqual(actual, expected[i])
      return // if we get here without an exception, that means success
    } catch (e) {
      if (e.name !== 'AssertionError' || i === expected.length - 1) throw e
    }
  }
}

describe('Tesseract', () => {
  describe('sequential use', () => {
    let s1, s2
    beforeEach(() => {
      s1 = tesseract.init()
    })

    it('should initially be an empty map', () => {
      assert.deepEqual(s1, {})
      assert.deepEqual(Object.keys(s1), [])
      assert.strictEqual(s1._type, 'map')
      assert.strictEqual(s1.someProperty, undefined)
      assert.strictEqual(s1['someProperty'], undefined)
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
      it('should have a fixed object ID', () => {
        assert.strictEqual(s1._id, '00000000-0000-0000-0000-000000000000')
      })

      it('should know its store ID', () => {
        assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s1._store_id))
        assert.notEqual(s1._store_id, '00000000-0000-0000-0000-000000000000')
        assert.strictEqual(tesseract.init('customStoreId')._store_id, 'customStoreId')
      })

      it('should handle single-property assignment', () => {
        s1 = tesseract.set(s1, 'foo', 'bar')
        s1 = tesseract.set(s1, 'zip', 'zap')
        assert.strictEqual(s1.foo, 'bar')
        assert.strictEqual(s1.zip, 'zap')
        assert.deepEqual(s1, {'foo': 'bar', 'zip': 'zap'})
        equalsOneOf(Object.keys(s1), ['foo', 'zip'], ['zip', 'foo'])
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

      it('should insert new elements at the specified position', () => {
        s1 = tesseract.set(s1, 'list', [])
        s1 = tesseract.insert(s1.list, 0, 'one')
        s1 = tesseract.insert(s1.list, 1, 'two')
        s1 = tesseract.insert(s1.list, 0, 'zero')
        assert.deepEqual(s1, {list: ['zero', 'one', 'two']})
        assert.deepEqual(s1.list, ['zero', 'one', 'two'])
        assert.strictEqual(s1.list[0], 'zero')
        assert.strictEqual(s1.list[1], 'one')
        assert.strictEqual(s1.list[2], 'two')
      })

      it('should handle assignment of a list literal', () => {
        s1 = tesseract.set(s1, 'list', ['zero', 'one', 'two'])
        assert.deepEqual(s1, {list: ['zero', 'one', 'two']})
        assert.deepEqual(s1.list, ['zero', 'one', 'two'])
        assert.strictEqual(s1.list[0], 'zero')
        assert.strictEqual(s1.list[1], 'one')
        assert.strictEqual(s1.list[2], 'two')
      })

      it('should behave like a JS array', () => {
        s1 = tesseract.set(s1, 'list', ['zero', 'one'])
        assert.strictEqual(s1.list[0], 'zero')
        assert.strictEqual(s1.list[1], 'one')
        assert.strictEqual(s1.list[2], undefined)
        assert.strictEqual(s1.list.length, 2)
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
      assert.deepEqual(tesseract.getVClock(s1), {[s1._store_id]: 0})
      assert.deepEqual(tesseract.getDeltas(s2, tesseract.getVClock(s1)), [])
      assert.deepEqual(tesseract.applyDeltas(s1, []), {})
    })

    it('should generate deltas representing changes', () => {
      s1 = tesseract.set(s1, 's1', 's1')
      s2 = tesseract.set(s2, 's2', 's2')
      assert.deepEqual(tesseract.getVClock(s1), {[s1._store_id]: 1})
      assert.deepEqual(tesseract.getVClock(s2), {[s2._store_id]: 1})
      const act1 = tesseract.getDeltas(s1, tesseract.getVClock(s2))
      const act2 = tesseract.getDeltas(s2, tesseract.getVClock(s1))
      assert.deepEqual(act1, [{
        action: 'set', by: s1._store_id, clock: {[s1._store_id]: 1},
        target: '00000000-0000-0000-0000-000000000000', key: 's1', value: 's1'
      }])
      assert.deepEqual(act2, [{
        action: 'set', by: s2._store_id, clock: {[s2._store_id]: 1},
        target: '00000000-0000-0000-0000-000000000000', key: 's2', value: 's2'
      }])
      s1 = tesseract.applyDeltas(s1, act2)
      s2 = tesseract.applyDeltas(s2, act1)
      assert.deepEqual(s1, {s1: 's1', s2: 's2'})
      assert.deepEqual(s2, {s1: 's1', s2: 's2'})
    })

    it('should determine deltas missing from other stores', () => {
      s1 = tesseract.set(s1, 'cheeses', ['Comté', 'Stilton'])
      s2 = tesseract.merge(s2, s1)
      s2 = tesseract.insert(s2.cheeses, 2, 'Mozzarella')
      s1 = tesseract.merge(s1, s2)
      s1 = tesseract.remove(s1.cheeses, 2)
      s2 = tesseract.insert(s2.cheeses, 1, 'Jarlsberg')
      const act1 = tesseract.getDeltas(s1, tesseract.getVClock(s2))
      const act2 = tesseract.getDeltas(s2, tesseract.getVClock(s1))
      assert.deepEqual(act1.map(a => a.action), ['del'])
      assert.deepEqual(act2.map(a => a.action), ['ins', 'set'])
      assert.strictEqual(act2[1].value, 'Jarlsberg')
    })

    it('should ignore duplicate deliveries', () => {
      s1 = tesseract.set(s1, 'cheeses', [])
      s2 = tesseract.merge(s2, s1)
      s1 = tesseract.insert(s1.cheeses, 0, 'Wensleydale')
      const act1 = tesseract.getDeltas(s1, tesseract.getVClock(s2))
      s2 = tesseract.applyDeltas(s2, act1)
      assert.deepEqual(s2, {cheeses: ['Wensleydale']})
      s2 = tesseract.applyDeltas(s2, act1)
      assert.deepEqual(s2, {cheeses: ['Wensleydale']})
    })

    it('should handle out-of-order delivery', () => {
      s1 = tesseract.set(s1, 'score', 1)
      s1 = tesseract.set(s1, 'score', 2)
      const act1 = tesseract.getDeltas(s1, tesseract.getVClock(s2))
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
      const act1 = tesseract.getDeltas(s1, tesseract.getVClock(s2))
      assert.deepEqual(act1.map(a => a.action), ['ins', 'set'])
      assert.strictEqual(act1[1].value, 'Paneer')
      s2 = tesseract.merge(s2, s1)
      s2 = tesseract.insert(s2.cheeses, 1, 'Feta')
      const act2 = tesseract.getDeltas(s2, tesseract.getVClock(s1))
      assert.deepEqual(act2.map(a => a.action), ['ins', 'set'])
      assert.strictEqual(act2[1].value, 'Feta')
      s3 = tesseract.applyDeltas(s3, act2)
      assert.deepEqual(s3, {cheeses: []})
      s3 = tesseract.applyDeltas(s3, act1)
      assert.deepEqual(s3, {cheeses: ['Paneer', 'Feta']})
    })
  })
})
