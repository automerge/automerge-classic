const { CACHE, OBJECT_ID, CONFLICTS } = require('./constants')
const { interpretPatch } = require('./apply_patch')
const { Text } = require('./text')
const { Table } = require('./table')
const { Counter, getWriteableCounter } = require('./counter')
const { ROOT_ID, isObject, copyObject } = require('../src/common')
const uuid = require('../src/uuid')


/**
 * An instance of this class is passed to `rootObjectProxy()`. The methods are
 * called by proxy object mutation functions to query the current object state
 * and to apply the requested changes.
 */
class Context {
  constructor (doc, actorId, applyPatch) {
    this.actorId = actorId
    this.cache = doc[CACHE]
    this.updated = {}
    this.ops = []
    this.applyPatch = applyPatch ? applyPatch : interpretPatch
  }

  /**
   * Adds an operation object to the list of changes made in the current context.
   */
  addOp(operation) {
    this.ops.push(operation)
  }

  /**
   * Takes a value and returns an object describing the value (in the format used by patches).
   */
  getValueDescription(value) {
    if (!['object', 'boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`Unsupported type of value: ${typeof value}`)
    }

    if (isObject(value)) {
      if (value instanceof Date) {
        // Date object, represented as milliseconds since epoch
        return {value: value.getTime(), datatype: 'timestamp'}

      } else if (value instanceof Counter) {
        // Counter object
        return {value: value.value, datatype: 'counter'}

      } else {
        // Nested object (map, list, text, or table)
        const objectId = value[OBJECT_ID]
        if (!objectId) {
          throw new RangeError(`Object ${JSON.stringify(value)} has no objectId`)
        }
        return {objectId, type: this.getObjectType(objectId)}
      }
    } else {
      // Primitive value (number, string, boolean, or null)
      return {value}
    }
  }

  /**
   * Builds the values structure describing a single property in a patch. Finds all the values of
   * property `key` of `object` (there might be multiple values in the case of a conflict), and
   * returns an object that maps operation IDs to descriptions of values.
   */
  getValuesDescriptions(path, object, key) {
    if (object instanceof Table) {
      // Table objects don't have conflicts, since rows are identified by their unique objectId
      const value = object.byId(key)
      if (value) {
        return {[key]: this.getValueDescription(value)}
      } else {
        return {}
      }
    } else {
      // Map, list, or text objects
      const conflicts = object[CONFLICTS][key], values = {}
      if (!conflicts) {
        throw new RangeError(`No children at key ${key} of path ${JSON.stringify(path)}`)
      }
      for (let opId of Object.keys(conflicts)) {
        values[opId] = this.getValueDescription(conflicts[opId])
      }
      return values
    }
  }

  /**
   * Returns the value at property `key` of object `object`. In the case of a conflict, returns
   * the value whose assignment operation has the ID `opId`.
   */
  getPropertyValue(object, key, opId) {
    if (object instanceof Table) {
      return object.byId(key)
    } else {
      return object[CONFLICTS][key][opId]
    }
  }

  /**
   * Recurses along `path` into the patch object `patch`, creating nodes along the way as needed
   * by mutating the patch object. Returns the subpatch at the given path.
   */
  getSubpatch(patch, path) {
    let subpatch = patch.diffs, object = this.getObject(ROOT_ID)

    for (let pathElem of path) {
      if (!subpatch.props) {
        subpatch.props = {}
      }
      if (!subpatch.props[pathElem.key]) {
        subpatch.props[pathElem.key] = this.getValuesDescriptions(path, object, pathElem.key)
      }

      let nextOpId = null, values = subpatch.props[pathElem.key]
      for (let opId of Object.keys(values)) {
        if (values[opId].objectId === pathElem.objectId) {
          nextOpId = opId
        }
      }
      if (!nextOpId) {
        throw new RangeError(`Cannot find path object with objectId ${pathElem.objectId}`)
      }
      subpatch = values[nextOpId]
      object = this.getPropertyValue(object, pathElem.key, nextOpId)
    }

    if (!subpatch.props) {
      subpatch.props = {}
    }
    return subpatch
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
   * Returns a string that is either 'map', 'table', 'list', or 'text', indicating
   * the type of the object with ID `objectId`.
   */
  getObjectType(objectId) {
    if (objectId === ROOT_ID) return 'map'
    const object = this.getObject(objectId)
    if (object instanceof Text) return 'text'
    if (object instanceof Table) return 'table'
    if (Array.isArray(object)) return 'list'
    return 'map'
  }

  /**
   * Returns the value associated with the property named `key` on the object
   * at path `path`. If the value is an object, returns a proxy for it.
   */
  getObjectField(path, objectId, key) {
    if (!['string', 'number'].includes(typeof key)) return
    const object = this.getObject(objectId)

    if (object[key] instanceof Counter) {
      return getWriteableCounter(object[key].value, this, path, objectId, key)

    } else if (isObject(object[key])) {
      const childId = object[key][OBJECT_ID]
      const subpath = path.concat([{key, objectId: childId}])
      // The instantiateObject function is added to the context object by rootObjectProxy()
      return this.instantiateObject(subpath, childId)

    } else {
      return object[key]
    }
  }

  /**
   * Recursively creates Automerge versions of all the objects and nested objects in `value`,
   * constructing a patch and operations that describe the object tree. The new object is
   * assigned to the property `key` in the object with ID `obj`. If `insert` is true, a new
   * list element is created at index `key`, and the new object is assigned to that list
   * element. If `key` is null, the ID of the new object is used as key (this construction
   * is used by Automerge.Table).
   */
  createNestedObjects(obj, key, value, insert) {
    if (value[OBJECT_ID]) {
      throw new RangeError('Cannot create a reference to an existing document object')
    }
    const child = uuid()
    if (key === null) key = child

    if (value instanceof Text) {
      // Create a new Text object
      const operation = {action: 'makeText', obj, key, child}
      if (insert) operation.insert = true
      this.addOp(operation)

      const subpatch = {objectId: child, type: 'text', edits: [], props: {}}
      this.insertListItems(subpatch, 0, [...value], true)
      return subpatch

    } else if (value instanceof Table) {
      // Create a new Table object
      if (value.count > 0) {
        throw new RangeError('Assigning a non-empty Table object is not supported')
      }
      const operation = {action: 'makeTable', obj, key, child}
      if (insert) operation.insert = true
      this.addOp(operation)
      return {objectId: child, type: 'table', props: {}}

    } else if (Array.isArray(value)) {
      // Create a new list object
      const operation = {action: 'makeList', obj, key, child}
      if (insert) operation.insert = true
      this.addOp(operation)

      const subpatch = {objectId: child, type: 'list', edits: [], props: {}}
      this.insertListItems(subpatch, 0, value, true)
      return subpatch

    } else {
      // Create a new map object
      const operation = {action: 'makeMap', obj, key, child}
      if (insert) operation.insert = true
      this.addOp(operation)

      let props = {}
      for (let nested of Object.keys(value)) {
        const valuePatch = this.setValue(child, nested, value[nested], false)
        props[nested] = {[this.actorId]: valuePatch}
      }
      return {objectId: child, type: 'map', props}
    }
  }

  /**
   * Records an assignment to a particular key in a map, or a particular index in a list.
   * `objectId` is the ID of the object being modified, `key` is the property name or list
   * index being updated, and `value` is the new value being assigned. If `insert` is true,
   * a new list element is inserted at index `key`, and `value` is assigned to that new list
   * element. Returns a patch describing the new value. The return value is of the form
   * `{objectId, type, props}` if `value` is an object, or `{value, datatype}` if it is a
   * primitive value. For string, number, boolean, or null the datatype is omitted.
   */
  setValue(objectId, key, value, insert) {
    if (!objectId) {
      throw new RangeError('setValue needs an objectId')
    }
    if (key === '') {
      throw new RangeError('The key of a map entry must not be an empty string')
    }

    if (isObject(value) && !(value instanceof Date) && !(value instanceof Counter)) {
      // Nested object (map, list, text, or table)
      return this.createNestedObjects(objectId, key, value, insert)
    } else {
      // Date or counter object, or primitive value (number, string, boolean, or null)
      const description = this.getValueDescription(value)
      const operation = Object.assign({action: 'set', obj: objectId, key}, description)
      if (insert) operation.insert = true
      this.addOp(operation)
      return description
    }
  }

  /**
   * Constructs a new patch, calls `callback` with the subpatch at the location `path`,
   * and then immediately applies the patch to the document.
   */
  applyAtPath(path, callback) {
    let patch = {diffs: {objectId: ROOT_ID, type: 'map'}}
    callback(this.getSubpatch(patch, path))
    this.applyPatch(patch.diffs, this.cache[ROOT_ID], this.updated)
  }

  /**
   * Updates the map object at path `path`, setting the property with name
   * `key` to `value`.
   */
  setMapKey(path, key, value) {
    if (typeof key !== 'string') {
      throw new RangeError(`The key of a map entry must be a string, not ${typeof key}`)
    }

    const objectId = path.length === 0 ? ROOT_ID : path[path.length - 1].objectId
    const object = this.getObject(objectId)
    if (object[key] instanceof Counter) {
      throw new RangeError('Cannot overwrite a Counter object; use .increment() or .decrement() to change its value.')
    }

    // If the assigned field value is the same as the existing value, and
    // the assignment does not resolve a conflict, do nothing
    if (object[key] !== value || Object.keys(object[CONFLICTS][key] || {}).length > 1 || value === undefined) {
      this.applyAtPath(path, subpatch => {
        const valuePatch = this.setValue(objectId, key, value, false)
        subpatch.props[key] = {[this.actorId]: valuePatch}
      })
    }
  }

  /**
   * Updates the map object at path `path`, deleting the property `key`.
   */
  deleteMapKey(path, key) {
    const objectId = path.length === 0 ? ROOT_ID : path[path.length - 1].objectId
    const object = this.getObject(objectId)

    if (object[key] !== undefined) {
      this.addOp({action: 'del', obj: objectId, key})
      this.applyAtPath(path, subpatch => {
        subpatch.props[key] = {}
      })
    }
  }

  /**
   * Inserts a sequence of new list elements `values` into a list, starting at position `index`.
   * `newObject` is true if we are creating a new list object, and false if we are updating an
   * existing one. `subpatch` is the patch for the list object being modified. Mutates
   * `subpatch` to reflect the sequence of values.
   */
  insertListItems(subpatch, index, values, newObject) {
    const list = newObject ? [] : this.getObject(subpatch.objectId)
    if (index < 0 || index > list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }

    for (let offset = 0; offset < values.length; offset++) {
      const valuePatch = this.setValue(subpatch.objectId, index + offset, values[offset], true)
      subpatch.edits.push({action: 'insert', index: index + offset})
      subpatch.props[index + offset] = {[this.actorId]: valuePatch}
    }
  }

  /**
   * Updates the list object at path `path`, replacing the current value at
   * position `index` with the new value `value`.
   */
  setListIndex(path, index, value) {
    const objectId = path.length === 0 ? ROOT_ID : path[path.length - 1].objectId
    const list = this.getObject(objectId)
    if (index === list.length) {
      return this.splice(path, index, 0, [value])
    }
    if (index < 0 || index > list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }
    if (list[index] instanceof Counter) {
      throw new RangeError('Cannot overwrite a Counter object; use .increment() or .decrement() to change its value.')
    }

    // If the assigned list element value is the same as the existing value, and
    // the assignment does not resolve a conflict, do nothing
    if (list[index] !== value || Object.keys(list[CONFLICTS][index] || {}).length > 1 || value === undefined) {
      this.applyAtPath(path, subpatch => {
        const valuePatch = this.setValue(objectId, index, value, false)
        subpatch.props[index] = {[this.actorId]: valuePatch}
      })
    }
  }

  /**
   * Updates the list object at path `path`, deleting `deletions` list elements starting from
   * list index `start`, and inserting the list of new elements `insertions` at that position.
   */
  splice(path, start, deletions, insertions) {
    const objectId = path.length === 0 ? ROOT_ID : path[path.length - 1].objectId
    let list = this.getObject(objectId)
    if (start < 0 || deletions < 0 || start > list.length - deletions) {
      throw new RangeError(`${deletions} deletions starting at index ${start} are out of bounds for list of length ${list.length}`)
    }
    if (deletions === 0 && insertions.length === 0) return

    let patch = {diffs: {objectId: ROOT_ID, type: 'map'}}
    let subpatch = this.getSubpatch(patch, path)
    if (!subpatch.edits) subpatch.edits = []

    if (deletions > 0) {
      for (let i = 0; i < deletions; i++) {
        this.addOp({action: 'del', obj: objectId, key: start})
        subpatch.edits.push({action: 'remove', index: start})
      }
    }

    if (insertions.length > 0) {
      this.insertListItems(subpatch, start, insertions, false)
    }
    this.applyPatch(patch.diffs, this.cache[ROOT_ID], this.updated)
  }

  /**
   * Updates the table object at path `path`, adding a new entry `row`.
   * Returns the objectId of the new row.
   */
  addTableRow(path, row) {
    if (!isObject(row) || Array.isArray(row)) {
      throw new TypeError('A table row must be an object')
    }
    if (row[OBJECT_ID]) {
      throw new TypeError('Cannot reuse an existing object as table row')
    }
    if (row.id) {
      throw new TypeError('A table row must not have an "id" property; it is generated automatically')
    }

    const valuePatch = this.setValue(path[path.length - 1].objectId, null, row, false)
    this.applyAtPath(path, subpatch => {
      subpatch.props[valuePatch.objectId] = {[valuePatch.objectId]: valuePatch}
    })
    return valuePatch.objectId
  }

  /**
   * Updates the table object at path `path`, deleting the row with ID `rowId`.
   */
  deleteTableRow(path, rowId) {
    const objectId = path[path.length - 1].objectId, table = this.getObject(objectId)

    if (table.byId(rowId)) {
      this.addOp({action: 'del', obj: objectId, key: rowId})
      this.applyAtPath(path, subpatch => {
        subpatch.props[rowId] = {}
      })
    }
  }

  /**
   * Adds the integer `delta` to the value of the counter located at property
   * `key` in the object at path `path`.
   */
  increment(path, key, delta) {
    const objectId = path.length === 0 ? ROOT_ID : path[path.length - 1].objectId
    const object = this.getObject(objectId)
    if (!(object[key] instanceof Counter)) {
      throw new TypeError('Only counter values can be incremented')
    }

    // TODO what if there is a conflicting value on the same key as the counter?
    const value = object[key].value + delta
    this.addOp({action: 'inc', obj: objectId, key, value: delta})
    this.applyAtPath(path, subpatch => {
      subpatch.props[key] = {[this.actorId]: {value, datatype: 'counter'}}
    })
  }
}

module.exports = {
  Context
}
