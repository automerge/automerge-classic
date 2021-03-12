const { Map, List, Set, fromJS } = require('immutable')
const { SkipList } = require('./skip_list')
const { decodeChange, decodeChangeMeta } = require('./columnar')
const { parseOpId, appendEdit } = require('../src/common')

// Returns true if all changes that causally precede the given change
// have already been applied in `opSet`.
function causallyReady(opSet, change) {
  for (let hash of change.deps) {
    if (!opSet.hasIn(['hashes', hash])) return false
  }
  return true
}

/**
 * Returns the path from the root object to the given objectId, as an array of
 * operations describing the objects and keys traversed. If there are several
 * paths to the same object, returns one of the paths arbitrarily. Returns
 * null if there is no path (e.g. if the object has been deleted).
 */
function getPath(opSet, objectId) {
  let path = []
  while (objectId !== '_root') {
    const ref = opSet.getIn(['byObject', objectId, '_inbound'], Set()).first()
    if (!ref) return null
    path.unshift(ref)
    objectId = ref.get('obj')
  }
  return path
}

/**
 * Returns a string that is either 'map', 'table', 'list', or 'text', indicating
 * the type of the object with ID `objectId`.
 */
function getObjectType(opSet, objectId) {
  if (objectId === '_root') return 'map'
  const objInit = opSet.getIn(['byObject', objectId, '_init', 'action'])
  const type = {makeMap: 'map', makeTable: 'table', makeList: 'list', makeText: 'text'}[objInit]
  if (!type) throw new RangeError(`Unknown object type ${objInit} for ${objectId}`)
  return type
}

// Processes a 'makeMap', 'makeList', 'makeTable', or 'makeText' operation
function applyMake(opSet, op, patch) {
  const objectId = getChildId(op), action = op.get('action')
  if (opSet.hasIn(['byObject', objectId, '_keys'])) throw new Error(`Duplicate creation of object ${objectId}`)

  let object = Map({_init: op, _inbound: Set(), _keys: Map()})
  if (action === 'makeList' || action === 'makeText') {
    object = object.set('_elemIds', new SkipList())
    if (patch && !patch.edits) {
      patch.edits = []
    }
  }
  opSet = opSet.setIn(['byObject', objectId], object)

  if (patch) {
    patch.objectId = objectId
    patch.type = getObjectType(opSet, objectId)
  }
  return opSet
}

// Processes an insertion operation. Does not modify any patch because the new list element
// only becomes visible through the assignment of a value to the new list element.
function applyInsert(opSet, op) {
  const objectId = op.get('obj'), opId = op.get('opId')
  if (!opSet.get('byObject').has(objectId)) throw new Error(`Modification of unknown object ${objectId}`)
  if (opSet.hasIn(['byObject', objectId, '_insertion', opId])) throw new Error(`Duplicate list element ID ${opId}`)
  if (!op.get('elemId')) throw new RangeError('insert operation has no key')

  return opSet
    .updateIn(['byObject', objectId, '_following', op.get('elemId')], List(), list => list.push(op))
    .setIn(['byObject', objectId, '_insertion', opId], op)
}

function updateListElement(opSet, objectId, elemId, patch) {
  const ops = getFieldOps(opSet, objectId, elemId)
  let elemIds = opSet.getIn(['byObject', objectId, '_elemIds'])
  let index = elemIds.indexOf(elemId)

  if (patch && patch.edits === undefined) {
    patch.edits = []
  }

  if (index >= 0) {
    if (ops.isEmpty()) {
      elemIds = elemIds.removeIndex(index)
      if (patch) appendEdit(patch.edits, {action: 'remove', index, count: 1})
    } else {
      elemIds = elemIds.setValue(elemId, ops.first().get('value'))
      if (patch) mergeEdits(patch.edits, makeListEditsForIndex(opSet, objectId, elemId, index, false))
    }

  } else {
    if (ops.isEmpty()) return opSet // deleting a non-existent element = no-op

    // find the index of the closest preceding list element
    let prevId = elemId
    while (true) {
      index = -1
      prevId = getPrevious(opSet, objectId, prevId)
      if (!prevId) break
      index = elemIds.indexOf(prevId)
      if (index >= 0) break
    }

    index += 1
    elemIds = elemIds.insertIndex(index, elemId, ops.first().get('value'))
    if (patch) {
      mergeEdits(patch.edits, makeListEditsForIndex(opSet, objectId, elemId, index, true))
    }
  }
  return opSet.setIn(['byObject', objectId, '_elemIds'], elemIds)
}

/**
 * Returns true if the operation `op` introduces a child object.
 */
function isChildOp(op) {
  const action = op.get('action')
  return action.startsWith('make') || action === 'link'
}

/**
 * Returns the object ID of the child introduced by `op`.
 */
function getChildId(op) {
  return op.get('child', op.get('opId'))
}

/**
 * Returns the key that is updated by the given operation. In the case of lists and text,
 * the key is the element ID; in the case of maps, it is the property name.
 */
function getOperationKey(op) {
  const keyStr = op.get('key')
  if (keyStr) return keyStr
  const key = op.get('insert') ? op.get('opId') : op.get('elemId')
  if (!key) throw new RangeError(`operation has no key: ${op}`)
  return key
}

/**
 * Processes a 'set', 'del', 'make*', 'link', or 'inc' operation. Mutates `patch`
 * to describe the change and returns an updated `opSet`.
 */
function applyAssign(opSet, op, patch) {
  const objectId = op.get('obj'), action = op.get('action'), key = getOperationKey(op)
  if (!opSet.get('byObject').has(objectId)) throw new RangeError(`Modification of unknown object ${objectId}`)
  const type = getObjectType(opSet, objectId)

  if (patch) {
    patch.objectId = patch.objectId || objectId
    if (patch.objectId !== objectId) {
      throw new RangeError(`objectId mismatch in patch: ${patch.objectId} != ${objectId}`)
    }
    if (['map', 'table'].includes(type)) {
      if (patch.props === undefined) {
        patch.props = {}
      }
      if (patch.props[key] === undefined) {
        patch.props[key] = {}
      }
    } else {
      if (!patch.edits) {
        patch.edits = []
      }
    }

    patch.type = patch.type || type
    if (patch.type !== type) {
      throw new RangeError(`object type mismatch in patch: ${patch.type} != ${type}`)
    }
  }

  if (action.startsWith('make')) {
    if (patch) {
      const valuePatch = {}
      opSet = applyMake(opSet, op, valuePatch)
      if (['map', 'table'].includes(type)) {
        patch.props[key][op.get('opId')] = valuePatch
      }
    } else {
      opSet = applyMake(opSet, op)
    }
  }
  if (action === 'link' && patch) {
    patch.props[key][op.get('opId')] = constructObject(opSet, getChildId(op))
  }

  const ops = getFieldOps(opSet, objectId, key)
  let overwritten, remaining

  if (action === 'inc') {
    overwritten = List()
    remaining = ops.map(other => {
      if (other.get('action') === 'set' && typeof other.get('value') === 'number' &&
          other.get('datatype') === 'counter' && op.get('pred').includes(other.get('opId'))) {
        return other.set('value', other.get('value') + op.get('value'))
      } else {
        return other
      }
    })
  } else {
    const priorOpsOverwritten = ops.groupBy(other => op.get('pred').includes(other.get('opId')))
    overwritten = priorOpsOverwritten.get(true,  List())
    remaining   = priorOpsOverwritten.get(false, List())
  }

  // If any child object references were overwritten, remove them from the index of inbound links
  for (let old of overwritten.filter(isChildOp)) {
    opSet = opSet.updateIn(['byObject', getChildId(old), '_inbound'], ops => ops.remove(old))
  }

  if (isChildOp(op)) {
    opSet = opSet.updateIn(['byObject', getChildId(op), '_inbound'], Set(), ops => ops.add(op))
  }
  if (action === 'set' || isChildOp(op)) { // not 'inc' or 'del'
    remaining = remaining.push(op)
  }
  remaining = remaining.sort(lamportCompare).reverse()
  opSet = opSet.setIn(['byObject', objectId, '_keys', key], remaining)

  if (type === 'list' || type === 'text') {
    opSet = updateListElement(opSet, objectId, key, patch)
  } else {
    setPatchPropsForMap(opSet, objectId, key, patch)
  }
  return opSet
}

/**
 * Updates `patch` with the fields required in a patch. `pathOp` is an operation
 * along the path from the root to the object being modified, as returned by
 * `getPath()`. Returns the sub-object representing the child identified by this
 * operation.
 */
function initializePatch(opSet, pathOp, patch) {
  const objectId = pathOp.get('obj'), opId = pathOp.get('opId'), key = getOperationKey(pathOp)
  const type = getObjectType(opSet, objectId)
  patch.objectId = patch.objectId || objectId
  patch.type     = patch.type     || type

  if (patch.objectId !== objectId) {
    throw new RangeError(`objectId mismatch in path: ${patch.objectId} != ${objectId}`)
  }
  if (patch.type !== type) {
    throw new RangeError(`object type mismatch in path: ${patch.type} != ${type}`)
  }
  if (['map', 'table'].includes(patch.type)) {
    setPatchPropsForMap(opSet, objectId, key, patch)
    if (patch.props[key][opId] === undefined) {
      throw new RangeError(`field ops for ${key} did not contain opId ${opId}`)
    }
    return patch.props[key][opId]
  } else {
    let elemIds = opSet.getIn(['byObject', objectId, '_elemIds'])
    let index = elemIds.indexOf(key)
    if (!patch.edits) patch.edits = []
    let elemPatch = patch.edits.find(e => e.opId === key || e.elemId === key)
    if (elemPatch) {
      return elemPatch.value
    } else {
      const edits = makeListEditsForIndex(opSet, objectId, key, index, false)
      let elemPatch = edits.find(e => e.opId === opId || e.elemId === opId)
      if (elemPatch === undefined) {
        throw new RangeError(`field ops for ${key} did not contain opId ${opId}`)
      }
      patch.edits.push(...edits)
      return elemPatch.value
    }
  }

}

/**
 * Updates `patch` to include all the values (including conflicts) for the field
 * `key` of the object with ID `objectId`.
 */
function setPatchPropsForMap(opSet, objectId, key, patch) {
  if (!patch) return
  if (patch.props === undefined) {
    patch.props = {}
  }
  if (patch.props[key] === undefined) {
    patch.props[key] = {}
  }

  const ops = {}
  for (let op of getFieldOps(opSet, objectId, key)) {
    const opId = op.get('opId')
    ops[opId] = true

    if (op.get('action') === 'set') {
      patch.props[key][opId] = {type: 'value', value: op.get('value')}
      if (op.get('datatype')) {
        patch.props[key][opId].datatype = op.get('datatype')
      }
    } else if (isChildOp(op)) {
      if (!patch.props[key][opId]) {
        const childId = getChildId(op)
        const type = getObjectType(opSet, childId)
        patch.props[key][opId] = {objectId: childId, type}
        if (type === "list" || type === "text") patch.props[key][opId].edits = []
      }
    } else {
      throw new RangeError(`Unexpected operation in field ops: ${op.get('action')}`)
    }
  }

  // Remove any values that appear in the patch, but were not returned by getFieldOps()
  for (let opId of Object.keys(patch.props[key])) {
    if (!ops[opId]) {
      delete patch.props[key][opId]
    }
  }
}

function makeListEditsForIndex(opSet, listId, elemId, index, insert) {
  edits = []
  for (let op of getFieldOps(opSet, listId, elemId)) {
    let valuePatch = {}
    const opId = op.get('opId')

    if (op.get('action') === 'set') {
      valuePatch = {type: 'value', value: op.get('value')}
      if (op.get('datatype')) {
        valuePatch.datatype = op.get('datatype')
      }
    } else if (isChildOp(op)) {
      const childId = getChildId(op)
      const type = getObjectType(opSet, childId)
      valuePatch = {objectId: childId, type}
      if (type === 'list' || type === 'text') valuePatch.edits = []
    } else {
      throw new RangeError(`Unexpected operation in field ops: ${op.get('action')}`)
    }

    if (edits.length === 0 && insert) {
      edits.push({
        action: 'insert',
        value: valuePatch,
        elemId: opId,
        index,
      })
    } else {
      edits.push({
        action: 'update',
        value: valuePatch,
        opId: opId,
        index,
      })
    }
  }

  return edits
}

function mergeEdits(existingEdits, newEdits) {
  for (const edit of newEdits) {
    appendEdit(existingEdits, edit)
  }
}

/**
 * Applies the operations in the `change` to `opSet`. As a side-effect, `patch`
 * is mutated to describe the changes. Returns the updated `opSet`.
 */
function applyOps(opSet, change, patch) {
  const actor = change.get('actor'), seq = change.get('seq'), startOp = change.get('startOp')
  let newObjects = Set()
  change.get('ops').forEach((op, index) => {
    const action = op.get('action'), obj = op.get('obj'), insert = op.get('insert')
    if (!['set', 'del', 'inc', 'link', 'makeMap', 'makeList', 'makeText', 'makeTable'].includes(action)) {
      throw new RangeError(`Unknown operation action: ${action}`)
    }
    if (!op.get('pred')) {
      throw new RangeError(`Missing 'pred' field in operation ${op}`)
    }

    let localPatch
    if (patch) {
      const path = getPath(opSet, obj)
      if (path !== null) {
        localPatch = patch
        for (let pathOp of path) localPatch = initializePatch(opSet, pathOp, localPatch)
      }
    }

    const opWithId = op.merge({opId: `${startOp + index}@${actor}`})
    if (insert) {
      opSet = applyInsert(opSet, opWithId)
    }
    if (action.startsWith('make')) {
      newObjects = newObjects.add(getChildId(opWithId))
    }
    opSet = applyAssign(opSet, opWithId, localPatch)
  })
  return opSet
}

/**
 * Applies the changeset `change` to `opSet` (unless it has already been applied,
 * in which case we do nothing). As a side-effect, `patch` is mutated to describe
 * the changes. Returns the updated `opSet`.
 */
function applyChange(opSet, binaryChange, patch) {
  const change = fromJS(decodeChange(binaryChange))
  const actor = change.get('actor'), seq = change.get('seq'), startOp = change.get('startOp'), hash = change.get('hash')
  if (typeof actor !== 'string' || typeof seq !== 'number' || typeof startOp !== 'number') {
    throw new TypeError(`Missing change metadata: actor = ${actor}, seq = ${seq}, startOp = ${startOp}`)
  }
  if (opSet.hasIn(['hashes', hash])) return opSet // change already applied, return unchanged

  const expectedSeq = opSet.getIn(['states', actor], List()).size + 1
  if (seq !== expectedSeq) {
    throw new RangeError(`Expected change ${expectedSeq} by ${actor}, got change ${seq}`)
  }

  let maxOpId = 0
  for (let depHash of change.get('deps')) {
    const depOpId = opSet.getIn(['hashes', depHash, 'maxOpId'])
    if (depOpId === undefined) throw new RangeError(`Unknown dependency hash ${depHash}`)
    maxOpId = Math.max(maxOpId, depOpId)
    opSet = opSet.updateIn(['hashes', depHash, 'depsFuture'], Set(), future => future.add(hash))
  }
  if (startOp !== maxOpId + 1) {
    throw new RangeError(`Expected startOp to be ${maxOpId + 1}, was ${startOp}`)
  }

  let queue = change.get('deps'), sameActorDep = (seq === 1)
  while (!sameActorDep && !queue.isEmpty()) {
    const dep = opSet.getIn(['hashes', queue.first()])
    queue = queue.shift()
    if (dep.get('actor') === actor && dep.get('seq') === seq - 1) {
      sameActorDep = true
    } else {
      queue = queue.concat(dep.get('depsPast'))
    }
  }
  if (!sameActorDep) {
    throw new RangeError('Change lacks dependency on prior sequence number by the same actor')
  }

  const changeInfo = Map({
    actor, seq, startOp,
    change: binaryChange,
    maxOpId: startOp + change.get('ops').size - 1,
    depsPast: change.get('deps').toSet(),
    depsFuture: Set()
  })

  opSet = applyOps(opSet, change, patch)
  return opSet
    .setIn(['hashes', hash], changeInfo)
    .updateIn(['states', actor], List(), prior => prior.push(hash))
    .update('deps', deps => deps.subtract(change.get('deps')).add(hash))
    .update('maxOp', maxOp => Math.max(maxOp, changeInfo.get('maxOpId')))
    .update('history', history => history.push(hash))
}

function applyQueuedOps(opSet, patch) {
  let queue = List()
  while (true) {
    for (let change of opSet.get('queue')) {
      if (causallyReady(opSet, decodeChangeMeta(change, false))) {
        opSet = applyChange(opSet, change, patch)
      } else {
        queue = queue.push(change)
      }
    }

    if (queue.count() === opSet.get('queue').count()) return opSet
    opSet = opSet.set('queue', queue)
    queue = List()
  }
}

function init() {
  return Map()
    .set('states',   Map())
    .set('history',  List())
    .set('byObject', Map().set('_root', Map().set('_keys', Map())))
    .set('hashes',   Map())
    .set('deps',     Set())
    .set('maxOp',     0)
    .set('queue',    List())
}

/**
 * Adds `change` to `opSet` without any modification
 * (e.g. because it's a remote change, or we have loaded it from disk). `change`
 * is given as an Immutable.js Map object. `patch` is mutated to describe the
 * change (in the format used by patches).
 */
function addChange(opSet, change, patch) {
  opSet = opSet.update('queue', queue => queue.push(change))
  return applyQueuedOps(opSet, patch)
}

/**
 * Applies a change made by the local user and adds it to `opSet`. The `change`
 * is given as an Immutable.js Map object. `patch` is mutated to describe the
 * change (in the format used by patches).
 */
function addLocalChange(opSet, change, patch) {
  return applyChange(opSet, change, patch)
}

/**
 * Returns an array of hashes of the current "head" changes (i.e. those changes
 * that no other change depends on).
 */
function getHeads(opSet) {
  return opSet.get('deps').toJSON().sort()
}

/**
 * Returns all the changes in `opSet` that need to be sent to another replica.
 * `haveDeps` is an Immutable.js List object containing the hashes (as hex
 * strings) of the heads that the other replica has. Those changes in `haveDeps`
 * and any of their transitive dependencies will not be returned; any changes
 * later than or concurrent to the hashes in `haveDeps` will be returned.
 * If `haveDeps` is an empty list, all changes are returned.
 *
 * NOTE: This function throws an exception if any of the given hashes are not
 * known to this replica. This means that if the other replica is ahead of us,
 * this function cannot be used directly to find the changes to send.
 * TODO need to fix this.
 */
function getMissingChanges(opSet, haveDeps) {
  let stack = haveDeps, seenHashes = {}
  while (!stack.isEmpty()) {
    const hash = stack.last()
    const deps = opSet.getIn(['hashes', hash, 'depsPast'])
    if (!deps) throw new RangeError(`hash not found: ${hash}`)
    stack = stack.pop().concat(deps)
    seenHashes[hash] = true
  }

  return opSet.get('history')
    .filter(hash => !seenHashes[hash])
    .map(hash => opSet.getIn(['hashes', hash, 'change']))
    .toJSON()
}

function getMissingDeps(opSet) {
  let missing = {}, inQueue = {}
  for (let binaryChange of opSet.get('queue')) {
    const change = decodeChangeMeta(binaryChange, true)
    inQueue[change.hash] = true
    for (let depHash of change.deps) {
      if (!opSet.hasIn(['hashes', depHash])) missing[depHash] = true
    }
  }
  return Object.keys(missing).filter(hash => !inQueue[hash]).sort()
}

function getFieldOps(opSet, objectId, key) {
  return opSet.getIn(['byObject', objectId, '_keys', key], List())
}

function getParent(opSet, objectId, key) {
  if (key === '_head') return
  const insertion = opSet.getIn(['byObject', objectId, '_insertion', key])
  if (!insertion) throw new TypeError(`Missing index entry for list element ${key}`)
  return insertion.get('elemId')
}

function lamportCompare(op1, op2) {
  const time1 = parseOpId(op1.get('opId')), time2 = parseOpId(op2.get('opId'))
  if (time1.counter < time2.counter) return -1
  if (time1.counter > time2.counter) return  1
  if (time1.actorId < time2.actorId) return -1
  if (time1.actorId > time2.actorId) return  1
  return 0
}

function insertionsAfter(opSet, objectId, parentId, childId) {
  let childKey = null
  if (childId) childKey = Map({opId: childId})

  return opSet
    .getIn(['byObject', objectId, '_following', parentId], List())
    .filter(op => op.get('insert') && (!childKey || lamportCompare(op, childKey) < 0))
    .sort(lamportCompare)
    .reverse() // descending order
    .map(op => op.get('opId'))
}

function getNext(opSet, objectId, key) {
  const children = insertionsAfter(opSet, objectId, key)
  if (!children.isEmpty()) return children.first()

  let ancestor
  while (true) {
    ancestor = getParent(opSet, objectId, key)
    if (!ancestor) return
    const siblings = insertionsAfter(opSet, objectId, ancestor, key)
    if (!siblings.isEmpty()) return siblings.first()
    key = ancestor
  }
}

// Given the ID of a list element, returns the ID of the immediate predecessor list element,
// or null if the given list element is at the head.
function getPrevious(opSet, objectId, key) {
  const parentId = getParent(opSet, objectId, key)
  let children = insertionsAfter(opSet, objectId, parentId)
  if (children.first() === key) {
    if (parentId === '_head') return null; else return parentId;
  }

  let prevId
  for (let child of children) {
    if (child === key) break
    prevId = child
  }
  while (true) {
    children = insertionsAfter(opSet, objectId, prevId)
    if (children.isEmpty()) return prevId
    prevId = children.last()
  }
}

function constructField(opSet, op) {
  if (isChildOp(op)) {
    return constructObject(opSet, getChildId(op))
  } else if (op.get('action') === 'set') {
    const result = {value: op.get('value')}
    if (op.get('datatype')) result.datatype = op.get('datatype')
    return result
  } else {
    throw new TypeError(`Unexpected operation action: ${op.get('action')}`)
  }
}

function constructMap(opSet, objectId, type) {
  const patch = {objectId, type, props: {}}
  for (let [key, fieldOps] of opSet.getIn(['byObject', objectId, '_keys']).entries()) {
    if (!fieldOps.isEmpty()) {
      patch.props[key] = {}
      for (let op of fieldOps) {
        patch.props[key][op.get('opId')] = constructField(opSet, op)
      }
    }
  }
  return patch
}

function constructList(opSet, objectId, type) {
  const patch = {objectId, type, props: {}, edits: []}
  let elemId = '_head', index = 0, maxCounter = 0

  while (true) {
    elemId = getNext(opSet, objectId, elemId)
    if (!elemId) {
      return patch
    }
    maxCounter = Math.max(maxCounter, parseOpId(elemId).counter)

    const fieldOps = getFieldOps(opSet, objectId, elemId)
    if (!fieldOps.isEmpty()) {
      patch.props[index] = {}
      for (let op of fieldOps) {
        patch.props[index][op.get('opId')] = constructField(opSet, op)
      }
      index += 1
    }
  }
}

function constructObject(opSet, objectId) {
  const type = getObjectType(opSet, objectId)
  if (type === 'map' || type === 'table') {
    return constructMap(opSet, objectId, type)
  } else if (type === 'list' || type === 'text') {
    return constructList(opSet, objectId, type)
  } else {
    throw new RangeError(`Unknown object type: ${type}`)
  }
}

module.exports = {
  init, addChange, addLocalChange, getHeads, getMissingChanges, getMissingDeps,
  constructObject, getFieldOps, getOperationKey
}
