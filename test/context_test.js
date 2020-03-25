const assert = require('assert')
const sinon = require('sinon')
const { Context } = require('../frontend/context')
const { CACHE, OBJECT_ID, CONFLICTS } = require('../frontend/constants')
const { ROOT_ID } = require('../src/common')
const { Counter } = require('../frontend/counter')
const { Table, instantiateTable } = require('../frontend/table')
const { Text } = require('../frontend/text')
const uuid = require('../src/uuid')

describe('Proxying context', () => {
  let context, applyPatch

  beforeEach(() => {
    applyPatch = sinon.spy()
    context = new Context({[CACHE]: {[ROOT_ID]: {}}}, uuid(), applyPatch)
  })

  describe('.setMapKey', () => {
    it('should assign a primitive value to a map key', () => {
      context.setMapKey([], 'sparrows', 5)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        sparrows: {[context.actorId]: {value: 5}}
      }})
      assert.deepStrictEqual(context.ops, [{obj: ROOT_ID, action: 'set', key: 'sparrows', value: 5}])
    })

    it('should do nothing if the value was not changed', () => {
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, goldfinches: 3, [CONFLICTS]: {goldfinches: {actor1: 3}}}
      context.setMapKey([], 'goldfinches', 3)
      assert(applyPatch.notCalled)
      assert.deepStrictEqual(context.ops, [])
    })

    it('should allow a conflict to be resolved', () => {
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, goldfinches: 5, [CONFLICTS]: {goldfinches: {actor1: 3, actor2: 5}}}
      context.setMapKey([], 'goldfinches', 3)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        goldfinches: {[context.actorId]: {value: 3}}
      }})
      assert.deepStrictEqual(context.ops, [{obj: ROOT_ID, action: 'set', key: 'goldfinches', value: 3}])
    })

    it('should create nested maps', () => {
      context.setMapKey([], 'birds', {goldfinches: 3})
      assert(applyPatch.calledOnce)
      const objectId = applyPatch.firstCall.args[0].props.birds[context.actorId].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {[context.actorId]: {objectId, type: 'map', props: {
          goldfinches: {[context.actorId]: {value: 3}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'makeMap', key: 'birds', child: objectId},
        {obj: objectId, action: 'set', key: 'goldfinches', value: 3}
      ])
    })

    it('should perform assignment inside nested maps', () => {
      const objectId = uuid(), child = {[OBJECT_ID]: objectId}
      context.cache[objectId] = child
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, [CONFLICTS]: {birds: {actor1: child}}, birds: child}
      context.setMapKey([{key: 'birds', objectId}], 'goldfinches', 3)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {actor1: {objectId, type: 'map', props: {
          goldfinches: {[context.actorId]: {value: 3}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [{obj: objectId, action: 'set', key: 'goldfinches', value: 3}])
    })

    it('should perform assignment inside conflicted maps', () => {
      const objectId1 = uuid(), child1 = {[OBJECT_ID]: objectId1}
      const objectId2 = uuid(), child2 = {[OBJECT_ID]: objectId2}
      context.cache[objectId1] = child1
      context.cache[objectId2] = child2
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, birds: child2,
        [CONFLICTS]: {birds: {actor1: child1, actor2: child2}}}
      context.setMapKey([{key: 'birds', objectId: objectId2}], 'goldfinches', 3)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {birds: {
        actor1: {objectId: objectId1, type: 'map'},
        actor2: {objectId: objectId2, type: 'map', props: {
          goldfinches: {[context.actorId]: {value: 3}}
        }}
      }}})
      assert.deepStrictEqual(context.ops, [{obj: objectId2, action: 'set', key: 'goldfinches', value: 3}])
    })

    it('should handle conflict values of various types', () => {
      const objectId = uuid(), child = {[OBJECT_ID]: objectId}, dateValue = new Date()
      context.cache[objectId] = child
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, values: child, [CONFLICTS]: {values: {
        actor1: dateValue, actor2: new Counter(), actor3: 42, actor4: null, actor5: child
      }}}
      context.setMapKey([{key: 'values', objectId}], 'goldfinches', 3)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {values: {
        actor1: {value: dateValue.getTime(), datatype: 'timestamp'},
        actor2: {value: 0, datatype: 'counter'},
        actor3: {value: 42},
        actor4: {value: null},
        actor5: {objectId, type: 'map', props: {goldfinches: {[context.actorId]: {value: 3}}}}
      }}})
      assert.deepStrictEqual(context.ops, [{obj: objectId, action: 'set', key: 'goldfinches', value: 3}])
    })

    it('should create nested lists', () => {
      context.setMapKey([], 'birds', ['sparrow', 'goldfinch'])
      assert(applyPatch.calledOnce)
      const objectId = applyPatch.firstCall.args[0].props.birds[context.actorId].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {[context.actorId]: {objectId, type: 'list', props: {
          0: {[context.actorId]: {value: 'sparrow'}},
          1: {[context.actorId]: {value: 'goldfinch'}}
        }, edits: [
          {action: 'insert', index: 0}, {action: 'insert', index: 1}
        ]}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'makeList', key: 'birds', child: objectId},
        {obj: objectId, action: 'set', key: 0, insert: true, value: 'sparrow'},
        {obj: objectId, action: 'set', key: 1, insert: true, value: 'goldfinch'}
      ])
    })

    it('should create nested Text objects', () => {
      context.setMapKey([], 'text', new Text('hi'))
      const objectId = applyPatch.firstCall.args[0].props.text[context.actorId].objectId
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        text: {[context.actorId]: {objectId, type: 'text', props: {
          0: {[context.actorId]: {value: 'h'}},
          1: {[context.actorId]: {value: 'i'}}
        }, edits: [
          {action: 'insert', index: 0}, {action: 'insert', index: 1}
        ]}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'makeText', key: 'text', child: objectId},
        {obj: objectId, action: 'set', key: 0, insert: true, value: 'h'},
        {obj: objectId, action: 'set', key: 1, insert: true, value: 'i'}
      ])
    })

    it('should create nested Table objects', () => {
      context.setMapKey([], 'books', new Table(['author', 'title']))
      assert(applyPatch.calledOnce)
      const objectId = applyPatch.firstCall.args[0].props.books[context.actorId].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        books: {[context.actorId]: {objectId, type: 'table', props: {}}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'makeTable', key: 'books', child: objectId}
      ])
    })

    it('should allow assignment of Date values', () => {
      const now = new Date()
      context.setMapKey([], 'now', now)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        now: {[context.actorId]: {value: now.getTime(), datatype: 'timestamp'}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'set', key: 'now', value: now.getTime(), datatype: 'timestamp'}
      ])
    })

    it('should allow assignment of Counter values', () => {
      const counter = new Counter(3)
      context.setMapKey([], 'counter', counter)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        counter: {[context.actorId]: {value: 3, datatype: 'counter'}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: ROOT_ID, action: 'set', key: 'counter', value: 3, datatype: 'counter'}
      ])
    })
  })

  describe('.deleteMapKey', () => {
    it('should remove an existing key', () => {
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, goldfinches: 3, [CONFLICTS]: {goldfinches: {actor1: 3}}}
      context.deleteMapKey([], 'goldfinches')
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {goldfinches: {}}})
      assert.deepStrictEqual(context.ops, [{obj: ROOT_ID, action: 'del', key: 'goldfinches'}])
    })

    it('should do nothing if the key does not exist', () => {
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, goldfinches: 3, [CONFLICTS]: {goldfinches: {actor1: 3}}}
      context.deleteMapKey([], 'sparrows')
      const expected = {objectId: ROOT_ID, type: 'map'}
      assert(applyPatch.notCalled)
      assert.deepStrictEqual(context.ops, [])
    })

    it('should update a nested object', () => {
      const objectId = uuid(), child = {[OBJECT_ID]: objectId, [CONFLICTS]: {goldfinches: {actor1: 3}}, goldfinches: 3}
      context.cache[objectId] = child
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, [CONFLICTS]: {birds: {actor1: child}}, birds: child}
      context.deleteMapKey([{key: 'birds', objectId}], 'goldfinches')
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {actor1: {objectId, type: 'map', props: {goldfinches: {}}}}
      }})
      assert.deepStrictEqual(context.ops, [{obj: objectId, action: 'del', key: 'goldfinches'}])
    })
  })

  describe('list manipulation', () => {
    let listId, list

    beforeEach(() => {
      listId = uuid()
      list = ['swallow', 'magpie']
      Object.defineProperty(list, OBJECT_ID, {value: listId})
      Object.defineProperty(list, CONFLICTS, {value: [{actor1: 'swallow'}, {actor1: 'magpie'}]})
      context.cache[listId] = list
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, birds: list, [CONFLICTS]: {birds: {actor1: list}}}
    })

    it('should overwrite an existing list element', () => {
      context.setListIndex([{key: 'birds', objectId: listId}], 0, 'starling')
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {actor1: {objectId: listId, type: 'list', props: {
          0: {[context.actorId]: {value: 'starling'}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [{obj: listId, action: 'set', key: 0, value: 'starling'}])
    })

    it('should create nested objects on assignment', () => {
      context.setListIndex([{key: 'birds', objectId: listId}], 1, {english: 'goldfinch', latin: 'carduelis'})
      assert(applyPatch.calledOnce)
      const nestedId = applyPatch.firstCall.args[0].props.birds.actor1.props[1][context.actorId].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {actor1: {objectId: listId, type: 'list', props: {
          1: {[context.actorId]: {objectId: nestedId, type: 'map', props: {
            english: {[context.actorId]: {value: 'goldfinch'}},
            latin: {[context.actorId]: {value: 'carduelis'}}
          }}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'makeMap', key: 1, child: nestedId},
        {obj: nestedId, action: 'set', key: 'english', value: 'goldfinch'},
        {obj: nestedId, action: 'set', key: 'latin', value: 'carduelis'}
      ])
    })

    it('should create nested objects on insertion', () => {
      context.splice([{key: 'birds', objectId: listId}], 2, 0, [{english: 'goldfinch', latin: 'carduelis'}])
      assert(applyPatch.calledOnce)
      const nestedId = applyPatch.firstCall.args[0].props.birds.actor1.props[2][context.actorId].objectId
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {actor1: {objectId: listId, type: 'list', edits: [
          {action: 'insert', index: 2}
        ], props: {
          2: {[context.actorId]: {objectId: nestedId, type: 'map', props: {
            english: {[context.actorId]: {value: 'goldfinch'}},
            latin: {[context.actorId]: {value: 'carduelis'}}
          }}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'makeMap', key: 2, insert: true, child: nestedId},
        {obj: nestedId, action: 'set', key: 'english', value: 'goldfinch'},
        {obj: nestedId, action: 'set', key: 'latin', value: 'carduelis'}
      ])
    })

    it('should support deleting list elements', () => {
      context.splice([{key: 'birds', objectId: listId}], 0, 2, [])
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {actor1: {objectId: listId, type: 'list', props: {}, edits: [
          {action: 'remove', index: 0}, {action: 'remove', index: 0}
        ]}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'del', key: 0},
        {obj: listId, action: 'del', key: 0}
      ])
    })

    it('should support list splicing', () => {
      context.splice([{key: 'birds', objectId: listId}], 0, 1, ['starling', 'goldfinch'])
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        birds: {actor1: {objectId: listId, type: 'list', edits: [
          {action: 'remove', index: 0},
          {action: 'insert', index: 0},
          {action: 'insert', index: 1}
        ], props: {
          0: {[context.actorId]: {value: 'starling'}},
          1: {[context.actorId]: {value: 'goldfinch'}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: listId, action: 'del', key: 0},
        {obj: listId, action: 'set', key: 0, insert: true, value: 'starling'},
        {obj: listId, action: 'set', key: 1, insert: true, value: 'goldfinch'}
      ])
    })
  })

  describe('Table manipulation', () => {
    let tableId, table

    beforeEach(() => {
      tableId = uuid()
      table = instantiateTable(tableId)
      context.cache[tableId] = table
      context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, books: table, [CONFLICTS]: {books: {actor1: table}}}
    })

    it('should add a table row', () => {
      const rowId = context.addTableRow([{key: 'books', objectId: tableId}], {author: 'Mary Shelley', title: 'Frankenstein'})
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        books: {actor1: {objectId: tableId, type: 'table', props: {
          [rowId]: {[rowId]: {objectId: rowId, type: 'map', props: {
            author: {[context.actorId]: {value: 'Mary Shelley'}},
            title: {[context.actorId]: {value: 'Frankenstein'}}
          }}}
        }}}
      }})
      assert.deepStrictEqual(context.ops, [
        {obj: tableId, action: 'makeMap', key: rowId, child: rowId},
        {obj: rowId, action: 'set', key: 'author', value: 'Mary Shelley'},
        {obj: rowId, action: 'set', key: 'title', value: 'Frankenstein'}
      ])
    })

    it('should delete a table row', () => {
      const rowId = uuid()
      const row = {author: 'Mary Shelley', title: 'Frankenstein'}
      row[OBJECT_ID] = rowId
      table.entries[rowId] = row
      context.deleteTableRow([{key: 'books', objectId: tableId}], rowId)
      assert(applyPatch.calledOnce)
      assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
        books: {actor1: {objectId: tableId, type: 'table', props: {[rowId]: {}}}}
      }})
      assert.deepStrictEqual(context.ops, [{obj: tableId, action: 'del', key: rowId}])
    })
  })

  it('should increment a counter', () => {
    const counter = new Counter()
    context.cache[ROOT_ID] = {[OBJECT_ID]: ROOT_ID, counter, [CONFLICTS]: {counter: {actor1: counter}}}
    context.increment([], 'counter', 1)
    assert(applyPatch.calledOnce)
    assert.deepStrictEqual(applyPatch.firstCall.args[0], {objectId: ROOT_ID, type: 'map', props: {
      counter: {[context.actorId]: {value: 1, datatype: 'counter'}}
    }})
    assert.deepStrictEqual(context.ops, [{obj: ROOT_ID, action: 'inc', key: 'counter', value: 1}])
  })
})
