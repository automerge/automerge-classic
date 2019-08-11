const { OPTIONS, CACHE, INBOUND, STATE, OBJECT_ID, CONFLICTS, CHANGE, ELEM_IDS } = require('./constants')
const { ROOT_ID, isObject, copyObject } = require('../src/common')
const uuid = require('../src/uuid')
const { interpretPatch, cloneRootObject } = require('./apply_patch')
const { rootObjectProxy } = require('./proxies')
const { Context } = require('./context')
const { Text } = require('./text')
const { Table } = require('./table')
const { Counter } = require('./counter')

/**
 * Takes a set of objects that have been updated (in `updated`) and an updated
 * mapping from child objectId to parent objectId (in `inbound`), and returns
 * a new immutable document root object based on `doc` that reflects those
 * updates. The state object `state` is attached to the new root object.
 */
function updateRootObject(doc, updated, inbound, state) {
  let newDoc = updated[ROOT_ID]
  if (!newDoc) {
    newDoc = cloneRootObject(doc[CACHE][ROOT_ID])
    updated[ROOT_ID] = newDoc
  }
  Object.defineProperty(newDoc, OPTIONS,  {value: doc[OPTIONS]})
  Object.defineProperty(newDoc, CACHE,    {value: updated})
  Object.defineProperty(newDoc, INBOUND,  {value: inbound})
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
    Object.freeze(inbound)
  }
  return newDoc
}

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
      }
    } else {
      result.push(op)
    }
  }
  return result.reverse()
}

/**
 * Adds a new change request to the list of pending requests, and returns an
 * updated document root object. `requestType` is a string indicating the type
 * of request, which may be "change", "undo", or "redo". For the "change" request
 * type, the details of the change are taken from the context object `context`.
 * `message` is an optional human-readable string describing the change.
 */
function makeChange(doc, requestType, context, message) {
  const actor = getActorId(doc)
  if (!actor) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  const state = copyObject(doc[STATE])
  state.seq += 1
  const deps = copyObject(state.deps)
  delete deps[actor]

  const request = {requestType, actor, seq: state.seq, deps}
  if (message !== undefined) {
    request.message = message
  }
  if (context) {
    request.ops = ensureSingleAssignment(context.ops)
  }

  if (doc[OPTIONS].backend) {
    const [backendState, patch] = doc[OPTIONS].backend.applyLocalChange(state.backendState, request)
    state.backendState = backendState
    state.requests = []
    // NOTE: When performing a local change, the patch is effectively applied twice -- once by the
    // context invoking interpretPatch as soon as any change is made, and the second time here
    // (after a round-trip through the backend). This is perhaps more robust, as changes only take
    // effect in the form processed by the backend, but the downside is a performance cost.
    // Should we change this?
    return [applyPatchToDoc(doc, patch, state, true), request]

  } else {
    if (!context) context = new Context(doc, actor)
    const queuedRequest = copyObject(request)
    queuedRequest.before = doc
    queuedRequest.diffs = context.patch.diffs
    state.requests = state.requests.concat([queuedRequest])
    return [updateRootObject(doc, context.updated, context.inbound, state), request]
  }
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
  const inbound = copyObject(doc[INBOUND])
  const updated = {}
  interpretPatch(patch.diffs, doc, updated, inbound)

  if (fromBackend) {
    const seq = patch.clock ? patch.clock[actor] : undefined
    if (seq && seq > state.seq) state.seq = seq
    state.deps = patch.deps
    state.canUndo = patch.canUndo
    state.canRedo = patch.canRedo
  }
  return updateRootObject(doc, updated, inbound, state)
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
  if (options.actorId === undefined && !options.deferActorId) {
    options.actorId = uuid()
  }

  const root = {}, cache = {[ROOT_ID]: root}
  const state = {seq: 0, requests: [], deps: {}, canUndo: false, canRedo: false}
  if (options.backend) {
    state.backendState = options.backend.init()
  }
  Object.defineProperty(root, OBJECT_ID, {value: ROOT_ID})
  Object.defineProperty(root, OPTIONS,   {value: Object.freeze(options)})
  Object.defineProperty(root, CONFLICTS, {value: Object.freeze({})})
  Object.defineProperty(root, CACHE,     {value: Object.freeze(cache)})
  Object.defineProperty(root, INBOUND,   {value: Object.freeze({})})
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
 * `message` is an optional descriptive string that is attached to the change.
 * The actual change is made within the callback function `callback`, which is
 * given a mutable version of the document as argument. Returns a two-element
 * array `[doc, request]` where `doc` is the updated document, and `request`
 * is the change request to send to the backend. If nothing was actually
 * changed, returns the original `doc` and a `null` change request.
 */
function change(doc, message, callback) {
  if (doc[OBJECT_ID] !== ROOT_ID) {
    throw new TypeError('The first argument to Automerge.change must be the document root')
  }
  if (doc[CHANGE]) {
    throw new TypeError('Calls to Automerge.change cannot be nested')
  }
  if (typeof message === 'function' && callback === undefined) {
    ;[message, callback] = [callback, message]
  }
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('Change message must be a string')
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
    return makeChange(doc, 'change', context, message)
  }
}

/**
 * Triggers a new change request on the document `doc` without actually
 * modifying its data. `message` is an optional descriptive string attached to
 * the change. This function can be useful for acknowledging the receipt of
 * some message (as it's incorported into the `deps` field of the change).
 * Returns a two-element array `[doc, request]` where `doc` is the updated
 * document, and `request` is the change request to send to the backend.
 */
function emptyChange(doc, message) {
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('Change message must be a string')
  }

  const actorId = getActorId(doc)
  if (!actorId) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  return makeChange(doc, 'change', new Context(doc, actorId), message)
}

/**
 * Applies `patch` to the document root object `doc`. This patch must come
 * from the backend; it may be the result of a local change or a remote change.
 * If it is the result of a local change, the `seq` field from the change
 * request should be included in the patch, so that we can match them up here.
 */
function applyPatch(doc, patch) {
  const state = copyObject(doc[STATE])
  let baseDoc

  if (state.requests.length > 0) {
    baseDoc = state.requests[0].before
    if (patch.actor === getActorId(doc) && patch.seq !== undefined) {
      if (state.requests[0].seq !== patch.seq) {
        throw new RangeError(`Mismatched sequence number: patch ${patch.seq} does not match next request ${state.requests[0].seq}`)
      }
      state.requests = state.requests.slice(1).map(copyObject)
    } else {
      state.requests = state.requests.slice().map(copyObject)
    }
  } else {
    baseDoc = doc
    state.requests = []
  }

  if (doc[OPTIONS].backend) {
    if (!patch.state) {
      throw new RangeError('When an immediate backend is used, a patch must contain the new backend state')
    }
    state.backendState = patch.state
    state.requests = []
    return applyPatchToDoc(doc, patch, state, true)
  }

  let newDoc = applyPatchToDoc(baseDoc, patch, state, true)
  for (let request of state.requests) {
    // NOTE: technically it is not right to simply re-apply pending patches here: especially if
    // they describe changes to a list or text, the indexes in the patch may need to be shifted
    // due to insertions or deletions made by a remote patch. In the past (~v0.12.0) we had a
    // transformRequest function here that performed a kind of simplistic Operational
    // Transformation in order to adjust list indexes, but we removed it since there were many
    // cases it didn't handle correctly, and it added complexity.
    request.before = newDoc
    newDoc = applyPatchToDoc(request.before, request, state, false)
  }
  return newDoc
}

/**
 * Returns `true` if undo is currently possible on the document `doc` (because
 * there is a local change that has not already been undone); `false` if not.
 */
function canUndo(doc) {
  return !!doc[STATE].canUndo && !isUndoRedoInFlight(doc)
}

/**
 * Returns `true` if one of the pending requests is an undo or redo.
 */
function isUndoRedoInFlight(doc) {
  return doc[STATE].requests.some(req => ['undo', 'redo'].includes(req.requestType))
}

/**
 * Creates a request to perform an undo on the document `doc`, returning a
 * two-element array `[doc, request]` where `doc` is the updated document, and
 * `request` needs to be sent to the backend. `message` is an optional change
 * description to attach to the undo. Note that the undo does not take effect
 * immediately: only after the request is sent to the backend, and the backend
 * responds with a patch, does the user-visible document update actually happen.
 */
function undo(doc, message) {
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('Change message must be a string')
  }
  if (!doc[STATE].canUndo) {
    throw new Error('Cannot undo: there is nothing to be undone')
  }
  if (isUndoRedoInFlight(doc)) {
    throw new Error('Can only have one undo in flight at any one time')
  }
  return makeChange(doc, 'undo', null, message)
}

/**
 * Returns `true` if redo is currently possible on the document `doc` (because
 * a prior action was an undo that has not already been redone); `false` if not.
 */
function canRedo(doc) {
  return !!doc[STATE].canRedo && !isUndoRedoInFlight(doc)
}

/**
 * Creates a request to perform a redo of a prior undo on the document `doc`,
 * returning a two-element array `[doc, request]` where `doc` is the updated
 * document, and `request` needs to be sent to the backend. `message` is an
 * optional change description to attach to the redo. Note that the redo does
 * not take effect immediately: only after the request is sent to the backend,
 * and the backend responds with a patch, does the user-visible document
 * update actually happen.
 */
function redo(doc, message) {
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('Change message must be a string')
  }
  if (!doc[STATE].canRedo) {
    throw new Error('Cannot redo: there is no prior undo')
  }
  if (isUndoRedoInFlight(doc)) {
    throw new Error('Can only have one redo in flight at any one time')
  }
  return makeChange(doc, 'redo', null, message)
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
  const state = Object.assign({}, doc[STATE], {actorId})
  return updateRootObject(doc, {}, doc[INBOUND], state)
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
function getBackendState(doc) {
  return doc[STATE].backendState
}

function getElementIds(list) {
  return list[ELEM_IDS]
}

module.exports = {
  init, from, change, emptyChange, applyPatch,
  canUndo, undo, canRedo, redo,
  getObjectId, getObjectById, getActorId, setActorId, getConflicts,
  getBackendState, getElementIds,
  Text, Table, Counter
}
