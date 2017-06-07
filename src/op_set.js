const { Map, List, fromJS } = require('immutable')

// Returns true if the two operations are concurrent, that is, they happened without being aware of
// each other (neither happened before the other). Returns false if one supersedes the other.
function isConcurrent(op1, op2) {
  const [clock1, clock2] = [op1.get('clock'), op2.get('clock')]
  if (!clock1 || !clock2) return false
  let oneFirst = false, twoFirst = false
  clock1.keySeq().concat(clock2.keySeq()).forEach(key => {
    if (clock1.get(key, 0) < clock2.get(key, 0)) oneFirst = true
    if (clock2.get(key, 0) < clock1.get(key, 0)) twoFirst = true
  })
  return oneFirst && twoFirst
}

// Returns true if all changesets that causally precede the given changeset
// have already been applied in `opSet`.
function causallyReady(opSet, changeset) {
  const origin = changeset.get('actor'), seq = changeset.getIn(['clock', origin])
  if (typeof seq !== 'number' || seq <= 0) throw 'Invalid sequence number'

  return changeset.get('clock')
    .filterNot((seq, actor) => {
      const applied = opSet.getIn(['byActor', actor], List()).size
      if (actor === origin) {
        return seq === applied + 1
      } else {
        return seq <= applied
      }
    })
    .isEmpty()
}

// Returns true if the changeset has already been applied to the opSet.
function isRedundant(opSet, changeset) {
  const seq = changeset.getIn(['clock', changeset.get('actor')])
  const ops = opSet.getIn(['byActor', changeset.get('actor')], List())
  if (typeof seq !== 'number' || seq <= 0) throw 'Invalid sequence number'
  if (seq > ops.size) return false
  if (!ops.get(seq - 1).equals(changeset)) throw 'Inconsistent reuse of sequence number'
  return true
}

// Updates the various indexes that we need in order to search for operations
function applyOp(opSet, op) {
  const obj = op.get('obj'), action = op.get('action')
  if (action === 'makeMap' || action == 'makeList') {
    if (opSet.hasIn(['byObject', obj])) throw 'Duplicate creation of object ' + obj
    opSet = opSet.setIn(['byObject', obj], Map().set('_init', op))
  } else {
    if (!opSet.get('byObject').has(obj)) throw 'Modification of unknown object ' + obj
    const keyOps = opSet.getIn(['byObject', obj, op.get('key')], List())
    opSet = opSet.setIn(['byObject', obj, op.get('key')], keyOps.push(op))

    if (action === 'ins') {
      const counter = op.get('counter'), elemId = op.get('actor') + ':' + counter
      if (opSet.hasIn(['byObject', obj, '_insertion', elemId])) throw 'Duplicate list element ID ' + elemId
      opSet = opSet.setIn(['byObject', obj, '_insertion', elemId], op)

      const oldCounter = opSet.getIn(['byObject', obj, '_counter'], 0)
      if (counter && counter > oldCounter) {
        opSet = opSet.setIn(['byObject', obj, '_counter'], counter)
      }
    }
  }
  return opSet
}

function applyChangeset(opSet, changeset) {
  const actor = changeset.get('actor'), clock = changeset.get('clock')
  opSet = opSet.setIn(['byActor', actor], opSet.getIn(['byActor', actor], List()).push(changeset))
  changeset.get('ops').forEach(op => { opSet = applyOp(opSet, op.merge({actor, clock})) })
  return opSet
}

function applyQueuedOps(opSet) {
  let queue = List()
  while (true) {
    opSet.get('queue').forEach(changeset => {
      if (causallyReady(opSet, changeset)) {
        opSet = applyChangeset(opSet, changeset)
      } else if (!isRedundant(opSet, changeset)) {
        queue = queue.push(changeset)
      }
    })

    if (queue.count() === opSet.get('queue').count()) return opSet
    opSet = opSet.set('queue', queue)
    queue = List()
  }
}

const root_id = '00000000-0000-0000-0000-000000000000'

function init() {
  return fromJS({
    byActor:  {},
    byObject: { [root_id]: {} },
    local:    [],
    queue:    []
  })
}

function addLocalOp(opSet, op, actor) {
  opSet = opSet.set('local', opSet.get('local').push(op))
  return applyOp(opSet, op.set('actor', actor))
}

function addChangeset(opSet, changeset) {
  opSet = opSet.set('queue', opSet.get('queue').push(changeset))
  return applyQueuedOps(opSet)
}

function getVClock(opSet) {
  return opSet
    .get('byActor')
    .mapEntries(([actor, ops]) => [actor, ops.size])
}

function getFieldOps(opSet, obj, key) {
  let ops = opSet
    .getIn(['byObject', obj, key], List())
    .filter(op => (op.get('action') === 'set' || op.get('action') === 'link' || op.get('action') == 'del'))
  let values = List()

  while (!ops.isEmpty()) {
    const lastOp = ops.last()
    if (lastOp.get('action') !== 'del') values = values.push(lastOp)
    ops = ops.butLast().filter(op => isConcurrent(op, lastOp))
  }
  return values.sortBy(op => op.get('actor')).reverse()
}

function getParent(opSet, obj, key) {
  if (key === '_head') return
  const insertion = opSet.getIn(['byObject', obj, '_insertion', key])
  if (!insertion) throw new TypeError('Missing index entry for list element ' + key)
  return insertion.get('key')
}

function lamportCompare(op1, op2) {
  if (op1.get('counter') < op2.get('counter')) return -1
  if (op1.get('counter') > op2.get('counter')) return  1
  if (op1.get('actor'  ) < op2.get('actor'  )) return -1
  if (op1.get('actor'  ) > op2.get('actor'  )) return  1
  return 0
}

function insertionsAfter(opSet, obj, key) {
  return opSet
    .getIn(['byObject', obj, key], List())
    .filter(op => (op.get('action') === 'ins'))
    .sort(lamportCompare)
    .reverse() // descending order
    .map(op => op.get('actor') + ':' + op.get('counter'))
}

function getNext(opSet, obj, key) {
  const children = insertionsAfter(opSet, obj, key)
  if (!children.isEmpty()) return children.first()

  let ancestor
  while (true) {
    ancestor = getParent(opSet, obj, key)
    if (!ancestor) return
    const siblings = insertionsAfter(opSet, obj, ancestor).filter(sib => sib < key)
    if (!siblings.isEmpty()) return siblings.first()
    key = ancestor
  }
}

module.exports = {
  init, addLocalOp, addChangeset, getVClock, getFieldOps, getNext
}
