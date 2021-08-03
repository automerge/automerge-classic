const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { assertEqualsOneOf } = require('./helpers')
const UUID_PATTERN = /^[0-9a-f]{32}$/
const { setProxyFree } = require('../frontend/proxies')

describe('Automerge polyfill proxy API', () => {

  before(() => {
    Automerge.useProxyFreeAPI()
  })

  after(() => {
    setProxyFree(false)
  })

  describe('root object', () => {
    it('should have a fixed object ID', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.strictEqual(Automerge.getObjectId(doc), '_root')
      })
    })

    it('should know its actor ID', () => {
      Automerge.change(Automerge.init(), doc => {
        assert(UUID_PATTERN.test(Automerge.getActorId(doc).toString()))
        assert.notEqual(Automerge.getActorId(doc), '_root')
        assert.strictEqual(Automerge.getActorId(Automerge.init('01234567')), '01234567')
      })
    })

    it('should expose keys as object properties', () => {
      Automerge.change(Automerge.init(), doc => {
        doc.set('key1', 'value1')
        assert.strictEqual(doc.get('key1'), 'value1')
      })
    })

    it('should return undefined for unknown properties', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.strictEqual(doc.get('someProperty'), undefined)
      })
    })

    it('should support ownKeys()', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.deepStrictEqual(doc.ownKeys(), [])
        doc.set('key1', 'value1')
        assert.deepStrictEqual(doc.ownKeys(), ['key1'])
        doc.set('key2', 'value2')
        assertEqualsOneOf(doc.ownKeys(), ['key1', 'key2'], ['key2', 'key1'])
      })
    })

    it('should support .getOwnPropertyNames()', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.deepStrictEqual(doc.getOwnPropertyNames(), [])
        doc.set('key1', 'value1')
        assert.deepStrictEqual(doc.getOwnPropertyNames(), ['key1'])
        doc.set('key2', 'value2')
        assertEqualsOneOf(doc.getOwnPropertyNames(), ['key1', 'key2'], ['key2', 'key1'])
      })
    })

    it('should support bulk assignment with assign()', () => {
      Automerge.change(Automerge.init(), doc => {
        doc.assign({key1: 'value1', key2: 'value2'})
        assert.strictEqual(doc.get('key1'), 'value1')
        assert.strictEqual(doc.get('key2'), 'value2')
      })
    })

    it('should support JSON.stringify()', () => {
      Automerge.change(Automerge.init(), doc => {
        assert.deepStrictEqual(JSON.stringify(doc), '{}')
        doc.set('key1', 'value1')
        assert.deepStrictEqual(JSON.stringify(doc), '{"key1":"value1"}')
        doc.set('key2', 'value2')
        assert.deepStrictEqual(JSON.parse(JSON.stringify(doc)), {
          key1: 'value1', key2: 'value2'
        })
      })
    })

    it('should allow access to an object by id', () => {
      const doc = Automerge.change(Automerge.init(), doc => {
        doc.set('deepObj', {})
        let a = doc.get('deepObj')
        a.set('deepList', {})

        const listId = Automerge.getObjectId(doc.get('deepObj').get('deepList'))
        assert.throws(() => { Automerge.getObjectById(doc, listId) }, /Cannot use getObjectById in a change callback/)
      })

      const objId = Automerge.getObjectId(doc.deepObj)
      assert.strictEqual(Automerge.getObjectById(doc, objId), doc.deepObj)
      const listId = Automerge.getObjectId(doc.deepObj.deepList)
      assert.strictEqual(Automerge.getObjectById(doc, listId), doc.deepObj.deepList)
    })

    it('should support iteration', () => {
      Automerge.change(Automerge.init(), doc => {
        doc.set('key1', 'value1')
        doc.set('key2', 'value2')
        doc.set('key3', 'value3')
        let copy = {}
        for (const [key, value] of doc) copy[key] = value
        assert.deepStrictEqual(copy, {key1: 'value1', key2: 'value2', key3: 'value3'})

        // spread operator also uses iteration protocol
        assert.deepStrictEqual([['key0', 'value0'], ...doc, ['key4', 'value4']], [['key0', 'value0'], ['key1', 'value1'], ['key2', 'value2'], ['key3', 'value3'], ['key4', 'value4']])
      })
    })
  })

  describe('list object', () => {
    let root
    beforeEach(() => {
      root = Automerge.change(Automerge.init(), doc => {
        doc.set('list', [1, 2, 3])
        doc.set('empty', [])
        doc.set('listObjects', [ {id: "first"}, {id: "second"} ])
      })
    })

    it('should look like a JavaScript array', () => {
      Automerge.change(root, doc => {
        assert.strictEqual((doc.get('list').isArray()), true)
        assert.strictEqual(typeof doc.get('list'), 'object')
      })
    })

    it('should have a length property', () => {
      Automerge.change(root, doc => {
        assert.strictEqual(doc.get('empty').length(), 0)
        assert.strictEqual(doc.get('list').length(), 3)
      })
    })

    it('should allow entries to be fetched by index', () => {
      Automerge.change(root, doc => {
        assert.strictEqual(doc.get('list').get(0),   1)
        assert.strictEqual(doc.get('list').get('0'), 1)
        assert.strictEqual(doc.get('list').get(1),   2)
        assert.strictEqual(doc.get('list').get('1'), 2)
        assert.strictEqual(doc.get('list').get(2),   3)
        assert.strictEqual(doc.get('list').get('2'), 3)
        assert.strictEqual(doc.get('list').get(3),   undefined)
        assert.strictEqual(doc.get('list').get('3'), undefined)
        assert.strictEqual(doc.get('list').get(-1),  undefined)
        assert.strictEqual(doc.get('list').get('someProperty'), undefined)
      })
    })

    it('should support .has()', () => {
      Automerge.change(root, doc => {
        assert.strictEqual(doc.get('list').has(0), true)
        assert.strictEqual(doc.get('list').has('0'), true)
        assert.strictEqual(doc.get('list').has(3), false)
        assert.strictEqual(doc.get('list').has('3'), false)
        assert.strictEqual(doc.get('list').has('length'), true)
        assert.strictEqual(doc.get('list').has('someProperty'), false)
      })
    })

    it('should support .objectKeys()', () => {
      Automerge.change(root, doc => {
        assert.deepStrictEqual(doc.get('list').objectKeys(), ['0', '1', '2'])
      })
    })

    it('should support .getOwnPropertyNames()', () => {
      Automerge.change(root, doc => {
        assert.deepStrictEqual(doc.get('list').getOwnPropertyNames(), ['length', '0', '1', '2'])
      })
    })

    it('should support JSON.stringify()', () => {
      Automerge.change(root, doc => {
        assert.deepStrictEqual(JSON.parse(JSON.stringify(doc)), {
          list: [1, 2, 3], empty: [], listObjects: [ {id: "first"}, {id: "second"} ]
        })
        assert.deepStrictEqual(JSON.stringify(doc.get('list')), '[1,2,3]')
      })
    })

    it('should support iteration', () => {
      Automerge.change(root, doc => {
        let copy = []
        for (let x of doc.get('list')) copy.push(x)
        assert.deepStrictEqual(copy, [1, 2, 3])

        // spread operator also uses iteration protocol
        assert.deepStrictEqual([0, ...doc.get('list'), 4], [0, 1, 2, 3, 4])
      })
    })

    describe('should support standard array read-only operations', () => {
      it('concat()', () => {
        Automerge.change(root, doc => {
          assert.deepStrictEqual(doc.get('list').concat([4, 5, 6]), [1, 2, 3, 4, 5, 6])
          assert.deepStrictEqual(doc.get('list').concat([4], [5, [6]]), [1, 2, 3, 4, 5, [6]])
        })
      })

      it('entries()', () => {
        Automerge.change(root, doc => {
          let copy = []
          for (let x of doc.get('list').entries()) copy.push(x)
          assert.deepStrictEqual(copy, [[0, 1], [1, 2], [2, 3]])
          assert.deepStrictEqual([...doc.get('list').entries()], [[0, 1], [1, 2], [2, 3]])
        })
      })

      it('every()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').every(() => false), true)
          assert.strictEqual(doc.get('list').every(val => val > 0), true)
          assert.strictEqual(doc.get('list').every(val => val > 2), false)
          assert.strictEqual(doc.get('list').every((val, index) => index < 3), true)
          // check that in the callback, 'this' is set to the second argument of 'every'
          doc.get('list').every(function () { assert.strictEqual(this.hello, 'world'); return true }, {hello: 'world'})
        })
      })

      it('filter()', () => {
        Automerge.change(root, doc => {
          assert.deepStrictEqual(doc.get('empty').filter(() => false), [])
          assert.deepStrictEqual(doc.get('list').filter(num => num % 2 === 1), [1, 3])
          assert.deepStrictEqual(doc.get('list').filter(() => true), [1, 2, 3])
          doc.get('list').filter(function () { assert.strictEqual(this.hello, 'world'); return true }, {hello: 'world'})
        })
      })

      it('find()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').find(() => true), undefined)
          assert.strictEqual(doc.get('list').find(num => num >= 2), 2)
          assert.strictEqual(doc.get('list').find(num => num >= 4), undefined)
          doc.get('list').find(function () { assert.strictEqual(this.hello, 'world'); return true }, {hello: 'world'})
        })
      })

      it('findIndex()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').findIndex(() => true), -1)
          assert.strictEqual(doc.get('list').findIndex(num => num >= 2), 1)
          assert.strictEqual(doc.get('list').findIndex(num => num >= 4), -1)
          doc.get('list').findIndex(function () { assert.strictEqual(this.hello, 'world'); return true }, {hello: 'world'})
        })
      })

      it('forEach()', () => {
        Automerge.change(root, doc => {
          doc.get('empty').forEach(() => { assert.fail('was called', 'not called', 'callback error') })
          let binary = []
          doc.get('list').forEach(num => binary.push(num.toString(2)))
          assert.deepStrictEqual(binary, ['1', '10', '11'])
          doc.get('list').forEach(function () { assert.strictEqual(this.hello, 'world'); return true }, {hello: 'world'})
        })
      })

      it('includes()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').includes(3), false)
          assert.strictEqual(doc.get('list').includes(3), true)
          assert.strictEqual(doc.get('list').includes(1, 1), false)
          assert.strictEqual(doc.get('list').includes(2, -2), true)
          assert.strictEqual(doc.get('list').includes(0), false)
        })
      })

      it('indexOf()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').indexOf(3), -1)
          assert.strictEqual(doc.get('list').indexOf(3), 2)
          assert.strictEqual(doc.get('list').indexOf(1, 1), -1)
          assert.strictEqual(doc.get('list').indexOf(2, -2), 1)
          assert.strictEqual(doc.get('list').indexOf(0), -1)
        })
      })

      it('indexOf() with objects', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('listObjects').indexOf(doc.get('listObjects').get(0)), 0)
          assert.strictEqual(doc.get('listObjects').indexOf(doc.get('listObjects').get(1)), 1)

          assert.strictEqual(doc.get('listObjects').indexOf(doc.get('listObjects').get(0), 0), 0)
          assert.strictEqual(doc.get('listObjects').indexOf(doc.get('listObjects').get(0), 1), -1)
          assert.strictEqual(doc.get('listObjects').indexOf(doc.get('listObjects').get(1), 0), 1)
          assert.strictEqual(doc.get('listObjects').indexOf(doc.get('listObjects').get(1), 1), 1)
        })
      })

      it('join()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').join(', '), '')
          assert.strictEqual(doc.get('list').join(), '1,2,3')
          assert.strictEqual(doc.get('list').join(''), '123')
          assert.strictEqual(doc.get('list').join(', '), '1, 2, 3')
        })
      })

      it('keys()', () => {
        Automerge.change(root, doc => {
          let keys = []
          for (let x of doc.get('list').keys()) keys.push(x)
          assert.deepStrictEqual(keys, [0, 1, 2])
          assert.deepStrictEqual([...doc.get('list').keys()], [0, 1, 2])
        })
      })

      it('lastIndexOf()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').lastIndexOf(3), -1)
          assert.strictEqual(doc.get('list').lastIndexOf(3), 2)
          assert.strictEqual(doc.get('list').lastIndexOf(3, 1), -1)
          assert.strictEqual(doc.get('list').lastIndexOf(3, -1), 2)
          assert.strictEqual(doc.get('list').lastIndexOf(0), -1)
        })
      })

      it('map()', () => {
        Automerge.change(root, doc => {
          assert.deepStrictEqual(doc.get('empty').map(num => num * 2), [])
          assert.deepStrictEqual(doc.get('list').map(num => num * 2), [2, 4, 6])
          assert.deepStrictEqual(doc.get('list').map((num, index) => index + '->' + num), ['0->1', '1->2', '2->3'])
          doc.get('list').map(function () { assert.strictEqual(this.hello, 'world'); return true }, {hello: 'world'})
        })
      })

      it('reduce()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').reduce((sum, val) => sum + val, 0), 0)
          assert.strictEqual(doc.get('list').reduce((sum, val) => sum + val, 0), 6)
          assert.strictEqual(doc.get('list').reduce((sum, val) => sum + val, ''), '123')
          assert.strictEqual(doc.get('list').reduce((sum, val) => sum + val), 6)
          assert.strictEqual(doc.get('list').reduce((sum, val, index) => ((index % 2 === 0) ? (sum + val) : sum), 0), 4)
        })
      })

      it('reduceRight()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').reduceRight((sum, val) => sum + val, 0), 0)
          assert.strictEqual(doc.get('list').reduceRight((sum, val) => sum + val, 0), 6)
          assert.strictEqual(doc.get('list').reduceRight((sum, val) => sum + val, ''), '321')
          assert.strictEqual(doc.get('list').reduceRight((sum, val) => sum + val), 6)
          assert.strictEqual(doc.get('list').reduceRight((sum, val, index) => ((index % 2 === 0) ? (sum + val) : sum), 0), 4)
        })
      })

      it('slice()', () => {
        Automerge.change(root, doc => {
          assert.deepStrictEqual(doc.get('empty').slice(), [])
          assert.deepStrictEqual(doc.get('list').slice(2), [3])
          assert.deepStrictEqual(doc.get('list').slice(-2), [2, 3])
          assert.deepStrictEqual(doc.get('list').slice(0, 0), [])
          assert.deepStrictEqual(doc.get('list').slice(0, 1), [1])
          assert.deepStrictEqual(doc.get('list').slice(0, -1), [1, 2])
        })
      })

      it('some()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').some(() => true), false)
          assert.strictEqual(doc.get('list').some(val => val > 2), true)
          assert.strictEqual(doc.get('list').some(val => val > 4), false)
          assert.strictEqual(doc.get('list').some((val, index) => index > 2), false)
          doc.get('list').some(function () { assert.strictEqual(this.hello, 'world'); return true }, {hello: 'world'})
        })
      })

      it('toString()', () => {
        Automerge.change(root, doc => {
          assert.strictEqual(doc.get('empty').toString(), '')
          assert.strictEqual(doc.get('list').toString(), '1,2,3')
        })
      })

      it('values()', () => {
        Automerge.change(root, doc => {
          let values = []
          for (let x of doc.get('list').values()) values.push(x)
          assert.deepStrictEqual(values, [1, 2, 3])
          assert.deepStrictEqual([...doc.get('list').values()], [1, 2, 3])
        })
      })

      it('should allow mutation of objects returned from built in list iteration', () => {
        root = Automerge.change(Automerge.init({freeze: true}), doc => {
          doc.set('objects', [{id: 1, value: 'one'}, {id: 2, value: 'two'}])
        })
        root = Automerge.change(root, doc => {
          for (let obj of doc.get('objects')) if (obj.get('id') === 1) obj.set('value', 'ONE!')
        })
        assert.deepStrictEqual(root, {objects: [{id: 1, value: 'ONE!'}, {id: 2, value: 'two'}]})
      })

      it('should allow mutation of objects returned from readonly list methods', () => {
        root = Automerge.change(Automerge.init({freeze: true}), doc => {
          doc.set('objects', [{id: 1, value: 'one'}, {id: 2, value: 'two'}])
        })
        root = Automerge.change(root, doc => {
          doc.get('objects').find(obj => obj.get('id') === 1).set('value', 'ONE!')
        })
        assert.deepStrictEqual(root, {objects: [{id: 1, value: 'ONE!'}, {id: 2, value: 'two'}]})
      })
    })

    describe('should support standard mutation methods', () => {
      it('fill()', () => {
        root = Automerge.change(root, doc => doc.get('list').fill('a'))
        assert.deepStrictEqual(root.list, ['a', 'a', 'a'])
        root = Automerge.change(root, doc => doc.get('list').fill('c', 1).fill('b', 1, 2))
        assert.deepStrictEqual(root.list, ['a', 'b', 'c'])
      })

      it('pop()', () => {
        root = Automerge.change(root, doc => assert.strictEqual(doc.get('list').pop(), 3))
        assert.deepStrictEqual(root.list, [1, 2])
        root = Automerge.change(root, doc => assert.strictEqual(doc.get('list').pop(), 2))
        assert.deepStrictEqual(root.list, [1])
        root = Automerge.change(root, doc => assert.strictEqual(doc.get('list').pop(), 1))
        assert.deepStrictEqual(root.list, [])
        root = Automerge.change(root, doc => assert.strictEqual(doc.get('list').pop(), undefined))
        assert.deepStrictEqual(root.list, [])
      })

      it('push()', () => {
        root = Automerge.change(root, doc => doc.set('noodles', []))
        root = Automerge.change(root, doc => doc.get('noodles').push('udon', 'soba'))
        root = Automerge.change(root, doc => doc.get('noodles').push('ramen'))
        assert.deepStrictEqual(root.noodles, ['udon', 'soba', 'ramen'])
        assert.strictEqual(root.noodles[0], 'udon')
        assert.strictEqual(root.noodles[1], 'soba')
        assert.strictEqual(root.noodles[2], 'ramen')
        assert.strictEqual(root.noodles.length, 3)
      })

      it('shift()', () => {
        root = Automerge.change(root, doc => assert.strictEqual(doc.get('list').shift(), 1))
        assert.deepStrictEqual(root.list, [2, 3])
        root = Automerge.change(root, doc => assert.strictEqual(doc.get('list').shift(), 2))
        assert.deepStrictEqual(root.list, [3])
        root = Automerge.change(root, doc => assert.strictEqual(doc.get('list').shift(), 3))
        assert.deepStrictEqual(root.list, [])
        root = Automerge.change(root, doc => assert.strictEqual(doc.get('list').shift(), undefined))
        assert.deepStrictEqual(root.list, [])
      })

      it('splice()', () => {
        root = Automerge.change(root, doc => assert.deepStrictEqual(doc.get('list').splice(1), [2, 3]))
        assert.deepStrictEqual(root.list, [1])
        root = Automerge.change(root, doc => assert.deepStrictEqual(doc.get('list').splice(0, 0, 'a', 'b', 'c'), []))
        assert.deepStrictEqual(root.list, ['a', 'b', 'c', 1])
        root = Automerge.change(root, doc => assert.deepStrictEqual(doc.get('list').splice(1, 2, '-->'), ['b', 'c']))
        assert.deepStrictEqual(root.list, ['a', '-->', 1])
        root = Automerge.change(root, doc => assert.deepStrictEqual(doc.get('list').splice(2, 200, 2), [1]))
        assert.deepStrictEqual(root.list, ['a', '-->', 2])
      })

      it('unshift()', () => {
        root = Automerge.change(root, doc => doc.set('noodles', []))
        root = Automerge.change(root, doc => doc.get('noodles').unshift('soba', 'udon'))
        root = Automerge.change(root, doc => doc.get('noodles').unshift('ramen'))
        assert.deepStrictEqual(root.noodles, ['ramen', 'soba', 'udon'])
        assert.strictEqual(root.noodles[0], 'ramen')
        assert.strictEqual(root.noodles[1], 'soba')
        assert.strictEqual(root.noodles[2], 'udon')
        assert.strictEqual(root.noodles.length, 3)
      })
    })
  })
})
