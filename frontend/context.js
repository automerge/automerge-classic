const { CACHE, INBOUND, OBJECT_ID, CONFLICTS, MAX_ELEM } = require('./constants')
const { interpretPatch } = require('./apply_patch')
const { Text, getElemId } = require('./text')
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
    // An accumulated patch that contains all the changes in this context
    this.patch = {diffs: {objectId: ROOT_ID, type: 'map'}}
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
   * returns an object that maps actorIds to descriptions of values.
   */
  getValuesDescriptions(path, object, key) {
    if (object instanceof Table) {
      // Table objects don't have conflicts, since rows are identified by their unique objectId
      const value = object.byId(key)
      if (value) {
        return {[object.getActorId(key)]: this.getValueDescription(value)}
      } else {
        return {}
      }
    } else {
      // Map, list, or text objects
      const conflicts = object[CONFLICTS][key], values = {}
      if (!conflicts) {
        throw new RangeError(`No children at key ${key} of path ${JSON.stringify(path)}`)
      }
      for (let actor of Object.keys(conflicts)) {
        values[actor] = this.getValueDescription(conflicts[actor])
      }
      return values
    }
  }

  /**
   * Returns the value at property `key` of object `object`. In the case of a conflict, returns
   * the value assigned by the actor with ID `actorId`.
   */
  getPropertyValue(object, key, actorId) {
    if (object instanceof Table) {
      if (actorId !== object.getActorId(key)) {
        throw new RangeError(`Mismatched actorId: ${actorId} != ${object.getActorId(key)}`)
      }
      return object.byId(key)
    } else {
      return object[CONFLICTS][key][actorId]
    }
  }

  /**
   * Recurses along `path` into the patch object `patch`, creating nodes along
   * the way as needed. Returns the subpatch at the given path.
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

      let nextActor = null, values = subpatch.props[pathElem.key]
      for (let actor of Object.keys(values)) {
        if (values[actor].objectId === pathElem.objectId) {
          nextActor = actor
        }
      }
      if (!nextActor) {
        throw new RangeError(`Cannot find path object with objectId ${pathElem.objectId}`)
      }
      subpatch = values[nextActor]
      object = this.getPropertyValue(object, pathElem.key, nextActor)
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
   * with ID `objectId`. If the value is an object, returns a proxy for it.
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
   * constructing a patch and operations that describe the object tree. `subpatch` must be
   * the patch for the parent object in which the new value is created. If the object is a map,
   * then `key` is the key to which the new value is assigned, and `index` should equal `key`.
   * If the object is a list, then `key` is the unique element ID of the list element being
   * updated, and `index` is the numeric list index being updated. The subpatch is mutated to
   * reflect the newly created objects. If `key` is not given, the ID of the new object is
   * used as key (this construction is used by Automerge.Table).
   */
  createNestedObjects(subpatch, key, index, value) {
    if (value[OBJECT_ID]) {
      throw new RangeError('Cannot create a reference to an existing document object')
    }
    const objectId = uuid(), obj = subpatch.objectId
    if (!key) key = objectId
    if (!index) index = key

    if (value instanceof Text) {
      // Create a new Text object
      subpatch.props[index] = {[this.actorId]: {objectId, type: 'text', edits: [], props: {}}}
      this.addOp({action: 'makeText', obj, key, child: objectId})
      return this.insertListItems(subpatch.props[index][this.actorId], 0, [...value], true)

    } else if (value instanceof Table) {
      // Create a new Table object
      if (value.count > 0) {
        throw new RangeError('Assigning a non-empty Table object is not supported')
      }
      subpatch.props[index] = {[this.actorId]: {objectId, type: 'table', props: {}}}
      this.addOp({action: 'makeTable', obj, key, child: objectId})
      const columns = this.setValue(subpatch.props[index][this.actorId], 'columns', 'columns', value.columns)
      return {objectId, type: 'table', props: {columns: {[this.actorId]: columns}}}

    } else if (Array.isArray(value)) {
      // Create a new list object
      subpatch.props[index] = {[this.actorId]: {objectId, type: 'list', edits: [], props: {}}}
      this.addOp({action: 'makeList', obj, key, child: objectId})
      return this.insertListItems(subpatch.props[index][this.actorId], 0, value, true)

    } else {
      // Create a new map object
      subpatch.props[index] = {[this.actorId]: {objectId, type: 'map', props: {}}}
      this.addOp({action: 'makeMap', obj, key, child: objectId})
      let props = {}

      for (let nested of Object.keys(value)) {
        const result = this.setValue(subpatch.props[index][this.actorId], nested, nested, value[nested])
        props[nested] = {[this.actorId]: result}
      }
      return {objectId, type: 'map', props}
    }
  }

  /**
   * Records an assignment to a particular key in a map, or a particular index in a list.
   * `subpatch` is the patch for the object being modified, and `value` is the new value
   * being assigned. If the object is a map, then `key` is the key being updated, and
   * `index` should equal `key`. If the object is a list, then `key` is the unique
   * element ID of the list element being updated, and `index` is the numeric list index
   * being updated. Mutates `subpatch` to reflect the assignment, and also returns a
   * patch describing the new value. The return value is of the form
   * `{objectId, type, props}` if `value` is an object, or `{value, datatype}` if it is a
   * primitive value. For string, number, boolean, or null the datatype is omitted.
   */
  setValue(subpatch, key, index, value) {
    const obj = subpatch.objectId
    if (!obj) {
      throw new RangeError('setValue subpatch needs an objectId')
    }
    if (key === '') {
      throw new RangeError('The key of a map entry must not be an empty string')
    }

    if (isObject(value) && !(value instanceof Date) && !(value instanceof Counter)) {
      // Nested object (map, list, text, or table)
      return this.createNestedObjects(subpatch, key, index, value)
    } else {
      // Date or counter object, or primitive value (number, string, boolean, or null)
      const description = this.getValueDescription(value)
      this.addOp(Object.assign({action: 'set', obj, key}, description))
      subpatch.props[index] = {[this.actorId]: description}
      return description
    }
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
      const newValue = this.setValue(this.getSubpatch(this.patch, path), key, key, value)
      let singlePatch = {diffs: {objectId: ROOT_ID, type: 'map'}}
      this.getSubpatch(singlePatch, path).props[key] = {[this.actorId]: newValue}
      this.applyPatch(singlePatch.diffs, this.cache[ROOT_ID], this.updated)
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
      let singlePatch = {diffs: {objectId: ROOT_ID, type: 'map'}}
      this.getSubpatch(singlePatch, path).props[key] = {}
      this.getSubpatch(this.patch, path).props[key] = {}
      this.applyPatch(singlePatch.diffs, this.cache[ROOT_ID], this.updated)
    }
  }

  /**
   * `props` is an object whose keys are integers. This function mutates the object,
   * renaming all keys whose integer value is greater than or equal to `startIndex`.
   * Every key `k` is moved to key `k + delta`, where `delta` is a positive or
   * negative integer. If `delta` is negative, we also delete any keys `k` with
   * `startIndex + delta <= k < startIndex` (i.e. any keys in the overwritten range).
   */
  moveProperties(props, startIndex, delta) {
    const keys = Object.keys(props).map(prop => {
      if (!/^[0-9]+$/.test(prop)) throw new RangeError(`Non-integer property ${prop}`)
      return parseInt(prop)
    })

    const moveKeys = keys.filter(key => key >= startIndex)
    const deleteKeys = (delta > 0) ? [] :
      keys.filter(key => key < startIndex && key >= startIndex + delta)

    if (delta > 0) {
      moveKeys.sort((a, b) => b - a) // sort in descending order
    } else {
      moveKeys.sort((a, b) => a - b) // sort in ascending order
    }

    for (let i of deleteKeys) {
      delete props[i]
    }
    for (let i of moveKeys) {
      props[i + delta] = props[i]
      delete props[i]
    }
  }

  /**
   * Inserts a sequence of new list elements `values` into a list, starting at position `index`.
   * `newObject` is true if we are creating a new list object, and false if we are updating an
   * existing one.* `subpatch` is the patch for the list object being modified. Mutates
   * `subpatch` to reflect the sequence of values, and also returns a patch describing the
   * updates to the list object.
   */
  insertListItems(subpatch, index, values, newObject) {
    const list = newObject ? [] : this.getObject(subpatch.objectId)
    if (index < 0 || index > list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }

    // Any existing assignments to list elements after the insertion position
    // need to be moved along to make space for the new elements
    this.moveProperties(subpatch.props, index, values.length)

    let prevId = (index === 0) ? '_head' : getElemId(list, index - 1)
    let edits = [], props = {}, elem = list[MAX_ELEM] || 0

    for (let offset = 0; offset < values.length; offset++) {
      elem++
      const elemId = `${this.actorId}:${elem}`
      this.addOp({action: 'ins', obj: subpatch.objectId, key: prevId, elem})
      edits.push({action: 'insert', index: index + offset, elemId})
      props[index + offset] = {[this.actorId]: this.setValue(subpatch, elemId, index + offset, values[offset])}
      prevId = elemId
    }

    subpatch.maxElem = Math.max(elem, subpatch.maxElem || 0)
    subpatch.edits.push(...edits)
    Object.assign(subpatch.props, props)
    return {objectId: subpatch.objectId, type: subpatch.type, maxElem: elem, edits, props}
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
      const elemId = getElemId(list, index)
      const newValue = this.setValue(this.getSubpatch(this.patch, path), elemId, index, value)
      let singlePatch = {diffs: {objectId: ROOT_ID, type: 'map'}}
      this.getSubpatch(singlePatch, path).props[index] = {[this.actorId]: newValue}
      this.applyPatch(singlePatch.diffs, this.cache[ROOT_ID], this.updated)
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

    let subpatch = this.getSubpatch(this.patch, path), deletionEdits = []
    if (!subpatch.edits) subpatch.edits = []

    if (deletions > 0) {
      for (let i = 0; i < deletions; i++) {
        const elemId = getElemId(list, start + i)
        this.addOp({action: 'del', obj: objectId, key: elemId})
        deletionEdits.push({action: 'remove', index: start, elemId})
      }

      // Any existing assignments to list elements after the deletion position
      // need to be moved to lower indexes, or removed (if in deleted range)
      this.moveProperties(subpatch.props, start + deletions, -deletions)
      subpatch.edits.push(...deletionEdits)
    }

    let listPatch = {edits: deletionEdits}
    if (insertions.length > 0) {
      listPatch = this.insertListItems(subpatch, start, insertions, false)
      listPatch.edits.unshift(...deletionEdits)
    }

    let singlePatch = {diffs: {objectId: ROOT_ID, type: 'map'}}
    Object.assign(this.getSubpatch(singlePatch, path), listPatch)
    this.applyPatch(singlePatch.diffs, this.cache[ROOT_ID], this.updated)
  }

  /**
   * Updates the table object with ID `objectId`, adding a new entry `row`.
   * Returns the objectId of the new row.
   */
  addTableRow(path, row) {
    if (!isObject(row)) {
      throw new TypeError('A table row must be an object')
    }
    if (row[OBJECT_ID]) {
      throw new TypeError('Cannot reuse an existing object as table row')
    }

    const newValue = this.setValue(this.getSubpatch(this.patch, path), null, null, row)
    let singlePatch = {diffs: {objectId: ROOT_ID, type: 'map'}}
    this.getSubpatch(singlePatch, path).props[newValue.objectId] = {[this.actorId]: newValue}
    this.applyPatch(singlePatch.diffs, this.cache[ROOT_ID], this.updated)
    return newValue.objectId
  }

  /**
   * Updates the table object at path `path`, deleting the row with ID `rowId`.
   */
  deleteTableRow(path, rowId) {
    const objectId = path[path.length - 1].objectId, table = this.getObject(objectId)

    if (table.byId(rowId)) {
      this.addOp({action: 'del', obj: objectId, key: rowId})
      let singlePatch = {diffs: {objectId: ROOT_ID, type: 'map'}}
      this.getSubpatch(singlePatch, path).props[rowId] = {}
      this.getSubpatch(this.patch, path).props[rowId] = {}
      this.applyPatch(singlePatch.diffs, this.cache[ROOT_ID], this.updated)
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
    const value = object[key].value + delta

    if (Array.isArray(object) || object instanceof Text) {
      const elemId = getElemId(object, key)
      this.addOp({action: 'inc', obj: objectId, key: elemId, value: delta})
    } else {
      this.addOp({action: 'inc', obj: objectId, key, value: delta})
    }

    // TODO what if there is a conflicting value on the same key as the counter?
    let singlePatch = {diffs: {objectId: ROOT_ID, type: 'map'}}
    this.getSubpatch(singlePatch, path).props[key] = {[this.actorId]: {value, datatype: 'counter'}}
    this.getSubpatch(this.patch, path).props[key] = {[this.actorId]: {value, datatype: 'counter'}}
    this.applyPatch(singlePatch.diffs, this.cache[ROOT_ID], this.updated)
  }
}

module.exports = {
  Context
}
