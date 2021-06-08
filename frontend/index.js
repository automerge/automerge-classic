const { OPTIONS, CACHE, STATE, OBJECT_ID, CONFLICTS, CHANGE, ELEM_IDS } = require('./constants')
const { isObject, copyObject } = require('../src/common')
const uuid = require('../src/uuid')
const { interpretPatch, cloneRootObject } = require('./apply_patch')
const { rootObjectProxy } = require('./proxies')
const { Context } = require('./context')
const { Text } = require('./text')
const { Table } = require('./table')
const { Counter } = require('./counter')
const { Float64, Int, Uint } = require('./numbers')
const { Observable } = require('./observable')

/**
 * Actor IDs must consist only of hexadecimal digits so that they can be encoded
 * compactly in binary form.
 */
function checkActorId(actorId) {
  if (typeof actorId !== 'string') {
    throw new TypeError(`Unsupported type of actorId: ${typeof actorId}`)
  }
  if (!/^[0-9a-f]+$/.test(actorId)) {
    throw new RangeError('actorId must consist only of lowercase hex digits')
  }
  if (actorId.length % 2 !== 0) {
    throw new RangeError('actorId must consist of an even number of digits')
  }
}

/**
 * Takes a set of objects that have been updated (in `updated`) and an updated state object
 * `state`, and returns a new immutable document root object based on `doc` that reflects
 * those updates.
 */
function updateRootObject(doc, updated, state) {
  let newDoc = updated._root
  if (!newDoc) {
    newDoc = cloneRootObject(doc[CACHE]._root)
    updated._root = newDoc
  }
  Object.defineProperty(newDoc, OPTIONS,  {value: doc[OPTIONS]})
  Object.defineProperty(newDoc, CACHE,    {value: updated})
  Object.defineProperty(newDoc, STATE,    {value: state})

  if (doc[OPTIONS].freeze) {
    for (let objectId of Object.keys(updated)) {
      if (updated[objectId] instanceof Table) {
        updated[objectId]._freeze()
      } else if (updated[objectId] instanceof Text) {
        Object.freeze(updated[objectId].elems)
        Object.freeze(updated[objectId])
      } else {
        Object.freeze(updated[objectId])
        Object.freeze(updated[objectId][CONFLICTS])
      }
    }
  }

  for (let objectId of Object.keys(doc[CACHE])) {
    if (!updated[objectId]) {
      updated[objectId] = doc[CACHE][objectId]
    }
  }

  if (doc[OPTIONS].freeze) {
    Object.freeze(updated)
  }
  return newDoc
}

/**
 * Adds a new change request to the list of pending requests, and returns an
 * updated document root object.
 * The details of the change are taken from the context object `context`.
 * `options` contains properties that may affect how the change is processed; in
 * particular, the `message` property of `options` is an optional human-readable
 * string describing the change.
 */
function makeChange(doc, context, options) {
  const actor = getActorId(doc)
  if (!actor) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  const state = copyObject(doc[STATE])
  state.seq += 1

  const change = {
    actor,
    seq: state.seq,
    startOp: state.maxOp + 1,
    deps: state.deps,
    time: (options && typeof options.time === 'number') ? options.time
                                                        : Math.round(new Date().getTime() / 1000),
    message: (options && typeof options.message === 'string') ? options.message : '',
    ops: context.ops
  }

  if (doc[OPTIONS].backend) {
    const [backendState, patch, binaryChange] = doc[OPTIONS].backend.applyLocalChange(state.backendState, change)
    state.backendState = backendState
    state.lastLocalChange = binaryChange
    // NOTE: When performing a local change, the patch is effectively applied twice -- once by the
    // context invoking interpretPatch as soon as any change is made, and the second time here
    // (after a round-trip through the backend). This is perhaps more robust, as changes only take
    // effect in the form processed by the backend, but the downside is a performance cost.
    // Should we change this?
    const newDoc = applyPatchToDoc(doc, patch, state, true)
    const patchCallback = options && options.patchCallback || doc[OPTIONS].patchCallback
    if (patchCallback) patchCallback(patch, doc, newDoc, true, [binaryChange])
    return [newDoc, change]

  } else {
    const queuedRequest = {actor, seq: change.seq, before: doc}
    state.requests = state.requests.concat([queuedRequest])
    state.maxOp = state.maxOp + countOps(change.ops)
    state.deps = []
    return [updateRootObject(doc, context ? context.updated : {}, state), change]
  }
}

function countOps(ops) {
  let count = 0
  for (const op of ops) {
    if (op.action === 'set' && op.values) {
      count += op.values.length
    } else {
      count += 1
    }
  }
  return count
}

/**
 * Returns the binary encoding of the last change made by the local actor.
 */
function getLastLocalChange(doc) {
  return doc[STATE] && doc[STATE].lastLocalChange ? doc[STATE].lastLocalChange : null
}

/**
 * Applies the changes described in `patch` to the document with root object
 * `doc`. The state object `state` is attached to the new root object.
 * `fromBackend` should be set to `true` if the patch came from the backend,
 * and to `false` if the patch is a transient local (optimistically applied)
 * change from the frontend.
 */
function applyPatchToDoc(doc, patch, state, fromBackend) {
  const actor = getActorId(doc)
  const updated = {}
  interpretPatch(patch.diffs, doc, updated)

  if (fromBackend) {
    if (!patch.clock) throw new RangeError('patch is missing clock field')
    if (patch.clock[actor] && patch.clock[actor] > state.seq) {
      state.seq = patch.clock[actor]
    }
    state.clock = patch.clock
    state.deps  = patch.deps
    state.maxOp = Math.max(state.maxOp, patch.maxOp)
  }
  return updateRootObject(doc, updated, state)
}

/**
 * Creates an empty document object with no changes.
 */
function init(options) {
  if (typeof options === 'string') {
    options = {actorId: options}
  } else if (typeof options === 'undefined') {
    options = {}
  } else if (!isObject(options)) {
    throw new TypeError(`Unsupported value for init() options: ${options}`)
  }

  if (!options.deferActorId) {
    if (options.actorId === undefined) {
      options.actorId = uuid()
    }
    checkActorId(options.actorId)
  }

  if (options.observable) {
    const patchCallback = options.patchCallback, observable = options.observable
    options.patchCallback = (patch, before, after, local, changes) => {
      if (patchCallback) patchCallback(patch, before, after, local, changes)
      observable.patchCallback(patch, before, after, local, changes)
    }
  }

  const root = {}, cache = {_root: root}
  const state = {seq: 0, maxOp: 0, requests: [], clock: {}, deps: []}
  if (options.backend) {
    state.backendState = options.backend.init()
    state.lastLocalChange = null
  }
  Object.defineProperty(root, OBJECT_ID, {value: '_root'})
  Object.defineProperty(root, OPTIONS,   {value: Object.freeze(options)})
  Object.defineProperty(root, CONFLICTS, {value: Object.freeze({})})
  Object.defineProperty(root, CACHE,     {value: Object.freeze(cache)})
  Object.defineProperty(root, STATE,     {value: Object.freeze(state)})
  return Object.freeze(root)
}

/**
 * Returns a new document object initialized with the given state.
 */
function from(initialState, options) {
  return change(init(options), 'Initialization', doc => Object.assign(doc, initialState))
}


/**
 * Changes a document `doc` according to actions taken by the local user.
 * `options` is an object that can contain the following properties:
 *  - `message`: an optional descriptive string that is attached to the change.
 * If `options` is a string, it is treated as `message`.
 *
 * The actual change is made within the callback function `callback`, which is
 * given a mutable version of the document as argument. Returns a two-element
 * array `[doc, request]` where `doc` is the updated document, and `request`
 * is the change request to send to the backend. If nothing was actually
 * changed, returns the original `doc` and a `null` change request.
 */
function change(doc, options, callback) {
  if (doc[OBJECT_ID] !== '_root') {
    throw new TypeError('The first argument to Automerge.change must be the document root')
  }
  if (doc[CHANGE]) {
    throw new TypeError('Calls to Automerge.change cannot be nested')
  }
  if (typeof options === 'function' && callback === undefined) {
    [options, callback] = [callback, options]
  }
  if (typeof options === 'string') {
    options = {message: options}
  }
  if (options !== undefined && !isObject(options)) {
    throw new TypeError('Unsupported type of options')
  }

  const actorId = getActorId(doc)
  if (!actorId) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  const context = new Context(doc, actorId)
  callback(rootObjectProxy(context))

  if (Object.keys(context.updated).length === 0) {
    // If the callback didn't change anything, return the original document object unchanged
    return [doc, null]
  } else {
    return makeChange(doc, context, options)
  }
}

/**
 * Triggers a new change request on the document `doc` without actually
 * modifying its data. `options` is an object as described in the documentation
 * for the `change` function. This function can be useful for acknowledging the
 * receipt of some message (as it's incorported into the `deps` field of the
 * change). Returns a two-element array `[doc, request]` where `doc` is the
 * updated document, and `request` is the change request to send to the backend.
 */
function emptyChange(doc, options) {
  if (doc[OBJECT_ID] !== '_root') {
    throw new TypeError('The first argument to Automerge.emptyChange must be the document root')
  }
  if (typeof options === 'string') {
    options = {message: options}
  }
  if (options !== undefined && !isObject(options)) {
    throw new TypeError('Unsupported type of options')
  }

  const actorId = getActorId(doc)
  if (!actorId) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  return makeChange(doc, new Context(doc, actorId), options)
}

/**
 * Applies `patch` to the document root object `doc`. This patch must come
 * from the backend; it may be the result of a local change or a remote change.
 * If it is the result of a local change, the `seq` field from the change
 * request should be included in the patch, so that we can match them up here.
 */
function applyPatch(doc, patch, backendState = undefined) {
  if (doc[OBJECT_ID] !== '_root') {
    throw new TypeError('The first argument to Frontend.applyPatch must be the document root')
  }
  const state = copyObject(doc[STATE])

  if (doc[OPTIONS].backend) {
    if (!backendState) {
      throw new RangeError('applyPatch must be called with the updated backend state')
    }
    state.backendState = backendState
    return applyPatchToDoc(doc, patch, state, true)
  }

  let baseDoc

  if (state.requests.length > 0) {
    baseDoc = state.requests[0].before
    if (patch.actor === getActorId(doc)) {
      if (state.requests[0].seq !== patch.seq) {
        throw new RangeError(`Mismatched sequence number: patch ${patch.seq} does not match next request ${state.requests[0].seq}`)
      }
      state.requests = state.requests.slice(1)
    } else {
      state.requests = state.requests.slice()
    }
  } else {
    baseDoc = doc
    state.requests = []
  }

  let newDoc = applyPatchToDoc(baseDoc, patch, state, true)
  if (state.requests.length === 0) {
    return newDoc
  } else {
    state.requests[0] = copyObject(state.requests[0])
    state.requests[0].before = newDoc
    return updateRootObject(doc, {}, state)
  }
}

/**
 * Returns the Automerge object ID of the given object.
 */
function getObjectId(object) {
  return object[OBJECT_ID]
}

/**
 * Returns the object with the given Automerge object ID. Note: when called
 * within a change callback, the returned object is read-only (not a mutable
 * proxy object).
 */
function getObjectById(doc, objectId) {
  // It would be nice to return a proxied object in a change callback.
  // However, that requires knowing the path from the root to the current
  // object, which we don't have if we jumped straight to the object by its ID.
  // If we maintained an index from object ID to parent ID we could work out the path.
  if (doc[CHANGE]) {
    throw new TypeError('Cannot use getObjectById in a change callback')
  }
  return doc[CACHE][objectId]
}

/**
 * Returns the Automerge actor ID of the given document.
 */
function getActorId(doc) {
  return doc[STATE].actorId || doc[OPTIONS].actorId
}

/**
 * Sets the Automerge actor ID on the document object `doc`, returning a
 * document object with updated metadata.
 */
function setActorId(doc, actorId) {
  checkActorId(actorId)
  const state = Object.assign({}, doc[STATE], {actorId})
  return updateRootObject(doc, {}, state)
}

/**
 * Fetches the conflicts on the property `key` of `object`, which may be any
 * object in a document. If `object` is a list, then `key` must be a list
 * index; if `object` is a map, then `key` must be a property name.
 */
function getConflicts(object, key) {
  if (object[CONFLICTS] && object[CONFLICTS][key] &&
      Object.keys(object[CONFLICTS][key]).length > 1) {
    return object[CONFLICTS][key]
  }
}

/**
 * Returns the backend state associated with the document `doc` (only used if
 * a backend implementation is passed to `init()`).
 */
function getBackendState(doc, callerName = null, argPos = 'first') {
  if (doc[OBJECT_ID] !== '_root') {
    // Most likely cause of passing an array here is forgetting to deconstruct the return value of
    // Automerge.applyChanges().
    const extraMsg = Array.isArray(doc) ? '. Note: Automerge.applyChanges now returns an array.' : ''
    if (callerName) {
      throw new TypeError(`The ${argPos} argument to Automerge.${callerName} must be the document root${extraMsg}`)
    } else {
      throw new TypeError(`Argument is not an Automerge document root${extraMsg}`)
    }
  }
  return doc[STATE].backendState
}

/**
 * Given an array or text object from an Automerge document, returns an array
 * containing the unique element ID of each list element/character.
 */
function getElementIds(list) {
  if (list instanceof Text) {
    return list.elems.map(elem => elem.elemId)
  } else {
    return list[ELEM_IDS]
  }
}

module.exports = {
  init, from, change, emptyChange, applyPatch,
  getObjectId, getObjectById, getActorId, setActorId, getConflicts, getLastLocalChange,
  getBackendState, getElementIds,
  Text, Table, Counter, Observable, Float64, Int, Uint
}
