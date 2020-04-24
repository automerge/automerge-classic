const transit = require('transit-immutable-js')
const uuid = require('./uuid')
const Frontend = require('../frontend')
const { encodeChange, decodeChanges } = require('../backend/columnar')
const { isObject } = require('./common')
let backend = require('../backend') // mutable: can be overridden with setDefaultBackend()

/**
 * Constructs a new frontend document that reflects the given list of changes.
 */
function docFromChanges(options, changes) {
  const doc = init(options)
  const state = backend.loadChanges(backend.init(), changes)
  const patch = backend.getPatch(state)
  patch.state = state
  return Frontend.applyPatch(doc, patch)
}

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
  const changeOpts = {message: 'Initialization', undoable: false}
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

function undo(doc, options) {
  const [newDoc, change] = Frontend.undo(doc, options)
  return newDoc
}

function redo(doc, options) {
  const [newDoc, change] = Frontend.redo(doc, options)
  return newDoc
}

function clone(doc) {
  const state = backend.clone(Frontend.getBackendState(doc))
  const patch = backend.getPatch(state)
  patch.state = state
  return Frontend.applyPatch(doc, patch)
}

function free(doc) {
  backend.free(Frontend.getBackendState(doc))
}

function load(changes, options) {
  return docFromChanges(options, changes) // TODO change this to use encoded document format
}

function save(doc) {
  return getAllChanges(doc) // TODO change this to use encoded document format
}

function merge(localDoc, remoteDoc) {
  if (Frontend.getActorId(localDoc) === Frontend.getActorId(remoteDoc)) {
    throw new RangeError('Cannot merge an actor with itself')
  }
  // Just copy all changes from the remote doc; any duplicates will be ignored
  return applyChanges(localDoc, getAllChanges(remoteDoc))
}

function getChanges(oldDoc, newDoc) {
  const newState = Frontend.getBackendState(newDoc)
  return backend.getChanges(newState, Frontend.getDeps(oldDoc))
}

function getAllChanges(doc) {
  return backend.getChanges(Frontend.getBackendState(doc), [])
}

function applyChanges(doc, changes) {
  const oldState = Frontend.getBackendState(doc)
  const [newState, patch] = backend.applyChanges(oldState, changes)
  patch.state = newState
  return Frontend.applyPatch(doc, patch)
}

function getMissingDeps(doc) {
  return backend.getMissingDeps(Frontend.getBackendState(doc))
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
        const decoded = decodeChanges([change])
        if (decoded.length !== 1) {
          throw new RangeError(`Unexpected number of decoded changes: ${decoded.length}`)
        }
        return decoded[0]
      },
      get snapshot () {
        return docFromChanges(actor, history.slice(0, index + 1))
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

function decodeChange(change) {
  return decodeChanges([change])
}

module.exports = {
  init, from, change, emptyChange, undo, redo, clone, free,
  load, save, merge, getChanges, getAllChanges, applyChanges, getMissingDeps,
  encodeChange, decodeChange, equals, getHistory, uuid,
  Frontend, setDefaultBackend,
  get Backend() { return backend }
}

for (let name of ['canUndo', 'canRedo', 'getObjectId', 'getObjectById', 'getActorId',
     'setActorId', 'getConflicts', 'Text', 'Table', 'Counter']) {
  module.exports[name] = Frontend[name]
}
