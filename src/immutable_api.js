const { Map, List, Set, Record } = require('immutable')
const State = require('./state')
const OpSet = require('./op_set')


//// Write

// Returns `true` if object is one of the write proxies we yield for users
// in `change` blocks.
function isWriteObject(object) {
  return ((object instanceof WriteMap) || (object instanceof WriteList))
}

// Returns a context that reflects the changes encoded in `leftValue`'s context
// with all of those encoded in `rightValues`' contexts merged in too.
//
// We need this because we convey changes via contexts purely functionally,
// and it's possible for users to do updates to different parts of the
// document and then combine those changes (e.g. in the root document), all
// within the same `change` block.
function mergeContexts(leftValue, ...rightValues) {
  let accumContext = leftValue._context
  for (let rightValue of rightValues) {
    if (isWriteObject(rightValue)) {
      const rightContext = rightValue._context
      const rightContextLocal = rightContext.getIn(['state', 'opSet', 'local'])
      const accumContextLocal = accumContext.getIn(['state', 'opSet', 'local'])
      const actorId = accumContext.getIn(['state', 'actorId'])
      let opSet = accumContext.getIn(['state', 'opSet'])
      rightContextLocal.forEach(op => {
        if (!accumContextLocal.contains(op)) {
          const ret = OpSet.addLocalOp(opSet, op, actorId)
          opSet = ret[0]
        }
      })
      accumContext = accumContext.setIn(['state', 'opSet'], opSet)
    } else if (isReadObject(rightValue)) {
      throw new Error('Do not know how to handle these objects')
    }
  }
  return accumContext
}

// Validator for getIn / setIn / updateIn.
function mustGiveKeys(keys, fnName) {
  if (keys.length === 0) {
    throw new TypeError(`Must have at least one key to ${fnName}`)
  }
}

function genericGetIn(from, keys) {
  let obj = from
  if (keys.length === 0) {
    throw new TypeError('Must have at least one key to getIn')
  }
  for (let key of keys) {
    obj = obj.get(key)
    if (obj === undefined) break
  }
  return obj
}

function genericSetIn(from, keys, value) {
  mustGiveKeys(keys, 'setIn')

  let keyedObject = from
  for (let i=1; i<keys.length; i++) {
    keyedObject = keyedObject.get(keys[i-1])
    // If we're missing any containers in the chain, we need to create empty
    // maps. To do that, we'll first form the new maps as standard immutable
    // nested values around the original leaf value, and then setIn that new,
    // larger value with the smaller, existing array of keys as the path.
    if (!keyedObject) {
      const keysWithObjects = keys.slice(0, i)
      const keysWithoutObjects = keys.slice(i)
      let newValue = value
      for (let j=keysWithoutObjects.length-1; j>=0; j--) {
        newValue = new Map().set(keysWithoutObjects[j], newValue)
      }
      return from.setIn(keysWithObjects, newValue)
    }
  }
  const intContext = mergeContexts(from, value)
  const newContext = intContext.update('state', (s) => {
    const keyedObjectId = keyedObject._objectId
    const keyedObjectKey = keys[keys.length-1]
    if (keyedObject instanceof WriteMap) {
      return State.setField(s, keyedObjectId, keyedObjectKey, value)
    } else if (keyedObject instanceof WriteList) {
      return State.setListIndex(s, keyedObjectId, keyedObjectKey, value)
    } else {
      throw new Error('Unexpected keyedObject (and should be unreachable)')
    }
  })

  if (from instanceof WriteMap) {
    return new WriteMap(newContext, from._objectId)
  } else if (from instanceof WriteList) {
    return new WriteList(newContext, from._objectId)
  } else {
    throw new Error('Unexpected genericSetIn from: ' + from.toString())
  }
}

class WriteList {
  constructor(context, objectId) {
    // _context and _objectId are private to Automerge
    this._context = context
    this._objectId = objectId

    // size is a public field in the Immutable.js API, and so too here
    this.size = OpSet.listLength(this._context.state.get('opSet'), this._objectId)
  }

  // Returns an `Immutable.List` with the current contets of this `WriteList`.
  // Contained values will still be wrapped in `WriteList` / `WriteMap` as
  // appropriate. Getting a materialized list is useful when we need to do
  // something with the whole collection, like in `toString` below.
  _materialize() {
    const iter = OpSet.listIterator(this._context.state.get('opSet'), this._objectId, 'values', this._context)
    return new List(iter)
  }

  toString() {
    const listString = this._materialize().__toString('[',']')
    return `WriteList(${this._objectId}) ${listString}`
  }

  // Persistent changes

  // Unlike the Immutable.JS API, it's an error to `set` beyond the current
  // bounds of the list. This is enforced by Automerge internals.
  set(index, value) {
    // Handle negative index here as in Immutable.js API.
    // Underlying Automerge lib errors otherwise.
    if (index < 0) {
      return this.set(this.size + index, value)
    }
    const intContext = mergeContexts(this, value)
    const newContext = intContext.update('state', (s) => {
      return State.setListIndex(s, this._objectId, index, value)
    })
    return new WriteList(newContext, this._objectId)
  }

  delete(index) {
    return this.splice(index, 1)
  }

  remove(index) {
    return this.delete(index)
  }

  insert(index, value) {
    return this.splice(index, 0, value)
  }

  // clear()

  push(...values) {
    return this.splice(this.size, 0, ...values)
  }

  pop() {
    if (this.size == 0) {
      return this
    }
    return this.splice(this.size - 1, 1)
  }

  unshift(value) {
    return this.splice(0, 0, value)
  }

  shift() {
    return this.splice(0, 1)
  }

  update(key, fn) {
    throw new Error('Not yet implemented')
  }

  // setSize(size)

  // Deep persistent changes

  setIn(keys, value) {
    return genericSetIn(this, keys, value)
  }

  // deleteIn()
  // removeIn()

  updateIn(key, fn) {
    throw new Error('Not yet implemented')
  }

  // mergeIn()
  // mergeDeepIn()

  // Transient changes
  withMutations() { throw new Error('Not supported - get _data.' ) }
  asMutable() {     throw new Error('Not supported - get _data.' ) }
  wasAltered() {    throw new Error('Not supported - get _data.' ) }
  asImmutable() {   throw new Error('Not supported - get _data.' ) }

  // Sequence algorithms
  // concat(...valuesOrCollections)
  // merge(...valuesOrCollections)
  // map(mapper, context)
  // flatMap()
  // filter()
  // zip()
  // zipAll()
  // zipWith()
  // [Symbol.iterator]()
  // filterNot()
  // reverse()
  // sortBy(comparatorValueMapper, comparator)
  // sortBy()
  // groupBy()

  // Conversion to Javascript types
  // toJS()
  // toJSON()
  // toArray()
  // toObject()

  // Reading values

  get(index) {
    return OpSet.listElemByIndex(this._context.state.get('opSet'), this._objectId, index, this._context)
  }

  // has()
  // includes()
  // contains()
  // first()
  // last()

  // Conversion to Seq
  // toSeq()
  // fromEntrySeq()
  // toKeyedSeq()
  // toIndexedSeq()
  // toSetSeq()

  // Combination
  // interpose()
  // interleave()

  splice(index, removeNum, ...values) {
    if (removeNum === undefined) {
      removeNum = this.size - index
    }

    const intContext = mergeContexts(this, ...values)
    const newContext = intContext.update('state', (s) => {
      return State.splice(s, this._objectId, index, removeNum, values)
    })
    return new WriteList(newContext, this._objectId)
  }

  // flatten()

  // Search for value
  // indexOf()
  // lastIndexOf()
  // findIndex()
  // findLastIndex()
  // find()
  // findLast()
  // findEntry()
  // findLastEntry()
  // findKey()
  // findLastKey()
  // keyOf()
  // lastKeyOf()
  // max()
  // maxBy()
  // min()
  // minBy()

  // Value equality
  // equals(other)
  // hashCode()

  // Reading deep values

  getIn(keys) {
    return genericGetIn(this, keys)
  }

  // hasIn()

  // Conversion to Collections
  // toMap()
  // toOrderedMap()
  // toSet()
  // toOrderedSet()
  // toList()
  // toStack()

  // Iterators
  // keys()
  // values()
  // entries()

  // Collections (Seq)
  // keySeq()
  // valueSeq()
  // entrySeq()

  // Side effects

  forEach(sideEffect, context) {
    return this._materialize().forEach(sideEffect, context)
  }

  // Creating subsets
  // slice(begin, end)
  // rest()
  // butLast()
  // skip()
  // skipLast()
  // skipWhile()
  // skipUntil()
  // take()
  // takeLast()
  // takeWhile()
  // takeUntil()

  // Reducing a value
  // reduce()
  // reduceRight()
  // every()
  // some()
  // join
  // isEmpty()
  // count()
  // countBy()

  // Comparison
  // isSubset()
  // isSuperset()
}

class WriteMap {
  constructor(context, objectId) {
    this._context = context
    this._objectId = objectId
  }

  // Returns an `Immutable.Map` with the current contets of this `WriteMap`.
  // Contained values will still be wrapped in `WriteList` / `WriteMap` as
  // appropriate. Getting a materialized list is useful when we need to do
  // something with the whole collection, like in `toString` below.
  _materialize() {
    const opSet = this._context.state.get('opSet')
    return new Map().withMutations(map => {
      for (let field of OpSet.getObjectFields(opSet, this._objectId)) {
        // OpSet.getObjectFields forcibly adds '_objectId', which we want as
        // metadata, not data. So exclude it from here.
        if (field !== '_objectId') {
          const val = OpSet.getObjectField(opSet, this._objectId, field, this._context)
          map.set(field, val)
        }
      }
    })
  }

  toString() {
    const mapString = this._materialize().__toString('{','}')
    return `WriteMap(${this._objectId}) ${mapString}`
  }

  // Persistent changes

  set(key, value) {
    const intContext = mergeContexts(this, value)
    const newContext = intContext.update('state', (s) => {
      return State.setField(s, this._objectId, key, value)
    })
    return new WriteMap(newContext, this._objectId)
  }

  // Unlike the Immutable.js API, it is an error to `delete` a key not in the
  // map. This is enforced by Automerge internals.
  delete(key) {
    const newContext = this._context.update('state', (s) => {
      return State.deleteField(s, this._objectId, key)
    })
    return new WriteMap(newContext, this._objectId)
  }

  // Alias of `delete`.
  remove(key) {
    return this.delete(key)
  }

  // deleteAll()
  // removeAll()
  // clear()

  update(key, fn) {
    if (arguments.length != 2) {
      throw new TypeError('Must use 2-ary form of .update')
    }

    const oldValue = this.get(key)
    const newValue = fn(oldValue)
    return this.set(key, newValue)
  }

  // merge()
  // concat()
  // mergeWith()
  // mergeDeep()
  // mergeDeepIn()

  // Deep persistent changes

  setIn(keys, value) {
    return genericSetIn(this, keys, value)
  }

  deleteIn(keys) {
    if (keys.length === 0) {
      throw new TypeError('Must have at least one key to deleteIn')
    }
    let keyedObj = this
    for (let i=1; i<keys.length; i++) {
      keyedObj = keyedObj.get(keys[i-1])
      if (!keyedObj) {
        return this
      }
    }
    const innerKey = keys[keys.length-1]
    if (!keyedObj.get(innerKey)) {
      return this
    }
    const newContext = this._context.update('state', (s) => {
      return State.deleteField(s, keyedObj._objectId, innerKey)
    })
    return new WriteMap(newContext, this._objectId)
  }

  removeIn(keys) {
    return this.deleteIn(keys)
  }

  updateIn(keys, fn) {
    mustGiveKeys(keys, 'updateIn')
    if (arguments.length != 2) {
      throw new TypeError('Must use 2-ary form of .updateIn')
    }

    const oldValue = this.getIn(keys)
    const newValue = fn(oldValue)
    return this.setIn(keys, newValue)
  }

  // mergeIn()
  // deepMergeIn()

  // Transient changes
  withMutations() { throw new Error('Not supported - get _data.' ) }
  asMutable() {     throw new Error('Not supported - get _data.' ) }
  wasAltered() {    throw new Error('Not supported - get _data.' ) }
  asImmutable() {   throw new Error('Not supported - get _data.' ) }

  // # Sequence algorithms
  // map(mapper, context)
  // mapKeys()
  // mapEntries()
  // flatMap()
  // filter()
  // flip()
  // filterNot(predicate)
  // reverse()
  // sort()
  // sortBy(comparatorValueMapper, comparator)
  // groupBy()

  // Conversion to Javascript types
  // toJS()
  // toJSON()
  // toArray()
  // toObject()

  // Conversion to Seq
  // toSeq()
  // toKeyedSeq()
  // toIndexedSeq()
  // toSetSeq()

  // Sequence functions
  // concat()
  // [Symbol.iterator]()

  // Value equality
  // equals(other)
  // hashCode()

  // Reading values

  get(key) {
    return OpSet.getObjectField(this._context.state.get('opSet'), this._objectId, key, this._context)
  }

  // has()
  // includes()
  // contains()
  // first()
  // last()

  // Reading deep values

  getIn(keys) {
    return genericGetIn(this, keys)
  }

  // hasIn()

  // Conversion to Collections
  // toMap()
  // toOrderedMap()
  // toSet()
  // toOrderedSet()
  // toList()
  // toStack()

  // Iterators
  // keys()
  // values()
  // entries()

  // Collections (Seq)
  // keySeq()
  // valueSeq()
  // entrySeq()

  // Side effects
  // forEach(sideEffect, context)

  // Creating subsets
  // slice()
  // rest()
  // butLast()
  // skip()
  // skipLast()
  // skipWhile()
  // skipUntil()
  // take()
  // takeLast()
  // takeWhile()
  // takeUntil()

  // Combination
  // flatten()

  // Reducing a value
  // reduce()
  // reduceRight()
  // every()
  // some()
  // join()
  // isEmpty()
  // count()
  // countBy()

  // Search for value
  // find()
  // findLast()
  // findEntry()
  // findLastEntry()
  // findKey()
  // findLastKey()
  // keyOf()
  // lastKeyOf()
  // max()
  // maxBy()
  // min()
  // minBy()

  // Comparison
  // isSubset()
  // isSuperset()
}

function instantiateWriteObject(opSet, objectId) {
  const objectType = opSet.getIn(['byObject', objectId, '_init', 'action'])
  if (objectType === 'makeMap') {
    return new WriteMap(this, objectId)
  } else if (objectType === 'makeList') {
    return new WriteList(this, objectId)
  } else {
    throw new Error('Unknown object type: ' + objectType)
  }
}

function rootWriteMap(context) {
  const newContext = context.set('instantiateObject', instantiateWriteObject)
  return new WriteMap(newContext, '00000000-0000-0000-0000-000000000000')
}

const ImmutableContext = Record({
  state: undefined,
  instantiateObject: undefined,
})


//// Read

function isReadObject(object) {
  return ((object instanceof ReadMap) || (object instanceof ReadList))
}

class ReadList {
  constructor(data, objectId) {
    if (!(data instanceof List)) {
      throw TypeError('Must pass Immutable.List (can be ReadList)')
    }
    return makeReadList(data, objectId)
  }

  toString() {
    return this._data.__toString(`ReadList(${this._objectId}) [`, ']')
  }

  // Persistent changes
  set(index, value) { return this._data.set(index, value) }
  delete(index) { return this._data.delete(index) }
  remove(index) { return this._data.remove(index) }
  insert(index, value) { return this._data.insert(index, value) }
  clear() { return this._data.clear() }
  push(...values) { return this._data.push(...values) }
  pop() { return this._data.pop() }
  unshift(...values) { return this._data.unshift(...values) }
  shift() { return this._data.shift() }
  // update()
  setSize(size) { return this._data.setSize(size) }

  // Deep persistent changes
  // setIn()
  // deleteIn()
  // removeIn()
  // updateIn()
  // mergeIn()
  // mergeDeepIn()

  // Transient changes
  withMutations() { throw new Error('Not supported - get _data.' ) }
  asMutable() {     throw new Error('Not supported - get _data.' ) }
  wasAltered() {    throw new Error('Not supported - get _data.' ) }
  asImmutable() {   throw new Error('Not supported - get _data.' ) }

  // Sequence algorithms
  concat(...valuesOrCollections) { this._data.concat(...valuesOrCollections) }
  merge(...valuesOrCollections) { this._data.merge(...valuesOrCollections) }
  map(mapper, context) { return this._data.map(mapper, context) }
  // flatMap()
  // filter()
  // zip()
  // zipAll()
  // zipWith()
  // [Symbol.iterator]()
  // filterNot()
  // reverse()
  sortBy(comparatorValueMapper, comparator) { return this._data.sortBy(comparatorValueMapper, comparator) }
  // sortBy()
  // groupBy()

  // Conversion to Javascript types
  // toJS()
  // toJSON()
  // toArray()
  // toObject()

  // Reading values
  get(index, notSetValue) { return this._data.get(index, notSetValue) }
  // has()
  // includes()
  // contains()
  // first()
  // last()

  // Conversion to Seq
  // toSeq()
  // fromEntrySeq()
  // toKeyedSeq()
  // toIndexedSeq()
  // toSetSeq()

  // Combination
  // interpose()
  // interleave()
  // splice()
  // flatten()

  // Search for value
  // indexOf()
  // lastIndexOf()
  // findIndex()
  // findLastIndex()
  // find()
  // findLast()
  // findEntry()
  // findLastEntry()
  // findKey()
  // findLastKey()
  // keyOf()
  // lastKeyOf()
  // max()
  // maxBy()
  // min()
  // minBy()

  // Value equality
  equals(other) { return this._data.equals(other) }
  hashCode() { return this._data.hashCode() }

  // Reading deep values
  getIn(keys) { return this._data.getIn(keys) }
  // hasIn()

  // Conversion to Collections
  // toMap()
  // toOrderedMap()
  // toSet()
  // toOrderedSet()
  // toList()
  // toStack()

  // Iterators
  // keys()
  // values()
  // entries()

  // Collections (Seq)
  // keySeq()
  // valueSeq()
  // entrySeq()

  // Side effects
  forEach(sideEffect, context) { return this._data.forEach(sideEffect, context) }

  // Creating subsets
  slice(begin, end) { return this._data.slice(begin, end) }
  // rest()
  // butLast()
  // skip()
  // skipLast()
  // skipWhile()
  // skipUntil()
  // take()
  // takeLast()
  // takeWhile()
  // takeUntil()

  // Reducing a value
  reduce(reducer, initialReduction, context) { return this._data.reduce(reducer, initialReduction, context) }
  // reduceRight()
  // every()
  // some()
  // join
  // isEmpty()
  // count()
  // countBy()

  // Comparison
  // isSubset()
  // isSuperset()
}

function makeReadList(data, objectId) {
  const rl = Object.create(ReadList.prototype)
  rl._data = data
  rl.size = data.size
  rl._objectId = objectId
  return rl
}


class ReadMap {
  constructor(data, objectId, conflicts) {
    if (!(data instanceof Map)) {
      throw TypeError('Must pass Immutable.Map (can be ReadMap)')
    }
    return makeReadMap(data, objectId, conflicts)
  }

  toString() {
    return this._data.__toString(`ReadMap(${this._objectId}) {`, '}')
  }

  // Persistent changes
  set(key, value) { return this._data.set(key, value) }
  delete(key) { return this._data.delete(key) }
  remove(key) { return this._data.remove(key) }
  // deleteAll()
  // removeAll()
  clear() { return this._data.clear() }
  // update()
  // merge()
  // concat()
  // mergeWith()
  // mergeDeep()
  // mergeDeepIn()

  // Deep persistent changes
  // setIn()
  // deleteIn()
  // removeIn()
  // updateIn()
  // mergeIn()
  // deepMergeIn()

  // Transient changes
  withMutations() { throw new Error('Not supported - get _data.' ) }
  asMutable() {     throw new Error('Not supported - get _data.' ) }
  wasAltered() {    throw new Error('Not supported - get _data.' ) }
  asImmutable() {   throw new Error('Not supported - get _data.' ) }

  // # Sequence algorithms
  map(mapper, context) { return this._data.map(mapper, context) }
  // mapKeys()
  // mapEntries()
  // flatMap()
  // filter()
  // flip()
  filterNot(predicate) { return this._data.filterNot(predicate) }
  // reverse()
  // sort()
  sortBy(comparatorValueMapper, comparator) { return this._data.sortBy(comparatorValueMapper, comparator) }
  // groupBy()

  // Conversion to Javascript types
  // toJS()
  // toJSON()
  // toArray()
  // toObject()

  // Conversion to Seq
  // toSeq()
  // toKeyedSeq()
  // toIndexedSeq()
  // toSetSeq()

  // Sequence functions
  // concat()
  // [Symbol.iterator]()

  // Value equality
  equals(other) { return this._data.equals(other) }
  hashCode() { return this._data.hashCode() }

  // Reading values
  get(k, notSetValue) { return this._data.get(k, notSetValue) }
  // has()
  // includes()
  // contains()
  // first()
  // last()

  // Reading deep values
  getIn(ks, notSetValue) { return this._data.getIn(ks, notSetValue) }
  // hasIn()

  // Conversion to Collections
  // toMap()
  // toOrderedMap()
  // toSet()
  // toOrderedSet()
  // toList()
  // toStack()

  // Iterators
  // keys()
  // values()
  // entries()

  // Collections (Seq)
  // keySeq()
  // valueSeq()
  // entrySeq()

  // Side effects
  forEach(sideEffect, context) { return this._data.forEach(sideEffect, context) }

  // Creating subsets
  // slice()
  // rest()
  // butLast()
  // skip()
  // skipLast()
  // skipWhile()
  // skipUntil()
  // take()
  // takeLast()
  // takeWhile()
  // takeUntil()

  // Combination
  // flatten()

  // Reducing a value
  // reduce()
  // reduceRight()
  // every()
  // some()
  // join()
  // isEmpty()
  // count()
  // countBy()

  // Search for value
  // find()
  // findLast()
  // findEntry()
  // findLastEntry()
  // findKey()
  // findLastKey()
  // keyOf()
  // lastKeyOf()
  // max()
  // maxBy()
  // min()
  // minBy()

  // Comparison
  // isSubset()
  // isSuperset()
}

function makeReadMap(data, objectId, conflicts) {
  const rm = Object.create(ReadMap.prototype)
  rm._data = data
  rm.size = data.size
  rm._objectId = objectId
  rm._conflicts = conflicts
  return rm
}


function instantiateImmutable(opSet, objectId) {
  const isRoot = (objectId === OpSet.ROOT_ID)
  const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])

  // Don't read the root object from cache, because it may reference an outdated state.
  // The state may change without without invalidating the cache entry for the root object (for
  // example, adding an item to the queue of operations that are not yet causally ready).
  if (!isRoot) {
    if (opSet.hasIn(['cache', objectId])) return opSet.getIn(['cache', objectId])
    if (this.cache && this.cache[objectId]) return this.cache[objectId]
  }

  let obj
  if (isRoot || objType === 'makeMap') {
    const data = new Map().withMutations(data => {
      for (let field of OpSet.getObjectFields(opSet, objectId)) {
        // OpSet.getObjectFields forcibly adds '_objectId', which we want as metadata,
        // not data. So exclude it from here.
        if (field !== '_objectId') {
          data.set(field, OpSet.getObjectField(opSet, objectId, field, this))
        }
      }
    })
    const conflicts = OpSet.getObjectConflicts(opSet, objectId, this)
    obj = new ReadMap(data, objectId, conflicts)
  } else if (objType === 'makeList') {
    const data = List(OpSet.listIterator(opSet, objectId, 'values', this))
    obj = new ReadList(data, objectId)
  } else if (objType === 'makeText') {
    throw new Error('Unsupported object type: ' + objType)
  } else {
    throw new Error('Unknown object type: ' + objType)
  }

  if (this.cache) this.cache[objectId] = obj
  return obj
}

function materialize(opSet) {
  opSet = opSet.set('cache', Map())
  const context = {instantiateObject: instantiateImmutable, cache: {}}
  const rootObj = context.instantiateObject(opSet, OpSet.ROOT_ID)
  return [opSet.set('cache', Map(context.cache)), rootObj]
}

function refresh(opSet, objectId) {
  opSet = opSet.deleteIn(['cache', objectId])
  const context = {instantiateObject: instantiateImmutable, cache: {}}
  const object = context.instantiateObject(opSet, objectId)
  return opSet.setIn(['cache', objectId], object)
}

function updateMapObject(opSet, edit) {
  if (edit.action === 'create') {
    const map = new ReadMap(new Map(), edit.obj, new Map())
    return opSet.setIn(['cache', edit.obj], map)
  }

  let map = opSet.getIn(['cache', edit.obj])
  if (edit.action === 'set') {
    let conflicts = null
    if (edit.conflicts) {
      conflicts = new Map().withMutations(conflicts => {
        for (let conflict of edit.conflicts) {
          const value = conflict.link ? opSet.getIn(['cache', conflict.value]) : conflict.value
          conflicts.set(conflict.actor, value)
        }
      })
    }
    const newData = map._data.set(edit.key, edit.link ? opSet.getIn(['cache', edit.value]) : edit.value)
    const newConflicts = conflicts ? map._conflicts.set(edit.key, conflicts) : map._conflicts.delete(edit.key)
    map = new ReadMap(newData, edit.obj, newConflicts)
  } else if (edit.action === 'remove') {
    const newData = map._data.delete(edit.key)
    const newConflicts = map._conflicts.delete(edit.key)
    map = new ReadMap(newData, edit.obj, newConflicts)
  } else {
    throw 'Unknown action type: ' + edit.action
  }

  return opSet.setIn(['cache', edit.obj], map)
}

function updateListObject(opSet, edit) {
  if (edit.action === 'create') {
    const list = new ReadList(List(), edit.obj)
    return opSet.setIn(['cache', edit.obj], list)
  }

  const value = edit.link ? opSet.getIn(['cache', edit.value]) : edit.value
  let oldData = opSet.getIn(['cache', edit.obj])._data
  var newData

  if (edit.action === 'insert') {
    newData = oldData.insert(edit.index, value)
  } else if (edit.action === 'set') {
    newData = oldData.set(edit.index, value)
  } else if (edit.action === 'remove') {
    newData = oldData.delete(edit.index)
  } else throw 'Unknown action type: ' + edit.action

  const list = new ReadList(newData, edit.obj)
  return opSet.setIn(['cache', edit.obj], list)
}

function updateCache(opSet, diffs) {
  let affected = Set()
  for (let edit of diffs) {
    affected = affected.add(edit.obj)
    if (edit.type === 'map') {
      opSet = updateMapObject(opSet, edit)
    } else if (edit.type === 'list') {
      opSet = updateListObject(opSet, edit)
    } else if (edit.type === 'text') {
      throw new Error('Unsupported object type: ' + edit.type)
    } else {
      throw new Error('Unknown object type: ' + edit.type)
    }
  }

  // Update cache entries on the path from the root to the modified object
  while (!affected.isEmpty()) {
    affected = affected.flatMap(objectId => {
      return opSet
        .getIn(['byObject', objectId, '_inbound'], Set())
        .map(op => op.get('obj'))
    })
    for (let objectId of affected) opSet = refresh(opSet, objectId)
  }
  return opSet
}

function init(actorId) {
  const [opSet, rootObj] = materialize(OpSet.init())
  rootObj._state = Map({actorId, opSet})
  rootObj._actorId = actorId
  return rootObj
}

function applyChanges(root, changes, incremental) {
  let opSet = root._state.get('opSet'), diffs = [], diff
  for (let change of changes) {
    [opSet, diff] = OpSet.addChange(opSet, change)
    diffs.push(...diff)
  }

  let newRoot
  if (incremental) {
    opSet = updateCache(opSet, diffs)
    newRoot = opSet.getIn(['cache', OpSet.ROOT_ID])
    if (newRoot === root) {
      if (!(newRoot instanceof ReadMap)) {
        throw new Error('Did not expect newRoot: ' + newRoot.toString())
      }
      // Ugly hack to get a clone of the root object (since we mutably assign _state below)
      newRoot = new ReadMap(newRoot._data, newRoot._objectId, newRoot._conflicts)
    }
  } else {
    [opSet, newRoot] = materialize(opSet)
  }
  newRoot._state = root._state.set('opSet', opSet)
  newRoot._actorId = root._state.get('actorId')
  newRoot._objectId = root._objectId
  return newRoot
}

module.exports = {
  ReadMap, ReadList, WriteMap, WriteList,
  isWriteObject, isReadObject,
  rootWriteMap, ImmutableContext,
  init, applyChanges
}

// TODO: Understand exactly _state and other properties are thrown around.
// TODO: See if there's a cleaner way to handle instantiateObject props.
// TODO: Flesh out the collection APIs and/or rely more on Immutable.js implementations.
// TODO: Understand what Automerge.assign is meant to do.
// TODO: Add tests for metadata like _objectId, _conflicts, and maybe others.
// TODO: Look into history and previous versions of documents.
