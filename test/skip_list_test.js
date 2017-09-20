const assert = require('assert')
const jsc = require('jsverify')
const { SkipList } = require('../src/skip_list')

function iter(array) {
  return array[Symbol.iterator].bind(array)
}

describe('SkipList', () => {
  describe('.indexOf()', () => {
    it('should return -1 on an empty list', () => {
      let s = new SkipList()
      assert.strictEqual(s.indexOf('hello'), -1)
    })

    it('should return -1 for a nonexistent key', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a')
      assert.strictEqual(s.indexOf('b'), -1)
    })

    it('should return 0 for the first list element', () => {
      let s = new SkipList().insertAfter(null, 'b', 'b').insertAfter('b', 'c', 'c').insertAfter(null, 'a', 'a')
      assert.strictEqual(s.indexOf('a'), 0)
    })

    it('should return length-1 for the last list element', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').
        insertAfter('b', 'c', 'c').insertAfter('c', 'd', 'd')
      assert.strictEqual(s.indexOf('d'), 3)
    })

    it('should adjust based on removed elements', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').insertAfter('b', 'c', 'c')
      s = s.remove('a')
      assert.strictEqual(s.indexOf('b'), 0)
      assert.strictEqual(s.indexOf('c'), 1)
    })
  })

  describe('.length', () => {
    it('should be 0 for an empty list', () => {
      let s = new SkipList()
      assert.strictEqual(s.length, 0)
    })

    it('should increase by 1 for every insertion', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').insertAfter('b', 'c', 'c')
      assert.strictEqual(s.length, 3)
    })

    it('should decrease by 1 for every removal', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').insertAfter('b', 'c', 'c')
      assert.strictEqual(s.length, 3)
      s = s.remove('b')
      assert.strictEqual(s.length, 2)
    })
  })

  describe('.keyOf()', () => {
    it('should return null on an empty list', () => {
      let s = new SkipList()
      assert.strictEqual(s.keyOf(0), null)
    })

    it('should return null for an index past the end of the list', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b')
      assert.strictEqual(s.keyOf(2), null)
    })

    it('should return the first key for index 0', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').insertAfter('b', 'c', 'c')
      assert.strictEqual(s.keyOf(0), 'a')
    })

    it('should return the last key for index -1', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').insertAfter('b', 'c', 'c')
      assert.strictEqual(s.keyOf(-1), 'c')
    })

    it('should return the last key for index length-1', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').insertAfter('b', 'c', 'c')
      assert.strictEqual(s.keyOf(2), 'c')
    })

    it('should not count removed elements', () => {
      let s = new SkipList().insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').insertAfter('b', 'c', 'c')
      s = s.remove('b')
      assert.strictEqual(s.keyOf(0), 'a')
      assert.strictEqual(s.keyOf(1), 'c')
    })
  })

  describe('property-based tests', () => {
    function makeSkipListOps(size) {
      const numOps = jsc.random(0, Math.round(Math.log(size + 1) / Math.log(2)))
      const ops = new Array(numOps), ids = []
      for (let i = 0; i < numOps; i++) {
        if (ids.length === 0 || jsc.random(0, 1) === 0) {
          const index = jsc.random(0, ids.length)
          ops[i] = {
            id: i.toString(),
            insertAfter: (index === ids.length) ? null : ids[index],
            level: jsc.random(1, 7)
          }
          ids.push(i.toString())
        } else {
          const index = jsc.random(0, ids.length - 1)
          ops[i] = {remove: ids[index]}
          ids.splice(index, 1)
        }
      }
      return ops
    }

    it('should behave like a JS array', () => {
      jsc.assert(jsc.forall(jsc.bless({generator: makeSkipListOps}), function (ops) {
        let levels = ops.filter(op => op.hasOwnProperty('insertAfter')).map(op => op.level)
        let skipList = new SkipList(iter(levels))
        let shadow = []
        for (let op of ops) {
          if (op.hasOwnProperty('insertAfter')) {
            skipList = skipList.insertAfter(op.insertAfter, op.id, op.id)
            shadow.splice(shadow.indexOf(op.insertAfter) + 1, 0, op.id)
          } else {
            skipList = skipList.remove(op.remove)
            shadow.splice(shadow.indexOf(op.remove), 1)
          }
        }

        /*if (skipList.length !== shadow.length) console.log('list lengths must be equal')

        shadow.forEach((id, index) => {
          if (skipList.indexOf(id) !== index) {
            console.log('indexOf(' + id + ') = ' + skipList.indexOf(id) + ', should be ' + index)
          }
          if (skipList.keyOf(index) !== id) {
            console.log('keyOf(' + index + ') = ' + skipList.keyOf(index) + ', should be ' + id)
          }
        })*/

        return (skipList.length === shadow.length) && shadow.every((id, index) =>
          skipList.indexOf(id) === index && skipList.keyOf(index) === id
        )
      }), {tests: 100, size: 50})
    })
  })

  describe('internal structure', () => {
    it('should have a head node when initialized', () => {
      let s = new SkipList()
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 1,
                        prevKey: [], prevCount: [], nextKey: [null], nextCount: [null]})
    })

    it('should link to a new level-1 node', () => {
      let s = new SkipList(iter([1]))
      s = s.insertAfter(null, 'a', 'aaa')
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 1,
                        prevKey: [], prevCount: [], nextKey: ['a'], nextCount: [1]})
      assert.deepEqual(s._nodes.get('a'),
                       {key: 'a', value: 'aaa', level: 1,
                        prevKey: [null], prevCount: [1], nextKey: [null], nextCount: [1]})
    })

    it('should raise the head to the maximum level', () => {
      let s = new SkipList(iter([1, 1, 1, 3]))
      s = s.insertAfter(null, 'a', 'aaa').insertAfter('a', 'b', 'bbb').insertAfter('b', 'd', 'ddd')
      s = s.insertAfter('b', 'c', 'ccc') // this is the level-3 node

      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 3,
                        prevKey: [], prevCount: [], nextKey: ['a', 'c', 'c'], nextCount: [1, 3, 3]})
      assert.deepEqual(s._nodes.get('a'),
                       {key: 'a', value: 'aaa', level: 1,
                        prevKey: [null], prevCount: [1], nextKey: ['b'], nextCount: [1]})
      assert.deepEqual(s._nodes.get('b'),
                       {key: 'b', value: 'bbb', level: 1,
                        prevKey: ['a'], prevCount: [1], nextKey: ['c'], nextCount: [1]})
      assert.deepEqual(s._nodes.get('c'),
                       {key: 'c', value: 'ccc', level: 3,
                        prevKey: ['b', null, null], prevCount: [1, 3, 3],
                        nextKey: ['d', null, null], nextCount: [1, 2, 2]})
      assert.deepEqual(s._nodes.get('d'),
                       {key: 'd', value: 'ddd', level: 1,
                        prevKey: ['c'], nextKey: [null], prevCount: [1], nextCount: [1]})
    })

    it('should keep track of skip distances', () => {
      let s = new SkipList(iter([1, 2, 1, 3, 1, 2, 1, 4]))
      s = s.insertAfter(null, '1', '1').insertAfter('1', '2', '2').insertAfter('2', '3', '3').insertAfter('3', '4', '4')
      s = s.insertAfter('4', '5', '5').insertAfter('5', '6', '6').insertAfter('6', '7', '7').insertAfter('7', '8', '8')

      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 4,
                        prevKey: [], prevCount: [], nextKey: ['1', '2', '4', '8'], nextCount: [1, 2, 4, 8]})
      assert.deepEqual(s._nodes.get('2'),
                       {key: '2', value: '2', level: 2,
                        prevKey: ['1', null], prevCount: [1, 2], nextKey: ['3', '4'], nextCount: [1, 2]})
      assert.deepEqual(s._nodes.get('4'),
                       {key: '4', value: '4', level: 3,
                        prevKey: ['3', '2', null], prevCount: [1, 2, 4], nextKey: ['5', '6', '8'], nextCount: [1, 2, 4]})
      assert.deepEqual(s._nodes.get('6'),
                       {key: '6', value: '6', level: 2,
                        prevKey: ['5', '4'], prevCount: [1, 2], nextKey: ['7', '8'], nextCount: [1, 2]})
      assert.deepEqual(s._nodes.get('8'),
                       {key: '8', value: '8', level: 4,
                        prevKey: [ '7',  '6',  '4', null], prevCount: [1, 2, 4, 8],
                        nextKey: [null, null, null, null], nextCount: [1, 1, 1, 1]})
    })

    it('should update preceding and succeeding nodes at the appropriate levels', () => {
      let s = new SkipList(iter([5, 2, 1, 1, 1, 2, 5, 4]))
      s = s.insertAfter(null, '1', '1').insertAfter('1', '2', '2').insertAfter('2', '3', '3').insertAfter('3', '4', '4')
      s = s.insertAfter('4', '5', '5').insertAfter('5', '6', '6').insertAfter('6', '7', '7')
      s = s.insertAfter('4', 'x', 'x') // insert x at level 4

      assert.deepEqual(s._nodes.get('1'),
                       {key: '1', value: '1', level: 5,
                        prevKey: [null, null, null, null, null], prevCount: [1, 1, 1, 1, 1],
                        nextKey: [ '2',  '2',  'x',  'x',  '7'], nextCount: [1, 1, 4, 4, 7]})
      assert.deepEqual(s._nodes.get('2'),
                       {key: '2', value: '2', level: 2,
                        prevKey: ['1', '1'], prevCount: [1, 1], nextKey: ['3', 'x'], nextCount: [1, 3]})
      assert.deepEqual(s._nodes.get('x'),
                       {key: 'x', value: 'x', level: 4,
                        prevKey: ['4', '2', '1', '1'], prevCount: [1, 3, 4, 4],
                        nextKey: ['5', '6', '7', '7'], nextCount: [1, 2, 3, 3]})
      assert.deepEqual(s._nodes.get('6'),
                       {key: '6', value: '6', level: 2,
                        prevKey: ['5', 'x'], prevCount: [1, 2], nextKey: ['7', '7'], nextCount: [1, 1]})
      assert.deepEqual(s._nodes.get('7'),
                       {key: '7', value: '7', level: 5,
                        prevKey: [ '6',  '6',  'x',  'x',  '1'], prevCount: [1, 1, 3, 3, 7],
                        nextKey: [null, null, null, null, null], nextCount: [1, 1, 1, 1, 1]})
    })

    it('should handle removal of nodes', () => {
      let s = new SkipList(iter([1, 2, 1, 3]))
      s = s.insertAfter(null, 'a', 'a').insertAfter('a', 'b', 'b').insertAfter('b', 'c', 'c').insertAfter('c', 'd', 'd')

      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 3,
                        prevKey: [], prevCount: [], nextKey: ['a', 'b', 'd'], nextCount: [1, 2, 4]})
      assert.deepEqual(s._nodes.get('d'),
                       {key: 'd', value: 'd', level: 3,
                        prevKey: [ 'c',  'b', null], prevCount: [1, 2, 4],
                        nextKey: [null, null, null], nextCount: [1, 1, 1]})

      s = s.remove('b')
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 3,
                        prevKey: [], prevCount: [], nextKey: ['a', 'd', 'd'], nextCount: [1, 3, 3]})
      assert.deepEqual(s._nodes.get('a'),
                       {key: 'a', value: 'a', level: 1,
                        prevKey: [null], prevCount: [1], nextKey: ['c'], nextCount: [1]})
      assert.deepEqual(s._nodes.get('c'),
                       {key: 'c', value: 'c', level: 1,
                        prevKey: ['a'], prevCount: [1], nextKey: ['d'], nextCount: [1]})
      assert.deepEqual(s._nodes.get('d'),
                       {key: 'd', value: 'd', level: 3,
                        prevKey: [ 'c', null, null], prevCount: [1, 3, 3],
                        nextKey: [null, null, null], nextCount: [1, 1, 1]})
      assert.strictEqual(s._nodes.get('b'), undefined)
    })

    it('should allow the only element to be removed', () => {
      let s = new SkipList(iter([1])).insertAfter(null, '0', '0').remove('0')
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 1,
                        prevKey: [], prevCount: [], nextKey: [null], nextCount: [1]})
    })
  })
})
