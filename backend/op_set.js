const { Map, List, Set } = require('immutable')
const { SkipList } = require('./skip_list')
const { ROOT_ID, parseOpId } = require('../src/common')

// Returns true if all changes that causally precede the given change
// have already been applied in `opSet`.
function causallyReady(opSet, change) {
  const actor = change.get('actor'), seq = change.get('seq')
  let satisfied = true
  change.get('deps').set(actor, seq - 1).forEach((depSeq, depActor) => {
    if (opSet.getIn(['clock', depActor], 0) < depSeq) satisfied = false
  })
  return satisfied
}

function transitiveDeps(opSet, baseDeps) {
  return baseDeps.reduce((deps, depSeq, depActor) => {
    if (depSeq <= 0) return deps
    const transitive = opSet.getIn(['states', depActor, depSeq - 1, 'allDeps'])
    return deps
      .mergeWith((a, b) => Math.max(a, b), transitive)
      .set(depActor, depSeq)
  }, Map())
}

/**
 * Returns the path from the root object to the given objectId, as an array of
 * operations describing the objects and keys traversed. If there are several
 * paths to the same object, returns one of the paths arbitrarily.
 */
function getPath(opSet, objectId) {
  let path = []
  while (objectId !== ROOT_ID) {
    const ref = opSet.getIn(['byObject', objectId, '_inbound'], Set()).first()
    if (!ref) throw new RangeError(`No path found to object ${objectId}`)
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
  if (objectId === ROOT_ID) return 'map'
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

  return opSet
    .updateIn(['byObject', objectId, '_following', op.get('key')], List(), list => list.push(op))
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
      if (patch) patch.edits.push({action: 'remove', index})
    } else {
      elemIds = elemIds.setValue(elemId, ops.first().get('value'))
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
    if (patch) patch.edits.push({action: 'insert', index})
  }
  return opSet.setIn(['byObject', objectId, '_elemIds'], elemIds)
}

/**
 * Computes the inverse of operation `op` and adds it to the list of undo operations
 * (`undoLocal`) in `opSet`. The inverse is the operation that restores the modified
 * field to its previous value. Returns the updated `opSet`.
 */
function recordUndoHistory(opSet, op) {
  if (!opSet.has('undoLocal')) return opSet
  const objectId = op.get('obj'), key = getOperationKey(op), value = op.get('value')

  let undoOps
  if (op.get('action') === 'inc') {
    undoOps = List.of(Map({action: 'inc', obj: objectId, key, value: -value}))
  } else {
    undoOps = getFieldOps(opSet, objectId, key).map(ref => {
      if (ref.get('insert')) {
        ref = ref.set('key', key)
      }
      if (ref.get('action').startsWith('make')) {
        ref = ref.set('action', 'link').set('child', getChildId(ref))
      }
      ref = ref.filter((v, k) => ['action', 'obj', 'key', 'value', 'datatype', 'child'].includes(k))
      return ref
    })
  }
  if (undoOps.isEmpty()) {
    undoOps = List.of(Map({action: 'del', obj: objectId, key}))
  }
  return opSet.update('undoLocal', undoLocal => undoLocal.concat(undoOps))
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
  return op.get('insert') ? op.get('opId') : op.get('key')
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
    if (patch.props === undefined) {
      patch.props = {}
    }
    if (patch.props[key] === undefined) {
      patch.props[key] = {}
    }

    patch.type = patch.type || type
    if (patch.type !== type) {
      throw new RangeError(`object type mismatch in patch: ${patch.type} != ${type}`)
    }
  }

  if (action.startsWith('make')) {
    if (patch) {
      patch.props[key][op.get('opId')] = {}
      opSet = applyMake(opSet, op, patch.props[key][op.get('opId')])
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
  setPatchProps(opSet, objectId, key, patch)

  if (type === 'list' || type === 'text') {
    opSet = updateListElement(opSet, objectId, key, patch)
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
  setPatchProps(opSet, objectId, key, patch)

  if (patch.props[key][opId] === undefined) {
    throw new RangeError(`field ops for ${key} did not contain opId ${opId}`)
  }
  return patch.props[key][opId]
}

/**
 * Updates `patch` to include all the values (including conflicts) for the field
 * `key` of the object with ID `objectId`.
 */
function setPatchProps(opSet, objectId, key, patch) {
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
      patch.props[key][opId] = {value: op.get('value')}
      if (op.get('datatype')) {
        patch.props[key][opId].datatype = op.get('datatype')
      }
    } else if (isChildOp(op)) {
      if (!patch.props[key][opId]) {
        const childId = getChildId(op)
        patch.props[key][opId] = {objectId: childId, type: getObjectType(opSet, childId)}
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

/**
 * Mutates `patch`, changing elemId-based addressing of lists to index-based
 * addressing. (This can only be done once all the changes have been applied,
 * since the indexes are still in flux until that point.)
 */
function finalizePatch(opSet, patch) {
  if (!patch || !patch.props) return

  if (patch.type === 'list' || patch.type === 'text') {
    const elemIds = opSet.getIn(['byObject', patch.objectId, '_elemIds'])
    const newProps = {}
    for (let elemId of Object.keys(patch.props)) {
      if (/^[0-9]+$/.test(elemId)) {
        newProps[elemId] = patch.props[elemId]
      } else if (Object.keys(patch.props[elemId]).length > 0) {
        const index = elemIds.indexOf(elemId)
        if (index < 0) throw new RangeError(`List element has no index: ${elemId}`)
        newProps[index] = patch.props[elemId]
      }
    }
    patch.props = newProps
  }

  for (let key of Object.keys(patch.props)) {
    for (let opId of Object.keys(patch.props[key])) {
      finalizePatch(opSet, patch.props[key][opId])
    }
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

    let localPatch = patch
    if (patch) {
      for (let pathOp of getPath(opSet, obj)) {
        localPatch = initializePatch(opSet, pathOp, localPatch)
      }
    }

    const opWithId = op.merge({opId: `${startOp + index}@${actor}`})
    if (insert) {
      opSet = applyInsert(opSet, opWithId)
    }
    if (action.startsWith('make')) {
      newObjects = newObjects.add(getChildId(opWithId))
    }
    if (!newObjects.contains(obj)) {
      opSet = recordUndoHistory(opSet, opWithId)
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
function applyChange(opSet, change, patch) {
  const actor = change.get('actor'), seq = change.get('seq'), startOp = change.get('startOp')
  if (typeof actor !== 'string' || typeof seq !== 'number' || typeof startOp !== 'number') {
    throw new TypeError(`Missing change metadata: actor = ${actor}, seq = ${seq}, startOp = ${startOp}`)
  }

  const prior = opSet.getIn(['states', actor], List())
  if (seq <= prior.size) {
    if (!prior.get(seq - 1).get('change').equals(change)) {
      throw new RangeError(`Inconsistent reuse of sequence number ${seq} by ${actor}`)
    }
    return opSet // change already applied, return unchanged
  }
  if (seq > 1) {
    const prevChange = prior.get(seq - 2).get('change')
    const minExpected = prevChange.get('startOp') + prevChange.get('ops').size
    if (startOp < minExpected) {
      throw new RangeError(`Operation ID counter moved backwards: ${startOp} < ${minExpected}`)
    }
  }

  opSet = applyOps(opSet, change, patch)

  const allDeps = transitiveDeps(opSet, change.get('deps').set(actor, seq - 1))
  const remainingDeps = opSet.get('deps')
    .filter((depSeq, depActor) => depSeq > allDeps.get(depActor, 0))
    .set(actor, seq)

  opSet = opSet
    .setIn(['states', actor], prior.push(Map({allDeps, change})))
    .set('deps', remainingDeps)
    .setIn(['clock', actor], seq)
    .update('maxOp', maxOp => Math.max(maxOp, startOp + change.get('ops').size - 1))
    .update('history', history => history.push(change))
  return opSet
}

function applyQueuedOps(opSet, patch) {
  let queue = List()
  while (true) {
    for (let change of opSet.get('queue')) {
      if (causallyReady(opSet, change)) {
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

function pushUndoHistory(opSet) {
  const undoPos = opSet.get('undoPos')
  return opSet
    .update('undoStack', stack => {
      return stack
        .slice(0, undoPos)
        .push(opSet.get('undoLocal'))
    })
    .set('undoPos', undoPos + 1)
    .set('redoStack', List())
    .remove('undoLocal')
}

function init() {
  return Map()
    .set('states',   Map())
    .set('history',  List())
    .set('byObject', Map().set(ROOT_ID, Map().set('_keys', Map())))
    .set('clock',    Map())
    .set('deps',     Map())
    .set('maxOp',     0)
    .set('undoPos',   0)
    .set('undoStack', List())
    .set('redoStack', List())
    .set('queue',    List())
}

/**
 * Adds `change` to `opSet` without any modification or undo history creation
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
 * is given as an Immutable.js Map object. If `isUndoable` is true, an undo
 * history entry is created. `patch` is mutated to describe the change (in the
 * format used by patches).
 */
function addLocalChange(opSet, change, isUndoable, patch) {
  if (isUndoable) {
    opSet = opSet.set('undoLocal', List()) // setting the undoLocal key enables undo history capture
    opSet = applyChange(opSet, change, patch)
    opSet = pushUndoHistory(opSet)
  } else {
    opSet = applyChange(opSet, change, patch)
  }
  return opSet
}

function getMissingChanges(opSet, haveDeps) {
  if (haveDeps.isEmpty()) return opSet.get('history')

  const allDeps = transitiveDeps(opSet, haveDeps)
  return opSet.get('states')
    .map((states, actor) => states.skip(allDeps.get(actor, 0)))
    .valueSeq()
    .flatten(1)
    .map(state => state.get('change'))
}

function getChangesForActor(opSet, forActor, afterSeq) {
  afterSeq = afterSeq || 0

  return opSet.get('states')
    .filter((states, actor) => actor === forActor)
    .map((states, actor) => states.skip(afterSeq))
    .valueSeq()
    .flatten(1)
    .map(state => state.get('change'))
}

function getMissingDeps(opSet) {
  let missing = {}
  for (let change of opSet.get('queue')) {
    const deps = change.get('deps').set(change.get('actor'), change.get('seq') - 1)
    deps.forEach((depSeq, depActor) => {
      if (opSet.getIn(['clock', depActor], 0) < depSeq) {
        missing[depActor] = Math.max(depSeq, missing[depActor] || 0)
      }
    })
  }
  return missing
}

function getFieldOps(opSet, objectId, key) {
  return opSet.getIn(['byObject', objectId, '_keys', key], List())
}

function getParent(opSet, objectId, key) {
  if (key === '_head') return
  const insertion = opSet.getIn(['byObject', objectId, '_insertion', key])
  if (!insertion) throw new TypeError(`Missing index entry for list element ${key}`)
  return insertion.get('key')
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
      patch.edits.push({action: 'insert', index})
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
  init, addChange, addLocalChange, getMissingChanges, getChangesForActor, getMissingDeps,
  constructObject, getFieldOps, getOperationKey, finalizePatch, ROOT_ID
}
