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
 * Applies the list of changes `diff` to the cached objects in `cache`.
 * `updated` is an initially empty object that is mutated to contain the
 * updated objects. `inbound` is the mapping from child objectId to parent
 * objectId; it is updated according to the changes.
 */
function updateObjects(diffs, cache, updated, inbound) {
  for (let diff of diffs) {
    if (diff.type === 'map') {
      updateMapObject(diff, cache, updated, inbound)
    } else if (diff.type === 'list') {
      updateListObject(diff, cache, updated, inbound)
    } else if (diff.type === 'text') {
      throw new RangeError('TODO: Automerge.Text is not yet supported')
    } else {
      throw new RangeError('Unknown object type: ' + diff.type)
    }
  }

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

function init() {
  let root = {}, cache = {[ROOT_ID]: root}
  Object.defineProperty(root, OBJECT_ID, {value: ROOT_ID})
  Object.defineProperty(root, CONFLICTS, {value: Object.freeze({})})
  Object.defineProperty(root, CACHE,     {value: Object.freeze(cache)})
  Object.defineProperty(root, INBOUND,   {value: Object.freeze({})})
  return Object.freeze(root)
}

function applyDiffs(root, diffs) {
  let inbound = Object.assign({}, root[INBOUND])
  let updated = {}
  updateObjects(diffs, root[CACHE], updated, inbound)

  let newRoot = updated[ROOT_ID]
  if (!newRoot) {
    throw new Error('Root object was not modified by diffs')
  }
  Object.defineProperty(newRoot, CACHE,   {value: updated})
  Object.defineProperty(newRoot, INBOUND, {value: inbound})

  for (let objectId of Object.keys(root[CACHE])) {
    if (updated[objectId]) {
      Object.freeze(updated[objectId])
      Object.freeze(updated[objectId][CONFLICTS])
    } else {
      updated[objectId] = root[CACHE][objectId]
    }
  }

  Object.freeze(updated)
  Object.freeze(inbound)
  return newRoot
}

function getConflicts(object) {
  return object[CONFLICTS]
}

module.exports = {
  init, applyDiffs, getConflicts
}
