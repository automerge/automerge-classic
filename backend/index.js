const { Map, List, fromJS } = require('immutable')
const { isObject, copyObject, lessOrEqual, parseElemId } = require('../src/common')
const OpSet = require('./op_set')
const { SkipList } = require('./skip_list')

/**
 * Filters a list of operations `ops` such that, if there are multiple assignment
 * operations for the same object and key, we keep only the most recent. Returns
 * the filtered list of operations.
 */
function ensureSingleAssignment(ops) {
  let assignments = {}, result = []

  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i], { obj, key, action } = op
    if (['set', 'del', 'link', 'inc'].includes(action)) {
      if (!assignments[obj]) {
        assignments[obj] = {[key]: op}
        result.push(op)
      } else if (!assignments[obj][key]) {
        assignments[obj][key] = op
        result.push(op)
      } else if (assignments[obj][key].action === 'inc' && ['set', 'inc'].includes(action)) {
        assignments[obj][key].action = action
        assignments[obj][key].value += op.value
        if (op.datatype) assignments[obj][key].datatype = op.datatype
      }
    } else {
      result.push(op)
    }
  }
  return result.reverse()
}

/**
 * Processes a change request `request` that is incoming from the frontend. Translates index-based
 * addressing of lists into identifier-based addressing used by the CRDT.
 */
function processChangeRequest(state, request) {
  const { actor, seq, deps } = request
  const change = { actor, seq, deps }, ops = []
  if (request.message) change.message = request.message

  // Check whether the incoming request was made in a frontend whose state matches the current
  // backend state. If the backend has applied a change that the frontend had not yet seen at the
  // time it generated the request, throw an exception. (That additional change seen by the backend
  // would have to be a remote change, since only the frontend can generate local changes.) It is
  // impossible for the frontend to have seen a change that the backend has not seen.
  state.getIn(['opSet', 'deps']).forEach((depSeq, depActor) => {
    if (depActor === actor && depSeq !== seq - 1) {
      throw new RangeError(`Bad dependency for own actor ${actor}: ${depSeq} != ${seq - 1}`)
    }
    if (depActor !== actor && depSeq > (deps[depActor] || 0)) {
      throw new RangeError('Backend is ahead of frontend')
    }
  })

  let objectTypes = {}, elemIds = {}, maxElem = {}
  for (let op of request.ops) {
    if (op.action.startsWith('make')) {
      objectTypes[op.child] = op.action
    }

    const objType = objectTypes[op.obj] || state.getIn(['opSet', 'byObject', op.obj, '_init', 'action'])
    if (objType === 'makeList' || objType === 'makeText') {
      if (!elemIds[op.obj]) {
        elemIds[op.obj] = state.getIn(['opSet', 'byObject', op.obj, '_elemIds']) || new SkipList()
        maxElem[op.obj] = state.getIn(['opSet', 'byObject', op.obj, '_maxElem'], 0)
      }

      if (typeof op.key !== 'number') {
        throw new TypeError(`Unexpected operation key: ${op.key}`)
      }
      op = copyObject(op)

      if (op.action === 'ins') {
        maxElem[op.obj] += 1
        op.elem = maxElem[op.obj]
        const elemId = `${actor}:${maxElem[op.obj]}`

        if (op.key === 0) {
          op.key = '_head'
          elemIds[op.obj] = elemIds[op.obj].insertAfter(null, elemId)
        } else {
          op.key = elemIds[op.obj].keyOf(op.key - 1)
          elemIds[op.obj] = elemIds[op.obj].insertAfter(op.key, elemId)
        }
      } else {
        op.key = elemIds[op.obj].keyOf(op.key)
        if (op.action === 'del') {
          elemIds[op.obj] = elemIds[op.obj].removeKey(op.key)
        }
      }
    }

    ops.push(op)
  }

  change.ops = ensureSingleAssignment(ops)
  return apply(state, [change], request, true, true)
}

/**
 * Returns an empty node state.
 */
function init() {
  return Map({opSet: OpSet.init(), versions: List.of(Map({version: 0, deps: Map()}))})
}

/**
 * Constructs a patch object from the current node state `state` and the list
 * of object modifications `diffs`.
 */
function makePatch(state, diffs, request, isIncremental) {
  const canUndo = state.getIn(['opSet', 'undoPos']) > 0
  const canRedo = !state.getIn(['opSet', 'redoStack']).isEmpty()

  if (isIncremental) {
    let version
    if (state.get('versions').size > 0) {
      version = state.get('versions').last().get('version') + 1
    } else {
      version = 1
    }

    const versionObj = Map({version, deps: state.getIn(['opSet', 'deps'])})
    state = state.update('versions', versions => versions.push(versionObj))

    const patch = {version, canUndo, canRedo}
    if (patch && request) {
      patch.actor = request.actor
      patch.seq   = request.seq
    }
    patch.diffs = diffs
    return [state, patch]

  } else {
    const clock = state.getIn(['opSet', 'clock']).toJS()
    return [state, {version: 0, clock, canUndo, canRedo, diffs}]
  }
}

/**
 * The implementation behind `applyChanges()` and `applyLocalChange()`.
 */
function apply(state, changes, request, isLocal, isIncremental) {
  let diffs = isIncremental ? {} : null
  let opSet = state.get('opSet')
  for (let change of fromJS(changes)) {
    change = change.remove('requestType')
    opSet = OpSet.addChange(opSet, change, isLocal, diffs)
  }

  OpSet.finalizePatch(opSet, diffs)
  state = state.set('opSet', opSet)
  return isIncremental ? makePatch(state, diffs, request, true) : [state, null]
}

/**
 * Applies a list of `changes` from remote nodes to the node state `state`.
 * Returns a two-element array `[state, patch]` where `state` is the updated
 * node state, and `patch` describes the modifications that need to be made
 * to the document objects to reflect these changes.
 */
function applyChanges(state, changes) {
  return apply(state, changes, null, false, true)
}

/**
 * Takes a single change request `request` made by the local user, and applies
 * it to the node state `state`. The difference to `applyChanges()` is that this
 * function adds the change to the undo history, so it can be undone (whereas
 * remote changes are not normally added to the undo history). Returns a
 * two-element array `[state, patch]` where `state` is the updated node state,
 * and `patch` confirms the modifications to the document objects.
 */
function applyLocalChange(state, request) {
  if (typeof request.actor !== 'string' || typeof request.seq !== 'number') {
    throw new TypeError('Change request requries `actor` and `seq` properties')
  }
  // Throw error if we have already applied this change request
  if (request.seq <= state.getIn(['opSet', 'clock', request.actor], 0)) {
    throw new RangeError('Change request has already been applied')
  }

  const versionObj = state.get('versions').find(v => v.get('version') === request.version)
  if (!versionObj) {
    throw new RangeError(`Unknown base document version ${request.version}`)
  }
  const deps = versionObj.get('deps').remove(request.actor).toJS()
  request = Object.assign(request, {deps})
  state = state.update('versions', versions => versions.filter(v => v.get('version') >= request.version))

  if (request.requestType === 'change') {
    return processChangeRequest(state, request)
  } else if (request.requestType === 'undo') {
    return undo(state, request)
  } else if (request.requestType === 'redo') {
    return redo(state, request)
  } else {
    throw new RangeError(`Unknown requestType: ${request.requestType}`)
  }
}

/**
 * Applies a list of `changes` to the node state `state`, and returns the updated
 * state with those changes incorporated. Unlike `applyChanges()`, this function
 * does not produce a patch describing the incremental modifications, making it
 * a little faster when loading a document from disk. When all the changes have
 * been loaded, you can use `getPatch()` to construct the latest document state.
 */
function loadChanges(state, changes) {
  const [newState, patch] = apply(state, changes, null, false, false)
  const versionObj = Map({version: 0, deps: newState.getIn(['opSet', 'deps'])})
  return newState.set('versions', List.of(versionObj))
}

/**
 * Returns a patch that, when applied to an empty document, constructs the
 * document tree in the state described by the node state `state`.
 */
function getPatch(state) {
  const diffs = OpSet.constructObject(state.get('opSet'), OpSet.ROOT_ID)
  const [_, patch] = makePatch(state, diffs, null, false)
  return patch
}

function getChanges(oldState, newState) {
  const oldClock = oldState.getIn(['opSet', 'clock'])
  const newClock = newState.getIn(['opSet', 'clock'])
  if (!lessOrEqual(oldClock, newClock)) {
    throw new RangeError('Cannot diff two states that have diverged')
  }

  return OpSet.getMissingChanges(newState.get('opSet'), oldClock).toJS()
}

function getChangesForActor(state, actorId) {
  // I might want to validate the actorId here
  return OpSet.getChangesForActor(state.get('opSet'), actorId).toJS()
}

function getMissingChanges(state, clock) {
  return OpSet.getMissingChanges(state.get('opSet'), clock).toJS()
}

function getMissingDeps(state) {
  return OpSet.getMissingDeps(state.get('opSet'))
}

/**
 * Takes any changes that appear in `remote` but not in `local`, and applies
 * them to `local`, returning a two-element list `[state, patch]` where `state`
 * is the updated version of `local`, and `patch` describes the modifications
 * that need to be made to the document objects to reflect these changes.
 * Note that this function does not detect if the same sequence number has been
 * reused for different changes in `local` and `remote` respectively.
 */
function merge(local, remote) {
  const changes = OpSet.getMissingChanges(remote.get('opSet'), local.getIn(['opSet', 'clock']))
  return applyChanges(local, changes)
}

/**
 * Undoes the last change by the local user in the node state `state`. The
 * `request` object contains all parts of the change except the operations;
 * this function fetches the operations from the undo stack, pushes a record
 * onto the redo stack, and applies the change, returning a two-element list
 * containing `[state, patch]`.
 */
function undo(state, request) {
  const undoPos = state.getIn(['opSet', 'undoPos'])
  const undoOps = state.getIn(['opSet', 'undoStack', undoPos - 1])
  if (undoPos < 1 || !undoOps) {
    throw new RangeError('Cannot undo: there is nothing to be undone')
  }
  const { actor, seq, deps, message } = request
  const change = Map({ actor, seq, deps: fromJS(deps), message, ops: undoOps })

  let opSet = state.get('opSet')
  let redoOps = List().withMutations(redoOps => {
    for (let op of undoOps) {
      if (!['set', 'del', 'link', 'inc'].includes(op.get('action'))) {
        throw new RangeError(`Unexpected operation type in undo history: ${op}`)
      }
      // TODO this duplicates OpSet.recordUndoHistory
      const fieldOps = OpSet.getFieldOps(opSet, op.get('obj'), op.get('key'))
      if (op.get('action') === 'inc') {
        redoOps.push(Map({action: 'inc', obj: op.get('obj'), key: op.get('key'), value: -op.get('value')}))
      } else if (fieldOps.isEmpty()) {
        redoOps.push(Map({action: 'del', obj: op.get('obj'), key: op.get('key')}))
      } else {
        for (let fieldOp of fieldOps) {
          fieldOp = fieldOp.remove('actor').remove('seq')
          if (fieldOp.get('action').startsWith('make')) fieldOp = fieldOp.set('action', 'link')
          redoOps.push(fieldOp)
        }
      }
    }
  })

  opSet = opSet
    .set('undoPos', undoPos - 1)
    .update('redoStack', stack => stack.push(redoOps))

  let diffs = {}
  opSet = OpSet.addChange(opSet, change, false, diffs)
  state = state.set('opSet', opSet)
  OpSet.finalizePatch(opSet, diffs)
  return makePatch(state, diffs, request, true)
}

/**
 * Redoes the last `undo()` in the node state `state`. The `request` object
 * contains all parts of the change except the operations; this function
 * fetches the operations from the redo stack, and applies the change,
 * returning a two-element list `[state, patch]`.
 */
function redo(state, request) {
  const redoOps = state.getIn(['opSet', 'redoStack']).last()
  if (!redoOps) {
    throw new RangeError('Cannot redo: the last change was not an undo')
  }
  const { actor, seq, deps, message } = request
  const change = Map({ actor, seq, deps: fromJS(deps), message, ops: redoOps })

  let opSet = state.get('opSet')
    .update('undoPos', undoPos => undoPos + 1)
    .update('redoStack', stack => stack.pop())

  let diffs = {}
  opSet = OpSet.addChange(opSet, change, false, diffs)
  state = state.set('opSet', opSet)
  OpSet.finalizePatch(opSet, diffs)
  return makePatch(state, diffs, request, true)
}

module.exports = {
  init, applyChanges, applyLocalChange, loadChanges, getPatch,
  getChanges, getChangesForActor, getMissingChanges, getMissingDeps, merge
}
