const { CACHE, OBJECT_ID, CONFLICTS, ELEM_IDS, STATE } = require('./constants')
const { interpretPatch } = require('./apply_patch')
const { Text } = require('./text')
const { Table } = require('./table')
const { Counter, getWriteableCounter } = require('./counter')
const { Int, Uint, Float64 } = require('./numbers')
const { isObject, parseOpId, createArrayOfNulls } = require('../src/common')
const uuid = require('../src/uuid')


/**
 * An instance of this class is passed to `rootObjectProxy()`. The methods are
 * called by proxy object mutation functions to query the current object state
 * and to apply the requested changes.
 */
class Context {
  constructor (doc, actorId, applyPatch) {
    this.actorId = actorId
    this.nextOpNum = doc[STATE].maxOp + 1
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

    if (operation.action === 'set' && operation.values) {
      this.nextOpNum += operation.values.length
    } else if (operation.action === 'del' && operation.multiOp) {
      this.nextOpNum += operation.multiOp
    } else {
      this.nextOpNum += 1
    }
  }

  /**
   * Returns the operation ID of the next operation to be added to the context.
   */
  nextOpId() {
    return `${this.nextOpNum}@${this.actorId}`
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
        return {type: 'value', value: value.getTime(), datatype: 'timestamp'}

      } else if (value instanceof Int) {
        return {type: 'value', value: value.value, datatype: 'int'}
      } else if (value instanceof Uint) {
        return {type: 'value', value: value.value, datatype: 'uint'}
      } else if (value instanceof Float64) {
        return {type: 'value', value: value.value, datatype: 'float64'}
      } else if (value instanceof Counter) {
        // Counter object
        return {type: 'value', value: value.value, datatype: 'counter'}

      } else {
        // Nested object (map, list, text, or table)
        const objectId = value[OBJECT_ID], type = this.getObjectType(objectId)
        if (!objectId) {
          throw new RangeError(`Object ${JSON.stringify(value)} has no objectId`)
        }
        if (type === 'list' || type === 'text') {
          return {objectId, type, edits: []}
        } else {
          return {objectId, type, props: {}}
        }
      }
    } else if (typeof value === 'number') {
      if (Number.isInteger(value) && value <= Number.MAX_SAFE_INTEGER && value >= Number.MIN_SAFE_INTEGER) {
        return {type: 'value', value, datatype: 'int'}
      } else {
        return {type: 'value', value, datatype: 'float64'}
      }
    } else {
      // Primitive value (string, boolean, or null)
      return {type: 'value', value}
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
      return value ? {[key]: this.getValueDescription(value)} : {}
    } else if (object instanceof Text) {
      // Text objects don't support conflicts
      const value = object.get(key)
      const elemId = object.getElemId(key)
      return value ? {[elemId]: this.getValueDescription(value)} : {}
    } else {
      // Map or list objects
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
    } else if (object instanceof Text) {
      return object.get(key)
    } else {
      return object[CONFLICTS][key][opId]
    }
  }

  /**
   * Recurses along `path` into the patch object `patch`, creating nodes along the way as needed
   * by mutating the patch object. Returns the subpatch at the given path.
   */
  getSubpatch(patch, path) {
    if (path.length == 0) return patch
    let subpatch = patch, object = this.getObject('_root')

    for (let pathElem of path) {
      let values = this.getValuesDescriptions(path, object, pathElem.key)
      if (subpatch.props) {
        if (!subpatch.props[pathElem.key]) {
          subpatch.props[pathElem.key] = values
        }
      } else if (subpatch.edits) {
        for (const opId of Object.keys(values)) {
          subpatch.edits.push({action: 'update', index: pathElem.key, opId, value: values[opId]})
        }
      }

      let nextOpId = null
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
    if (objectId === '_root') return 'map'
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
   * assigned to the property `key` in the object with ID `obj`. If the object is a list or
   * text, `key` must be set to the list index being updated, and `elemId` must be set to the
   * elemId of the element being updated. If `insert` is true, we insert a new list element
   * (or text character) at index `key`, and `elemId` must be the elemId of the immediate
   * predecessor element (or the string '_head' if inserting at index 0). If the assignment
   * overwrites a previous value at this key/element, `pred` must be set to the array of the
   * prior operations we are overwriting (empty array if there is no existing value).
   */
  createNestedObjects(obj, key, value, insert, pred, elemId) {
    if (value[OBJECT_ID]) {
      throw new RangeError('Cannot create a reference to an existing document object')
    }
    const objectId = this.nextOpId()

    if (value instanceof Text) {
      // Create a new Text object
      this.addOp(elemId ? {action: 'makeText', obj, elemId, insert, pred}
                        : {action: 'makeText', obj, key, insert, pred})
      const subpatch = {objectId, type: 'text', edits: []}
      this.insertListItems(subpatch, 0, [...value], true)
      return subpatch

    } else if (value instanceof Table) {
      // Create a new Table object
      if (value.count > 0) {
        throw new RangeError('Assigning a non-empty Table object is not supported')
      }
      this.addOp(elemId ? {action: 'makeTable', obj, elemId, insert, pred}
                        : {action: 'makeTable', obj, key, insert, pred})
      return {objectId, type: 'table', props: {}}

    } else if (Array.isArray(value)) {
      // Create a new list object
      this.addOp(elemId ? {action: 'makeList', obj, elemId, insert, pred}
                        : {action: 'makeList', obj, key, insert, pred})
      const subpatch = {objectId, type: 'list', edits: []}
      this.insertListItems(subpatch, 0, value, true)
      return subpatch

    } else {
      // Create a new map object
      this.addOp(elemId ? {action: 'makeMap', obj, elemId, insert, pred}
                        : {action: 'makeMap', obj, key, insert, pred})
      let props = {}
      for (let nested of Object.keys(value).sort()) {
        const opId = this.nextOpId()
        const valuePatch = this.setValue(objectId, nested, value[nested], false, [])
        props[nested] = {[opId]: valuePatch}
      }
      return {objectId, type: 'map', props}
    }
  }

  /**
   * Records an assignment to a particular key in a map, or a particular index in a list.
   * `objectId` is the ID of the object being modified, `key` is the property name or list
   * index being updated, and `value` is the new value being assigned. If `insert` is true,
   * a new list element is inserted at index `key`, and `value` is assigned to that new list
   * element. `pred` is an array of opIds for previous values of the property being assigned,
   * which are overwritten by this operation. If the object being modified is a list or text,
   * `elemId` is the element ID of the list element being updated (if insert=false), or the
   * element ID of the list element immediately preceding the insertion (if insert=true).
   *
   * Returns a patch describing the new value. The return value is of the form
   * `{objectId, type, props}` if `value` is an object, or `{value, datatype}` if it is a
   * primitive value. For string, number, boolean, or null the datatype is omitted.
   */
  setValue(objectId, key, value, insert, pred, elemId) {
    if (!objectId) {
      throw new RangeError('setValue needs an objectId')
    }
    if (key === '') {
      throw new RangeError('The key of a map entry must not be an empty string')
    }

    if (isObject(value) && !(value instanceof Date) && !(value instanceof Counter) && !(value instanceof Int) && !(value instanceof Uint) && !(value instanceof Float64)) {
      // Nested object (map, list, text, or table)
      return this.createNestedObjects(objectId, key, value, insert, pred, elemId)
    } else {
      // Date or counter object, or primitive value (number, string, boolean, or null)
      const description = this.getValueDescription(value)
      const op = {action: 'set', obj: objectId, insert, value: description.value, pred}
      if (elemId) op.elemId = elemId; else op.key = key
      if (description.datatype) op.datatype = description.datatype
      this.addOp(op)
      return description
    }
  }

  /**
   * Constructs a new patch, calls `callback` with the subpatch at the location `path`,
   * and then immediately applies the patch to the document.
   */
  applyAtPath(path, callback) {
    let diff = {objectId: '_root', type: 'map', props: {}}
    callback(this.getSubpatch(diff, path))
    this.applyPatch(diff, this.cache._root, this.updated)
  }

  /**
   * Updates the map object at path `path`, setting the property with name
   * `key` to `value`.
   */
  setMapKey(path, key, value) {
    if (typeof key !== 'string') {
      throw new RangeError(`The key of a map entry must be a string, not ${typeof key}`)
    }

    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    const object = this.getObject(objectId)
    if (object[key] instanceof Counter) {
      throw new RangeError('Cannot overwrite a Counter object; use .increment() or .decrement() to change its value.')
    }

    // If the assigned field value is the same as the existing value, and
    // the assignment does not resolve a conflict, do nothing
    if (object[key] !== value || Object.keys(object[CONFLICTS][key] || {}).length > 1 || value === undefined) {
      this.applyAtPath(path, subpatch => {
        const pred = getPred(object, key)
        const opId = this.nextOpId()
        const valuePatch = this.setValue(objectId, key, value, false, pred)
        subpatch.props[key] = {[opId]: valuePatch}
      })
    }
  }

  /**
   * Updates the map object at path `path`, deleting the property `key`.
   */
  deleteMapKey(path, key) {
    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    const object = this.getObject(objectId)

    if (object[key] !== undefined) {
      const pred = getPred(object, key)
      this.addOp({action: 'del', obj: objectId, key, insert: false, pred})
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
    if (values.length === 0) return

    let elemId = getElemId(list, index, true)
    const allPrimitive = values.every(v => typeof v === 'string' || typeof v === 'number' ||
                                           typeof v === 'boolean' || v === null ||
                                           (isObject(v) && (v instanceof Date || v instanceof Counter || v instanceof Int ||
                                                            v instanceof Uint || v instanceof Float64)))
    const allValueDescriptions = allPrimitive ? values.map(v => this.getValueDescription(v)) : []
    const allDatatypesSame = allValueDescriptions.every(t => t.datatype === allValueDescriptions[0].datatype)

    if (allPrimitive && allDatatypesSame && values.length > 1) {
      const nextElemId = this.nextOpId()
      const datatype = allValueDescriptions[0].datatype
      const values = allValueDescriptions.map(v => v.value)
      const op = {action: 'set', obj: subpatch.objectId, elemId, insert: true, values, pred: []}
      const edit = {action: 'multi-insert', elemId: nextElemId, index, values}
      if (datatype) {
        op.datatype = datatype
        edit.datatype = datatype
      }
      this.addOp(op)
      subpatch.edits.push(edit)
    } else {
      for (let offset = 0; offset < values.length; offset++) {
        let nextElemId = this.nextOpId()
        const valuePatch = this.setValue(subpatch.objectId, index + offset, values[offset], true, [], elemId)
        elemId = nextElemId
        subpatch.edits.push({action: 'insert', index: index + offset, elemId, opId: elemId, value: valuePatch})
      }
    }
  }

  /**
   * Updates the list object at path `path`, replacing the current value at
   * position `index` with the new value `value`.
   */
  setListIndex(path, index, value) {
    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    const list = this.getObject(objectId)

    // Assignment past the end of the list => insert nulls followed by new value
    if (index >= list.length) {
      const insertions = createArrayOfNulls(index - list.length)
      insertions.push(value)
      return this.splice(path, list.length, 0, insertions)
    }
    if (list[index] instanceof Counter) {
      throw new RangeError('Cannot overwrite a Counter object; use .increment() or .decrement() to change its value.')
    }

    // If the assigned list element value is the same as the existing value, and
    // the assignment does not resolve a conflict, do nothing
    if (list[index] !== value || Object.keys(list[CONFLICTS][index] || {}).length > 1 || value === undefined) {
      this.applyAtPath(path, subpatch => {
        const pred = getPred(list, index)
        const opId = this.nextOpId()
        const valuePatch = this.setValue(objectId, index, value, false, pred, getElemId(list, index))
        subpatch.edits.push({action: 'update', index, opId, value: valuePatch})
      })
    }
  }

  /**
   * Updates the list object at path `path`, deleting `deletions` list elements starting from
   * list index `start`, and inserting the list of new elements `insertions` at that position.
   */
  splice(path, start, deletions, insertions) {
    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    let list = this.getObject(objectId)
    if (start < 0 || deletions < 0 || start > list.length - deletions) {
      throw new RangeError(`${deletions} deletions starting at index ${start} are out of bounds for list of length ${list.length}`)
    }
    if (deletions === 0 && insertions.length === 0) return

    let patch = {diffs: {objectId: '_root', type: 'map', props: {}}}
    let subpatch = this.getSubpatch(patch.diffs, path)

    if (deletions > 0) {
      let op, lastElemParsed, lastPredParsed
      for (let i = 0; i < deletions; i++) {
        if (this.getObjectField(path, objectId, start + i) instanceof Counter) {
          // This may seem bizarre, but it's really fiddly to implement deletion of counters from
          // lists, and I doubt anyone ever needs to do this, so I'm just going to throw an
          // exception for now. The reason is: a counter is created by a set operation with counter
          // datatype, and subsequent increment ops are successors to the set operation. Normally, a
          // set operation with successor indicates a value that has been overwritten, so a set
          // operation with successors is normally invisible. Counters are an exception, because the
          // increment operations don't make the set operation invisible. When a counter appears in
          // a map, this is not too bad: if all successors are increments, then the counter remains
          // visible; if one or more successors are deletions, it goes away. However, when deleting
          // a list element, we have the additional challenge that we need to distinguish between a
          // list element that is being deleted by the current change (in which case we need to put
          // a 'remove' action in the patch's edits for that list) and a list element that was
          // already deleted previously (in which case the patch should not reflect the deletion).
          // This can be done, but as I said, it's fiddly. If someone wants to pick this up in the
          // future, hopefully the above description will be enough to get you started. Good luck!
          throw new TypeError('Unsupported operation: deleting a counter from a list')
        }

        // Any sequences of deletions with consecutive elemId and pred values get combined into a
        // single multiOp; any others become individual deletion operations. This optimisation only
        // kicks in if the user deletes a sequence of elements at once (in a single call to splice);
        // it might be nice to also detect such runs of deletions in the case where the user deletes
        // a sequence of list elements one by one.
        const thisElem = getElemId(list, start + i), thisElemParsed = parseOpId(thisElem)
        const thisPred = getPred(list, start + i)
        const thisPredParsed = (thisPred.length === 1) ? parseOpId(thisPred[0]) : undefined

        if (op && lastElemParsed && lastPredParsed && thisPredParsed &&
            lastElemParsed.actorId === thisElemParsed.actorId && lastElemParsed.counter + 1 === thisElemParsed.counter &&
            lastPredParsed.actorId === thisPredParsed.actorId && lastPredParsed.counter + 1 === thisPredParsed.counter) {
          op.multiOp = (op.multiOp || 1) + 1
        } else {
          if (op) this.addOp(op)
          op = {action: 'del', obj: objectId, elemId: thisElem, insert: false, pred: thisPred}
        }
        lastElemParsed = thisElemParsed
        lastPredParsed = thisPredParsed
      }
      this.addOp(op)
      subpatch.edits.push({action: 'remove', index: start, count: deletions})
    }

    if (insertions.length > 0) {
      this.insertListItems(subpatch, start, insertions, false)
    }
    this.applyPatch(patch.diffs, this.cache._root, this.updated)
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

    const id = uuid()
    const valuePatch = this.setValue(path[path.length - 1].objectId, id, row, false, [])
    this.applyAtPath(path, subpatch => {
      subpatch.props[id] = {[valuePatch.objectId]: valuePatch}
    })
    return id
  }

  /**
   * Updates the table object at path `path`, deleting the row with ID `rowId`.
   * `pred` is the opId of the operation that originally created the row.
   */
  deleteTableRow(path, rowId, pred) {
    const objectId = path[path.length - 1].objectId, table = this.getObject(objectId)

    if (table.byId(rowId)) {
      this.addOp({action: 'del', obj: objectId, key: rowId, insert: false, pred: [pred]})
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
    const objectId = path.length === 0 ? '_root' : path[path.length - 1].objectId
    const object = this.getObject(objectId)
    if (!(object[key] instanceof Counter)) {
      throw new TypeError('Only counter values can be incremented')
    }

    // TODO what if there is a conflicting value on the same key as the counter?
    const type = this.getObjectType(objectId)
    const value = object[key].value + delta
    const opId = this.nextOpId()
    const pred = getPred(object, key)

    if (type === 'list' || type === 'text') {
      const elemId = getElemId(object, key, false)
      this.addOp({action: 'inc', obj: objectId, elemId, value: delta, insert: false, pred})
    } else {
      this.addOp({action: 'inc', obj: objectId, key, value: delta, insert: false, pred})
    }

    this.applyAtPath(path, subpatch => {
      if (type === 'list' || type === 'text') {
        subpatch.edits.push({action: 'update', index: key, opId, value: {value, datatype: 'counter'}})
      } else {
        subpatch.props[key] = {[opId]: {value, datatype: 'counter'}}
      }
    })
  }
}

function getPred(object, key) {
  if (object instanceof Table) {
    return [object.opIds[key]]
  } else if (object instanceof Text) {
    return object.elems[key].pred
  } else if (object[CONFLICTS]) {
    return object[CONFLICTS][key] ? Object.keys(object[CONFLICTS][key]) : []
  } else {
    return []
  }
}

function getElemId(list, index, insert = false) {
  if (insert) {
    if (index === 0) return '_head'
    index -= 1
  }
  if (list[ELEM_IDS]) return list[ELEM_IDS][index]
  if (list.getElemId) return list.getElemId(index)
  throw new RangeError(`Cannot find elemId at list index ${index}`)
}

module.exports = {
  Context
}
