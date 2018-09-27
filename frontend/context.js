const { CACHE, INBOUND, OBJECT_ID, CONFLICTS, MAX_ELEM } = require('./constants')
const { applyDiffs } = require('./apply_patch')
const { Text, getElemId } = require('./text')
const { isObject } = require('../src/common')
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
    this.inbound = Object.assign({}, doc[INBOUND])
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
  apply(diff) {
    this.diffs.push(diff)
    applyDiffs([diff], this.cache, this.updated, this.inbound)
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
  getObjectField(objectId, key) {
    const object = this.getObject(objectId)
    if (isObject(object[key])) {
      // The instantiateObject function is added to the context object by rootObjectProxy()
      return this.instantiateObject(object[key][OBJECT_ID])
    } else {
      return object[key]
    }
  }

  /**
   * Recursively creates Automerge versions of all the objects and nested
   * objects in `value`, and returns the object ID of the root object. If any
   * object is an existing Automerge object, its existing ID is returned.
   */
  createNestedObjects(value) {
    if (typeof value[OBJECT_ID] === 'string') return value[OBJECT_ID]
    const objectId = uuid()

    if (value instanceof Text) {
      // Create a new Text object
      if (value.length > 0) {
        throw new RangeError('Assigning a non-empty Text object is not supported')
      }
      this.apply({action: 'create', type: 'text', obj: objectId})
      this.addOp({action: 'makeText', obj: objectId})

    } else if (Array.isArray(value)) {
      // Create a new list object
      this.apply({action: 'create', type: 'list', obj: objectId})
      this.addOp({action: 'makeList', obj: objectId})
      this.splice(objectId, 0, 0, value)

    } else {
      // Create a new map object
      this.apply({action: 'create', type: 'map', obj: objectId})
      this.addOp({action: 'makeMap', obj: objectId})

      for (let key of Object.keys(value)) {
        this.setMapKey(objectId, key, value[key])
      }
    }

    return objectId
  }

  /**
   * Updates the map object with ID `objectId`, setting the property with name
   * `key` to `value`.
   */
  setMapKey(objectId, key, value) {
    if (typeof key !== 'string') {
      throw new RangeError(`The key of a map entry must be a string, not ${typeof key}`)
    }
    if (key === '') {
      throw new RangeError('The key of a map entry must not be an empty string')
    }
    if (key.startsWith('_')) {
      throw new RangeError(`Map entries starting with underscore are not allowed: ${key}`)
    }

    const object = this.getObject(objectId)
    if (!['object', 'boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`Unsupported type of value: ${typeof value}`)

    } else if (isObject(value)) {
      const childId = this.createNestedObjects(value)
      this.apply({action: 'set', type: 'map', obj: objectId, key, value: childId, link: true})
      this.addOp({action: 'link', obj: objectId, key, value: childId})

    } else if (object[key] !== value || object[CONFLICTS][key]) {
      // If the assigned field value is the same as the existing value, and
      // the assignment does not resolve a conflict, do nothing
      this.apply({action: 'set', type: 'map', obj: objectId, key, value})
      this.addOp({action: 'set', obj: objectId, key, value})
    }
  }

  /**
   * Updates the map object with ID `objectId`, deleting the property `key`.
   */
  deleteMapKey(objectId, key) {
    const object = this.getObject(objectId)
    if (object[key] !== undefined) {
      this.apply({action: 'remove', type: 'map', obj: objectId, key})
      this.addOp({action: 'del', obj: objectId, key})
    }
  }

  /**
   * Inserts a new list element `value` at position `index` into the list with
   * ID `objectId`.
   */
  insertListItem(objectId, index, value) {
    const list = this.getObject(objectId)
    if (index < 0 || index > list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }
    if (!['object', 'boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`Unsupported type of value: ${typeof value}`)
    }

    const maxElem = list[MAX_ELEM] + 1
    const type = (list instanceof Text) ? 'text' : 'list'
    const prevId = (index === 0) ? '_head' : getElemId(list, index - 1)
    const elemId = `${this.actorId}:${maxElem}`
    this.addOp({action: 'ins', obj: objectId, key: prevId, elem: maxElem})

    if (isObject(value)) {
      const childId = this.createNestedObjects(value)
      this.apply({action: 'insert', type, obj: objectId, index, value: childId, link: true, elemId})
      this.addOp({action: 'link', obj: objectId, key: elemId, value: childId})
    } else {
      this.apply({action: 'insert', type, obj: objectId, index, value, elemId})
      this.addOp({action: 'set', obj: objectId, key: elemId, value})
    }
    this.getObject(objectId)[MAX_ELEM] = maxElem
  }

  /**
   * Updates the list with ID `objectId`, replacing the current value at
   * position `index` with the new value `value`.
   */
  setListIndex(objectId, index, value) {
    const list = this.getObject(objectId)
    if (index === list.length) {
      this.insertListItem(objectId, index, value)
      return
    }
    if (index < 0 || index > list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }
    if (!['object', 'boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`Unsupported type of value: ${typeof value}`)
    }

    const elemId = getElemId(list, index)
    const type = (list instanceof Text) ? 'text' : 'list'

    if (isObject(value)) {
      const childId = this.createNestedObjects(value)
      this.apply({action: 'set', type, obj: objectId, index, value: childId, link: true})
      this.addOp({action: 'link', obj: objectId, key: elemId, value: childId})
    } else if (list[index] !== value || list[CONFLICTS][index]) {
      // If the assigned list element value is the same as the existing value, and
      // the assignment does not resolve a conflict, do nothing
      this.apply({action: 'set', type, obj: objectId, index, value})
      this.addOp({action: 'set', obj: objectId, key: elemId, value})
    }
  }

  /**
   * Updates the list object with ID `objectId`, deleting `deletions` list
   * elements starting from list index `start`, and inserting the list of new
   * elements `insertions` at that position.
   */
  splice(objectId, start, deletions, insertions) {
    let list = this.getObject(objectId)
    const type = (list instanceof Text) ? 'text' : 'list'

    if (deletions > 0) {
      if (start < 0 || start > list.length - deletions) {
        throw new RangeError(`${deletions} deletions starting at index ${start} are out of bounds for list of length ${list.length}`)
      }

      for (let i = 0; i < deletions; i++) {
        this.addOp({action: 'del', obj: objectId, key: getElemId(list, start)})
        this.apply({action: 'remove', type, obj: objectId, index: start})

        // Must refresh object after the first updateListObject call, since the
        // object previously may have been immutable
        if (i === 0) list = this.getObject(objectId)
      }
    }

    for (let i = 0; i < insertions.length; i++) {
      this.insertListItem(objectId, start + i, insertions[i])
    }
  }
}

module.exports = {
  Context
}
