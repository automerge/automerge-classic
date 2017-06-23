const { Map, List, Set } = require('immutable')

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

// Returns true if all changesets that causally precede the given changeset
// have already been applied in `opSet`.
function causallyReady(opSet, changeset) {
  const actor = changeset.get('actor'), seq = changeset.get('seq')
  let satisfied = true
  changeset.get('deps').set(actor, seq - 1).forEach((depSeq, depActor) => {
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

// Updates the various indexes that we need in order to search for operations
function applyOp(opSet, op) {
  const objectId = op.get('obj')
  switch (op.get('action')) {
    case 'makeMap':
    case 'makeList':
      if (opSet.hasIn(['byObject', objectId])) throw 'Duplicate creation of object ' + objectId
      return opSet.setIn(['byObject', objectId], Map().set('_init', op).set('_inbound', Set()))

    case 'ins':
      const elem = op.get('elem'), elemId = op.get('actor') + ':' + elem
      if (!opSet.get('byObject').has(objectId)) throw 'Modification of unknown object ' + objectId
      if (opSet.hasIn(['byObject', objectId, '_insertion', elemId])) throw 'Duplicate list element ID ' + elemId

      return opSet
        .updateIn(['byObject', objectId, '_following', op.get('key')], List(), list => list.push(op))
        .updateIn(['byObject', objectId, '_maxElem'], 0, maxElem => Math.max(elem, maxElem))
        .setIn(['byObject', objectId, '_insertion', elemId], op)

    case 'set':
    case 'del':
    case 'link':
      if (!opSet.get('byObject').has(objectId)) throw 'Modification of unknown object ' + objectId
      const priorOpsConcurrent = opSet
        .getIn(['byObject', objectId, op.get('key')], List())
        .groupBy(other => !!isConcurrent(opSet, other, op))
      let overwritten = priorOpsConcurrent.get(false, List())
      let remaining   = priorOpsConcurrent.get(true,  List())

      // If any links were overwritten, remove them from the index of inbound links
      overwritten.filter(op => op.get('action') === 'link')
        .forEach(op => {
          opSet = opSet.updateIn(['byObject', op.get('value'), '_inbound'], ops => ops.remove(op))
        })

      if (op.get('action') === 'link') {
        opSet = opSet.updateIn(['byObject', op.get('value'), '_inbound'], Set(), ops => ops.add(op))
      }
      if (op.get('action') !== 'del') {
        remaining = remaining.push(op)
      }
      remaining = remaining.sortBy(op => op.get('actor')).reverse()
      return opSet.setIn(['byObject', objectId, op.get('key')], remaining)

    default:
      throw 'Unknown operation type ' + obj.get('action')
  }
}

function applyChangeset(opSet, changeset) {
  const actor = changeset.get('actor'), seq = changeset.get('seq')
  const prior = opSet.getIn(['states', actor], List())
  if (seq <= prior.size) {
    if (!prior.get(seq - 1).get('changeset').equals(changeset)) {
      throw 'Inconsistent reuse of sequence number ' + seq + ' by ' + actor
    }
    return opSet // changeset already applied, return unchanged
  }

  const allDeps = transitiveDeps(opSet, changeset.get('deps').set(actor, seq - 1))
  let state = Map({changeset, allDeps})
  opSet = opSet.setIn(['states', actor], prior.push(state))

  changeset.get('ops').forEach(op => {
    opSet = applyOp(opSet, op.merge({actor, seq}))
  })
  state = state.set('byObject', opSet.get('byObject'))

  let linkedObjs = changeset.get('ops').map(op => op.get('obj')).toSet()
  let affectedObjs = Set()
  while (!linkedObjs.isEmpty()) {
    affectedObjs = affectedObjs.union(linkedObjs)
    linkedObjs = linkedObjs
      .flatMap(obj => opSet.getIn(['byObject', obj, '_inbound'], Set()).map(op => op.get('obj')))
      .toSet()
      .subtract(affectedObjs)
  }

  // According to the Immutable.js docs, Map.removeAll() ought to do this, but it doesn't exist?
  let cache = opSet.get('cache')
  affectedObjs.forEach(obj => { cache = cache.remove(obj) })

  const remainingDeps = opSet.get('deps')
    .filter((depSeq, depActor) => depSeq > allDeps.get(depActor, 0))
    .set(actor, seq)

  return opSet
    .set('cache', cache)
    .set('deps', remainingDeps)
    .setIn(['clock', actor], seq)
    .setIn(['states', actor, seq - 1], state)
    .update('history', history => history.push(state))
}

function applyQueuedOps(opSet) {
  let queue = List()
  while (true) {
    opSet.get('queue').forEach(changeset => {
      if (causallyReady(opSet, changeset)) {
        opSet = applyChangeset(opSet, changeset)
      } else {
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
  return Map()
    .set('states',   Map())
    .set('history',  List())
    .set('byObject', Map().set(root_id, Map()))
    .set('cache',    Map())
    .set('clock',    Map())
    .set('deps',     Map())
    .set('local',    List())
    .set('queue',    List())
}

function addLocalOp(opSet, op, actor) {
  opSet = opSet.update('local', ops => ops.push(op))
  return applyOp(opSet, op.set('actor', actor))
}

function addChangeset(opSet, changeset) {
  return applyQueuedOps(opSet.update('queue', queue => queue.push(changeset)))
}

function getMissingChanges(opSet, haveDeps) {
  const allDeps = transitiveDeps(opSet, haveDeps)
  return opSet.get('states')
    .map((states, actor) => states.skip(allDeps.get(actor, 0)))
    .valueSeq()
    .flatten(1)
    .map(state => state.get('changeset'))
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

function insertionsAfter(opSet, objectId, key) {
  return opSet
    .getIn(['byObject', objectId, '_following', key], List())
    .filter(op => (op.get('action') === 'ins'))
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
    const siblings = insertionsAfter(opSet, objectId, ancestor).filter(sib => sib < key)
    if (!siblings.isEmpty()) return siblings.first()
    key = ancestor
  }
}

module.exports = {
  init, addLocalOp, addChangeset, getMissingChanges, getFieldOps, getNext
}
