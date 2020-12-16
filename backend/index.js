const { Map, List } = require('immutable')
const { copyObject } = require('../src/common')
const OpSet = require('./op_set')
const { SkipList } = require('./skip_list')
const { splitContainers, encodeChange, decodeChanges, encodeDocument, constructPatch } = require('./columnar')
const assert = require('assert')


function inspect(d) {
  const util = require('util')
  console.log(util.inspect(d,2,null,2))
}

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

/**
 * Returns an empty node state.
 */
function init() {
  const opSet = OpSet.init()
  const state = Map({opSet, objectIds: Map()})
  return {state}
}

function clone(backend) {
  return {state: backendState(backend)}
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
  const clock   = state.getIn(['opSet', 'states']).map(seqs => seqs.size).toJSON()
  const deps    = state.getIn(['opSet', 'deps']).toJSON().sort()
  const maxOp = state.getIn(['opSet', 'maxOp'], 0)
  const patch = {clock, deps, diffs, maxOp}

  if (isIncremental && request) {
    patch.actor = request.actor
    patch.seq   = request.seq
  }
  return patch
}

/**
 * The implementation behind `applyChanges()`, `applyLocalChange()`, and
 * `loadChanges()`.
 */
function apply(state, changes, request, isIncremental) {
  let diffs = isIncremental ? {} : null
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
  let [state, patch] = apply(backendState(backend), changes, null, true)
  backend.frozen = true
  return [{state}, patch]
}

/**
 * Takes a single change request `request` made by the local user, and applies
 * it to the node state `backend`. Returns a two-element array `[backend, patch]`
 * where `backend` is the updated node state, and `patch` confirms the
 * modifications to the document objects.
 */
function applyLocalChange(backend, change) {
  const state = backendState(backend)
  if (change.seq <= state.getIn(['opSet', 'states', change.actor], List()).size) {
    throw new RangeError('Change request has already been applied')
  }
  if (change.seq > 1 && change.deps.length === 0) {
    const lastHash =  state.getIn(['opSet', 'states', change.actor, (change.seq - 2)])
    if (!lastHash) {
      throw new RangeError(`Cannot find hash of localChange before seq=${change.seq}`)
    }
    change.deps = [ lastHash ]
  }
  const binaryChange = encodeChange(change)
  const request = { actor: change.actor, seq: change.seq }
  const [state2, patch] = apply(state, [binaryChange], request, true)
  backend.frozen = true
  return [{ state: state2 }, patch, binaryChange]
}

/**
 * Returns the state of the document serialised to an Uint8Array.
 */
function save(backend) {
  return encodeDocument(getChanges(backend, []))
}

/**
 * Loads the document and/or changes contained in an Uint8Array, and returns a
 * backend initialised with this state.
 */
function load(data) {
  // Reconstruct the original change history that created the document.
  // It's a bit silly to convert to and from the binary encoding several times...!
  const binaryChanges = decodeChanges([data]).map(encodeChange)
  return loadChanges(init(), binaryChanges)
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
  const [newState, _] = apply(state, changes, null, false)
  backend.frozen = true
  return {state: newState}
}

/**
 * Returns a patch that, when applied to an empty document, constructs the
 * document tree in the state described by the node state `backend`.
 */
function getPatch(backend) {
  const state = backendState(backend)
  const diffs = constructPatch(save(backend))
  return makePatch(state, diffs, null, false)
}

function getChanges(backend, haveDeps) {
  if (!Array.isArray(haveDeps)) {
    throw new TypeError('Pass an array of hashes to Backend.getChanges()')
  }
  const state = backendState(backend)
  return OpSet.getMissingChanges(state.get('opSet'), List(haveDeps))
}

function getMissingDeps(backend) {
  const state = backendState(backend)
  return OpSet.getMissingDeps(state.get('opSet'))
}

module.exports = {
  init, clone, free, applyChanges, applyLocalChange, save, load, loadChanges, getPatch,
  getChanges, getMissingDeps
}
