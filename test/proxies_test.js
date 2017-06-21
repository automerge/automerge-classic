const assert = require('assert')
const tesseract = require('../src/tesseract')
const { equalsOneOf } = require('./helpers')

describe('Tesseract proxy API', () => {
  describe('root object', () => {
    let root
    beforeEach(() => {
      root = tesseract.init()
    })

    it('should have a fixed object ID', () => {
      assert.strictEqual(root._type, 'map')
      assert.strictEqual(root._objectId, '00000000-0000-0000-0000-000000000000')
    })

    it('should know its actor ID', () => {
      assert(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(root._actorId))
      assert.notEqual(root._actorId, '00000000-0000-0000-0000-000000000000')
      assert.strictEqual(tesseract.init('customActorId')._actorId, 'customActorId')
    })

    it('should prohibit mutation', () => {
      assert.throws(() => { root.key = 'value' }, /this object is read-only/)
      assert.throws(() => { root['key'] = 'value' }, /this object is read-only/)
      assert.throws(() => { delete root['key'] }, /this object is read-only/)
      assert.throws(() => { Object.assign(root, {key: 'value'}) }, /this object is read-only/)
    })

    it('should expose keys as object properties', () => {
      root = tesseract.changeset(root, doc => doc.key1 = 'value1')
      assert.strictEqual(root.key1, 'value1')
      assert.strictEqual(root['key1'], 'value1')
    })

    it('should return undefined for unknown properties', () => {
      assert.strictEqual(root.someProperty, undefined)
      assert.strictEqual(root['someProperty'], undefined)
    })

    it('should support the "in" operator', () => {
      assert.strictEqual('key1' in root, false)
      root = tesseract.changeset(root, doc => doc.key1 = 'value1')
      assert.strictEqual('key1' in root, true)
    })

    it('should support Object.keys()', () => {
      assert.deepEqual(Object.keys(root), [])
      root = tesseract.changeset(root, doc => doc.key1 = 'value1')
      assert.deepEqual(Object.keys(root), ['key1'])
      root = tesseract.changeset(root, doc => doc.key2 = 'value2')
      equalsOneOf(Object.keys(root), ['key1', 'key2'], ['key2', 'key1'])
    })

    it('should support Object.getOwnPropertyNames()', () => {
      assert.deepEqual(Object.getOwnPropertyNames(root), [])
      root = tesseract.changeset(root, doc => doc.key1 = 'value1')
      assert.deepEqual(Object.getOwnPropertyNames(root), ['key1'])
      root = tesseract.changeset(root, doc => doc.key2 = 'value2')
      equalsOneOf(Object.getOwnPropertyNames(root), ['key1', 'key2'], ['key2', 'key1'])
    })

    it('should support JSON.stringify()', () => {
      assert.deepEqual(JSON.stringify(root), '{}')
      root = tesseract.changeset(root, doc => doc.key1 = 'value1')
      assert.deepEqual(JSON.stringify(root), '{"key1":"value1"}')
      root = tesseract.changeset(root, doc => doc.key2 = 'value2')
      equalsOneOf(JSON.stringify(root), '{"key1":"value1","key2":"value2"}', '{"key2":"value2","key1":"value1"}')
    })

    it('should allow inspection as regular JS objects', () => {
      assert.deepEqual(root._inspect, {})
      assert.deepEqual(tesseract.inspect(root), {})
      root = tesseract.changeset(root, doc => doc.key1 = 'value1')
      assert.deepEqual(root._inspect, {key1: 'value1'})
      assert.deepEqual(tesseract.inspect(root), {key1: 'value1'})
      root = tesseract.changeset(root, doc => doc.key2 = 'value2')
      assert.deepEqual(root._inspect, {key1: 'value1', key2: 'value2'})
      assert.deepEqual(tesseract.inspect(root), {key1: 'value1', key2: 'value2'})
    })
  })

  describe('list object', () => {
    let root
    beforeEach(() => {
      root = tesseract.changeset(tesseract.init(), doc => doc.list = [1, 2, 3])
    })

    it('should look like a JavaScript array', () => {
      assert.strictEqual(Array.isArray(root.list), true)
      assert.strictEqual(typeof root.list, 'object')
      assert.strictEqual(toString.call(root.list), '[object Array]')
    })

    it('should prohibit mutation', () => {
      assert.throws(() => { root.list[0] = 42   }, /this list is read-only/)
      assert.throws(() => { root.list.push(42)  }, /this list is read-only/)
      assert.throws(() => { delete root.list[0] }, /this list is read-only/)
      assert.throws(() => { root.list.shift()   }, /this list is read-only/)
      assert.throws(() => { Object.assign(root.list, ['value']) }, /this list is read-only/)
    })

    it('should allow entries to be fetched by index', () => {
      assert.strictEqual(root.list[0],   1)
      assert.strictEqual(root.list['0'], 1)
      assert.strictEqual(root.list[1],   2)
      assert.strictEqual(root.list['1'], 2)
      assert.strictEqual(root.list[2],   3)
      assert.strictEqual(root.list['2'], 3)
      assert.strictEqual(root.list[3],   undefined)
      assert.strictEqual(root.list['3'], undefined)
      assert.strictEqual(root.list[-1],  undefined)
      assert.strictEqual(root.list.someProperty,    undefined)
      assert.strictEqual(root.list['someProperty'], undefined)
    })

    it('should support the "in" operator', () => {
      assert.strictEqual(0 in root.list, true)
      assert.strictEqual('0' in root.list, true)
      assert.strictEqual(3 in root.list, false)
      assert.strictEqual('3' in root.list, false)
      assert.strictEqual('length' in root.list, true)
      assert.strictEqual('someProperty' in root.list, false)
    })

    it('should support Object.keys()', () => {
      assert.deepEqual(Object.keys(root.list), ['0', '1', '2'])
    })

    it('should support Object.getOwnPropertyNames()', () => {
      assert.deepEqual(Object.getOwnPropertyNames(root.list), ['length', '0', '1', '2'])
    })

    it('should support JSON.stringify()', () => {
      assert.deepEqual(JSON.stringify(root), '{"list":[1,2,3]}')
      assert.deepEqual(JSON.stringify(root.list), '[1,2,3]')
    })

    it('should allow inspection as regular JS objects', () => {
      assert.deepEqual(root._inspect, {list: [1, 2, 3]})
      assert.deepEqual(tesseract.inspect(root), {list: [1, 2, 3]})
    })

    it('should support iteration', () => {
      let copy = []
      for (let x of root.list) copy.push(x)
      assert.deepEqual(copy, [1, 2, 3])

      // spread operator also uses iteration protocol
      assert.deepEqual([0, ...root.list, 4], [0, 1, 2, 3, 4])
    })

    it('should support iterating over entries', () => {
      let copy = []
      for (let x of root.list.entries()) copy.push(x)
      assert.deepEqual(copy, [[0, 1], [1, 2], [2, 3]])
      assert.deepEqual([...root.list.entries()], [[0, 1], [1, 2], [2, 3]])
    })
  })
})
