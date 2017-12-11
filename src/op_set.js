const { Map, List, Set } = require('immutable')
const { SkipList } = require('./skip_list')
const ROOT_ID = '00000000-0000-0000-0000-000000000000'

// Returns true if the two operations are concurrent, that is, they happened without being aware of
// each other (neither happened before the other). Returns false if one supersedes the other.
function isConcurrent(opSet, op1, op2) {
  const [actor1, seq1] = [op1.get('actor'), op1.get('seq')]
  const [actor2, seq2] = [op2.get('actor'), op2.get('seq')]
  if (!actor1 || !actor2 || !seq1 || !seq2) return false

  const clock1 = opSet.getIn(['states', actor1, seq1 - 1, 'allDeps'])
  const clock2 = opSet.getIn(['states', actor2, seq2 - 1, 'allDeps'])

  return clock1.get(actor2, 0) < seq2 && clock2.get(actor1, 0) < seq1
}

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

// Processes a 'makeMap', 'makeList', or 'makeText' operation
function applyMake(opSet, op) {
  const objectId = op.get('obj')
  if (opSet.hasIn(['byObject', objectId])) throw 'Duplicate creation of object ' + objectId

  let edit = {action: 'create', obj: objectId}
  let object = Map({_init: op, _inbound: Set()})
  if (op.get('action') === 'makeMap') {
    edit.type = 'map'
  } else {
    edit.type = (op.get('action') === 'makeText') ? 'text' : 'list'
    object = object.set('_elemIds', new SkipList())
  }

  opSet = opSet.setIn(['byObject', objectId], object)
  return [opSet, [edit]]
}

// Processes an 'ins' operation. Does not produce any diffs since the insertion alone
// produces no application-visible effect; the list element only becomes visible through
// a subsequent 'set' or 'link' operation on the inserted element.
function applyInsert(opSet, op) {
  const objectId = op.get('obj'), elem = op.get('elem'), elemId = op.get('actor') + ':' + elem
  if (!opSet.get('byObject').has(objectId)) throw 'Modification of unknown object ' + objectId
  if (opSet.hasIn(['byObject', objectId, '_insertion', elemId])) throw 'Duplicate list element ID ' + elemId

  opSet = opSet
    .updateIn(['byObject', objectId, '_following', op.get('key')], List(), list => list.push(op))
    .updateIn(['byObject', objectId, '_maxElem'], 0, maxElem => Math.max(elem, maxElem))
    .setIn(['byObject', objectId, '_insertion', elemId], op)
  return [opSet, []]
}

function patchList(opSet, objectId, index, action, op) {
  const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])
  let elemIds = opSet.getIn(['byObject', objectId, '_elemIds'])
  let value = op ? op.get('value') : null
  let edit = {action, type: (objType === 'makeText') ? 'text' : 'list', obj: objectId, index}
  if (op && op.get('action') === 'link') {
    edit.link = true
    value = {obj: op.get('value')}
  }

  if (action === 'insert') {
    elemIds = elemIds.insertIndex(index, op.get('key'), value)
    edit.value = op.get('value')
  } else if (action === 'set') {
    elemIds = elemIds.setValue(op.get('key'), value)
    edit.value = op.get('value')
  } else if (action === 'remove') {
    elemIds = elemIds.removeIndex(index)
  } else throw 'Unknown action type: ' + action

  opSet = opSet.setIn(['byObject', objectId, '_elemIds'], elemIds)
  return [opSet, [edit]]
}

function updateListElement(opSet, objectId, elemId) {
  const ops = getFieldOps(opSet, objectId, elemId)
  const elemIds = opSet.getIn(['byObject', objectId, '_elemIds'])
  let index = elemIds.indexOf(elemId)

  if (index >= 0) {
    if (ops.isEmpty()) {
      return patchList(opSet, objectId, index, 'remove', null)
    } else {
      return patchList(opSet, objectId, index, 'set', ops.first())
    }

  } else {
    if (ops.isEmpty()) return [opSet, []] // deleting a non-existent element = no-op

    // find the index of the closest preceding list element
    let prevId = elemId
    while (true) {
      index = -1
      prevId = getPrevious(opSet, objectId, prevId)
      if (!prevId) break
      index = elemIds.indexOf(prevId)
      if (index >= 0) break
    }

    return patchList(opSet, objectId, index + 1, 'insert', ops.first())
  }
}

function updateMapKey(opSet, objectId, key) {
  const ops = getFieldOps(opSet, objectId, key)
  let edit = {action: '', type: 'map', obj: objectId, key}

  if (ops.isEmpty()) {
    edit.action = 'remove'
  } else {
    edit.action = 'set'
    edit.value = ops.first().get('value')
    if (ops.first().get('action') === 'link') {
      edit.link = true
    }

    if (ops.size > 1) {
      edit.conflicts = []
      for (let op of ops.shift()) {
        let conflict = {actor: op.get('actor'), value: op.get('value')}
        if (op.get('action') === 'link') conflict.link = true
        edit.conflicts.push(conflict)
      }
    }
  }
  return [opSet, [edit]]
}

// Processes a 'set', 'del', or 'link' operation
function applyAssign(opSet, op) {
  const objectId = op.get('obj')
  const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])
  if (!opSet.get('byObject').has(objectId)) throw 'Modification of unknown object ' + objectId

  const priorOpsConcurrent = opSet
    .getIn(['byObject', objectId, op.get('key')], List())
    .groupBy(other => !!isConcurrent(opSet, other, op))
  let overwritten = priorOpsConcurrent.get(false, List())
  let remaining   = priorOpsConcurrent.get(true,  List())

  // If any links were overwritten, remove them from the index of inbound links
  for (let op of overwritten.filter(op => op.get('action') === 'link')) {
    opSet = opSet.updateIn(['byObject', op.get('value'), '_inbound'], ops => ops.remove(op))
  }

  if (op.get('action') === 'link') {
    opSet = opSet.updateIn(['byObject', op.get('value'), '_inbound'], Set(), ops => ops.add(op))
  }
  if (op.get('action') !== 'del') {
    remaining = remaining.push(op)
  }
  remaining = remaining.sortBy(op => op.get('actor')).reverse()
  opSet = opSet.setIn(['byObject', objectId, op.get('key')], remaining)

  if (objType === 'makeList' || objType === 'makeText') {
    return updateListElement(opSet, objectId, op.get('key'))
  } else {
    return updateMapKey(opSet, objectId, op.get('key'))
  }
}

function applyOp(opSet, op) {
  const action = op.get('action')
  if (action === 'makeMap' || action === 'makeList' || action === 'makeText') {
    return applyMake(opSet, op)
  } else if (action === 'ins') {
    return applyInsert(opSet, op)
  } else if (action === 'set' || action === 'del' || action === 'link') {
    return applyAssign(opSet, op)
  } else {
    throw 'Unknown operation type ' + action
  }
}

function applyChange(opSet, change) {
  const actor = change.get('actor'), seq = change.get('seq')
  const prior = opSet.getIn(['states', actor], List())
  if (seq <= prior.size) {
    if (!prior.get(seq - 1).get('change').equals(change)) {
      throw 'Inconsistent reuse of sequence number ' + seq + ' by ' + actor
    }
    return [opSet, []] // change already applied, return unchanged
  }

  const allDeps = transitiveDeps(opSet, change.get('deps').set(actor, seq - 1))
  opSet = opSet.setIn(['states', actor], prior.push(Map({change, allDeps})))

  let diff, diffs = []
  for (let op of change.get('ops')) {
    [opSet, diff] = applyOp(opSet, op.merge({actor, seq}))
    diffs.push(...diff)
  }

  const remainingDeps = opSet.get('deps')
    .filter((depSeq, depActor) => depSeq > allDeps.get(depActor, 0))
    .set(actor, seq)

  opSet = opSet
    .set('deps', remainingDeps)
    .setIn(['clock', actor], seq)
    .update('history', history => history.push(change))
  return [opSet, diffs]
}

function applyQueuedOps(opSet) {
  let queue = List(), diff, diffs = []
  while (true) {
    for (let change of opSet.get('queue')) {
      if (causallyReady(opSet, change)) {
        [opSet, diff] = applyChange(opSet, change)
        diffs.push(...diff)
      } else {
        queue = queue.push(change)
      }
    }

    if (queue.count() === opSet.get('queue').count()) return [opSet, diffs]
    opSet = opSet.set('queue', queue)
    queue = List()
  }
}

function init() {
  return Map()
    .set('states',   Map())
    .set('history',  List())
    .set('byObject', Map().set(ROOT_ID, Map()))
    .set('clock',    Map())
    .set('deps',     Map())
    .set('local',    List())
    .set('queue',    List())
}

function addLocalOp(opSet, op, actor) {
  const objectId = op.get('obj'), action = op.get('action'), key = op.get('key')
  let ops = opSet.get('local')

  // Override any prior assignment operations for the same object and key
  if (action === 'set' || action === 'del' || action === 'link') {
    ops = ops.filter(prev => prev.get('obj') != objectId || prev.get('key') != key)
  }
  ops = ops.push(op)
  return applyOp(opSet.set('local', ops), op.set('actor', actor))
}

function addChange(opSet, change) {
  opSet = opSet.update('queue', queue => queue.push(change))
  return applyQueuedOps(opSet)
}

function getMissingChanges(opSet, haveDeps) {
  const allDeps = transitiveDeps(opSet, haveDeps)
  return opSet.get('states')
    .map((states, actor) => states.skip(allDeps.get(actor, 0)))
    .valueSeq()
    .flatten(1)
    .map(state => state.get('change'))
}

function getFieldOps(opSet, objectId, key) {
  return opSet.getIn(['byObject', objectId, key], List())
}

function getParent(opSet, objectId, key) {
  if (key === '_head') return
  const insertion = opSet.getIn(['byObject', objectId, '_insertion', key])
  if (!insertion) throw new TypeError('Missing index entry for list element ' + key)
  return insertion.get('key')
}

function lamportCompare(op1, op2) {
  if (op1.get('elem' ) < op2.get('elem' )) return -1
  if (op1.get('elem' ) > op2.get('elem' )) return  1
  if (op1.get('actor') < op2.get('actor')) return -1
  if (op1.get('actor') > op2.get('actor')) return  1
  return 0
}

function insertionsAfter(opSet, objectId, parentId, childId) {
  const match = /^(.*):(\d+)$/.exec(childId || '')
  const childKey = match ? Map({actor: match[1], elem: parseInt(match[2])}) : null

  return opSet
    .getIn(['byObject', objectId, '_following', parentId], List())
    .filter(op => (op.get('action') === 'ins'))
    .filter(op => !childKey || lamportCompare(op, childKey) < 0)
    .sort(lamportCompare)
    .reverse() // descending order
    .map(op => op.get('actor') + ':' + op.get('elem'))
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

function getOpValue(opSet, op, context) {
  if (typeof op !== 'object' || op === null) return op
  switch (op.get('action')) {
    case 'set':  return op.get('value')
    case 'link': return context.instantiateObject(opSet, op.get('value'))
  }
}

function validFieldName(key) {
  return (typeof key === 'string' && key !== '' && !key.startsWith('_'))
}

function isFieldPresent(opSet, objectId, key) {
  return validFieldName(key) && !getFieldOps(opSet, objectId, key).isEmpty()
}

function getObjectFields(opSet, objectId) {
  return opSet.getIn(['byObject', objectId])
    .keySeq()
    .filter(key => isFieldPresent(opSet, objectId, key))
    .toSet()
    .add('_objectId')
}

function getObjectField(opSet, objectId, key, context) {
  if (key === '_objectId') return objectId
  if (!validFieldName(key)) return undefined
  const ops = getFieldOps(opSet, objectId, key)
  if (!ops.isEmpty()) return getOpValue(opSet, ops.first(), context)
}

function getObjectConflicts(opSet, objectId, context) {
  return opSet.getIn(['byObject', objectId])
    .filter((field, key) => validFieldName(key) && getFieldOps(opSet, objectId, key).size > 1)
    .mapEntries(([key, field]) => [key, field.shift().toMap()
      .mapEntries(([idx, op]) => [op.get('actor'), getOpValue(opSet, op, context)])
    ])
}

function listElemByIndex(opSet, objectId, index, context) {
  const elemId = opSet.getIn(['byObject', objectId, '_elemIds']).keyOf(index)
  if (elemId) {
    const ops = getFieldOps(opSet, objectId, elemId)
    if (!ops.isEmpty()) return getOpValue(opSet, ops.first(), context)
  }
}

function listLength(opSet, objectId) {
  return opSet.getIn(['byObject', objectId, '_elemIds']).length
}

function listIterator(opSet, listId, mode, context) {
  let elem = '_head', index = -1
  const next = () => {
    while (elem) {
      elem = getNext(opSet, listId, elem)
      if (!elem) return {done: true}

      const ops = getFieldOps(opSet, listId, elem)
      if (!ops.isEmpty()) {
        const value = getOpValue(opSet, ops.first(), context)
        index += 1
        switch (mode) {
          case 'keys':    return {done: false, value: index}
          case 'values':  return {done: false, value: value}
          case 'entries': return {done: false, value: [index, value]}
          case 'elems':   return {done: false, value: [index, elem]}
        }
      }
    }
  }

  const iterator = {next}
  iterator[Symbol.iterator] = () => { return iterator }
  return iterator
}

module.exports = {
  init, addLocalOp, addChange, getMissingChanges,
  getObjectFields, getObjectField, getObjectConflicts,
  listElemByIndex, listLength, listIterator, ROOT_ID
}
