const { rootObjectProxy } = require('./proxies_fe')

const OBJECT_ID = Symbol('_objectId')
const CONFLICTS = Symbol('_conflicts')
const CACHE     = Symbol('_cache')
const INBOUND   = Symbol('_inbound')
const ELEM_IDS  = Symbol('_elemIds')
const ROOT_ID   = '00000000-0000-0000-0000-000000000000'

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

/**
 * Finds the object IDs of all child objects referenced under the key `key` of
 * `object` (both `object[key]` and any conflicts under that key). Returns a map
 * from those objectIds to the value `true`.
 */
function childReferences(object, key) {
  let refs = {}, conflicts = object[CONFLICTS][key] || {}
  let children = [object[key]].concat(Object.values(conflicts))
  for (let child of children) {
    if (isObject(child)) {
      refs[child[OBJECT_ID]] = true
    }
  }
  return refs
}

/**
 * Updates `inbound` (a mapping from each child object ID to its parent) based
 * on a change to the object with ID `objectId`. `refsBefore` and `refsAfter`
 * are objects produced by the `childReferences()` function, containing the IDs
 * of child objects before and after the change, respectively.
 */
function updateInbound(objectId, refsBefore, refsAfter, inbound) {
  for (let ref of Object.keys(refsBefore)) {
    if (!refsAfter[ref]) delete inbound[ref]
  }
  for (let ref of Object.keys(refsAfter)) {
    if (inbound[ref] && inbound[ref] !== objectId) {
      throw new RangeError(`Object ${ref} has multiple parents`)
    } else if (!inbound[ref]) {
      inbound[ref] = objectId
    }
  }
}

/**
 * Creates a writable copy of an immutable map object. If `originalObject`
 * is undefined, creates an empty object with ID `objectId`.
 */
function cloneMapObject(originalObject, objectId) {
  let object = Object.assign({}, originalObject)
  let conflicts = Object.assign({}, originalObject ? originalObject[CONFLICTS] : undefined)
  Object.defineProperty(object, CONFLICTS, {value: conflicts})
  Object.defineProperty(object, OBJECT_ID, {value: objectId})
  return object
}

/**
 * Applies the change `diff` to a map object. `cache` and `updated` are indexed
 * by objectId; the existing read-only object is taken from `cache`, and the
 * updated writable object is written to `updated`. `inbound` is a mapping from
 * child objectId to parent objectId; it is updated according to the change.
 */
function updateMapObject(diff, cache, updated, inbound) {
  if (!updated[diff.obj]) {
    updated[diff.obj] = cloneMapObject(cache[diff.obj], diff.obj)
  }
  let object = updated[diff.obj], conflicts = object[CONFLICTS]
  let refsBefore = {}, refsAfter = {}

  if (diff.action === 'create') {
    // do nothing
  } else if (diff.action === 'set') {
    refsBefore = childReferences(object, diff.key)
    object[diff.key] = diff.link ? (updated[diff.value] || cache[diff.value]) : diff.value
    if (diff.conflicts) {
      conflicts[diff.key] = {}
      for (let conflict of diff.conflicts) {
        const value = conflict.link ? (updated[conflict.value] || cache[conflict.value]) : conflict.value
        conflicts[diff.key][conflict.actor] = value
      }
      Object.freeze(conflicts[diff.key])
    } else {
      delete conflicts[diff.key]
    }
    refsAfter = childReferences(object, diff.key)
  } else if (diff.action === 'remove') {
    refsBefore = childReferences(object, diff.key)
    delete object[diff.key]
    delete conflicts[diff.key]
  } else {
    throw new RangeError('Unknown action type: ' + diff.action)
  }

  updateInbound(diff.obj, refsBefore, refsAfter, inbound)
}

/**
 * Updates the map object with ID `objectId` such that all child objects that
 * have been updated in `updated` are replaced with references to the updated
 * version.
 */
function parentMapObject(objectId, cache, updated) {
  if (!updated[objectId]) {
    updated[objectId] = cloneMapObject(cache[objectId], objectId)
  }
  let object = updated[objectId]

  for (let key of Object.keys(object)) {
    let value = object[key]
    if (isObject(value) && updated[value[OBJECT_ID]]) {
      object[key] = updated[value[OBJECT_ID]]
    }

    let conflicts = object[CONFLICTS][key] || {}, conflictsUpdate = null
    for (let actorId of Object.keys(conflicts)) {
      value = conflicts[actorId]
      if (isObject(value) && updated[value[OBJECT_ID]]) {
        if (!conflictsUpdate) {
          conflictsUpdate = Object.assign({}, conflicts)
          object[CONFLICTS][key] = conflictsUpdate
        }
        conflictsUpdate[actorId] = updated[value[OBJECT_ID]]
      }
    }

    if (conflictsUpdate) {
      Object.freeze(conflictsUpdate)
    }
  }
}

/**
 * Creates a writable copy of an immutable list object. If `originalList` is
 * undefined, creates an empty list with ID `objectId`.
 */
function cloneListObject(originalList, objectId) {
  let list = originalList ? originalList.slice() : [] // slice() makes a shallow clone
  let conflicts = (originalList && originalList[CONFLICTS]) ? originalList[CONFLICTS].slice() : []
  let elemIds   = (originalList && originalList[ELEM_IDS] ) ? originalList[ELEM_IDS].slice()  : []
  Object.defineProperty(list, CONFLICTS, {value: conflicts})
  Object.defineProperty(list, ELEM_IDS,  {value: elemIds})
  Object.defineProperty(list, OBJECT_ID, {value: objectId})
  return list
}

/**
 * Applies the change `diff` to a list object. `cache` and `updated` are indexed
 * by objectId; the existing read-only object is taken from `cache`, and the
 * updated writable object is written to `updated`. `inbound` is a mapping from
 * child objectId to parent objectId; it is updated according to the change.
 */
function updateListObject(diff, cache, updated, inbound) {
  if (!updated[diff.obj]) {
    updated[diff.obj] = cloneListObject(cache[diff.obj], diff.obj)
  }
  let list = updated[diff.obj], conflicts = list[CONFLICTS], elemIds = list[ELEM_IDS]
  let value = null, conflict = null

  if (['insert', 'set'].includes(diff.action)) {
    value = diff.link ? (updated[diff.value] || cache[diff.value]) : diff.value
    if (diff.conflicts) {
      conflict = {}
      for (let c of diff.conflicts) {
        conflict[c.actor] = c.link ? (updated[c.value] || cache[c.value]) : c.value
      }
      Object.freeze(conflict)
    }
  }

  let refsBefore = {}, refsAfter = {}
  if (diff.action === 'create') {
    // do nothing
  } else if (diff.action === 'insert') {
    list.splice(diff.index, 0, value)
    conflicts.splice(diff.index, 0, conflict)
    elemIds.splice(diff.index, 0, diff.elemId)
    refsAfter = childReferences(list, diff.index)
  } else if (diff.action === 'set') {
    refsBefore = childReferences(list, diff.index)
    list[diff.index] = value
    conflicts[diff.index] = conflict
    refsAfter = childReferences(list, diff.index)
  } else if (diff.action === 'remove') {
    refsBefore = childReferences(list, diff.index)
    list.splice(diff.index, 1)
    conflicts.splice(diff.index, 1) || {}
    elemIds.splice(diff.index, 1)
  } else {
    throw new RangeError('Unknown action type: ' + diff.action)
  }

  updateInbound(diff.obj, refsBefore, refsAfter, inbound)
}

/**
 * Updates the list object with ID `objectId` such that all child objects that
 * have been updated in `updated` are replaced with references to the updated
 * version.
 */
function parentListObject(objectId, cache, updated) {
  if (!updated[objectId]) {
    updated[objectId] = cloneListObject(cache[objectId], objectId)
  }
  let list = updated[objectId]

  for (let index = 0; index < list.length; index++) {
    let value = list[index]
    if (isObject(value) && updated[value[OBJECT_ID]]) {
      list[index] = updated[value[OBJECT_ID]]
    }

    let conflicts = list[CONFLICTS][index] || {}, conflictsUpdate = null
    for (let actorId of Object.keys(conflicts)) {
      value = conflicts[actorId]
      if (isObject(value) && updated[value[OBJECT_ID]]) {
        if (!conflictsUpdate) {
          conflictsUpdate = Object.assign({}, conflicts)
          list[CONFLICTS][index] = conflictsUpdate
        }
        conflictsUpdate[actorId] = updated[value[OBJECT_ID]]
      }
    }

    if (conflictsUpdate) {
      Object.freeze(conflictsUpdate)
    }
  }
}

/**
 * After some set of objects in `updated` (a map from object ID to mutable
 * object) have been updated, updates their parent objects to point to the new
 * object versions, all the way to the root object. `cache` contains the
 * previous (immutable) version of all objects, and `inbound` is the mapping
 * from child objectId to parent objectId. Any objects that were not modified
 * continue to refer to the existing version in `cache`.
 */
function updateParentObjects(cache, updated, inbound) {
  let affected = updated
  while (Object.keys(affected).length > 0) {
    let parents = {}
    for (let childId of Object.keys(affected)) {
      const parentId = inbound[childId]
      if (parentId) parents[parentId] = true
    }
    affected = parents

    for (let objectId of Object.keys(parents)) {
      if (Array.isArray(updated[objectId] || cache[objectId])) {
        parentListObject(objectId, cache, updated)
      } else {
        parentMapObject(objectId, cache, updated)
      }
    }
  }
}

/**
 * Takes a set of objects that have been updated (in `updated`) and an updated
 * mapping from child objectId to parent objectId (in `inbound`), and returns
 * a new immutable document root object based on `doc` that reflects those
 * updates.
 */
function updateRootObject(doc, updated, inbound) {
  let newDoc = updated[ROOT_ID]
  if (!newDoc) {
    throw new Error('Root object was not modified by patch')
  }
  Object.defineProperty(newDoc, CACHE,   {value: updated})
  Object.defineProperty(newDoc, INBOUND, {value: inbound})

  for (let objectId of Object.keys(doc[CACHE])) {
    if (updated[objectId]) {
      Object.freeze(updated[objectId])
      Object.freeze(updated[objectId][CONFLICTS])
    } else {
      updated[objectId] = doc[CACHE][objectId]
    }
  }

  Object.freeze(updated)
  Object.freeze(inbound)
  return newDoc
}


/**
 * An instance of this class is passed to `rootObjectProxy()`. The methods are
 * called by proxy object mutation functions to query the current object state
 * and to apply the requested changes.
 */
class Context {
  constructor (doc) {
    this.cache = doc[CACHE]
    this.updated = {}
    this.inbound = Object.assign({}, doc[INBOUND])
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
   * Returns an operation that, if applied, will reset the property `key` of
   * the object with ID `objectId` back to its current value.
   */
  mapKeyUndo(objectId, key) {
    const object = this.getObject(objectId)
    if (object[key] === undefined) {
      return {action: 'del', obj: objectId, key}
    } else if (isObject(object[key])) {
      return {action: 'link', obj: objectId, key, value: object[key][OBJECT_ID]}
    } else {
      // TODO if the current state is a conflict, undo should reinstate that conflict
      return {action: 'set', obj: objectId, key, value: object[key]}
    }
  }

  /**
   * Updates the map object with ID `objectId`, setting the property with name
   * `key` to `value`. `topLevel` should be true for an assignment that is made
   * directly by the user, and it should be false for an assignment that is part
   * of recursive object creation when assigning an object literal (this
   * distinction affects how undo history is created).
   */
  setMapKey(objectId, key, value, topLevel) {
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
    let undo = topLevel ? this.mapKeyUndo(objectId, key) : undefined

    if (!['object', 'boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`Unsupported type of value: ${typeof value}`)

    } else if (isObject(value)) {
      const newId = this.createNestedObjects(value)
      const diff = {action: 'set', type: 'map', obj: objectId, key, value: newId, link: true}
      this.addOp({action: 'link', obj: objectId, key, value: newId}, undo)
      updateMapObject(diff, this.cache, this.updated, this.inbound)

    } else if (object[key] !== value || object[CONFLICTS][key]) {
      // If the assigned field value is the same as the existing value, and
      // the assignment does not resolve a conflict, do nothing
      const diff = {action: 'set', type: 'map', obj: objectId, key, value}
      this.addOp({action: 'set', obj: objectId, key, value}, undo)
      updateMapObject(diff, this.cache, this.updated, this.inbound)
    }
  }

  /**
   * Updates the map object with ID `objectId`, deleting the property `key`.
   */
  deleteMapKey(objectId, key) {
    const object = this.getObject(objectId)
    if (object[key] !== undefined) {
      const undo = this.mapKeyUndo(objectId, key)
      const diff = {action: 'remove', type: 'map', obj: objectId, key}
      this.addOp({action: 'del', obj: objectId, key}, undo)
      updateMapObject(diff, this.cache, this.updated, this.inbound)
    }
  }

  /**
   * Updates the list object with ID `objectId`, deleting `deletions` list
   * elements starting from list index `start`, and inserting the list of new
   * elements `insertions` at that position.
   */
  splice(objectId, start, deletions, insertions) {
  }

  setListIndex(objectId, index, value) {
  }
}

/**
 * Creates an empty document object with no changes.
 */
function init() {
  let root = {}, cache = {[ROOT_ID]: root}
  Object.defineProperty(root, OBJECT_ID, {value: ROOT_ID})
  Object.defineProperty(root, CONFLICTS, {value: Object.freeze({})})
  Object.defineProperty(root, CACHE,     {value: Object.freeze(cache)})
  Object.defineProperty(root, INBOUND,   {value: Object.freeze({})})
  return Object.freeze(root)
}

/**
 * Changes a document `doc` according to actions taken by the local user.
 * `message` is an optional descriptive string that is attached to the change.
 * The actual change is made within the callback function `callback`, which is
 * given a mutable version of the document as argument.
 */
function change(doc, message, callback) {
  if (doc[OBJECT_ID] !== ROOT_ID) {
    throw new TypeError('The first argument to Automerge.change must be the document root')
  }
  if (doc._change && doc._change.mutable) {
    throw new TypeError('Calls to Automerge.change cannot be nested')
  }
  if (typeof message === 'function' && callback === undefined) {
    ;[message, callback] = [callback, message]
  }
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('Change message must be a string')
  }

  let context = new Context(doc)
  callback(rootObjectProxy(context))

  // If the callback didn't change anything, return the original document object unchanged
  if (Object.keys(context.updated).length === 0) {
    return doc
  } else {
    updateParentObjects(doc[CACHE], context.updated, context.inbound)
    return updateRootObject(doc, context.updated, context.inbound)
  }
}

/**
 * Applies `patch` to the document root object `doc`. This patch must come
 * from the backend; it may be the result of a local change or a remote change.
 */
function applyPatch(doc, patch) {
  let inbound = Object.assign({}, doc[INBOUND])
  let updated = {}

  for (let diff of patch.diffs) {
    if (diff.type === 'map') {
      updateMapObject(diff, doc[CACHE], updated, inbound)
    } else if (diff.type === 'list') {
      updateListObject(diff, doc[CACHE], updated, inbound)
    } else if (diff.type === 'text') {
      throw new RangeError('TODO: Automerge.Text is not yet supported')
    } else {
      throw new RangeError('Unknown object type: ' + diff.type)
    }
  }

  updateParentObjects(doc[CACHE], updated, inbound)
  return updateRootObject(doc, updated, inbound)
}

/**
 * Fetches the conflicts on `object`, which may be any object in a document.
 * If the object is a map, returns an object mapping keys to conflict sets
 * (only for those keys that actually have conflicts). If the object is a list,
 * returns a list that contains null for non-conflicting indexes and a conflict
 * set otherwise.
 */
function getConflicts(object) {
  return object[CONFLICTS]
}

module.exports = {
  init, change, applyPatch, getConflicts
}
