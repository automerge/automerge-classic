import * as assert from 'assert'
import Automerge from 'automerge'

import { assertEqualsOneOf } from './helpers'

const ROOT_ID = '00000000-0000-0000-0000-000000000000'
const UUID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

describe('Automerge proxy API', () => {
  describe('root object', () => {
    interface ObjTestDoc {
      key1?: string
      key2?: string
    }

    it('should have a fixed object ID', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
        assert.strictEqual(Automerge.getObjectId(doc), ROOT_ID)
      })
    })

    it('should know its actor ID', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
        assert.strictEqual(UUID_PATTERN.test(Automerge.getActorId(doc).toString()), true)
        assert.notEqual(Automerge.getActorId(doc), ROOT_ID)
        assert.strictEqual(Automerge.getActorId(Automerge.init('customActorId')), 'customActorId')
      })
    })

    it('should expose keys as object properties', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
        doc.key1 = 'value1'
        assert.strictEqual(doc.key1, 'value1')
        assert.strictEqual(doc['key1'], 'value1')
      })
    })

    it('should return undefined for unknown properties', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
        assert.strictEqual(doc.key1, undefined)
        assert.strictEqual(doc['key1'], undefined)
      })
    })

    it('should support the "in" operator', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
        assert.strictEqual('key1' in doc, false)
        doc.key1 = 'value1'
        assert.strictEqual('key1' in doc, true)
      })
    })

    it('should support Object.keys()', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
        assert.deepEqual(Object.keys(doc), [])
        doc.key1 = 'value1'
        assert.deepEqual(Object.keys(doc), ['key1'])
        doc.key2 = 'value2'
        assertEqualsOneOf(Object.keys(doc), ['key1', 'key2'], ['key2', 'key1'])
      })
    })

    it('should support Object.getOwnPropertyNames()', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
        assert.deepEqual(Object.getOwnPropertyNames(doc), [])
        doc.key1 = 'value1'
        assert.deepEqual(Object.getOwnPropertyNames(doc), ['key1'])
        doc.key2 = 'value2'
        assertEqualsOneOf(Object.getOwnPropertyNames(doc), ['key1', 'key2'], ['key2', 'key1'])
      })
    })

    it('should support bulk assignment with Object.assign()', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
        Object.assign(doc, {key1: 'value1', key2: 'value2'})
        assert.deepEqual(doc, {key1: 'value1', key2: 'value2'})
      })
    })

    it('should support JSON.stringify()', () => {
      Automerge.change(Automerge.init<ObjTestDoc>(), (doc: ObjTestDoc) => {
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
      interface DeepDoc {
        deepObj?: DeepDoc
        deepList?: DeepDoc[]
      }
      const doc = Automerge.change<DeepDoc>(Automerge.init<DeepDoc>(), doc => {
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
    interface ListTestDoc {
      numbers: List<number>
      noodles: List<string>
    }

    let root: ListTestDoc

    beforeEach(() => {
      root = Automerge.change(Automerge.init<ListTestDoc>(), (doc: any) => {
        doc.numbers = [1, 2, 3]
        doc.noodles = []
    })
    })

    it('should look like a JavaScript array', () => {
      Automerge.change(root, (doc: ListTestDoc) => {
        assert.strictEqual(Array.isArray(doc.numbers), true)
        assert.strictEqual(typeof doc.numbers, 'object')
        assert.strictEqual(toString.call(doc.numbers), '[object Array]')
      })
    })

    it('should have a length property', () => {
      Automerge.change(root, (doc: ListTestDoc) => {
        assert.strictEqual(doc.numbers.length, 3)
        assert.strictEqual(doc.noodles.length, 0)
      })
    })

    // TODO Is it important to test this with string indexes?
    it('should allow entries to be fetched by index', () => {
      Automerge.change(root, (doc: ListTestDoc) => {
        assert.strictEqual(doc.numbers[0], 1)
        // assert.strictEqual(doc.numbers['0'], 1)
        assert.strictEqual(doc.numbers[1], 2)
        // assert.strictEqual(doc.numbers['1'], 2)
        assert.strictEqual(doc.numbers[2], 3)
        // assert.strictEqual(doc.numbers['2'], 3)
        assert.strictEqual(doc.numbers[3], undefined)
        // assert.strictEqual(doc.numbers['3'], undefined)
        assert.strictEqual(doc.numbers[-1], undefined)
        // assert.strictEqual(doc.numbers.someProperty, undefined)
        // assert.strictEqual(doc.numbers['someProperty'], undefined)
      })
    })

    it('should support the "in" operator', () => {
      Automerge.change(root, (doc: ListTestDoc) => {
        assert.strictEqual(0 in doc.numbers, true)
        assert.strictEqual('0' in doc.numbers, true)
        assert.strictEqual(3 in doc.numbers, false)
        assert.strictEqual('3' in doc.numbers, false)
        assert.strictEqual('length' in doc.numbers, true)
        assert.strictEqual('someProperty' in doc.numbers, false)
      })
    })

    it('should support Object.keys()', () => {
      Automerge.change(root, (doc: ListTestDoc) => {
        assert.deepEqual(Object.keys(doc.numbers), ['0', '1', '2'])
      })
    })

    it('should support Object.getOwnPropertyNames()', () => {
      Automerge.change(root, (doc: ListTestDoc) => {
        assert.deepEqual(Object.getOwnPropertyNames(doc.numbers), ['length', '0', '1', '2'])
      })
    })

    it('should support JSON.stringify()', () => {
      Automerge.change(root, (doc: ListTestDoc) => {
        assert.deepEqual(JSON.parse(JSON.stringify(doc)), {
          numbers: [1, 2, 3],
          noodles: [],
        })
        assert.deepEqual(JSON.stringify(doc.numbers), '[1,2,3]')
      })
    })

    it('should support iteration', () => {
      Automerge.change(root, (doc: ListTestDoc) => {
        let copy = []
        for (let x of doc.numbers) copy.push(x)
        assert.deepEqual(copy, [1, 2, 3])

        // spread operator also uses iteration protocol
        assert.deepEqual([0, ...doc.numbers, 4], [0, 1, 2, 3, 4])
      })
    })

    describe('should support standard array read-only operations', () => {
      it('concat()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.deepEqual(doc.numbers.concat([4, 5, 6]), [1, 2, 3, 4, 5, 6])
          assert.deepEqual(doc.numbers.concat([4], [5, 6]), [1, 2, 3, 4, 5, 6])
        })
      })

      it('entries()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          let copy = []
          for (let x of doc.numbers.entries()) copy.push(x)
          assert.deepEqual(copy, [[0, 1], [1, 2], [2, 3]])
          assert.deepEqual([...doc.numbers.entries()], [[0, 1], [1, 2], [2, 3]])
        })
      })

      it('every()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.every(() => false), true)
          assert.strictEqual(doc.numbers.every((val: number) => val > 0), true)
          assert.strictEqual(doc.numbers.every((val: number) => val > 2), false)
          assert.strictEqual(doc.numbers.every((val: number, index: number) => index < 3), true)
          doc.numbers.every(
            function() {
              assert.strictEqual(this.hello, 'world')
              return true
            },
            { hello: 'world' }
          )
        })
      })

      it('filter()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.deepEqual(doc.noodles.filter(() => false), [])
          assert.deepEqual(doc.numbers.filter((num: number) => num % 2 === 1), [1, 3])
          assert.deepEqual(doc.numbers.filter((num: number) => true), [1, 2, 3])
          doc.numbers.filter(
            function() {
              assert.strictEqual(this.hello, 'world')
              return true
            },
            { hello: 'world' }
          )
        })
      })

      it('find()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.find(() => true), undefined)
          assert.strictEqual(doc.numbers.find((num: number) => num >= 2), 2)
          assert.strictEqual(doc.numbers.find((num: number) => num >= 4), undefined)
          const predicate = function() {
            assert.strictEqual(this.hello, 'world')
            return true
          }
          const thisArg = { hello: 'world' }
          doc.numbers.find(predicate, thisArg)
        })
      })

      it('findIndex()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.findIndex(() => true), -1)
          assert.strictEqual(doc.numbers.findIndex((num: number) => num >= 2), 1)
          assert.strictEqual(doc.numbers.findIndex((num: number) => num >= 4), -1)
          doc.numbers.findIndex(
            function() {
              assert.strictEqual(this.hello, 'world')
              return true
            },
            { hello: 'world' }
          )
        })
      })

      it('forEach()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          doc.noodles.forEach(() => { assert.fail('was called', 'not called', 'callback error') })
          let binary: string[] = []
          doc.numbers.forEach((num: number) => binary.push(num.toString(2)))
          assert.deepEqual(binary, ['1', '10', '11'])
          doc.numbers.forEach(
            function() {
              assert.strictEqual(this.hello, 'world')
            },
            { hello: 'world' }
          )
        })
      })

      it('includes()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.includes('udon'), false)
          assert.strictEqual(doc.numbers.includes(3), true)
          assert.strictEqual(doc.numbers.includes(1, 1), false)
          assert.strictEqual(doc.numbers.includes(2, -2), true)
          assert.strictEqual(doc.numbers.includes(0), false)
        })
      })

      it('indexOf()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.indexOf('udon'), -1)
          assert.strictEqual(doc.numbers.indexOf(3), 2)
          assert.strictEqual(doc.numbers.indexOf(1, 1), -1)
          assert.strictEqual(doc.numbers.indexOf(2, -2), 1)
          assert.strictEqual(doc.numbers.indexOf(0), -1)
        })
      })

      it('join()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.join(', '), '')
          assert.strictEqual(doc.numbers.join(), '1,2,3')
          assert.strictEqual(doc.numbers.join(''), '123')
          assert.strictEqual(doc.numbers.join(', '), '1, 2, 3')
        })
      })

      it('keys()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          let keys = []
          for (let x of doc.numbers.keys()) keys.push(x)
          assert.deepEqual(keys, [0, 1, 2])
          assert.deepEqual([...doc.numbers.keys()], [0, 1, 2])
        })
      })

      it('lastIndexOf()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.lastIndexOf('udon'), -1)
          assert.strictEqual(doc.numbers.lastIndexOf(3), 2)
          assert.strictEqual(doc.numbers.lastIndexOf(3, 1), -1)
          assert.strictEqual(doc.numbers.lastIndexOf(3, -1), 2)
          assert.strictEqual(doc.numbers.lastIndexOf(0), -1)
        })
      })

      it('map()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.deepEqual(doc.noodles.map((noodle: string) => noodle + ' noodles'), [])
          assert.deepEqual(doc.numbers.map((num: number) => num * 2), [2, 4, 6])
          assert.deepEqual(doc.numbers.map((num: number, index: number) => index + '->' + num), [
            '0->1',
            '1->2',
            '2->3',
          ])
          doc.numbers.map(
            function() {
              assert.strictEqual(this.hello, 'world')
            },
            { hello: 'world' }
          )
        })
      })

      it('reduce()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.reduce((result: string, val: string) => result + val, ''), '')
          assert.strictEqual(doc.numbers.reduce((sum: number, val: number) => sum + val, 0), 6)
          assert.strictEqual(doc.numbers.reduce((sum: string, val: number) => sum + val, ''), '123')
          assert.strictEqual(doc.numbers.reduce((sum: number, val: number) => sum + val), 6)
          assert.strictEqual(doc.numbers.reduce((sum: number, val: number, index: number) => (index % 2 === 0 ? sum + val : sum), 0), 4)
        })
      })

      it('reduceRight()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.reduceRight((result: string, val: string) => result + val, ''), '')
          assert.strictEqual(doc.numbers.reduceRight((sum: number, val: number) => sum + val, 0), 6)
          assert.strictEqual(doc.numbers.reduceRight((sum: string, val: number) => sum + val, ''), '321')
          assert.strictEqual(doc.numbers.reduceRight((sum: number, val: number) => sum + val), 6)
          assert.strictEqual(doc.numbers.reduceRight((sum: number, val: number, index: number) => (index % 2 === 0 ? sum + val : sum), 0 ), 4 )
        })
      })

      it('slice()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.deepEqual(doc.noodles.slice(), [])
          assert.deepEqual(doc.numbers.slice(2), [3])
          assert.deepEqual(doc.numbers.slice(-2), [2, 3])
          assert.deepEqual(doc.numbers.slice(0, 0), [])
          assert.deepEqual(doc.numbers.slice(0, 1), [1])
          assert.deepEqual(doc.numbers.slice(0, -1), [1, 2])
        })
      })

      it('some()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.some(() => true), false)
          assert.strictEqual(doc.numbers.some((val: number) => val > 2), true)
          assert.strictEqual(doc.numbers.some((val: number) => val > 4), false)
          assert.strictEqual(doc.numbers.some((val: number, index: number) => index > 2), false)
          doc.numbers.some(
            function() {
              assert.strictEqual(this.hello, 'world')
              return true
            },
            { hello: 'world' }
          )
        })
      })

      it('toString()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          assert.strictEqual(doc.noodles.toString(), '')
          assert.strictEqual(doc.numbers.toString(), '1,2,3')
        })
      })

      it('values()', () => {
        Automerge.change(root, (doc: ListTestDoc) => {
          let values = []
          for (let x of doc.numbers.values()) values.push(x)
          assert.deepEqual(values, [1, 2, 3])
          assert.deepEqual([...doc.numbers.values()], [1, 2, 3])
        })
      })
    })

    describe('should support standard mutation methods', () => {
      it('fill()', () => {
        root = Automerge.change(root, (doc: ListTestDoc) => doc.numbers.fill(999))
        assert.deepEqual(root.numbers, [999, 999, 999])
        root = Automerge.change(root, (doc: ListTestDoc) => doc.numbers.fill(777, 1).fill(888, 1, 2))
        assert.deepEqual(root.numbers, [999, 888, 777])
      })

      it('pop()', () => {
        root = Automerge.change(root, (doc: ListTestDoc) => assert.strictEqual(doc.numbers.pop(), 3))
        assert.deepEqual(root.numbers, [1, 2])
        root = Automerge.change(root, (doc: any) => assert.strictEqual(doc.numbers.pop(), 2))
        assert.deepEqual(root.numbers, [1])
        root = Automerge.change(root, (doc: any) => assert.strictEqual(doc.numbers.pop(), 1))
        assert.deepEqual(root.numbers, [])
        root = Automerge.change(root, (doc: any) => assert.strictEqual(doc.numbers.pop(), undefined))
        assert.deepEqual(root.numbers, [])
      })

      it('push()', () => {
        root = Automerge.change(root, (doc: ListTestDoc) => { doc.noodles = [] })
        root = Automerge.change(root, (doc: ListTestDoc) => doc.noodles.push('udon', 'soba'))
        root = Automerge.change(root, (doc: ListTestDoc) => doc.noodles.push('ramen'))
        assert.deepEqual(root.noodles, ['udon', 'soba', 'ramen'])
        assert.strictEqual(root.noodles[0], 'udon')
        assert.strictEqual(root.noodles[1], 'soba')
        assert.strictEqual(root.noodles[2], 'ramen')
        assert.strictEqual(root.noodles.length, 3)
      })

      it('shift()', () => {
        root = Automerge.change(root, (doc: ListTestDoc) => assert.strictEqual(doc.numbers.shift(), 1))
        assert.deepEqual(root.numbers, [2, 3])
        root = Automerge.change(root, (doc: ListTestDoc) => assert.strictEqual(doc.numbers.shift(), 2))
        assert.deepEqual(root.numbers, [3])
        root = Automerge.change(root, (doc: ListTestDoc) => assert.strictEqual(doc.numbers.shift(), 3))
        assert.deepEqual(root.numbers, [])
        root = Automerge.change(root, (doc: ListTestDoc) => assert.strictEqual(doc.numbers.shift(), undefined))
        assert.deepEqual(root.numbers, [])
      })

      it('splice()', () => {
        root = Automerge.change(root, (doc: ListTestDoc) => { assert.deepEqual(doc.numbers.splice(1), [2, 3]) })
        assert.deepEqual(root.numbers, [1])
        root = Automerge.change(root, (doc: ListTestDoc) => { assert.deepEqual(doc.numbers.splice(0, 0, 999, 888, 777), []) })
        assert.deepEqual(root.numbers, [999, 888, 777, 1])
        root = Automerge.change(root, (doc: ListTestDoc) => { assert.deepEqual(doc.numbers.splice(1, 2, -1), [888, 777]) })
        assert.deepEqual(root.numbers, [999, -1, 1])
      })

      it('unshift()', () => {
        root = Automerge.change(root, (doc: ListTestDoc) => { doc.noodles = [] })
        root = Automerge.change(root, (doc: ListTestDoc) => doc.noodles.unshift('soba', 'udon'))
        root = Automerge.change(root, (doc: ListTestDoc) => doc.noodles.unshift('ramen'))
        assert.deepEqual(root.noodles, ['ramen', 'soba', 'udon'])
        assert.strictEqual(root.noodles[0], 'ramen')
        assert.strictEqual(root.noodles[1], 'soba')
        assert.strictEqual(root.noodles[2], 'udon')
        assert.strictEqual(root.noodles.length, 3)
      })
    })
  })
})
