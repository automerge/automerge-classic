const assert = require('assert')
const jsc = require('jsverify')
const { LamportTS, SkipList } = require('../src/skip_list')
const { is } = require('immutable')

function iter(array) {
  return array[Symbol.iterator].bind(array)
}

const A = new LamportTS({counter: 1, actorId: 'a'})
const B = new LamportTS({counter: 2, actorId: 'b'})
const C = new LamportTS({counter: 3, actorId: 'c'})
const D = new LamportTS({counter: 4, actorId: 'd'})
const X = new LamportTS({counter: 5, actorId: 'x'})
const K0 = new LamportTS({counter: 0, actorId: 'k'})
const K1 = new LamportTS({counter: 1, actorId: 'k'})
const K2 = new LamportTS({counter: 2, actorId: 'k'})
const K3 = new LamportTS({counter: 3, actorId: 'k'})
const K4 = new LamportTS({counter: 4, actorId: 'k'})
const K5 = new LamportTS({counter: 5, actorId: 'k'})
const K6 = new LamportTS({counter: 6, actorId: 'k'})
const K7 = new LamportTS({counter: 7, actorId: 'k'})
const K8 = new LamportTS({counter: 8, actorId: 'k'})

describe('SkipList', () => {
  describe('.indexOf()', () => {
    it('should return -1 on an empty list', () => {
      let s = new SkipList()
      assert.strictEqual(s.indexOf(A), -1)
    })

    it('should return -1 for a nonexistent key', () => {
      let s = new SkipList().insertAfter(null, A, 'a')
      assert.strictEqual(s.indexOf(B), -1)
    })

    it('should return 0 for the first list element', () => {
      let s = new SkipList().insertAfter(null, B, 'b').insertAfter(B, C, 'c').insertAfter(null, A, 'a')
      assert.strictEqual(s.indexOf(A), 0)
    })

    it('should return length-1 for the last list element', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c').insertAfter(C, D, 'd')
      assert.strictEqual(s.indexOf(D), 3)
    })

    it('should adjust based on removed elements', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c')
      s = s.removeKey(A)
      assert.strictEqual(s.indexOf(B), 0)
      assert.strictEqual(s.indexOf(C), 1)
    })
  })

  describe('.length', () => {
    it('should be 0 for an empty list', () => {
      let s = new SkipList()
      assert.strictEqual(s.length, 0)
    })

    it('should increase by 1 for every insertion', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c')
      assert.strictEqual(s.length, 3)
    })

    it('should decrease by 1 for every removal', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c')
      assert.strictEqual(s.length, 3)
      s = s.removeKey(B)
      assert.strictEqual(s.length, 2)
    })
  })

  describe('.keyOf()', () => {
    it('should return null on an empty list', () => {
      let s = new SkipList()
      assert.strictEqual(s.keyOf(0), null)
    })

    it('should return null for an index past the end of the list', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b')
      assert.strictEqual(s.keyOf(2), null)
    })

    it('should return the first key for index 0', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c')
      assert.strictEqual(s.keyOf(0), A)
    })

    it('should return the last key for index -1', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c')
      assert.strictEqual(s.keyOf(-1), C)
    })

    it('should return the last key for index length-1', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c')
      assert.strictEqual(s.keyOf(2), C)
    })

    it('should not count removed elements', () => {
      let s = new SkipList().insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c')
      s = s.removeKey(B)
      assert.strictEqual(s.keyOf(0), A)
      assert.strictEqual(s.keyOf(1), C)
    })
  })

  describe('.getValue()', () => {
    it('should return undefined for a nonexistent key', () => {
      let s = new SkipList()
      assert.strictEqual(s.getValue(X), undefined)
    })

    it('should return the inserted value when present', () => {
      let s = new SkipList().insertAfter(null, K1, 'value1').insertAfter(K1, K2, 'value2')
      assert.strictEqual(s.getValue(K1), 'value1')
      assert.strictEqual(s.getValue(K2), 'value2')
    })
  })

  describe('.setValue()', () => {
    it('should throw an exception when setting a nonexistent key', () => {
      let s = new SkipList().insertAfter(null, K1, 'value1')
      assert.throws(() => { s.setValue(K2, 'value2') }, /referenced key does not exist/)
    })

    it('should update the value for an existing key', () => {
      let s = new SkipList().insertAfter(null, K1, 'value1').insertAfter(K1, K2, 'value2')
      let s2 = s.setValue(K2, 'updated value')
      assert.strictEqual(s.getValue(K2), 'value2')
      assert.strictEqual(s2.getValue(K2), 'updated value')
      assert.strictEqual(s2.getValue(K1), 'value1')
      assert.strictEqual(s2.length, 2)
    })
  })

  describe('.insertIndex()', () => {
    it('should insert the new key-value pair at the given index', () => {
      let s = new SkipList().insertAfter(null, A, 'aa').insertAfter(A, C, 'cc')
      let s2 = s.insertIndex(1, B, 'bb')
      assert.strictEqual(s2.indexOf(A), 0)
      assert.strictEqual(s2.indexOf(B), 1)
      assert.strictEqual(s2.indexOf(C), 2)
      assert.strictEqual(s2.length, 3)
    })

    it('should insert at the head if the index is zero', () => {
      let s = new SkipList().insertIndex(0, A, 'aa')
      assert.strictEqual(s.keyOf(0), A)
      assert.strictEqual(s.length, 1)
    })
  })

  describe('.removeIndex()', () => {
    it('should remove the value at the given index', () => {
      let s = new SkipList().insertAfter(null, A, 'aa').insertAfter(A, B, 'bb').insertAfter(B, C, 'cc')
      let s2 = s.removeIndex(1)
      assert.strictEqual(s2.indexOf(A), 0)
      assert.strictEqual(s2.indexOf(B), -1)
      assert.strictEqual(s2.indexOf(C), 1)
    })

    it('should raise an error if the given index is out of bounds', () => {
      let s = new SkipList().insertAfter(null, A, 'aa').insertAfter(A, B, 'bb').insertAfter(B, C, 'cc')
      assert.throws(() => { s.removeIndex(3) }, /key cannot be removed/)
    })
  })

  describe('iterators', () => {
    it('should iterate over values by default', () => {
      let s = new SkipList().insertAfter(null, K1, 'value1').insertAfter(K1, K2, 'value2')
      assert.deepEqual([...s], ['value1', 'value2'])
    })

    it('should support iterating over keys', () => {
      let s = new SkipList().insertAfter(null, K1, 'value1').insertAfter(K1, K2, 'value2')
      assert.deepEqual([...s.iterator('keys')], [K1, K2])
    })

    it('should support iterating over entries', () => {
      let s = new SkipList().insertAfter(null, K1, 'value1').insertAfter(K1, K2, 'value2')
      assert.deepEqual([...s.iterator('entries')], [[K1, 'value1'], [K2, 'value2']])
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
            id: new LamportTS({counter: i, actorId: 'x'}),
            insertAfter: (index === ids.length) ? null : ids[index],
            level: jsc.random(1, 7)
          }
          ids.push(ops[i].id)
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
            skipList = skipList.removeKey(op.remove)
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
      s = s.insertAfter(null, A, 'aaa')
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 1,
                        prevKey: [], prevCount: [], nextKey: [A], nextCount: [1]})
      assert.deepEqual(s._nodes.get(A),
                       {key: A, value: 'aaa', level: 1,
                        prevKey: [null], prevCount: [1], nextKey: [null], nextCount: [1]})
    })

    it('should raise the head to the maximum level', () => {
      let s = new SkipList(iter([1, 1, 1, 3]))
      s = s.insertAfter(null, A, 'aaa').insertAfter(A, B, 'bbb').insertAfter(B, D, 'ddd')
      s = s.insertAfter(B, C, 'ccc') // this is the level-3 node

      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 3,
                        prevKey: [], prevCount: [], nextKey: [A, C, C], nextCount: [1, 3, 3]})
      assert.deepEqual(s._nodes.get(A),
                       {key: A, value: 'aaa', level: 1,
                        prevKey: [null], prevCount: [1], nextKey: [B], nextCount: [1]})
      assert.deepEqual(s._nodes.get(B),
                       {key: B, value: 'bbb', level: 1,
                        prevKey: [A], prevCount: [1], nextKey: [C], nextCount: [1]})
      assert.deepEqual(s._nodes.get(C),
                       {key: C, value: 'ccc', level: 3,
                        prevKey: [B, null, null], prevCount: [1, 3, 3],
                        nextKey: [D, null, null], nextCount: [1, 2, 2]})
      assert.deepEqual(s._nodes.get(D),
                       {key: D, value: 'ddd', level: 1,
                        prevKey: [C], nextKey: [null], prevCount: [1], nextCount: [1]})
    })

    it('should keep track of skip distances', () => {
      let s = new SkipList(iter([1, 2, 1, 3, 1, 2, 1, 4]))
      s = s.insertAfter(null, K1, '1').insertAfter(K1, K2, '2').insertAfter(K2, K3, '3').insertAfter(K3, K4, '4')
      s = s.insertAfter(K4, K5, '5').insertAfter(K5, K6, '6').insertAfter(K6, K7, '7').insertAfter(K7, K8, '8')

      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 4,
                        prevKey: [], prevCount: [], nextKey: [K1, K2, K4, K8], nextCount: [1, 2, 4, 8]})
      assert.deepEqual(s._nodes.get(K2),
                       {key: K2, value: '2', level: 2,
                        prevKey: [K1, null], prevCount: [1, 2], nextKey: [K3, K4], nextCount: [1, 2]})
      assert.deepEqual(s._nodes.get(K4),
                       {key: K4, value: '4', level: 3,
                        prevKey: [K3, K2, null], prevCount: [1, 2, 4], nextKey: [K5, K6, K8], nextCount: [1, 2, 4]})
      assert.deepEqual(s._nodes.get(K6),
                       {key: K6, value: '6', level: 2,
                        prevKey: [K5, K4], prevCount: [1, 2], nextKey: [K7, K8], nextCount: [1, 2]})
      assert.deepEqual(s._nodes.get(K8),
                       {key: K8, value: '8', level: 4,
                        prevKey: [  K7,   K6,   K4, null], prevCount: [1, 2, 4, 8],
                        nextKey: [null, null, null, null], nextCount: [1, 1, 1, 1]})
    })

    it('should update preceding and succeeding nodes at the appropriate levels', () => {
      let s = new SkipList(iter([5, 2, 1, 1, 1, 2, 5, 4]))
      s = s.insertAfter(null, K1, '1').insertAfter(K1, K2, '2').insertAfter(K2, K3, '3').insertAfter(K3, K4, '4')
      s = s.insertAfter(K4, K5, '5').insertAfter(K5, K6, '6').insertAfter(K6, K7, '7')
      s = s.insertAfter(K4, X, 'x') // insert x at level 4

      assert.deepEqual(s._nodes.get(K1),
                       {key: K1, value: '1', level: 5,
                        prevKey: [null, null, null, null, null], prevCount: [1, 1, 1, 1, 1],
                        nextKey: [  K2,   K2,    X,    X,   K7], nextCount: [1, 1, 4, 4, 7]})
      assert.deepEqual(s._nodes.get(K2),
                       {key: K2, value: '2', level: 2,
                        prevKey: [K1, K1], prevCount: [1, 1], nextKey: [K3, X], nextCount: [1, 3]})
      assert.deepEqual(s._nodes.get(X),
                       {key: X, value: 'x', level: 4,
                        prevKey: [K4, K2, K1, K1], prevCount: [1, 3, 4, 4],
                        nextKey: [K5, K6, K7, K7], nextCount: [1, 2, 3, 3]})
      assert.deepEqual(s._nodes.get(K6),
                       {key: K6, value: '6', level: 2,
                        prevKey: [K5, X], prevCount: [1, 2], nextKey: [K7, K7], nextCount: [1, 1]})
      assert.deepEqual(s._nodes.get(K7),
                       {key: K7, value: '7', level: 5,
                        prevKey: [  K6,   K6,    X,    X,   K1], prevCount: [1, 1, 3, 3, 7],
                        nextKey: [null, null, null, null, null], nextCount: [1, 1, 1, 1, 1]})
    })

    it('should handle removal of nodes', () => {
      let s = new SkipList(iter([1, 2, 1, 3]))
      s = s.insertAfter(null, A, 'a').insertAfter(A, B, 'b').insertAfter(B, C, 'c').insertAfter(C, D, 'd')

      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 3,
                        prevKey: [], prevCount: [], nextKey: [A, B, D], nextCount: [1, 2, 4]})
      assert.deepEqual(s._nodes.get(D),
                       {key: D, value: 'd', level: 3,
                        prevKey: [ C,  B, null], prevCount: [1, 2, 4],
                        nextKey: [null, null, null], nextCount: [1, 1, 1]})

      s = s.removeKey(B)
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 3,
                        prevKey: [], prevCount: [], nextKey: [A, D, D], nextCount: [1, 3, 3]})
      assert.deepEqual(s._nodes.get(A),
                       {key: A, value: 'a', level: 1,
                        prevKey: [null], prevCount: [1], nextKey: [C], nextCount: [1]})
      assert.deepEqual(s._nodes.get(C),
                       {key: C, value: 'c', level: 1,
                        prevKey: [A], prevCount: [1], nextKey: [D], nextCount: [1]})
      assert.deepEqual(s._nodes.get(D),
                       {key: D, value: 'd', level: 3,
                        prevKey: [   C, null, null], prevCount: [1, 3, 3],
                        nextKey: [null, null, null], nextCount: [1, 1, 1]})
      assert.strictEqual(s._nodes.get(B), undefined)
    })

    it('should allow the only element to be removed', () => {
      let s = new SkipList(iter([1])).insertAfter(null, K0, '0').removeKey(K0)
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 1,
                        prevKey: [], prevCount: [], nextKey: [null], nextCount: [1]})
    })
  })
})
