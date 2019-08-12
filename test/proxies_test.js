const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { assertEqualsOneOf } = require('./helpers')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'
const UUID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

describe('Automerge proxy API', () => {
  describe('root object', () => {
    it('should have a fixed object ID', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.strictEqual(Automerge.getObjectId(doc), ROOT_ID)
      })
    })

    it('should know its actor ID', () => {
      Automerge.change(Automerge.init(), doc => {
        assert(UUID_PATTERN.test(Automerge.getActorId(doc).toString()))
        assert.notEqual(Automerge.getActorId(doc), ROOT_ID)
        assert.strictEqual(Automerge.getActorId(Automerge.init('customActorId')), 'customActorId')
      })
    })

    it('should expose keys as object properties', () => {
      Automerge.change(Automerge.init(), doc => {
        doc.key1 = 'value1'
        assert.strictEqual(doc.key1, 'value1')
        assert.strictEqual(doc['key1'], 'value1')
      })
    })

    it('should return undefined for unknown properties', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.strictEqual(doc.someProperty, undefined)
        assert.strictEqual(doc['someProperty'], undefined)
      })
    })

    it('should support the "in" operator', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.strictEqual('key1' in doc, false)
        doc.key1 = 'value1'
        assert.strictEqual('key1' in doc, true)
      })
    })

    it('should support Object.keys()', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.deepEqual(Object.keys(doc), [])
        doc.key1 = 'value1'
        assert.deepEqual(Object.keys(doc), ['key1'])
        doc.key2 = 'value2'
        assertEqualsOneOf(Object.keys(doc), ['key1', 'key2'], ['key2', 'key1'])
      })
    })

    it('should support Object.getOwnPropertyNames()', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.deepEqual(Object.getOwnPropertyNames(doc), [])
        doc.key1 = 'value1'
        assert.deepEqual(Object.getOwnPropertyNames(doc), ['key1'])
        doc.key2 = 'value2'
        assertEqualsOneOf(Object.getOwnPropertyNames(doc), ['key1', 'key2'], ['key2', 'key1'])
      })
    })

    it('should support bulk assignment with Object.assign()', () => {
      Automerge.change(Automerge.init(), doc => {
        Object.assign(doc, {key1: 'value1', key2: 'value2'})
        assert.deepEqual(doc, {key1: 'value1', key2: 'value2'})
      })
    })

    it('should support JSON.stringify()', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.deepEqual(JSON.stringify(doc), '{}')
        doc.key1 = 'value1'
        assert.deepEqual(JSON.stringify(doc), '{"key1":"value1"}')
        doc.key2 = 'value2'
        assert.deepEqual(JSON.parse(JSON.stringify(doc)), {
          key1: 'value1', key2: 'value2'
        })
      })
    })

    it('should allow access to an object by id', () => {
      let deepObjId, deepListId

      const doc = Automerge.change(Automerge.init(), doc => {
        const rootObj = Automerge.getObjectById(doc, ROOT_ID)
        assert.strictEqual(Automerge.getObjectId(rootObj), Automerge.getObjectId(doc))

        rootObj.deepObj = {}
        deepObjId = Automerge.getObjectId(doc.deepObj)
        const deepObj = Automerge.getObjectById(doc, deepObjId)
        assert.strictEqual(Automerge.getObjectId(deepObj), deepObjId)

        deepObj.deepList = []
        deepListId = Automerge.getObjectId(doc.deepObj.deepList)
        const deepList = Automerge.getObjectById(doc, deepListId)
        assert.strictEqual(Automerge.getObjectId(deepList), deepListId)
      })

      const deepObj = Automerge.getObjectById(doc, deepObjId)
      assert.strictEqual(Automerge.getObjectId(deepObj), Automerge.getObjectId(doc.deepObj))
      const deepList = Automerge.getObjectById(doc, deepListId)
      assert.strictEqual(Automerge.getObjectId(deepList), Automerge.getObjectId(doc.deepObj.deepList))
    })
  })

  describe('list object', () => {
    let root
    beforeEach(() => {
      root = Automerge.change(Automerge.init(), doc => { doc.list = [1, 2, 3]; doc.empty = [] })
    })

    it('should look like a JavaScript array', () => {
      Automerge.change(root, doc => {
        assert.strictEqual(Array.isArray(doc.list), true)
        assert.strictEqual(typeof doc.list, 'object')
        assert.strictEqual(toString.call(doc.list), '[object Array]')
      })
    })

    it('should have a length property', () => {
      Automerge.change(root, doc => {
        assert.strictEqual(doc.empty.length, 0)
        assert.strictEqual(doc.list.length, 3)
      })
    })

    it('should allow entries to be fetched by index', () => {
      Automerge.change(root, doc => {
        assert.strictEqual(doc.list[0],   1)
        assert.strictEqual(doc.list['0'], 1)
        assert.strictEqual(doc.list[1],   2)
        assert.strictEqual(doc.list['1'], 2)
        assert.strictEqual(doc.list[2],   3)
        assert.strictEqual(doc.list['2'], 3)
        assert.strictEqual(doc.list[3],   undefined)
        assert.strictEqual(doc.list['3'], undefined)
        assert.strictEqual(doc.list[-1],  undefined)
        assert.strictEqual(doc.list.someProperty,    undefined)
        assert.strictEqual(doc.list['someProperty'], undefined)
      })
    })

    it('should support the "in" operator', () => {
      Automerge.change(root, doc => {
        assert.strictEqual(0 in doc.list, true)
        assert.strictEqual('0' in doc.list, true)
        assert.strictEqual(3 in doc.list, false)
        assert.strictEqual('3' in doc.list, false)
        assert.strictEqual('length' in doc.list, true)
        assert.strictEqual('someProperty' in doc.list, false)
      })
    })

    it('should support Object.keys()', () => {
      Automerge.change(root, doc => {
        assert.deepEqual(Object.keys(doc.list), ['0', '1', '2'])
      })
    })

    it('should support Object.getOwnPropertyNames()', () => {
      Automerge.change(root, doc => {
        assert.deepEqual(Object.getOwnPropertyNames(doc.list), ['length', '0', '1', '2'])
      })
    })

    it('should support JSON.stringify()', () => {
      Automerge.change(root, doc => {
        assert.deepEqual(JSON.parse(JSON.stringify(doc)), {
          list: [1, 2, 3], empty: []
        })
        assert.deepEqual(JSON.stringify(doc.list), '[1,2,3]')
      })
    })

    it('should support iteration', () => {
      Automerge.change(root, doc => {
        let copy = []
        for (let x of doc.list) copy.push(x)
        assert.deepEqual(copy, [1, 2, 3])

        // spread operator also uses iteration protocol
        assert.deepEqual([0, ...doc.list, 4], [0, 1, 2, 3, 4])
      })
    })

    describe('should support standard array read-only operations', () => {
      it('concat()', () => {
        Automerge.change(root, doc => {
          assert.deepEqual(doc.list.concat([4, 5, 6]), [1, 2, 3, 4, 5, 6])
          assert.deepEqual(doc.list.concat([4], [5, [6]]), [1, 2, 3, 4, 5, [6]])
        })
      })

      it('entries()', () => {
        Automerge.change(root, doc => {
          let copy = []
          for (let x of doc.list.entries()) copy.push(x)
          assert.deepEqual(copy, [[0, 1], [1, 2], [2, 3]])
          assert.deepEqual([...doc.list.entries()], [[0, 1], [1, 2], [2, 3]])
        })
      })

      it('every()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.every(() => false), true)
          assert.strictEqual(doc.list.every(val => val > 0), true)
          assert.strictEqual(doc.list.every(val => val > 2), false)
          assert.strictEqual(doc.list.every((val, index) => index < 3), true)
          doc.list.every(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
        })
      })

      it('filter()', () => {
        Automerge.change(root, doc => {
          assert.deepEqual(doc.empty.filter(() => false), [])
          assert.deepEqual(doc.list.filter(num => num % 2 === 1), [1, 3])
          assert.deepEqual(doc.list.filter(num => true), [1, 2, 3])
          doc.list.filter(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
        })
      })

      it('find()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.find(() => true), undefined)
          assert.strictEqual(doc.list.find(num => num >= 2), 2)
          assert.strictEqual(doc.list.find(num => num >= 4), undefined)
          doc.list.find(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
        })
      })

      it('findIndex()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.findIndex(() => true), -1)
          assert.strictEqual(doc.list.findIndex(num => num >= 2), 1)
          assert.strictEqual(doc.list.findIndex(num => num >= 4), -1)
          doc.list.findIndex(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
        })
      })

      it('forEach()', () => {
        Automerge.change(root, doc => {
          doc.empty.forEach(() => { assert.fail('was called', 'not called', 'callback error') })
          let binary = []
          doc.list.forEach(num => binary.push(num.toString(2)))
          assert.deepEqual(binary, ['1', '10', '11'])
          doc.list.forEach(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
        })
      })

      it('includes()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.includes(3), false)
          assert.strictEqual(doc.list.includes(3), true)
          assert.strictEqual(doc.list.includes(1, 1), false)
          assert.strictEqual(doc.list.includes(2, -2), true)
          assert.strictEqual(doc.list.includes(0), false)
        })
      })

      it('indexOf()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.indexOf(3), -1)
          assert.strictEqual(doc.list.indexOf(3), 2)
          assert.strictEqual(doc.list.indexOf(1, 1), -1)
          assert.strictEqual(doc.list.indexOf(2, -2), 1)
          assert.strictEqual(doc.list.indexOf(0), -1)
        })
      })

      it('join()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.join(', '), '')
          assert.strictEqual(doc.list.join(), '1,2,3')
          assert.strictEqual(doc.list.join(''), '123')
          assert.strictEqual(doc.list.join(', '), '1, 2, 3')
        })
      })

      it('keys()', () => {
        Automerge.change(root, doc => {
          let keys = []
          for (let x of doc.list.keys()) keys.push(x)
          assert.deepEqual(keys, [0, 1, 2])
          assert.deepEqual([...doc.list.keys()], [0, 1, 2])
        })
      })

      it('lastIndexOf()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.lastIndexOf(3), -1)
          assert.strictEqual(doc.list.lastIndexOf(3), 2)
          assert.strictEqual(doc.list.lastIndexOf(3, 1), -1)
          assert.strictEqual(doc.list.lastIndexOf(3, -1), 2)
          assert.strictEqual(doc.list.lastIndexOf(0), -1)
        })
      })

      it('map()', () => {
        Automerge.change(root, doc => {
          assert.deepEqual(doc.empty.map(num => num * 2), [])
          assert.deepEqual(doc.list.map(num => num * 2), [2, 4, 6])
          assert.deepEqual(doc.list.map((num, index) => index + '->' + num), ['0->1', '1->2', '2->3'])
          doc.list.map(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
        })
      })

      it('reduce()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.reduce((sum, val) => sum + val, 0), 0)
          assert.strictEqual(doc.list.reduce((sum, val) => sum + val, 0), 6)
          assert.strictEqual(doc.list.reduce((sum, val) => sum + val, ''), '123')
          assert.strictEqual(doc.list.reduce((sum, val) => sum + val), 6)
          assert.strictEqual(doc.list.reduce((sum, val, index) => (index % 2 === 0) ? (sum + val) : sum, 0), 4)
        })
      })

      it('reduceRight()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.reduceRight((sum, val) => sum + val, 0), 0)
          assert.strictEqual(doc.list.reduceRight((sum, val) => sum + val, 0), 6)
          assert.strictEqual(doc.list.reduceRight((sum, val) => sum + val, ''), '321')
          assert.strictEqual(doc.list.reduceRight((sum, val) => sum + val), 6)
          assert.strictEqual(doc.list.reduceRight((sum, val, index) => (index % 2 === 0) ? (sum + val) : sum, 0), 4)
        })
      })

      it('slice()', () => {
        Automerge.change(root, doc => {
          assert.deepEqual(doc.empty.slice(), [])
          assert.deepEqual(doc.list.slice(2), [3])
          assert.deepEqual(doc.list.slice(-2), [2, 3])
          assert.deepEqual(doc.list.slice(0, 0), [])
          assert.deepEqual(doc.list.slice(0, 1), [1])
          assert.deepEqual(doc.list.slice(0, -1), [1, 2])
        })
      })

      it('some()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.some(() => true), false)
          assert.strictEqual(doc.list.some(val => val > 2), true)
          assert.strictEqual(doc.list.some(val => val > 4), false)
          assert.strictEqual(doc.list.some((val, index) => index > 2), false)
          doc.list.some(function () { assert.strictEqual(this.hello, 'world') }, {hello: 'world'})
        })
      })

      it('toString()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.empty.toString(), '')
          assert.strictEqual(doc.list.toString(), '1,2,3')
        })
      })

      it('values()', () => {
        Automerge.change(root, doc => {
          let values = []
          for (let x of doc.list.values()) values.push(x)
          assert.deepEqual(values, [1, 2, 3])
          assert.deepEqual([...doc.list.values()], [1, 2, 3])
        })
      })

      it('should allow mutation of objects returned from built in list iteration', () => {
        root = Automerge.change(Automerge.init({freeze: true}), doc => {
          doc.objects = [{id: 1, value: 'one'}, {id: 2, value: 'two'}]
        })
        root = Automerge.change(root, doc => {
          for (let obj of doc.objects) if (obj.id === 1) obj.value = 'ONE!'
        })
        assert.deepEqual(root, {objects: [{id: 1, value: 'ONE!'}, {id: 2, value: 'two'}]})
      })

      it('should allow mutation of objects returned from readonly list methods', () => {
        root = Automerge.change(Automerge.init({freeze: true}), doc => {
          doc.objects = [{id: 1, value: 'one'}, {id: 2, value: 'two'}]
        })
        root = Automerge.change(root, doc => {
          doc.objects.find(obj => obj.id === 1).value = 'ONE!'
        })
        assert.deepEqual(root, {objects: [{id: 1, value: 'ONE!'}, {id: 2, value: 'two'}]})
      })
    })

    describe('should support standard mutation methods', () => {
      it('fill()', () => {
        root = Automerge.change(root, doc => doc.list.fill('a'))
        assert.deepEqual(root.list, ['a', 'a', 'a'])
        root = Automerge.change(root, doc => doc.list.fill('c', 1).fill('b', 1, 2))
        assert.deepEqual(root.list, ['a', 'b', 'c'])
      })

      it('pop()', () => {
        root = Automerge.change(root, doc => assert.strictEqual(doc.list.pop(), 3))
        assert.deepEqual(root.list, [1, 2])
        root = Automerge.change(root, doc => assert.strictEqual(doc.list.pop(), 2))
        assert.deepEqual(root.list, [1])
        root = Automerge.change(root, doc => assert.strictEqual(doc.list.pop(), 1))
        assert.deepEqual(root.list, [])
        root = Automerge.change(root, doc => assert.strictEqual(doc.list.pop(), undefined))
        assert.deepEqual(root.list, [])
      })

      it('push()', () => {
        root = Automerge.change(root, doc => doc.noodles = [])
        root = Automerge.change(root, doc => doc.noodles.push('udon', 'soba'))
        root = Automerge.change(root, doc => doc.noodles.push('ramen'))
        assert.deepEqual(root.noodles, ['udon', 'soba', 'ramen'])
        assert.strictEqual(root.noodles[0], 'udon')
        assert.strictEqual(root.noodles[1], 'soba')
        assert.strictEqual(root.noodles[2], 'ramen')
        assert.strictEqual(root.noodles.length, 3)
      })

      it('shift()', () => {
        root = Automerge.change(root, doc => assert.strictEqual(doc.list.shift(), 1))
        assert.deepEqual(root.list, [2, 3])
        root = Automerge.change(root, doc => assert.strictEqual(doc.list.shift(), 2))
        assert.deepEqual(root.list, [3])
        root = Automerge.change(root, doc => assert.strictEqual(doc.list.shift(), 3))
        assert.deepEqual(root.list, [])
        root = Automerge.change(root, doc => assert.strictEqual(doc.list.shift(), undefined))
        assert.deepEqual(root.list, [])
      })

      it('splice()', () => {
        root = Automerge.change(root, doc => assert.deepEqual(doc.list.splice(1), [2, 3]))
        assert.deepEqual(root.list, [1])
        root = Automerge.change(root, doc => assert.deepEqual(doc.list.splice(0, 0, 'a', 'b', 'c'), []))
        assert.deepEqual(root.list, ['a', 'b', 'c', 1])
        root = Automerge.change(root, doc => assert.deepEqual(doc.list.splice(1, 2, '-->'), ['b', 'c']))
        assert.deepEqual(root.list, ['a', '-->', 1])
      })

      it('unshift()', () => {
        root = Automerge.change(root, doc => doc.noodles = [])
        root = Automerge.change(root, doc => doc.noodles.unshift('soba', 'udon'))
        root = Automerge.change(root, doc => doc.noodles.unshift('ramen'))
        assert.deepEqual(root.noodles, ['ramen', 'soba', 'udon'])
        assert.strictEqual(root.noodles[0], 'ramen')
        assert.strictEqual(root.noodles[1], 'soba')
        assert.strictEqual(root.noodles[2], 'udon')
        assert.strictEqual(root.noodles.length, 3)
      })
    })
  })
})
