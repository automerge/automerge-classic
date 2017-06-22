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
      root = tesseract.changeset(tesseract.init(), doc => { doc.list = [1, 2, 3]; doc.empty = [] })
    })

    it('should look like a JavaScript array', () => {
      assert.strictEqual(Array.isArray(root.list), true)
      assert.strictEqual(typeof root.list, 'object')
      assert.strictEqual(toString.call(root.list), '[object Array]')
    })

    it('should have a length property', () => {
      assert.strictEqual(root.empty.length, 0)
      assert.strictEqual(root.list.length, 3)
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
      equalsOneOf(JSON.stringify(root), '{"list":[1,2,3],"empty":[]}', '{"empty":[],"list":[1,2,3]}')
      assert.deepEqual(JSON.stringify(root.list), '[1,2,3]')
    })

    it('should allow inspection as regular JS objects', () => {
      assert.deepEqual(root._inspect, {list: [1, 2, 3], empty: []})
      assert.deepEqual(tesseract.inspect(root), {list: [1, 2, 3], empty: []})
    })

    it('should support iteration', () => {
      let copy = []
      for (let x of root.list) copy.push(x)
      assert.deepEqual(copy, [1, 2, 3])

      // spread operator also uses iteration protocol
      assert.deepEqual([0, ...root.list, 4], [0, 1, 2, 3, 4])
    })

    describe('should support standard read-only methods', () => {
      it('concat()', () => {
        assert.deepEqual(root.list.concat([4, 5, 6]), [1, 2, 3, 4, 5, 6])
        assert.deepEqual(root.list.concat([4], [5, [6]]), [1, 2, 3, 4, 5, [6]])
      })

      it('entries()', () => {
        let copy = []
        for (let x of root.list.entries()) copy.push(x)
        assert.deepEqual(copy, [[0, 1], [1, 2], [2, 3]])
        assert.deepEqual([...root.list.entries()], [[0, 1], [1, 2], [2, 3]])
      })

      it('every()', () => {
        assert.strictEqual(root.empty.every(() => false), true)
        assert.strictEqual(root.list.every(val => val > 0), true)
        assert.strictEqual(root.list.every(val => val > 2), false)
        assert.strictEqual(root.list.every((val, index) => index < 3), true)
        root.list.every(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
      })

      it('filter()', () => {
        assert.deepEqual(root.empty.filter(() => false), [])
        assert.deepEqual(root.list.filter(num => num % 2 === 1), [1, 3])
        assert.deepEqual(root.list.filter(num => true), [1, 2, 3])
        root.list.filter(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
      })

      it('find()', () => {
        assert.strictEqual(root.empty.find(() => true), undefined)
        assert.strictEqual(root.list.find(num => num >= 2), 2)
        assert.strictEqual(root.list.find(num => num >= 4), undefined)
        root.list.find(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
      })

      it('findIndex()', () => {
        assert.strictEqual(root.empty.findIndex(() => true), -1)
        assert.strictEqual(root.list.findIndex(num => num >= 2), 1)
        assert.strictEqual(root.list.findIndex(num => num >= 4), -1)
        root.list.findIndex(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
      })

      it('forEach()', () => {
        root.empty.forEach(() => { assert.fail('was called', 'not called', 'callback error') })
        let binary = []
        root.list.forEach(num => binary.push(num.toString(2)))
        assert.deepEqual(binary, ['1', '10', '11'])
        root.list.forEach(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
      })

      it('includes()', () => {
        assert.strictEqual(root.empty.includes(3), false)
        assert.strictEqual(root.list.includes(3), true)
        assert.strictEqual(root.list.includes(1, 1), false)
        assert.strictEqual(root.list.includes(2, -2), true)
        assert.strictEqual(root.list.includes(0), false)
      })

      it('indexOf()', () => {
        assert.strictEqual(root.empty.indexOf(3), -1)
        assert.strictEqual(root.list.indexOf(3), 2)
        assert.strictEqual(root.list.indexOf(1, 1), -1)
        assert.strictEqual(root.list.indexOf(2, -2), 1)
        assert.strictEqual(root.list.indexOf(0), -1)
      })

      it('join()', () => {
        assert.strictEqual(root.empty.join(', '), '')
        assert.strictEqual(root.list.join(), '1,2,3')
        assert.strictEqual(root.list.join(''), '123')
        assert.strictEqual(root.list.join(', '), '1, 2, 3')
      })

      it('keys()', () => {
        let keys = []
        for (let x of root.list.keys()) keys.push(x)
        assert.deepEqual(keys, [0, 1, 2])
        assert.deepEqual([...root.list.keys()], [0, 1, 2])
      })

      it('lastIndexOf()', () => {
        assert.strictEqual(root.empty.lastIndexOf(3), -1)
        assert.strictEqual(root.list.lastIndexOf(3), 2)
        assert.strictEqual(root.list.lastIndexOf(3, 1), -1)
        assert.strictEqual(root.list.lastIndexOf(3, -1), 2)
        assert.strictEqual(root.list.lastIndexOf(0), -1)
      })

      it('map()', () => {
        assert.deepEqual(root.empty.map(num => num * 2), [])
        assert.deepEqual(root.list.map(num => num * 2), [2, 4, 6])
        assert.deepEqual(root.list.map((num, index) => index + '->' + num), ['0->1', '1->2', '2->3'])
        root.list.map(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
      })

      it('reduce()', () => {
        assert.strictEqual(root.empty.reduce((sum, val) => sum + val, 0), 0)
        assert.strictEqual(root.list.reduce((sum, val) => sum + val, 0), 6)
        assert.strictEqual(root.list.reduce((sum, val) => sum + val, ''), '123')
        assert.strictEqual(root.list.reduce((sum, val) => sum + val), 6)
        assert.strictEqual(root.list.reduce((sum, val, index) => (index % 2 === 0) ? (sum + val) : sum, 0), 4)
      })

      it('reduceRight()', () => {
        assert.strictEqual(root.empty.reduceRight((sum, val) => sum + val, 0), 0)
        assert.strictEqual(root.list.reduceRight((sum, val) => sum + val, 0), 6)
        assert.strictEqual(root.list.reduceRight((sum, val) => sum + val, ''), '321')
        assert.strictEqual(root.list.reduceRight((sum, val) => sum + val), 6)
        assert.strictEqual(root.list.reduceRight((sum, val, index) => (index % 2 === 0) ? (sum + val) : sum, 0), 4)
      })

      it('slice()', () => {
        assert.deepEqual(root.empty.slice(), [])
        assert.deepEqual(root.list.slice(2), [3])
        assert.deepEqual(root.list.slice(-2), [2, 3])
        assert.deepEqual(root.list.slice(0, 0), [])
        assert.deepEqual(root.list.slice(0, 1), [1])
        assert.deepEqual(root.list.slice(0, -1), [1, 2])
      })

      it('some()', () => {
        assert.strictEqual(root.empty.some(() => true), false)
        assert.strictEqual(root.list.some(val => val > 2), true)
        assert.strictEqual(root.list.some(val => val > 4), false)
        assert.strictEqual(root.list.some((val, index) => index > 2), false)
        root.list.some(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
      })

      it('toString()', () => {
        assert.strictEqual(root.empty.toString(), '')
        assert.strictEqual(root.list.toString(), '1,2,3')
      })

      it('values()', () => {
        let values = []
        for (let x of root.list.values()) values.push(x)
        assert.deepEqual(values, [1, 2, 3])
        assert.deepEqual([...root.list.values()], [1, 2, 3])
      })
    })

    describe('should support standard mutation methods', () => {
      it('fill()', () => {
        root = tesseract.changeset(root, doc => doc.list.fill('a'))
        assert.deepEqual(root.list, ['a', 'a', 'a'])
        root = tesseract.changeset(root, doc => doc.list.fill('c', 1).fill('b', 1, 2))
        assert.deepEqual(root.list, ['a', 'b', 'c'])
      })

      it('pop()', () => {
        root = tesseract.changeset(root, doc => assert.strictEqual(doc.list.pop(), 3))
        assert.deepEqual(root.list, [1, 2])
        root = tesseract.changeset(root, doc => assert.strictEqual(doc.list.pop(), 2))
        assert.deepEqual(root.list, [1])
        root = tesseract.changeset(root, doc => assert.strictEqual(doc.list.pop(), 1))
        assert.deepEqual(root.list, [])
        root = tesseract.changeset(root, doc => assert.strictEqual(doc.list.pop(), undefined))
        assert.deepEqual(root.list, [])
      })

      it('push()', () => {
        root = tesseract.changeset(root, doc => doc.noodles = [])
        root = tesseract.changeset(root, doc => doc.noodles.push('udon', 'soba'))
        root = tesseract.changeset(root, doc => doc.noodles.push('ramen'))
        assert.deepEqual(root.noodles, ['udon', 'soba', 'ramen'])
        assert.strictEqual(root.noodles[0], 'udon')
        assert.strictEqual(root.noodles[1], 'soba')
        assert.strictEqual(root.noodles[2], 'ramen')
        assert.strictEqual(root.noodles.length, 3)
      })

      it('shift()', () => {
        root = tesseract.changeset(root, doc => assert.strictEqual(doc.list.shift(), 1))
        assert.deepEqual(root.list, [2, 3])
        root = tesseract.changeset(root, doc => assert.strictEqual(doc.list.shift(), 2))
        assert.deepEqual(root.list, [3])
        root = tesseract.changeset(root, doc => assert.strictEqual(doc.list.shift(), 3))
        assert.deepEqual(root.list, [])
        root = tesseract.changeset(root, doc => assert.strictEqual(doc.list.shift(), undefined))
        assert.deepEqual(root.list, [])
      })

      it('splice()', () => {
        root = tesseract.changeset(root, doc => doc.list.splice(1))
        assert.deepEqual(root.list, [1])
        root = tesseract.changeset(root, doc => doc.list.splice(0, 0, 'a', 'b', 'c'))
        assert.deepEqual(root.list, ['a', 'b', 'c', 1])
        root = tesseract.changeset(root, doc => doc.list.splice(1, 2, '-->'))
        assert.deepEqual(root.list, ['a', '-->', 1])
      })

      it('unshift()', () => {
        root = tesseract.changeset(root, doc => doc.noodles = [])
        root = tesseract.changeset(root, doc => doc.noodles.unshift('soba', 'udon'))
        root = tesseract.changeset(root, doc => doc.noodles.unshift('ramen'))
        assert.deepEqual(root.noodles, ['ramen', 'soba', 'udon'])
        assert.strictEqual(root.noodles[0], 'ramen')
        assert.strictEqual(root.noodles[1], 'soba')
        assert.strictEqual(root.noodles[2], 'udon')
        assert.strictEqual(root.noodles.length, 3)
      })
    })
  })
})
