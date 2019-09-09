const { Map, List, fromJS } = require('immutable')
const { copyObject, lessOrEqual } = require('../src/common')
const OpSet = require('./op_set')
const { SkipList } = require('./skip_list')

/**
 * Processes a change request `request` that is incoming from the frontend. Translates index-based
 * addressing of lists into identifier-based addressing used by the CRDT, and removes duplicate
 * assignments to the same object and key.
 */
function processChangeRequest(opSet, request, startOp) {
  const { actor, seq, deps } = request
  const change = { actor, seq, startOp, deps, ops: [] }
  if (request.message) change.message = request.message

  let objectTypes = {}, elemIds = {}, assignments = {}
  for (let op of request.ops) {
    if (op.action.startsWith('make')) {
      objectTypes[op.child] = op.action
    }

    const objType = objectTypes[op.obj] || opSet.getIn(['byObject', op.obj, '_init', 'action'])
    if (objType === 'makeList' || objType === 'makeText') {
      if (!elemIds[op.obj]) {
        elemIds[op.obj] = opSet.getIn(['byObject', op.obj, '_elemIds']) || new SkipList()
      }

      if (typeof op.key !== 'number') {
        throw new TypeError(`Unexpected operation key: ${op.key}`)
      }
      op = copyObject(op)

      if (op.insert) {
        const opId = `${startOp + change.ops.length}@${actor}`

        if (op.key === 0) {
          op.key = '_head'
          elemIds[op.obj] = elemIds[op.obj].insertAfter(null, opId)
        } else {
          op.key = elemIds[op.obj].keyOf(op.key - 1)
          elemIds[op.obj] = elemIds[op.obj].insertAfter(op.key, opId)
        }
      } else {
        op.key = elemIds[op.obj].keyOf(op.key)
        if (op.action === 'del') {
          elemIds[op.obj] = elemIds[op.obj].removeKey(op.key)
        }
      }
    }

    // Detect duplicate assignments to the same object and key
    if (['set', 'del', 'link', 'inc'].includes(op.action) && !op.insert) {
      if (!assignments[op.obj]) {
        assignments[op.obj] = {[op.key]: op}
      } else if (!assignments[op.obj][op.key]) {
        assignments[op.obj][op.key] = op
      } else if (op.action === 'inc') {
        assignments[op.obj][op.key].value += op.value
        continue
      } else {
        assignments[op.obj][op.key].action = op.action
        assignments[op.obj][op.key].value = op.value
        continue
      }
    }

    change.ops.push(op)
  }

  return fromJS(change)
}

/**
 * Returns an empty node state.
 */
function init() {
  const opSet = OpSet.init(), versionObj = Map({version: 0, localOnly: true, opSet})
  return Map({opSet, versions: List.of(versionObj)})
}

/**
 * Constructs a patch object from the current node state `state` and the list
 * of object modifications `diffs`.
 */
function makePatch(state, diffs, request, isIncremental) {
  const version = state.get('versions').last().get('version')
  const canUndo = state.getIn(['opSet', 'undoPos']) > 0
  const canRedo = !state.getIn(['opSet', 'redoStack']).isEmpty()

  if (isIncremental) {
    const patch = {version, canUndo, canRedo}
    if (patch && request) {
      patch.actor = request.actor
      patch.seq   = request.seq
    }
    patch.diffs = diffs
    return patch

  } else {
    const clock = state.getIn(['opSet', 'clock']).toJS()
    return {version, clock, canUndo, canRedo, diffs}
  }
}

/**
 * The implementation behind `applyChanges()` and `applyLocalChange()`.
 */
function apply(state, changes, request, isUndoable, isIncremental) {
  let diffs = isIncremental ? {} : null
  let opSet = state.get('opSet')
  for (let change of changes) {
    opSet = OpSet.addChange(opSet, change, !!request, isUndoable, diffs)
  }

  OpSet.finalizePatch(opSet, diffs)
  state = state.set('opSet', opSet)

  if (isIncremental) {
    const version = state.get('versions').last().get('version') + 1
    const versionObj = Map({version, localOnly: true, opSet})
    state = state.update('versions', versions => versions.push(versionObj))
  } else {
    const versionObj = Map({version: 0, localOnly: true, opSet})
    state = state.set('versions', List.of(versionObj))
  }

  return [state, isIncremental ? makePatch(state, diffs, request, true) : null]
}

/**
 * Applies a list of `changes` from remote nodes to the node state `state`.
 * Returns a two-element array `[state, patch]` where `state` is the updated
 * node state, and `patch` describes the modifications that need to be made
 * to the document objects to reflect these changes.
 */
function applyChanges(state, changes) {
  // The localOnly flag on a version object is set to true if all changes since that version have
  // been local changes. Since we are applying a remote change here, we have to set that flag to
  // false on all existing version objects.
  state = state.update('versions', versions => versions.map(v => v.set('localOnly', false)))
  return apply(state, fromJS(changes), null, false, true)
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
  const deps = versionObj.getIn(['opSet', 'deps']).remove(request.actor).toJS()
  request = Object.assign(request, {deps})

  let change, startOp = state.getIn(['opSet', 'maxOp'], 0) + 1
  if (request.requestType === 'change') {
    change = processChangeRequest(versionObj.get('opSet'), request, startOp)
  } else if (request.requestType === 'undo') {
    ;[state, change] = undo(state, request, startOp)
  } else if (request.requestType === 'redo') {
    ;[state, change] = redo(state, request, startOp)
  } else {
    throw new RangeError(`Unknown requestType: ${request.requestType}`)
  }

  let patch, isUndoable = (request.requestType === 'change')
  ;[state, patch] = apply(state, List.of(change), request, isUndoable, true)

  state = state.update('versions', versions => {
    // Remove any versions before the one referenced by the current request, since future requests
    // will always reference a version number that is greater than or equal to the current
    return versions.filter(v => v.get('version') >= request.version)
      // Update the list of past versions so that if a future change request from the frontend
      // refers to one of these versions, we know exactly what state the frontend was in when it
      // made the change. If there have only been local updates since a given version, then the
      // frontend is in sync with the backend (since the frontend has applied the same change
      // locally). However, if there have also been remote updates, then we construct a special
      // opSet that contains only the local changes but excludes the remote ones. This opSet should
      // match the state of the frontend (which has not yet seen the remote update).
      .map(v => {
        if (v.get('localOnly')) {
          return v.set('opSet', state.get('opSet'))
        } else {
          return v.set('opSet', OpSet.addChange(v.get('opSet'), change, true, false, null))
        }
      })
  })
  return [state, patch]
}

/**
 * Applies a list of `changes` to the node state `state`, and returns the updated
 * state with those changes incorporated. Unlike `applyChanges()`, this function
 * does not produce a patch describing the incremental modifications, making it
 * a little faster when loading a document from disk. When all the changes have
 * been loaded, you can use `getPatch()` to construct the latest document state.
 */
function loadChanges(state, changes) {
  const [newState, _] = apply(state, fromJS(changes), null, false, false)
  return newState
}

/**
 * Returns a patch that, when applied to an empty document, constructs the
 * document tree in the state described by the node state `state`.
 */
function getPatch(state) {
  const diffs = OpSet.constructObject(state.get('opSet'), OpSet.ROOT_ID)
  return makePatch(state, diffs, null, false)
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
 * onto the redo stack, and returns a two-element list `[state, change]`
 * where `change` is the change to be applied.
 */
function undo(state, request, startOp) {
  const undoPos = state.getIn(['opSet', 'undoPos'])
  const undoOps = state.getIn(['opSet', 'undoStack', undoPos - 1])
  if (undoPos < 1 || !undoOps) {
    throw new RangeError('Cannot undo: there is nothing to be undone')
  }
  const { actor, seq, deps, message } = request
  const change = Map({ actor, seq, startOp, deps: fromJS(deps), message, ops: undoOps })

  let opSet = state.get('opSet')
  let redoOps = List().withMutations(redoOps => {
    for (let op of undoOps) {
      if (!['set', 'del', 'link', 'inc'].includes(op.get('action'))) {
        throw new RangeError(`Unexpected operation type in undo history: ${op}`)
      }
      // TODO this duplicates OpSet.recordUndoHistory
      const key = OpSet.getOperationKey(op)
      const fieldOps = OpSet.getFieldOps(opSet, op.get('obj'), key)
      if (op.get('action') === 'inc') {
        redoOps.push(Map({action: 'inc', obj: op.get('obj'), key, value: -op.get('value')}))
      } else if (fieldOps.isEmpty()) {
        redoOps.push(Map({action: 'del', obj: op.get('obj'), key}))
      } else {
        for (let fieldOp of fieldOps) {
          fieldOp = fieldOp.remove('opId').remove('pred')
          if (fieldOp.get('insert')) fieldOp = fieldOp.remove('insert').set('key', key)
          if (fieldOp.get('action').startsWith('make')) fieldOp = fieldOp.set('action', 'link')
          redoOps.push(fieldOp)
        }
      }
    }
  })

  opSet = opSet
    .set('undoPos', undoPos - 1)
    .update('redoStack', stack => stack.push(redoOps))
  return [state.set('opSet', opSet), change]
}

/**
 * Redoes the last `undo()` in the node state `state`. The `request` object
 * contains all parts of the change except the operations; this function
 * fetches the operations from the redo stack, and returns two-element list
 * `[state, change]` where `change` is the change to be applied.
 */
function redo(state, request, startOp) {
  const redoOps = state.getIn(['opSet', 'redoStack']).last()
  if (!redoOps) {
    throw new RangeError('Cannot redo: the last change was not an undo')
  }
  const { actor, seq, deps, message } = request
  const change = Map({ actor, seq, startOp, deps: fromJS(deps), message, ops: redoOps })

  let opSet = state.get('opSet')
    .update('undoPos', undoPos => undoPos + 1)
    .update('redoStack', stack => stack.pop())
  return [state.set('opSet', opSet), change]
}

module.exports = {
  init, applyChanges, applyLocalChange, loadChanges, getPatch,
  getChanges, getChangesForActor, getMissingChanges, getMissingDeps, merge
}
