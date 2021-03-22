const { Map, List } = require('immutable')
const { copyObject } = require('../src/common')
const OpSet = require('./op_set')
const { SkipList } = require('./skip_list')
const { splitContainers, encodeChange, decodeChanges, encodeDocument, constructPatch, BackendDoc } = require('./columnar')
const { encodeSyncMessage, decodeSyncMessage, makeBloomFilter, getChangesToSend } = require('./sync')

// Feature flag: false uses old Immutable.js-based backend data structures, true uses new
// byte-array-based data structures. New data structures are not yet fully working.
const USE_NEW_BACKEND = false

function backendState(backend) {
  if (backend.frozen) {
    throw new Error(
      'Attempting to use an outdated Automerge document that has already been updated. ' +
      'Please use the latest document state, or call Automerge.clone() if you really ' +
      'need to use this old document state.'
    )
  }
  return backend.state
}

function hashesByActor(state, actorId) {
  if (USE_NEW_BACKEND) {
    return state.hashesByActor[actorId] || []
  } else {
    return state.getIn(['opSet', 'states', actorId], List()).toJS()
  }
}

/**
 * Returns an empty node state.
 */
function init() {
  if (USE_NEW_BACKEND) {
    return {state: new BackendDoc(), heads: []}
  } else {
    return {state: Map({opSet: OpSet.init(), objectIds: Map()}), heads: []}
  }
}

function clone(backend) {
  if (USE_NEW_BACKEND) {
    return {state: backendState(backend).clone(), heads: backend.heads}
  } else {
    return {state: backendState(backend), heads: backend.heads}
  }
}

function free(backend) {
  backend.state = null
  backend.frozen = true
}

/**
 * Constructs a patch object from the current node state `state` and the
 * object modifications `diffs`.
 */
function makePatch(state, diffs, request, isIncremental) {
  const clock = state.getIn(['opSet', 'states']).map(seqs => seqs.size).toJSON()
  const deps  = state.getIn(['opSet', 'deps']).toJSON().sort()
  const maxOp = state.getIn(['opSet', 'maxOp'], 0)
  const patch = {clock, deps, diffs, maxOp}

  if (isIncremental && request) {
    patch.actor = request.actor
    patch.seq   = request.seq

    // Omit the local actor's own last change from deps
    const lastHash = state.getIn(['opSet', 'states', request.actor, request.seq - 1])
    patch.deps = patch.deps.filter(dep => dep !== lastHash)
  }
  return patch
}

/**
 * The implementation behind `applyChanges()`, `applyLocalChange()`, and
 * `loadChanges()`.
 */
function apply(state, changes, request, isIncremental) {
  let diffs = isIncremental ? {objectId: '_root', type: 'map'} : null
  let opSet = state.get('opSet')
  for (let change of changes) {
    for (let chunk of splitContainers(change)) {
      if (request) {
        opSet = OpSet.addLocalChange(opSet, chunk, diffs)
      } else {
        opSet = OpSet.addChange(opSet, chunk, diffs)
      }
    }
  }

  OpSet.finalizePatch(opSet, diffs)
  state = state.set('opSet', opSet)

  return [state, isIncremental ? makePatch(state, diffs, request, true) : null]
}

/**
 * Applies a list of `changes` from remote nodes to the node state `backend`.
 * Returns a two-element array `[state, patch]` where `state` is the updated
 * node state, and `patch` describes the modifications that need to be made
 * to the document objects to reflect these changes.
 */
function applyChanges(backend, changes) {
  if (USE_NEW_BACKEND) {
    const state = backendState(backend)
    const patch = state.applyChanges(changes)
    backend.frozen = true
    return [{state, heads: state.heads}, patch]
  } else {
    let [state, patch] = apply(backendState(backend), changes, null, true)
    const heads = OpSet.getHeads(state.get('opSet'))
    backend.frozen = true
    return [{state, heads}, patch]
  }
}

/**
 * Takes a single change request `request` made by the local user, and applies
 * it to the node state `backend`. Returns a two-element array `[backend, patch]`
 * where `backend` is the updated node state, and `patch` confirms the
 * modifications to the document objects.
 */
function applyLocalChange(backend, change) {
  const state = backendState(backend)
  if (change.seq <= hashesByActor(state, change.actor).length) {
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
    const lastHash = hashesByActor(state, change.actor)[change.seq - 2]
    if (!lastHash) {
      throw new RangeError(`Cannot find hash of localChange before seq=${change.seq}`)
    }
    let deps = {[lastHash]: true}
    for (let hash of change.deps) deps[hash] = true
    change.deps = Object.keys(deps).sort()
  }

  const binaryChange = encodeChange(change)

  if (USE_NEW_BACKEND) {
    const patch = state.applyChanges([binaryChange], true)
    backend.frozen = true

    // On the patch we send out, omit the last local change hash
    const lastHash = hashesByActor(state, change.actor)[change.seq - 1]
    patch.deps = patch.deps.filter(head => head !== lastHash)
    return [{state, heads: state.heads}, patch, binaryChange]

  } else {
    const request = {actor: change.actor, seq: change.seq}
    const [state2, patch] = apply(state, [binaryChange], request, true)
    const heads = OpSet.getHeads(state2.get('opSet'))
    backend.frozen = true
    return [{state: state2, heads}, patch, binaryChange]
  }
}

/**
 * Returns the state of the document serialised to an Uint8Array.
 */
function save(backend) {
  if (USE_NEW_BACKEND) {
    return backendState(backend).save()
  } else {
    return encodeDocument(getAllChanges(backend))
  }
}

/**
 * Loads the document and/or changes contained in an Uint8Array, and returns a
 * backend initialised with this state.
 */
function load(data) {
  if (USE_NEW_BACKEND) {
    const state = new BackendDoc(data)
    return {state, heads: state.heads}
  } else {
    // Reconstruct the original change history that created the document.
    // It's a bit silly to convert to and from the binary encoding several times...!
    const binaryChanges = decodeChanges([data]).map(encodeChange)
    return loadChanges(init(), binaryChanges)
  }
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
  if (USE_NEW_BACKEND) {
    state.applyChanges(changes)
    backend.frozen = true
    return {state, heads: state.heads}
  } else {
    const [newState, _] = apply(state, changes, null, false)
    backend.frozen = true
    return {state: newState, heads: OpSet.getHeads(newState.get('opSet'))}
  }
}

/**
 * Returns a patch that, when applied to an empty document, constructs the
 * document tree in the state described by the node state `backend`.
 */
function getPatch(backend) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    const diffs = constructPatch(state.save())
    return {
      maxOp: state.maxOp,
      clock: state.clock,
      deps: state.heads,
      diffs: diffs
    }
  } else {
    const diffs = constructPatch(save(backend))
    return makePatch(state, diffs, null, false)
  }
}

/**
 * Returns an array of hashes of the current "head" changes (i.e. those changes
 * that no other change depends on).
 */
function getHeads(backend) {
  return backend.heads
}

/**
 * Initiates a run of the sync protocol with a remote node. Call this function when
 * a connection with the remote node has just been established (and no message has
 * been received yet), or when we want to inform the remote node that our local
 * document has been updated with new changes. `lastSync` are the heads (as returned
 * by `getHeads()`) at the time of the last completed sync with this particular
 * remote node. Omit `lastSync` if this is the first time we're syncing with this
 * particular remote node. Returns a sync message of the form `{heads, need, have}`,
 * which can be encoded for transmission using `encodeSyncMessage()`. Both sides of
 * the connection need to send each other a `syncStart` message; this can happen
 * concurrently.
 */
function syncStart(backend, lastSync = []) {
  const have = makeBloomFilter(backendState(backend), lastSync)
  return {heads: getHeads(backend), need: [], have: [have]}
}

/**
 * Executes one step of the sync protocol with another node. Call this function
 * when a sync message is received from a remote node. `message` is the received
 * message that has already been decoded using `decodeSyncMessage()`. Returns
 * a two-element array `[response, changes]`, where `response` is a sync message
 * of the form `{heads, need, have}` that should be sent back to the remote node
 * in response (or undefined if the sync is finished and no further message
 * needs to be sent). `changes` is an array of binary changes that need to be
 * sent to the remote node in one or more separate messages.
 */
function syncResponse(backend, message) {
  const heads = getHeads(backend), state = backendState(backend)

  // If the heads are equal, we're in sync and don't need to do anything further
  let headsEqual = (message.heads.length === heads.length)
  for (let i = 0; i < message.heads.length && headsEqual; i++) {
    headsEqual = headsEqual && message.heads[i] === heads[i]
  }
  if (headsEqual && message.need.length === 0) return [undefined, []]

  // Fall back to a full re-sync if the sender's last sync state includes hashes
  // that we don't know. This could happen if we crashed after the last sync and
  // failed to persist changes that the other node already sent us.
  if (message.have.length > 0) {
    const lastSync = message.have[0].lastSync
    if (!lastSync.every(hash => getChangeByHash(backend, hash))) {
      return [{heads, need: [], have: [{lastSync: [], bloom: Uint8Array.of()}]}, []]
    }
  }

  // Regular response to a sync message: send any changes that the other node
  // doesn't have. We leave the "have" field empty because the previous message
  // generated by `syncStart` already indicated what changes we have.
  return [{heads, need: [], have: []}, getChangesToSend(state, message)]
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

  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getChanges(haveDeps)
  } else {
    return OpSet.getMissingChanges(state.get('opSet'), List(haveDeps))
  }
}

/**
 * If the backend has applied a change with the given `hash` (given as a
 * hexadecimal string), returns that change (as a byte array). Returns undefined
 * if no change with that hash has been applied. A change with missing
 * dependencies does not count as having been applied.
 */
function getChangeByHash(backend, hash) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getChangeByHash(hash)
  } else {
    return OpSet.getChangeByHash(state.get('opSet'), hash)
  }
}

/**
 * Returns the hashes of any missing dependencies, i.e. where we have applied a
 * change that has a dependency on a change we have not seen. If the argument
 * `changes` is given (an array of binary changes), also returns the hashes of
 * any dependencies that would be missing if we applied those changes. Does not
 * actually apply any changes that are given.
 */
function getMissingDeps(backend, changes = [], heads = []) {
  const state = backendState(backend)
  if (USE_NEW_BACKEND) {
    return state.getMissingDeps(changes, heads)
  } else {
    return OpSet.getMissingDeps(state.get('opSet'), changes, heads)
  }
}

module.exports = {
  init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch,
  getHeads, syncStart, syncResponse, encodeSyncMessage, decodeSyncMessage,
  getAllChanges, getChanges, getChangeByHash, getMissingDeps
}
