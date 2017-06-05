const { Map, List, fromJS } = require('immutable')

// Returns true if the two operations are concurrent, that is, they happened without being aware of
// each other (neither happened before the other). Returns false if one supersedes the other.
function isConcurrent(op1, op2) {
  const [clock1, clock2] = [op1.get('clock'), op2.get('clock')]
  let oneFirst = false, twoFirst = false
  clock1.keySeq().concat(clock2.keySeq()).forEach(key => {
    if (clock1.get(key, 0) < clock2.get(key, 0)) oneFirst = true
    if (clock2.get(key, 0) < clock1.get(key, 0)) twoFirst = true
  })
  return oneFirst && twoFirst
}

// Returns true if all operations that causally precede `op` have already been applied in `opSet`.
function causallyReady(opSet, op) {
  const origin = op.get('actor'), seq = op.getIn(['clock', origin])
  if (typeof seq !== 'number' || seq <= 0) throw 'Invalid sequence number'

  return op.get('clock')
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

// Returns true if the op has already been applied to the opSet.
function isRedundant(opSet, op) {
  const seq = op.getIn(['clock', op.get('actor')])
  const ops = opSet.getIn(['byActor', op.get('actor')], List())
  if (typeof seq !== 'number' || seq <= 0) throw 'Invalid sequence number'
  if (seq > ops.size) return false
  if (!ops.get(seq - 1).equals(op)) throw 'Inconsistent reuse of sequence number'
  return true
}

function applyOp(opSet, op) {
  const actor = op.get('actor'), obj = op.get('obj'), action = op.get('action')
  opSet = opSet.setIn(['byActor', actor], opSet.getIn(['byActor', actor], List()).push(op))

  // Index maintenance
  if (action === 'makeMap' || action == 'makeList') {
    if (opSet.hasIn(['byObject', obj])) throw 'Duplicate creation of object ' + obj
    opSet = opSet.setIn(['byObject', obj], Map().set('_init', op))
  } else {
    if (!opSet.get('byObject').has(obj)) throw 'Modification of unknown object ' + obj
    const keyOps = opSet.getIn(['byObject', obj, op.get('key')], List())
    opSet = opSet.setIn(['byObject', obj, op.get('key')], keyOps.push(op))

    if (action === 'ins') {
      const next = op.get('next')
      if (opSet.hasIn(['byObject', obj, '_insertion', next])) throw 'Duplicate list element ID ' + next
      opSet = opSet.setIn(['byObject', obj, '_insertion', next], op)

      const [name, newCount] = parseLamport(next)
      const oldCount = opSet.getIn(['byObject', obj, '_counter'], 0)
      if (newCount && newCount > oldCount) {
        opSet = opSet.setIn(['byObject', obj, '_counter'], newCount)
      }
    }
  }
  return opSet
}

function applyQueuedOps(opSet) {
  let queue = List()
  while (true) {
    opSet.get('queue').forEach(op => {
      if (causallyReady(opSet, op)) {
        opSet = applyOp(opSet, op)
      } else if (!isRedundant(opSet, op)) {
        queue = queue.push(op)
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
    queue:    []
  })
}

function add(opSet, op) {
  return applyQueuedOps(opSet.set('queue', opSet.get('queue').push(op)))
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

function parseLamport(stamp) {
  const [, name, count] = /^(.*):(\d+)$/.exec(stamp) || []
  if (count) return [name, parseInt(count)]
}

function lamportLessThan(stamp1, stamp2) {
  const [name1, count1] = parseLamport(stamp1)
  const [name2, count2] = parseLamport(stamp2)
  return (count1 < count2) || (count1 === count2 && name1 < name2)
}

function insertionsAfter(opSet, obj, key) {
  return opSet
    .getIn(['byObject', obj, key], List())
    .filter(op => (op.get('action') === 'ins'))
    .map(op => op.get('next'))
    .sort((a, b) => lamportLessThan(a, b) ? 1 : -1) // descending order
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
  init, add, getVClock, getFieldOps, getNext
}
