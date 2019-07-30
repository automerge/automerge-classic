const { ROOT_ID, isObject, copyObject, parseElemId } = require('../src/common')
const { OPTIONS, OBJECT_ID, CONFLICTS, ELEM_IDS, MAX_ELEM } = require('./constants')
const { Text, instantiateText } = require('./text')
const { Table, instantiateTable } = require('./table')
const { Counter } = require('./counter')

/**
 * Reconstructs the value from the diff object `diff`.
 */
function getValue(diff, cache, updated) {
  if (diff.link) {
    // Reference to another object; fetch it from the cache
    return updated[diff.value] || cache[diff.value]
  } else if (diff.datatype === 'timestamp') {
    // Timestamp: value is milliseconds since 1970 epoch
    return new Date(diff.value)
  } else if (diff.datatype === 'counter') {
    return new Counter(diff.value)
  } else if (diff.datatype !== undefined) {
    throw new TypeError(`Unknown datatype: ${diff.datatype}`)
  } else {
    // Primitive value (number, string, boolean, or null)
    return diff.value
  }
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
    if (isObject(child) && child[OBJECT_ID]) {
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
  if (originalObject && originalObject[OBJECT_ID] !== objectId) {
    throw new RangeError(`cloneMapObject ID mismatch: ${originalObject[OBJECT_ID]} !== ${objectId}`)
  }
  let object = copyObject(originalObject)
  let conflicts = copyObject(originalObject ? originalObject[CONFLICTS] : undefined)
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
    object[diff.key] = getValue(diff, cache, updated)
    if (diff.conflicts) {
      conflicts[diff.key] = {}
      for (let conflict of diff.conflicts) {
        conflicts[diff.key][conflict.actor] = getValue(conflict, cache, updated)
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
          conflictsUpdate = copyObject(conflicts)
          object[CONFLICTS][key] = conflictsUpdate
        }
        conflictsUpdate[actorId] = updated[value[OBJECT_ID]]
      }
    }

    if (conflictsUpdate && cache[ROOT_ID][OPTIONS].freeze) {
      Object.freeze(conflictsUpdate)
    }
  }
}

/**
 * Applies the change `diff` to a table object. `cache` and `updated` are indexed
 * by objectId; the existing read-only object is taken from `cache`, and the
 * updated writable object is written to `updated`. `inbound` is a mapping from
 * child objectId to parent objectId; it is updated according to the change.
 */
function updateTableObject(diff, cache, updated, inbound) {
  if (!updated[diff.obj]) {
    updated[diff.obj] = cache[diff.obj] ? cache[diff.obj]._clone() : instantiateTable(diff.obj)
  }
  let object = updated[diff.obj]
  let refsBefore = {}, refsAfter = {}

  if (diff.action === 'create') {
    // do nothing
  } else if (diff.action === 'set') {
    const previous = object.byId(diff.key)
    if (isObject(previous)) refsBefore[previous[OBJECT_ID]] = true
    if (diff.link) {
      object.set(diff.key, updated[diff.value] || cache[diff.value])
      refsAfter[diff.value] = true
    } else {
      object.set(diff.key, diff.value)
    }
  } else if (diff.action === 'remove') {
    const previous = object.byId(diff.key)
    if (isObject(previous)) refsBefore[previous[OBJECT_ID]] = true
    object.remove(diff.key)
  } else {
    throw new RangeError('Unknown action type: ' + diff.action)
  }

  updateInbound(diff.obj, refsBefore, refsAfter, inbound)
}

/**
 * Updates the table object with ID `objectId` such that all child objects that
 * have been updated in `updated` are replaced with references to the updated
 * version.
 */
function parentTableObject(objectId, cache, updated) {
  if (!updated[objectId]) {
    updated[objectId] = cache[objectId]._clone()
  }
  let table = updated[objectId]

  for (let key of Object.keys(table.entries)) {
    let value = table.byId(key)
    if (isObject(value) && updated[value[OBJECT_ID]]) {
      table.set(key, updated[value[OBJECT_ID]])
    }
  }
}

/**
 * Creates a writable copy of an immutable list object. If `originalList` is
 * undefined, creates an empty list with ID `objectId`.
 */
function cloneListObject(originalList, objectId) {
  if (originalList && originalList[OBJECT_ID] !== objectId) {
    throw new RangeError(`cloneListObject ID mismatch: ${originalList[OBJECT_ID]} !== ${objectId}`)
  }
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
    value = getValue(diff, cache, updated)
    if (diff.conflicts) {
      conflict = {}
      for (let c of diff.conflicts) {
        conflict[c.actor] = getValue(c, cache, updated)
      }
      Object.freeze(conflict)
    }
  }

  let refsBefore = {}, refsAfter = {}
  if (diff.action === 'create') {
    // do nothing
  } else if (diff.action === 'insert') {
    list[MAX_ELEM] = Math.max(list[MAX_ELEM], parseElemId(diff.elemId).counter)
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
  } else if (diff.action === 'maxElem') {
    list[MAX_ELEM] = Math.max(list[MAX_ELEM], diff.value)
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
          conflictsUpdate = copyObject(conflicts)
          list[CONFLICTS][index] = conflictsUpdate
        }
        conflictsUpdate[actorId] = updated[value[OBJECT_ID]]
      }
    }

    if (conflictsUpdate && cache[ROOT_ID][OPTIONS].freeze) {
      Object.freeze(conflictsUpdate)
    }
  }
}

/**
 * Applies the list of changes from `diffs[startIndex]` to `diffs[endIndex]`
 * (inclusive the last element) to a Text object. `cache` and `updated` are
 * indexed by objectId; the existing read-only object is taken from `cache`,
 * and the updated object is written to `updated`.
 */
function updateTextObject(diffs, startIndex, endIndex, cache, updated) {
  const objectId = diffs[startIndex].obj
  if (!updated[objectId]) {
    if (cache[objectId]) {
      const elems = cache[objectId].elems.slice()
      const maxElem = cache[objectId][MAX_ELEM]
      updated[objectId] = instantiateText(objectId, elems, maxElem)
    } else {
      updated[objectId] = instantiateText(objectId, [], 0)
    }
  }

  let elems = updated[objectId].elems, maxElem = updated[objectId][MAX_ELEM]
  let splicePos = -1, deletions, insertions

  while (startIndex <= endIndex) {
    const diff = diffs[startIndex]
    if (diff.action === 'create') {
      // do nothing

    } else if (diff.action === 'insert') {
      if (splicePos < 0) {
        splicePos = diff.index
        deletions = 0
        insertions = []
      }
      maxElem = Math.max(maxElem, parseElemId(diff.elemId).counter)
      insertions.push({elemId: diff.elemId, value: diff.value, conflicts: diff.conflicts})

      if (startIndex === endIndex || diffs[startIndex + 1].action !== 'insert' ||
          diffs[startIndex + 1].index !== diff.index + 1) {
        elems.splice(splicePos, deletions, ...insertions)
        splicePos = -1
      }

    } else if (diff.action === 'set') {
      elems[diff.index] = {
        elemId: elems[diff.index].elemId,
        value: diff.value,
        conflicts: diff.conflicts
      }

    } else if (diff.action === 'remove') {
      if (splicePos < 0) {
        splicePos = diff.index
        deletions = 0
        insertions = []
      }
      deletions += 1

      if (startIndex === endIndex ||
          !['insert', 'remove'].includes(diffs[startIndex + 1].action) ||
          diffs[startIndex + 1].index !== diff.index) {
        elems.splice(splicePos, deletions)
        splicePos = -1
      }

    } else if (diff.action === 'maxElem') {
      maxElem = Math.max(maxElem, diff.value)
    } else {
      throw new RangeError('Unknown action type: ' + diff.action)
    }

    startIndex += 1
  }
  updated[objectId] = instantiateText(objectId, elems, maxElem)
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
      } else if ((updated[objectId] || cache[objectId]) instanceof Table) {
        parentTableObject(objectId, cache, updated)
      } else {
        parentMapObject(objectId, cache, updated)
      }
    }
  }
}

/**
 * Applies the list of changes `diffs` to the appropriate object in `updated`.
 * `cache` and `updated` are indexed by objectId; the existing read-only object
 * is taken from `cache`, and the updated writable object is written to
 * `updated`. `inbound` is a mapping from child objectId to parent objectId;
 * it is updated according to the change.
 */
function applyDiffs(diffs, cache, updated, inbound) {
  let startIndex = 0
  for (let endIndex = 0; endIndex < diffs.length; endIndex++) {
    const diff = diffs[endIndex]

    if (diff.type === 'map') {
      updateMapObject(diff, cache, updated, inbound)
      startIndex = endIndex + 1
    } else if (diff.type === 'table') {
      updateTableObject(diff, cache, updated, inbound)
      startIndex = endIndex + 1
    } else if (diff.type === 'list') {
      updateListObject(diff, cache, updated, inbound)
      startIndex = endIndex + 1
    } else if (diff.type === 'text') {
      if (endIndex === diffs.length - 1 || diffs[endIndex + 1].obj !== diff.obj) {
        updateTextObject(diffs, startIndex, endIndex, cache, updated)
        startIndex = endIndex + 1
      }
    } else {
      throw new TypeError(`Unknown object type: ${diff.type}`)
    }
  }
}

/**
 * Creates a writable copy of the immutable document root object `root`.
 */
function cloneRootObject(root) {
  if (root[OBJECT_ID] !== ROOT_ID) {
    throw new RangeError(`Not the root object: ${root[OBJECT_ID]}`)
  }
  return cloneMapObject(root, ROOT_ID)
}

module.exports = {
  applyDiffs, updateParentObjects, cloneRootObject
}
