const assert = require('assert')
const { SkipList } = require('../src/skip_list')

describe('SkipList', () => {
  describe('internal structure', () => {
    it('should have a head node when initialized', () => {
      let s = new SkipList()
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 1,
                        prevKey: [], prevCount: [], nextKey: [null], nextCount: [null]})
    })

    it('should link to a new level-1 node', () => {
      let s = new SkipList(function* () { yield 1 })
      s = s.insertAfter(null, 'a', 'aaa')
      assert.deepEqual(s._nodes.get(null),
                       {key: null, value: null, level: 1,
                        prevKey: [], prevCount: [], nextKey: ['a'], nextCount: [1]})
      assert.deepEqual(s._nodes.get('a'),
                       {key: 'a', value: 'aaa', level: 1,
                        prevKey: [null], prevCount: [1], nextKey: [null], nextCount: [1]})
    })

    it('should raise the head to the maximum level', () => {
      let s = new SkipList(function* () {
        for (let level of [1, 1, 1, 3]) yield level
      })
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
      let s = new SkipList(function* () {
        for (let level of [1, 2, 1, 3, 1, 2, 1, 4]) yield level
      })
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
      let s = new SkipList(function* () {
        for (let level of [5, 2, 1, 1, 1, 2, 5, 4]) yield level
      })
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
  })
})
