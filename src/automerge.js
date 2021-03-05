const uuid = require('./uuid')
const Frontend = require('../frontend')
const { OPTIONS } = require('../frontend/constants')
const { encodeChange, decodeChange } = require('../backend/columnar')
const { isObject } = require('./common')
let backend = require('../backend') // mutable: can be overridden with setDefaultBackend()

///// Automerge.* API

function init(options) {
  if (typeof options === 'string') {
    options = {actorId: options}
  } else if (typeof options === 'undefined') {
    options = {}
  } else if (!isObject(options)) {
    throw new TypeError(`Unsupported options for init(): ${options}`)
  }
  return Frontend.init(Object.assign({backend}, options))
}

/**
 * Returns a new document object initialized with the given state.
 */
function from(initialState, options) {
  const changeOpts = {message: 'Initialization'}
  return change(init(options), changeOpts, doc => Object.assign(doc, initialState))
}

function change(doc, options, callback) {
  const [newDoc, change] = Frontend.change(doc, options, callback)
  return newDoc
}

function emptyChange(doc, options) {
  const [newDoc, change] = Frontend.emptyChange(doc, options)
  return newDoc
}

function clone(doc) {
  const state = backend.clone(Frontend.getBackendState(doc))
  const patch = backend.getPatch(state)
  patch.state = state
  return Frontend.applyPatch(init(), patch)
}

function free(doc) {
  backend.free(Frontend.getBackendState(doc))
}

function load(data, options) {
  const state = backend.load(data)
  const patch = backend.getPatch(state)
  patch.state = state
  const doc = Frontend.applyPatch(init(options), patch)

  if (doc[OPTIONS].patchCallback) {
    delete patch.state
    doc[OPTIONS].patchCallback(patch, {}, doc, false, [data])
  }
  return doc
}

function save(doc) {
  return backend.save(Frontend.getBackendState(doc))
}

function merge(localDoc, remoteDoc) {
  if (Frontend.getActorId(localDoc) === Frontend.getActorId(remoteDoc)) {
    throw new RangeError('Cannot merge an actor with itself')
  }
  // Just copy all changes from the remote doc; any duplicates will be ignored
  return applyChanges(localDoc, getAllChanges(remoteDoc))
}

function getChanges(oldDoc, newDoc) {
  const oldState = Frontend.getBackendState(oldDoc)
  const newState = Frontend.getBackendState(newDoc)
  return backend.getChanges(newState, backend.getHeads(oldState))
}

function getAllChanges(doc) {
  return backend.getAllChanges(Frontend.getBackendState(doc))
}

function applyChanges(doc, changes, options = {}) {
  const oldState = Frontend.getBackendState(doc)
  const [newState, patch] = backend.applyChanges(oldState, changes)
  patch.state = newState
  const newDoc = Frontend.applyPatch(doc, patch)

  const patchCallback = options.patchCallback || doc[OPTIONS].patchCallback
  if (patchCallback) {
    delete patch.state
    patchCallback(patch, doc, newDoc, false, changes)
  }
  return newDoc
}

function getMissingDeps(doc) {
  return backend.getMissingDeps(Frontend.getBackendState(doc))
}

/**
 * Returns a byte array that uniquely identifies the current state of the document.
 * Any two documents that have applied the same set of changes (even in a different order)
 * will return the same value from this function.
 */
function getCurrentVersion(doc) {
  return backend.getCurrentVersion(Frontend.getBackendState(doc))
}

/**
 * Establishes a sync session with another peer. If the local peer is the initiator
 * of the session, `initState` should be the document version (as returned by
 * `getCurrentVersion`) of the last time we synced with that particular peer, or
 * undefined if this is the first time we are syncing with this peer. If the
 * remote peer initiated the session by sending us a message, `initState` is this
 * message received from the other peer.
 *
 * Returns a `Sync` object that handles sending and receiving messages.
 */
function startSync(doc, initState) {
  return backend.startSync(Frontend.getBackendState(doc), initState)
}

/**
 * Updates the backend state with the data received from another peer in the
 * course of a completed sync session. `sync` is the object previously returned
 * by `startSync()`.
 */
function finishSync(doc, sync, options = {}) {
  if (!sync.isFinished) throw new Error('sync is not yet finished')
  return applyChanges(doc, sync.receivedChanges, options)
}

function equals(val1, val2) {
  if (!isObject(val1) || !isObject(val2)) return val1 === val2
  const keys1 = Object.keys(val1).sort(), keys2 = Object.keys(val2).sort()
  if (keys1.length !== keys2.length) return false
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false
    if (!equals(val1[keys1[i]], val2[keys2[i]])) return false
  }
  return true
}

function getHistory(doc) {
  const actor = Frontend.getActorId(doc)
  const history = getAllChanges(doc)
  return history.map((change, index) => {
    return {
      get change () {
        return decodeChange(change)
      },
      get snapshot () {
        const state = backend.loadChanges(backend.init(), history.slice(0, index + 1))
        const patch = backend.getPatch(state)
        patch.state = state
        return Frontend.applyPatch(init(actor), patch)
      }
    }
  })
}

/**
 * Replaces the default backend implementation with a different one.
 * This allows you to switch to using the Rust/WebAssembly implementation.
 */
function setDefaultBackend(newBackend) {
  backend = newBackend
}

module.exports = {
  init, from, change, emptyChange, clone, free,
  load, save, merge, getChanges, getAllChanges, applyChanges, getMissingDeps,
  getCurrentVersion, startSync, finishSync,
  encodeChange, decodeChange, equals, getHistory, uuid,
  Frontend, setDefaultBackend,
  get Backend() { return backend }
}

for (let name of ['getObjectId', 'getObjectById', 'getActorId',
     'setActorId', 'getConflicts', 'getLastLocalChange',
     'Text', 'Table', 'Counter', 'Observable']) {
  module.exports[name] = Frontend[name]
}
