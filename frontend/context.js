const { CACHE, INBOUND, OBJECT_ID, CONFLICTS, DEFAULT_V, MAX_ELEM } = require('./constants')
const { interpretPatch } = require('./apply_patch')
const { Text, getElemId } = require('./text')
const { Table } = require('./table')
const { Counter, getWriteableCounter } = require('./counter')
const { isObject, copyObject } = require('../src/common')
const uuid = require('../src/uuid')


/**
 * An instance of this class is passed to `rootObjectProxy()`. The methods are
 * called by proxy object mutation functions to query the current object state
 * and to apply the requested changes.
 */
class Context {
  constructor (doc, actorId) {
    this.actorId = actorId
    this.cache = doc[CACHE]
    this.updated = {}
    this.inbound = copyObject(doc[INBOUND])
    this.ops = []
    this.diffs = []
  }

  /**
   * Adds an operation object to the list of changes made in the current context.
   */
  addOp(operation) {
    this.ops.push(operation)
  }

  /**
   * Applies a diff object to the current document state.
   */
  apply(path, diff) {
    this.diffs.push(diff)
    interpretPatch([diff], this.cache, this.updated, this.inbound) // FIXME
  }

  /**
   * Returns an object (not proxied) from the cache or updated set, as appropriate.
   */
  getObject(objectId) {
    const object = this.updated[objectId] || this.cache[objectId]
    if (!object) throw new RangeError(`Target object does not exist: ${objectId}`)
    return object
  }

  /**
   * Returns the value associated with the property named `key` on the object
   * with ID `objectId`. If the value is an object, returns a proxy for it.
   */
  getObjectField(path, objectId, key) {
    if (!['string', 'number'].includes(typeof key)) return
    const object = this.getObject(objectId)

    if (object[key] instanceof Counter) {
      return getWriteableCounter(object[key].value, this, path, objectId, key)

    } else if (isObject(object[key])) {
      const subpath = path.concat([{objectId, key, actor: object[DEFAULT_V][key]}])
      // The instantiateObject function is added to the context object by rootObjectProxy()
      return this.instantiateObject(subpath, object[key][OBJECT_ID])

    } else {
      return object[key]
    }
  }

  /**
   * Recursively creates Automerge versions of all the objects and nested
   * objects in `value`, and returns the object ID of the root object. The new
   * root object is created under the key `key` in the existing object with ID
   * `objectId`. If `key` is not given, the ID of the new root object is used
   * as key (this construction is used by Automerge.Table).
   */
  createNestedObjects(path, objectId, key, value) {
    // if (typeof value[OBJECT_ID] === 'string') TODO: move existing object
    const childId = uuid()
    if (!key) key = childId

    if (value instanceof Text) {
      // Create a new Text object
      this.apply(path, {action: 'create', type: 'text', obj: childId})
      this.addOp({action: 'makeText', obj: objectId, key, child: childId})

      if (value.length > 0) {
        this.splice(objectId, 0, 0, [...value])
      }

      // Set object properties so that any subsequent modifications of the Text
      // object can be applied to the context
      let text = this.getObject(objectId)
      value[OBJECT_ID] = objectId
      value.elems = text.elems
      value[MAX_ELEM] = text.maxElem
      value.context = this

    } else if (value instanceof Table) {
      // Create a new Table object
      if (value.count > 0) {
        throw new RangeError('Assigning a non-empty Table object is not supported')
      }
      this.apply(path, {action: 'create', type: 'table', obj: childId})
      this.addOp({action: 'makeTable', obj: objectId, key, child: childId})
      this.setMapKey(TODO_PATH, childId, 'table', 'columns', value.columns)

    } else if (Array.isArray(value)) {
      // Create a new list object
      this.apply(path, {action: 'create', type: 'list', obj: childId})
      this.addOp({action: 'makeList', obj: objectId, key, child: childId})
      this.splice(path, childId, 0, 0, value)

    } else {
      // Create a new map object
      this.apply(path, {action: 'create', type: 'map', obj: childId})
      this.addOp({action: 'makeMap', obj: objectId, key, child: childId})

      for (let nested of Object.keys(value)) {
        this.setMapKey(TODO_PATH, childId, 'map', nested, value[nested])
      }
    }

    return childId
  }

  /**
   * Records an operation to update the object with ID `obj`, setting `key`
   * to `value`. Returns an object in which the value has been normalized: if it
   * is a reference to another object, `{value: otherObjectId, link: true}` is
   * returned; otherwise `{value: primitiveValue, datatype: someType}` is
   * returned. The datatype is only present for values that need to be
   * interpreted in a special way (timestamps, counters); for primitive types
   * (string, number, boolean, null) the datatype property is omitted.
   */
  setValue(path, obj, key, value) {
    if (!['object', 'boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`Unsupported type of value: ${typeof value}`)
    }

    if (isObject(value)) {
      if (value instanceof Date) {
        // Date object, translate to timestamp (milliseconds since epoch)
        const timestamp = value.getTime()
        this.addOp({action: 'set', obj, key, value: timestamp, datatype: 'timestamp'})
        return {value: timestamp, datatype: 'timestamp'}

      } else if (value instanceof Counter) {
        // Counter object, save current value
        this.addOp({action: 'set', obj, key, value: value.value, datatype: 'counter'})
        return {value: value.value, datatype: 'counter'}

      } else {
        // Nested object (map, list, text, or table)
        const childId = this.createNestedObjects(path, obj, key, value)
        return {value: childId, link: true}
      }
    } else {
      // Primitive value (number, string, boolean, or null)
      this.addOp({action: 'set', obj, key, value})
      return {value}
    }
  }

  /**
   * Updates the object with ID `objectId`, setting the property with name
   * `key` to `value`. The `type` argument is 'map' if the object is a map
   * object, or 'table' if it is a table object.
   */
  setMapKey(path, objectId, type, key, value) { // TODO use path
    if (typeof key !== 'string') {
      throw new RangeError(`The key of a map entry must be a string, not ${typeof key}`)
    }
    if (key === '') {
      throw new RangeError('The key of a map entry must not be an empty string')
    }

    const object = this.getObject(objectId)
    if (object[key] instanceof Counter) {
      throw new RangeError('Cannot overwrite a Counter object; use .increment() or .decrement() to change its value.')
    }

    // If the assigned field value is the same as the existing value, and
    // the assignment does not resolve a conflict, do nothing
    if (object[key] !== value || object[CONFLICTS][key] || value === undefined) {
      const valueObj = this.setValue(path, objectId, key, value)
      this.apply(path, Object.assign({action: 'set', type, obj: objectId, key}, valueObj))
    }
  }

  /**
   * Updates the map object with ID `objectId`, deleting the property `key`.
   */
  deleteMapKey(path, objectId, key) { // TODO use path
    const object = this.getObject(objectId)
    if (object[key] !== undefined) {
      this.apply(path, {action: 'remove', type: 'map', obj: objectId, key})
      this.addOp({action: 'del', obj: objectId, key})
    }
  }

  /**
   * Inserts a new list element `value` at position `index` into the list with
   * ID `objectId`.
   */
  insertListItem(path, objectId, index, value) { // TODO use path
    const list = this.getObject(objectId)
    if (index < 0 || index > list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }

    const maxElem = list[MAX_ELEM] + 1
    const type = (list instanceof Text) ? 'text' : 'list'
    const prevId = (index === 0) ? '_head' : getElemId(list, index - 1)
    const elemId = `${this.actorId}:${maxElem}`
    this.addOp({action: 'ins', obj: objectId, key: prevId, elem: maxElem})

    const valueObj = this.setValue(path, objectId, elemId, value)
    this.apply(path, Object.assign({action: 'insert', type, obj: objectId, index, elemId}, valueObj))
    this.getObject(objectId)[MAX_ELEM] = maxElem
  }

  /**
   * Updates the list with ID `objectId`, replacing the current value at
   * position `index` with the new value `value`.
   */
  setListIndex(path, objectId, index, value) { // TODO use path
    const list = this.getObject(objectId)
    if (index === list.length) {
      this.insertListItem(path, objectId, index, value)
      return
    }
    if (index < 0 || index > list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }
    if (list[index] instanceof Counter) {
      throw new RangeError('Cannot overwrite a Counter object; use .increment() or .decrement() to change its value.')
    }

    // If the assigned list element value is the same as the existing value, and
    // the assignment does not resolve a conflict, do nothing
    if (list[index] !== value || list[CONFLICTS][index] || value === undefined) {
      const elemId = getElemId(list, index)
      const type = (list instanceof Text) ? 'text' : 'list'
      const valueObj = this.setValue(path, objectId, elemId, value)
      this.apply(path, Object.assign({action: 'set', type, obj: objectId, index}, valueObj))
    }
  }

  /**
   * Updates the list object with ID `objectId`, deleting `deletions` list
   * elements starting from list index `start`, and inserting the list of new
   * elements `insertions` at that position.
   */
  splice(path, objectId, start, deletions, insertions) {
    let list = this.getObject(objectId)
    const type = (list instanceof Text) ? 'text' : 'list'

    if (deletions > 0) {
      if (start < 0 || start > list.length - deletions) {
        throw new RangeError(`${deletions} deletions starting at index ${start} are out of bounds for list of length ${list.length}`)
      }

      for (let i = 0; i < deletions; i++) {
        this.addOp({action: 'del', obj: objectId, key: getElemId(list, start)})
        this.apply(path, {action: 'remove', type, obj: objectId, index: start})

        // Must refresh object after the first updateListObject call, since the
        // object previously may have been immutable
        if (i === 0) list = this.getObject(objectId)
      }
    }

    for (let i = 0; i < insertions.length; i++) {
      this.insertListItem(path, objectId, start + i, insertions[i])
    }
  }

  /**
   * Updates the table object with ID `objectId`, adding a new entry `row`.
   * Returns the objectId of the new row.
   */
  addTableRow(path, objectId, row) {
    if (!isObject(row)) {
      throw new TypeError('A table row must be an object')
    }
    if (row[OBJECT_ID]) {
      throw new TypeError('Cannot reuse an existing object as table row')
    }

    const rowId = this.createNestedObjects(path, objectId, null, row)
    this.apply(path, {action: 'set', type: 'table', obj: objectId, key: rowId, value: rowId, link: true})
    return rowId
  }

  /**
   * Updates the table object with ID `objectId`, deleting the row with ID `rowId`.
   */
  deleteTableRow(path, objectId, rowId) {
    this.apply(path, {action: 'remove', type: 'table', obj: objectId, key: rowId})
    this.addOp({action: 'del', obj: objectId, key: rowId})
  }

  /**
   * Adds the integer `delta` to the value of the counter located at property
   * `key` in the object with ID `objectId`.
   */
  increment(path, objectId, key, delta) {
    const object = this.getObject(objectId)
    if (!(object[key] instanceof Counter)) {
      throw new TypeError('Only counter values can be incremented')
    }
    const value = object[key].value + delta

    if (Array.isArray(object) || object instanceof Text) {
      const elemId = getElemId(object, key)
      const type = (object instanceof Text) ? 'text' : 'list'
      this.addOp({action: 'inc', obj: objectId, key: elemId, value: delta})
      this.apply(path, {action: 'set', obj: objectId, type, index: key, value, datatype: 'counter'})
    } else {
      this.addOp({action: 'inc', obj: objectId, key, value: delta})
      this.apply(path, {action: 'set', obj: objectId, type: 'map', key, value, datatype: 'counter'})
    }
  }
}

module.exports = {
  Context
}
