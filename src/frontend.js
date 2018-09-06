const { rootObjectProxy } = require('./proxies_fe')
const uuid = require('./uuid')

// Properties of the document root object
const ACTOR_ID  = Symbol('_actorId')   // the actor ID of the local replica (string)
const CACHE     = Symbol('_cache')     // map from objectId to immutable object
const INBOUND   = Symbol('_inbound')   // map from child objectId to parent objectId
const REQUESTS  = Symbol('_requests')  // list of changes applied locally but not yet confirmed by backend
const MAX_REQ   = Symbol('_maxReq')    // maximum request ID generated so far

// Properties of all Automerge objects
const OBJECT_ID = Symbol('_objectId')  // the object ID of the current object (string)
const CONFLICTS = Symbol('_conflicts') // map or list (depending on object type) of conflicts

// Properties of Automerge list objects
const ELEM_IDS  = Symbol('_elemIds')   // list containing the element ID of each list element
const MAX_ELEM  = Symbol('_maxElem')   // maximum element counter value in this list (number)

const ROOT_ID   = '00000000-0000-0000-0000-000000000000'

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

/**
 * Takes a string in the form that is used to identify list elements (an actor
 * ID concatenated with a counter, separated by a colon) and returns a
 * two-element array, `[counter, actorId]`.
 */
function parseElemId(elemId) {
  const match = /^(.*):(\d+)$/.exec(elemId || '')
  if (!match) {
    throw new RangeError(`Not a valid elemId: ${elemId}`)
  }
  return [parseInt(match[2]), match[1]]
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
  let maxElem   = (originalList && originalList[MAX_ELEM] ) ? originalList[MAX_ELEM]          : 0
  Object.defineProperty(list, OBJECT_ID, {value: objectId})
  Object.defineProperty(list, CONFLICTS, {value: conflicts})
  Object.defineProperty(list, ELEM_IDS,  {value: elemIds})
  Object.defineProperty(list, MAX_ELEM,  {value: maxElem, writable: true})
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
    list[MAX_ELEM] = Math.max(list[MAX_ELEM], parseElemId(diff.elemId)[0])
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
 * Applies the change `diff` to the appropriate object in `updated`. `cache`
 * and `updated` are indexed by objectId; the existing read-only object is
 * taken from `cache`, and the updated writable object is written to
 * `updated`. `inbound` is a mapping from child objectId to parent objectId;
 * it is updated according to the change.
 */
function applyDiff(diff, cache, updated, inbound) {
  if (diff.type === 'map') {
    updateMapObject(diff, cache, updated, inbound)
  } else if (diff.type === 'list') {
    updateListObject(diff, cache, updated, inbound)
  } else if (diff.type === 'text') {
    throw new TypeError('TODO: Automerge.Text is not yet supported')
  } else {
    throw new TypeError(`Unknown object type: ${diff.type}`)
  }
}

/**
 * Takes a set of objects that have been updated (in `updated`) and an updated
 * mapping from child objectId to parent objectId (in `inbound`), and returns
 * a new immutable document root object based on `doc` that reflects those
 * updates. The request queue `requests` and the request counter `maxReq` are
 * attached to the new root object.
 */
function updateRootObject(doc, updated, inbound, requests, maxReq) {
  let newDoc = updated[ROOT_ID]
  if (!newDoc) {
    throw new Error('Root object was not modified by patch')
  }
  Object.defineProperty(newDoc, ACTOR_ID, {value: doc[ACTOR_ID]})
  Object.defineProperty(newDoc, CACHE,    {value: updated})
  Object.defineProperty(newDoc, INBOUND,  {value: inbound})
  Object.defineProperty(newDoc, REQUESTS, {value: requests})
  Object.defineProperty(newDoc, MAX_REQ,  {value: maxReq})

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
 * Applies the changes described in `patch` to the document with root object
 * `doc`. The request queue `requests` and the request counter `maxReq` are
 * attached to the new root object.
 */
function applyPatchToDoc(doc, patch, requests, maxReq) {
  let inbound = Object.assign({}, doc[INBOUND])
  let updated = {}

  for (let diff of patch.diffs) {
    applyDiff(diff, doc[CACHE], updated, inbound)
  }

  updateParentObjects(doc[CACHE], updated, inbound)
  return updateRootObject(doc, updated, inbound, requests, maxReq)
}

/**
 * Mutates the request object `request` (representing a change made locally but
 * not yet applied by the backend), transforming it past the remote `patch`.
 * The transformed version of `request` can be applied after `patch` has been
 * applied, and its effect is the same as when the original version of `request`
 * is applied to the base document without `patch`.
 *
 * This function implements a simple form of Operational Transformation.
 * However, the implementation here is actually incomplete and incorrect.
 * Fortunately, it's actually not a big problem if the transformation here is
 * not quite right, because the transformed request is only used transiently
 * while waiting for a response from the backend. When the backend responds, the
 * transformation result is discarded and replaced with the backend's version.
 *
 * One scenario that is not handled correctly is insertion at the same index:
 * request = {diffs: [{obj: someList, type: 'list', action: 'insert', index: 1}]}
 * patch = {diffs: [{obj: someList, type: 'list', action: 'insert', index: 1}]}
 *
 * Correct behaviour (i.e. consistent with the CRDT) would be to order the two
 * insertions by their elemIds; any subsequent insertions with consecutive
 * indexes may also need to be adjusted accordingly (to keep an insertion
 * sequence by a particular actor uninterrupted).
 *
 * Another scenario that is not handled correctly:
 * requests = [
 *   {diffs: [{obj: someList, type: 'list', action: 'insert', index: 1, value: 'a'}]},
 *   {diffs: [{obj: someList, type: 'list', action: 'set',    index: 1, value: 'b'}]}
 * ]
 * patch = {diffs: [{obj: someList, type: 'list', action: 'remove', index: 1}]}
 *
 * The first request's insertion is correctly left unchanged, but the 'set' action
 * is incorrectly turned into an 'insert' because we don't realise that it is
 * assigning the previously inserted list item (not the deleted item).
 *
 * A third scenario is concurrent assignment to the same list element or map key;
 * this should create a conflict.
 */
function transformRequest(request, patch) {
  let transformed = []

  local_loop:
  for (let local of request.diffs) {
    local = Object.assign({}, local)

    for (let remote of patch.diffs) {
      // If the incoming patch modifies list indexes (because it inserts or removes),
      // adjust the indexes in local diffs accordingly
      if (local.obj === remote.obj && local.type === 'list' &&
          ['insert', 'set', 'remove'].includes(local.action)) {
        // TODO not correct: for two concurrent inserts with the same index, the order
        // needs to be determined by the elemIds to maintain consistency with the CRDT
        if (remote.action === 'insert' && remote.index <=  local.index) local.index += 1
        if (remote.action === 'remove' && remote.index <   local.index) local.index -= 1
        if (remote.action === 'remove' && remote.index === local.index) {
          if (local.action === 'set') local.action = 'insert'
          if (local.action === 'remove') continue local_loop // drop this diff
        }
      }

      // If the incoming patch assigns a list element or map key, and a local diff updates
      // the same key, make a conflict (since the two assignments are definitely concurrent).
      // The assignment with the highest actor ID determines the default resolution.
      if (local.obj === remote.obj && local.action === 'set' && remote.action === 'set' &&
          ((local.type === 'list' && local.index === remote.index) ||
           (local.type === 'map'  && local.key   === remote.key  ))) {
        // TODO
      }
    }
    transformed.push(local)
  }

  request.diffs = transformed
}


/**
 * An instance of this class is passed to `rootObjectProxy()`. The methods are
 * called by proxy object mutation functions to query the current object state
 * and to apply the requested changes.
 */
class Context {
  constructor (doc) {
    this.actorId = doc[ACTOR_ID]
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
    applyDiff(diff, this.cache, this.updated, this.inbound)
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

    if (Array.isArray(value)) {
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

    list[MAX_ELEM] += 1
    const prevId = (index === 0) ? '_head' : list[ELEM_IDS][index - 1]
    const elemId = `${this.actorId}:${list[MAX_ELEM]}`
    this.addOp({action: 'ins', obj: objectId, key: prevId, elem: list[MAX_ELEM]})

    if (isObject(value)) {
      const childId = this.createNestedObjects(value)
      this.apply({action: 'insert', type: 'list', obj: objectId, index, value: childId, link: true, elemId})
      this.addOp({action: 'link', obj: objectId, key: elemId, value: childId})
    } else {
      this.apply({action: 'insert', type: 'list', obj: objectId, index, value, elemId})
      this.addOp({action: 'set', obj: objectId, key: elemId, value})
    }
  }

  /**
   * Updates the list with ID `objectId`, replacing the current value at
   * position `index` with the new value `value`.
   */
  setListIndex(objectId, index, value) {
    const list = this.getObject(objectId)
    if (index < 0 || index >= list.length) {
      throw new RangeError(`List index ${index} is out of bounds for list of length ${list.length}`)
    }
    if (!['object', 'boolean', 'number', 'string'].includes(typeof value)) {
      throw new TypeError(`Unsupported type of value: ${typeof value}`)
    }

    const elemId = list[ELEM_IDS][index]

    if (isObject(value)) {
      const childId = this.createNestedObjects(value)
      this.apply({action: 'set', type: 'list', obj: objectId, index, value: childId, link: true})
      this.addOp({action: 'link', obj: objectId, key: elemId, value: childId})
    } else {
      this.apply({action: 'set', type: 'list', obj: objectId, index, value})
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

    if (deletions > 0) {
      if (start < 0 || start > list.length - deletions) {
        throw new RangeError(`${deletions} deletions starting at index ${start} are out of bounds for list of length ${list.length}`)
      }

      for (let i = 0; i < deletions; i++) {
        this.apply({action: 'remove', type: 'list', obj: objectId, index: start})
        this.addOp({action: 'del', obj: objectId, key: list[ELEM_IDS][start]})

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

/**
 * Creates an empty document object with no changes.
 */
function init(actorId) {
  let root = {}, cache = {[ROOT_ID]: root}
  Object.defineProperty(root, OBJECT_ID, {value: ROOT_ID})
  Object.defineProperty(root, ACTOR_ID,  {value: actorId || uuid()})
  Object.defineProperty(root, CONFLICTS, {value: Object.freeze({})})
  Object.defineProperty(root, CACHE,     {value: Object.freeze(cache)})
  Object.defineProperty(root, INBOUND,   {value: Object.freeze({})})
  Object.defineProperty(root, REQUESTS,  {value: Object.freeze([])})
  Object.defineProperty(root, MAX_REQ,   {value: 0})
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

  if (Object.keys(context.updated).length === 0) {
    // If the callback didn't change anything, return the original document object unchanged
    return doc
  } else {
    // TODO: If there are multiple assignment operations for the same object and key,
    // we should keep only the most recent (this applies to both ops and diffs)
    updateParentObjects(doc[CACHE], context.updated, context.inbound)

    const maxReq = doc[MAX_REQ] + 1
    const requests = doc[REQUESTS].slice()
    const request = {requestId: maxReq, before: doc, ops: context.ops, diffs: context.diffs}
    requests.push(request)

    return updateRootObject(doc, context.updated, context.inbound, requests, maxReq)
  }
}

/**
 * Applies `patch` to the document root object `doc`. This patch must come
 * from the backend; it may be the result of a local change or a remote change.
 * If it is the result of a local change, the `requestId` field from the change
 * request should be included in the patch, so that we can match them up here.
 */
function applyPatch(doc, patch) {
  let baseDoc, remainingRequests
  if (patch.requestId !== undefined) {
    if (doc[REQUESTS].length === 0) {
      throw new RangeError(`No matching request for requestId ${patch.requestId}`)
    }
    if (doc[REQUESTS][0].requestId !== patch.requestId) {
      throw new RangeError(`Mismatched requestId: patch ${patch.requestId} does not match next request ${doc[REQUESTS][0].requestId}`)
    }
    baseDoc = doc[REQUESTS][0].before
    remainingRequests = doc[REQUESTS].slice(1).map(req => Object.assign({}, req))
  } else if (doc[REQUESTS].length > 0) {
    baseDoc = doc[REQUESTS][0].before
    remainingRequests = doc[REQUESTS].slice().map(req => Object.assign({}, req))
  } else {
    baseDoc = doc
    remainingRequests = []
  }

  let newDoc = applyPatchToDoc(baseDoc, patch, remainingRequests, doc[MAX_REQ])
  for (let request of remainingRequests) {
    request.before = newDoc
    transformRequest(request, patch)
    newDoc = applyPatchToDoc(request.before, request, remainingRequests, doc[MAX_REQ])
  }
  return newDoc
}

/**
 * Returns the Automerge object ID of the given object.
 */
function getObjectId(object) {
  return object[OBJECT_ID]
}

/**
 * Returns the Automerge actor ID of the given document.
 */
function getActorId(doc) {
  return doc[ACTOR_ID]
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

/**
 * Returns the list of change requests pending on the document `doc`.
 */
function getRequests(doc) {
  return doc[REQUESTS].map(req => {
    const { requestId, ops } = req
    return { requestId, ops }
  })
}

module.exports = {
  init, change, applyPatch, getObjectId, getActorId, getConflicts, getRequests
}
