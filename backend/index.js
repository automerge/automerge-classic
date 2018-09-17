const { Map, List, fromJS } = require('immutable')
const { lessOrEqual } = require('../src/common')
const OpSet = require('./op_set')

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

class MaterializationContext {
  constructor () {
    this.diffs = {}
    this.children = {}
  }

  /**
   * Unpacks `value`: if it's an object of the form `{objectId: '...'}`, updates
   * `diff` to link to that objectId. Otherwise uses `value` as a primitive.
   */
  unpackValue(parentId, diff, value) {
    if (isObject(value)) {
      diff.value = value.objectId
      diff.link = true
      this.children[parentId].push(value.objectId)
    } else {
      diff.value = value
    }
  }

  /**
   * Unpacks `conflicts`: if it's an Immutable.js Map object (where keys are
   * actor IDs and values are primitive or object values), updates `diff` to
   * describe the conflicts.
   */
  unpackConflicts(parentId, diff, conflicts) {
    if (conflicts) {
      diff.conflicts = []

      for (let [actor, value] of conflicts) {
        let conflict = {actor}
        this.unpackValue(parentId, conflict, value)
        diff.conflicts.push(conflict)
      }
    }
  }

  /**
   * Updates `this.diffs[objectId]` to contain the patch necessary to
   * instantiate the map object with ID `objectId`.
   */
  instantiateMap(opSet, objectId) {
    let diffs = this.diffs[objectId]
    if (objectId !== OpSet.ROOT_ID) {
      diffs.push({obj: objectId, type: 'map', action: 'create'})
    }

    const conflicts = OpSet.getObjectConflicts(opSet, objectId, this)

    for (let key of OpSet.getObjectFields(opSet, objectId)) {
      let diff = {obj: objectId, type: 'map', action: 'set', key}
      this.unpackValue(objectId, diff, OpSet.getObjectField(opSet, objectId, key, this))
      this.unpackConflicts(objectId, diff, conflicts.get(key))
      diffs.push(diff)
    }
  }

  /**
   * Updates `this.diffs[objectId]` to contain the patch necessary to
   * instantiate the list or text object with ID `objectId`.
   */
  instantiateList(opSet, objectId, type) {
    let diffs = this.diffs[objectId]
    diffs.push({obj: objectId, type, action: 'create'})

    let conflicts = OpSet.listIterator(opSet, objectId, 'conflicts', this)
    let values    = OpSet.listIterator(opSet, objectId, 'values',    this)

    for (let [index, elemId] of OpSet.listIterator(opSet, objectId, 'elems', this)) {
      let diff = {obj: objectId, type, action: 'insert', index, elemId}
      this.unpackValue(objectId, diff, values.next().value)
      this.unpackConflicts(objectId, diff, conflicts.next().value)
      diffs.push(diff)
    }
  }

  /**
   * Called by OpSet.getOpValue() when recursively instantiating an object in
   * the document tree. Updates `this.diffs[objectId]` to contain the patch
   * necessary to instantiate the object, and returns `{objectId: objectId}`
   * (which is then interpreted by `this.unpackValue()`).
   */
  instantiateObject(opSet, objectId) {
    if (this.diffs[objectId]) return {objectId}

    const isRoot = (objectId === OpSet.ROOT_ID)
    const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])
    this.diffs[objectId] = []
    this.children[objectId] = []

    if (isRoot || objType === 'makeMap') {
      this.instantiateMap(opSet, objectId)
    } else if (objType === 'makeList') {
      this.instantiateList(opSet, objectId, 'list')
    } else if (objType === 'makeText') {
      this.instantiateList(opSet, objectId, 'text')
    } else {
      throw new RangeError(`Unknown object type: ${objType}`)
    }
    return {objectId}
  }

  /**
   * Constructs the list of all `diffs` necessary to instantiate the object tree
   * whose root is the object with ID `objectId`.
   */
  makePatch(objectId, diffs) {
    for (let childId of this.children[objectId]) {
      this.makePatch(childId, diffs)
    }
    diffs.push(...this.diffs[objectId])
  }
}


/**
 * Returns an empty node state.
 */
function init(actorId) {
  if (typeof actorId !== 'string') {
    throw new TypeError('init() requires an actorId')
  }
  const opSet = OpSet.init()
  return Map({actorId, opSet})
}

/**
 * Returns the current dependencies map in the form required by patch objects.
 */
function getDeps(state) {
  let actorId = state.get('actorId'), opSet = state.get('opSet')
  return opSet.get('deps')
    .set(actorId, opSet.getIn(['clock', actorId], 0))
}

/**
 * Applies a list of `changes` to the node state `state`. Returns a two-element
 * array `[state, patch]` where `state` is the updated node state, and `patch`
 * describes the changes that need to be made to the document object to reflect
 * this change.
 */
function applyChanges(state, changes) {
  let diffs = [], opSet = state.get('opSet')
  for (let change of fromJS(changes)) {
    const undoable = (change.get('actor') === state.get('actorId'))
    let [newOpSet, diff] = OpSet.addChange(opSet, change, undoable)
    diffs.push(...diff)
    opSet = newOpSet
  }

  state = state.set('opSet', opSet)
  let patch = {diffs, deps: getDeps(state).toJS()}

  if (changes.length === 1) {
    patch.actor = changes[0].actor
    patch.seq   = changes[0].seq
  }
  return [state, patch]
}

/**
 * Applies a single `change` incrementally; otherwise the same as
 * `applyChanges()`.
*/
function applyChange(state, change) {
  return applyChanges(state, [change])
}

/**
 * Creates and applies a new change by the local actor, containing the list of
 * operations `ops` and the optional `message`. Returns a two-element array
 * `[state, patch]` where `state` is the updated node state, and `patch`
 * describes the changes that need to be made to the document object.
 */
function makeChange(state, ops, message) {
  const actor = state.get('actorId')
  const seq = state.getIn(['opSet', 'clock', actor], 0) + 1
  const deps = getDeps(state)
  let change = Map({actor, seq, deps, ops})
  if (message) change = change.set('message', message)

  const [opSet, diffs] = OpSet.addChange(state.get('opSet'), change, false)
  let patch = {actor, seq, deps: deps.toJS(), diffs}
  return [state.set('opSet', opSet), patch]
}

/**
 * Returns a patch that, when applied to an empty document, constructs the
 * document tree in the state described by the node state `state`.
 */
function getPatch(state) {
  let diffs = [], opSet = state.get('opSet')
  let context = new MaterializationContext(opSet)
  context.instantiateObject(opSet, OpSet.ROOT_ID)
  context.makePatch(OpSet.ROOT_ID, diffs)
  return {diffs, deps: getDeps(state).toJS()}
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

function merge(local, remote) {
  if (local.get('actorId') === remote.get('actorId')) {
    throw new RangeError('Cannot merge an actor with itself')
  }

  const changes = OpSet.getMissingChanges(remote.get('opSet'), local.getIn(['opSet', 'clock']))
  return applyChanges(local, changes)
}

function canUndo(state) {
  return state.getIn(['opSet', 'undoPos']) > 0
}

function undo(state, message) {
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('Change message must be a string')
  }
  const undoPos = state.getIn(['opSet', 'undoPos'])
  const undoOps = state.getIn(['opSet', 'undoStack', undoPos - 1])
  if (undoPos < 1 || !undoOps) {
    throw new RangeError('Cannot undo: there is nothing to be undone')
  }
  let opSet = state.get('opSet')
  let redoOps = List().withMutations(redoOps => {
    for (let op of undoOps) {
      if (!['set', 'del', 'link'].includes(op.get('action'))) {
        throw new RangeError(`Unexpected operation type in undo history: ${op}`)
      }
      const fieldOps = OpSet.getFieldOps(opSet, op.get('obj'), op.get('key'))
      if (fieldOps.isEmpty()) {
        redoOps.push(Map({action: 'del', obj: op.get('obj'), key: op.get('key')}))
      } else {
        for (let fieldOp of fieldOps) {
          redoOps.push(fieldOp.remove('actor').remove('seq'))
        }
      }
    }
  })
  opSet = opSet
    .set('undoPos', undoPos - 1)
    .update('redoStack', stack => stack.push(redoOps))
  return makeChange(state.set('opSet', opSet), undoOps, message)
}

function canRedo(state) {
  return !state.getIn(['opSet', 'redoStack']).isEmpty()
}

function redo(state, message) {
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('Change message must be a string')
  }
  const redoOps = state.getIn(['opSet', 'redoStack']).last()
  if (!redoOps) {
    throw new RangeError('Cannot redo: the last change was not an undo')
  }
  const opSet = state.get('opSet')
    .update('undoPos', undoPos => undoPos + 1)
    .update('redoStack', stack => stack.pop())
  return makeChange(state.set('opSet', opSet), redoOps, message)
}

module.exports = {
  init, applyChanges, applyChange, getPatch,
  getChanges, getChangesForActor, getMissingChanges, getMissingDeps, merge,
  canUndo, undo, canRedo, redo
}
