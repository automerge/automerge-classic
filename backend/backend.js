const { encodeChange } = require('./columnar')
const { BackendDoc } = require('./new')
const { backendState } = require('./util')

/**
 * Returns an empty node state.
 */
function init() {
  return {state: new BackendDoc(), heads: []}
}

function clone(backend) {
  return {state: backendState(backend).clone(), heads: backend.heads}
}

function free(backend) {
  backend.state = null
  backend.frozen = true
}

/**
 * Applies a list of `changes` from remote nodes to the node state `backend`.
 * Returns a two-element array `[state, patch]` where `state` is the updated
 * node state, and `patch` describes the modifications that need to be made
 * to the document objects to reflect these changes.
 */
function applyChanges(backend, changes) {
  const state = backendState(backend)
  const patch = state.applyChanges(changes)
  backend.frozen = true
  return [{state, heads: state.heads}, patch]
}

function hashByActor(state, actorId, index) {
  if (state.hashesByActor[actorId] && state.hashesByActor[actorId][index]) {
    return state.hashesByActor[actorId][index]
  }
  if (!state.haveHashGraph) {
    state.computeHashGraph()
    if (state.hashesByActor[actorId] && state.hashesByActor[actorId][index]) {
      return state.hashesByActor[actorId][index]
    }
  }
  throw new RangeError(`Unknown change: actorId = ${actorId}, seq = ${index + 1}`)
}

/**
 * Takes a single change request `request` made by the local user, and applies
 * it to the node state `backend`. Returns a three-element array `[backend, patch, binaryChange]`
 * where `backend` is the updated node state,`patch` confirms the
 * modifications to the document objects, and `binaryChange` is a binary-encoded form of
 * the change submitted.
 */
function applyLocalChange(backend, change) {
  const state = backendState(backend)
  if (change.seq <= state.clock[change.actor] || 0) {
    throw new RangeError('Change request has already been applied')
  }

  // Add the local actor's last change hash to deps. We do this because when frontend
  // and backend are on separate threads, the frontend may fire off several local
  // changes in sequence before getting a response from the backend; since the binary
  // encoding and hashing is done by the backend, the frontend does not know the hash
  // of its own last change in this case. Rather than handle this situation as a
  // special case, we say that the frontend includes only specifies other actors'
  // deps in changes it generates, and the dependency from the local actor's last
  // change is always added here in the backend.
  //
  // Strictly speaking, we should check whether the local actor's last change is
  // indirectly reachable through a different actor's change; in that case, it is not
  // necessary to add this dependency. However, it doesn't do any harm either (only
  // using a few extra bytes of storage).
  if (change.seq > 1) {
    const lastHash = hashByActor(state, change.actor, change.seq - 2)
    if (!lastHash) {
      throw new RangeError(`Cannot find hash of localChange before seq=${change.seq}`)
    }
    let deps = {[lastHash]: true}
    for (let hash of change.deps) deps[hash] = true
    change.deps = Object.keys(deps).sort()
  }

  const binaryChange = encodeChange(change)
  const patch = state.applyChanges([binaryChange], true)
  backend.frozen = true

  // On the patch we send out, omit the last local change hash
  const lastHash = hashByActor(state, change.actor, change.seq - 1)
  patch.deps = patch.deps.filter(head => head !== lastHash)
  return [{state, heads: state.heads}, patch, binaryChange]
}

/**
 * Returns the state of the document serialised to an Uint8Array.
 */
function save(backend) {
  return backendState(backend).save()
}

/**
 * Loads the document and/or changes contained in an Uint8Array, and returns a
 * backend initialised with this state.
 */
function load(data) {
  const state = new BackendDoc(data)
  return {state, heads: state.heads}
}

/**
 * Applies a list of `changes` to the node state `backend`, and returns the updated
 * state with those changes incorporated. Unlike `applyChanges()`, this function
 * does not produce a patch describing the incremental modifications, making it
 * a little faster when loading a document from disk. When all the changes have
 * been loaded, you can use `getPatch()` to construct the latest document state.
 */
function loadChanges(backend, changes) {
  const state = backendState(backend)
  state.applyChanges(changes)
  backend.frozen = true
  return {state, heads: state.heads}
}

/**
 * Returns a patch that, when applied to an empty document, constructs the
 * document tree in the state described by the node state `backend`.
 */
function getPatch(backend) {
  return backendState(backend).getPatch()
}

/**
 * Returns an array of hashes of the current "head" changes (i.e. those changes
 * that no other change depends on).
 */
function getHeads(backend) {
  return backend.heads
}

/**
 * Returns the full history of changes that have been applied to a document.
 */
function getAllChanges(backend) {
  return getChanges(backend, [])
}

/**
 * Returns all changes that are newer than or concurrent to the changes
 * identified by the hashes in `haveDeps`. If `haveDeps` is an empty array, all
 * changes are returned. Throws an exception if any of the given hashes is unknown.
 */
function getChanges(backend, haveDeps) {
  if (!Array.isArray(haveDeps)) {
    throw new TypeError('Pass an array of hashes to Backend.getChanges()')
  }
  return backendState(backend).getChanges(haveDeps)
}

/**
 * Returns all changes that are present in `backend2` but not in `backend1`.
 * Intended for use in situations where the two backends are for different actors.
 * To get the changes added between an older and a newer document state of the same
 * actor, use `getChanges()` instead. `getChangesAdded()` throws an exception if
 * one of the backend states is frozen (i.e. if it is not the latest state of that
 * backend instance; this distinction matters when the backend is mutable).
 */
function getChangesAdded(backend1, backend2) {
  return backendState(backend2).getChangesAdded(backendState(backend1))
}

/**
 * If the backend has applied a change with the given `hash` (given as a
 * hexadecimal string), returns that change (as a byte array). Returns undefined
 * if no change with that hash has been applied. A change with missing
 * dependencies does not count as having been applied.
 */
function getChangeByHash(backend, hash) {
  return backendState(backend).getChangeByHash(hash)
}

/**
 * Returns the hashes of any missing dependencies, i.e. where we have applied a
 * change that has a dependency on a change we have not seen.
 *
 * If the argument `heads` is given (an array of hexadecimal strings representing
 * hashes as returned by `getHeads()`), this function also ensures that all of
 * those hashes resolve to either a change that has been applied to the document,
 * or that has been enqueued for later application once missing dependencies have
 * arrived. Any missing heads hashes are included in the returned array.
 */
function getMissingDeps(backend, heads = []) {
  return backendState(backend).getMissingDeps(heads)
}

module.exports = {
  init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch,
  getHeads, getAllChanges, getChanges, getChangesAdded, getChangeByHash, getMissingDeps
}
