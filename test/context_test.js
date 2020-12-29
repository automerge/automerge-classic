const assert = require('assert')
const sinon = require('sinon')
const { Context } = require('../frontend/context')
const { CACHE, OBJECT_ID, CONFLICTS, STATE, ELEMIDS } = require('../frontend/constants')
const { ROOT_ID } = require('../src/common')
const { Counter } = require('../frontend/counter')
const { Table, instantiateTable } = require('../frontend/table')
const { Text } = require('../frontend/text')
const uuid = require('../src/uuid')

describe('Proxying context', () => {
  let context, applyPatch

  beforeEach(() => {
    applyPatch = sinon.spy()
    context = new Context({[STATE]: { maxOp: 0 }, [CACHE]: {[ROOT_ID]: {}}}, uuid(), applyPatch)
  })

  describe('.setMapKey', () => {
    it('should assign a primitive value to a map key', () => {
      context.setMapKey([], 'sparrows', 5)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        sparrows: {[`1@${context.actorId}`]: {value: 5}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'set', key: 'sparrows', insert: false, value: 5, pred: []}
      ])
    })

    it('should do nothing if the value was not changed', () => {
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, goldfinches: 3, [CONFLICTS]: {goldfinches: {'1@actor1': 3}}}
      context.setMapKey([], 'goldfinches', 3)
      assert(applyPatch.notCalled)
      assert.deepStrictEqual(context.ops, [])
    })

    it('should allow a conflict to be resolved', () => {
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, goldfinches: 5, [CONFLICTS]: {goldfinches: {'1@actor1': 3, '2@actor2': 5}}}
      context.setMapKey([], 'goldfinches', 3)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        goldfinches: {[`1@${context.actorId}`]: {value: 3}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'set', key: 'goldfinches', insert: false, value: 3, pred: ['1@actor1', '2@actor2']}
      ])
    })

    it('should create nested maps', () => {
      context.setMapKey([], 'birds', {goldfinches: 3})
      assert(applyPatch.calledOnce)
      const objectId = applyPatch.firstCall.args[0].props.birds[`1@${context.actorId}`].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {[`1@${context.actorId}`]: {objectId, type: 'map', props: {
          goldfinches: {[`2@${context.actorId}`]: {value: 3}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'makeMap', key: 'birds', insert: false, pred: []},
        {obj: objectId, action: 'set', key: 'goldfinches', insert: false, value: 3, pred: []}
      ])
    })

    it('should perform assignment inside nested maps', () => {
      const objectId = uuid(), child = {[OBJECT_ID]: objectId}
      context.cache[objectId] = child
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, [CONFLICTS]: {birds: {'1@actor1': child}}, birds: child}
      context.setMapKey([{key: 'birds', objectId}], 'goldfinches', 3)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {'1@actor1': {objectId, type: 'map', props: {
          goldfinches: {[`1@${context.actorId}`]: {value: 3}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: objectId, action: 'set', key: 'goldfinches', insert: false, value: 3, pred: []}
      ])
    })

    it('should perform assignment inside conflicted maps', () => {
      const objectId1 = uuid(), child1 = {[OBJECT_ID]: objectId1}
      const objectId2 = uuid(), child2 = {[OBJECT_ID]: objectId2}
      context.cache[objectId1] = child1
      context.cache[objectId2] = child2
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, birds: child2,
        [CONFLICTS]: {birds: {'1@actor1': child1, '1@actor2': child2}}}
      context.setMapKey([{key: 'birds', objectId: objectId2}], 'goldfinches', 3)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {birds: {
        '1@actor1': {objectId: objectId1, type: 'map'},
        '1@actor2': {objectId: objectId2, type: 'map', props: {
          goldfinches: {[`1@${context.actorId}`]: {value: 3}}
        }}
      }}})
      assert.deepStrictEqual(context.ops, [
        {obj: objectId2, action: 'set', key: 'goldfinches', insert: false, value: 3, pred: []}
      ])
    })

    it('should handle conflict values of various types', () => {
      const objectId = uuid(), child = {[OBJECT_ID]: objectId}, dateValue = new Date()
      context.cache[objectId] = child
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, values: child, [CONFLICTS]: {values: {
        '1@actor1': dateValue, '1@actor2': new Counter(), '1@actor3': 42, '1@actor4': null, '1@actor5': child
      }}}
      context.setMapKey([{key: 'values', objectId}], 'goldfinches', 3)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {values: {
        '1@actor1': {value: dateValue.getTime(), datatype: 'timestamp'},
        '1@actor2': {value: 0, datatype: 'counter'},
        '1@actor3': {value: 42},
        '1@actor4': {value: null},
        '1@actor5': {objectId, type: 'map', props: {goldfinches: {[`1@${context.actorId}`]: {value: 3}}}}
      }}})
      assert.deepStrictEqual(context.ops, [
        {obj: objectId, action: 'set', key: 'goldfinches', insert: false, value: 3, pred: []}
      ])
    })

    it('should create nested lists', () => {
      context.setMapKey([], 'birds', ['sparrow', 'goldfinch'])
      assert(applyPatch.calledOnce)
      const objectId = applyPatch.firstCall.args[0].props.birds[`1@${context.actorId}`].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {[`1@${context.actorId}`]: {objectId, type: 'list', props: {
          0: {[`2@${context.actorId}`]: {value: 'sparrow'}},
          1: {[`3@${context.actorId}`]: {value: 'goldfinch'}}
        }, edits: [
          {action: 'insert', index: 0, elemId: `2@${context.actorId}`},
          {action: 'insert', index: 1, elemId: `3@${context.actorId}`}
        ]}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'makeList', key: 'birds', insert: false, pred: []},
        {obj: objectId, action: 'set', key: '_head', insert: true, value: 'sparrow', pred: []},
        {obj: objectId, action: 'set', key: `2@${context.actorId}`, insert: true, value: 'goldfinch', pred: []}
      ])
    })

    it('should create nested Text objects', () => {
      context.setMapKey([], 'text', new Text('hi'))
      const objectId = applyPatch.firstCall.args[0].props.text[`1@${context.actorId}`].objectId
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        text: {[`1@${context.actorId}`]: {objectId, type: 'text', props: {
          0: {[`2@${context.actorId}`]: {value: 'h'}},
          1: {[`3@${context.actorId}`]: {value: 'i'}}
        }, edits: [
          {action: 'insert', index: 0, elemId: `2@${context.actorId}`},
          {action: 'insert', index: 1, elemId: `3@${context.actorId}`}
        ]}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'makeText', key: 'text', insert: false, pred: []},
        {obj: objectId, action: 'set', key: '_head', insert: true, value: 'h', pred: []},
        {obj: objectId, action: 'set', key: `2@${context.actorId}`, insert: true, value: 'i', pred: []}
      ])
    })

    it('should create nested Table objects', () => {
      context.setMapKey([], 'books', new Table())
      assert(applyPatch.calledOnce)
      const objectId = applyPatch.firstCall.args[0].props.books[`1@${context.actorId}`].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        books: {[`1@${context.actorId}`]: {objectId, type: 'table', props: {}}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'makeTable', key: 'books', insert: false, pred: []}
      ])
    })

    it('should allow assignment of Date values', () => {
      const now = new Date()
      context.setMapKey([], 'now', now)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        now: {[`1@${context.actorId}`]: {value: now.getTime(), datatype: 'timestamp'}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'set', key: 'now', insert: false, value: now.getTime(), datatype: 'timestamp', pred: []}
      ])
    })

    it('should allow assignment of Counter values', () => {
      const counter = new Counter(3)
      context.setMapKey([], 'counter', counter)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        counter: {[`1@${context.actorId}`]: {value: 3, datatype: 'counter'}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'set', key: 'counter', insert: false, value: 3, datatype: 'counter', pred: []}
      ])
    })
  })

  describe('.deleteMapKey', () => {
    it('should remove an existing key', () => {
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, goldfinches: 3, [CONFLICTS]: {goldfinches: {'1@actor1': 3}}}
      context.deleteMapKey([], 'goldfinches')
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {goldfinches: {}}})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'del', key: 'goldfinches', insert: false, pred: ['1@actor1']}
      ])
    })

    it('should do nothing if the key does not exist', () => {
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, goldfinches: 3, [CONFLICTS]: {goldfinches: {'1@actor1': 3}}}
      context.deleteMapKey([], 'sparrows')
      const expected = {objectId: ROOT_ID, type: 'map'}
      assert(applyPatch.notCalled)
      assert.deepStrictEqual(context.ops, [])
    })

    it('should update a nested object', () => {
      const objectId = uuid(), child = {[OBJECT_ID]: objectId, [CONFLICTS]: {goldfinches: {'5@actor1': 3}}, goldfinches: 3}
      context.cache[objectId] = child
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, [CONFLICTS]: {birds: {'1@actor1': child}}, birds: child}
      context.deleteMapKey([{key: 'birds', objectId}], 'goldfinches')
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {'1@actor1': {objectId, type: 'map', props: {goldfinches: {}}}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: objectId, action: 'del', key: 'goldfinches', insert: false, pred: ['5@actor1']}
      ])
    })
  })

  describe('list manipulation', () => {
    let listId, list

    beforeEach(() => {
      listId = uuid()
      list = ['swallow', 'magpie']
      Object.defineProperty(list, OBJECT_ID, {value: listId})
      Object.defineProperty(list, CONFLICTS, {value: [{'1@xxx': 'swallow'}, {'2@xxx': 'magpie'}]})
      Object.defineProperty(list, ELEMIDS,   {value: ['1@xxx', '2@xxx']})
      context.cache[listId] = list
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, birds: list, [CONFLICTS]: {birds: {'1@actor1': list}}}
    })

    it('should overwrite an existing list element', () => {
      context.setListIndex([{key: 'birds', objectId: listId}], 0, 'starling')
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {'1@actor1': {objectId: listId, type: 'list', props: {
          0: {[`1@${context.actorId}`]: {value: 'starling'}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'set', key: '1@xxx', insert: false, value: 'starling', pred: ['1@xxx']}
      ])
    })

    it('should create nested objects on assignment', () => {
      context.setListIndex([{key: 'birds', objectId: listId}], 1, {english: 'goldfinch', latin: 'carduelis'})
      assert(applyPatch.calledOnce)
      const nestedId = applyPatch.firstCall.args[0].props.birds['1@actor1'].props[1][`1@${context.actorId}`].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {'1@actor1': {objectId: listId, type: 'list', props: {
          1: {[`1@${context.actorId}`]: {objectId: nestedId, type: 'map', props: {
            english: {[`2@${context.actorId}`]: {value: 'goldfinch'}},
            latin: {[`3@${context.actorId}`]: {value: 'carduelis'}}
          }}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'makeMap', key: '2@xxx', insert: false, pred: ['2@xxx']},
        {obj: nestedId, action: 'set', key: 'english', insert: false, value: 'goldfinch', pred: []},
        {obj: nestedId, action: 'set', key: 'latin', insert: false, value: 'carduelis', pred: []}
      ])
    })

    it('should create nested objects on insertion', () => {
      context.splice([{key: 'birds', objectId: listId}], 2, 0, [{english: 'goldfinch', latin: 'carduelis'}])
      assert(applyPatch.calledOnce)
      const nestedId = applyPatch.firstCall.args[0].props.birds['1@actor1'].props[2][`1@${context.actorId}`].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {'1@actor1': {objectId: listId, type: 'list', edits: [
          {action: 'insert', index: 2, elemId: `1@${context.actorId}`}
        ], props: {
          2: {[`1@${context.actorId}`]: {objectId: nestedId, type: 'map', props: {
            english: {[`2@${context.actorId}`]: {value: 'goldfinch'}},
            latin: {[`3@${context.actorId}`]: {value: 'carduelis'}}
          }}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'makeMap', key: '2@xxx', insert: true, pred: []},
        {obj: nestedId, action: 'set', key: 'english', insert: false, value: 'goldfinch', pred: []},
        {obj: nestedId, action: 'set', key: 'latin', insert: false, value: 'carduelis', pred: []}
      ])
    })

    it('should support deleting list elements', () => {
      context.splice([{key: 'birds', objectId: listId}], 0, 2, [])
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {'1@actor1': {objectId: listId, type: 'list', props: {}, edits: [
          {action: 'remove', index: 0}, {action: 'remove', index: 0}
        ]}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'del', key: '1@xxx', insert: false, pred: ['1@xxx']},
        {obj: listId, action: 'del', key: '2@xxx', insert: false, pred: ['2@xxx']}
      ])
    })

    it('should support list splicing', () => {
      context.splice([{key: 'birds', objectId: listId}], 0, 1, ['starling', 'goldfinch'])
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {'1@actor1': {objectId: listId, type: 'list', edits: [
          {action: 'remove', index: 0},
          {action: 'insert', index: 0, elemId: `2@${context.actorId}`},
          {action: 'insert', index: 1, elemId: `3@${context.actorId}`}
        ], props: {
          0: {[`2@${context.actorId}`]: {value: 'starling'}},
          1: {[`3@${context.actorId}`]: {value: 'goldfinch'}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'del', key: '1@xxx', insert: false, pred: ['1@xxx']},
        {obj: listId, action: 'set', key: '_head', insert: true, value: 'starling', pred: []},
        {obj: listId, action: 'set', key: `2@${context.actorId}`, insert: true, value: 'goldfinch', pred: []}
      ])
    })
  })

  describe('Table manipulation', () => {
    let tableId, table

    beforeEach(() => {
      tableId = uuid()
      table = instantiateTable(tableId)
      context.cache[tableId] = table
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, books: table, [CONFLICTS]: {books: {'1@actor1': table}}}
    })

    it('should add a table row', () => {
      const rowId = context.addTableRow([{key: 'books', objectId: tableId}], {author: 'Mary Shelley', title: 'Frankenstein'})
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        books: {'1@actor1': {objectId: tableId, type: 'table', props: {
          [rowId]: {[`1@${context.actorId}`]: {objectId: `1@${context.actorId}`, type: 'map', props: {
            author: {[`2@${context.actorId}`]: {value: 'Mary Shelley'}},
            title: {[`3@${context.actorId}`]: {value: 'Frankenstein'}}
          }}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: tableId, action: 'makeMap', key: rowId, insert: false, pred: []},
        {obj: `1@${context.actorId}`, action: 'set', key: 'author', insert: false, value: 'Mary Shelley', pred: []},
        {obj: `1@${context.actorId}`, action: 'set', key: 'title', insert: false, value: 'Frankenstein', pred: []}
      ])
    })

    it('should delete a table row', () => {
      const rowId = `1@${uuid()}`
      const row = {author: 'Mary Shelley', title: 'Frankenstein'}
      row[OBJECT_ID] = rowId
      table.entries[rowId] = row
      context.deleteTableRow([{key: 'books', objectId: tableId}], rowId)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        books: {'1@actor1': {objectId: tableId, type: 'table', props: {[rowId]: {}}}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: tableId, action: 'del', key: rowId, insert: false, pred: [rowId]}
      ])
    })
  })

  it('should increment a counter', () => {
    const counter = new Counter()
    context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, counter, [CONFLICTS]: {counter: {'1@actor1': counter}}}
    context.increment([], 'counter', 1)
    assert(applyPatch.calledOnce)
    assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
      counter: {[`1@${context.actorId}`]: {value: 1, datatype: 'counter'}}
    }})
    assert.deepStrictEqual(context.ops, [{obj: ROOT_ID, action: 'inc', key: 'counter', insert: false, value: 1, pred: ['1@actor1']}])
  })
})
