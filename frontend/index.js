const { OPTIONS, CACHE, INBOUND, STATE, OBJECT_ID, CONFLICTS, CHANGE, ELEM_IDS } = require('./constants')
const { ROOT_ID, isObject, copyObject } = require('../src/common')
const uuid = require('../src/uuid')
const { applyDiffs, updateParentObjects, cloneRootObject } = require('./apply_patch')
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
 * `options` contains properties that may affect how the change is processed; in
 * particular, the `message` property of `options` is an optional human-readable
 * string describing the change.
 */
function makeChange(doc, requestType, context, options) {
  const actor = getActorId(doc)
  if (!actor) {
    throw new Error('Actor ID must be initialized with setActorId() before making a change')
  }
  const state = copyObject(doc[STATE])
  state.seq += 1
  const deps = copyObject(state.deps)
  delete deps[actor]

  const request = {requestType, actor, seq: state.seq, deps}
  if (options && options.message !== undefined) {
    request.message = options.message
  }
  if (options && options.undoable === false) {
    request.undoable = false
  }
  if (context) {
    request.ops = ensureSingleAssignment(context.ops)
  }

  if (doc[OPTIONS].backend) {
    const [backendState, patch] = doc[OPTIONS].backend.applyLocalChange(state.backendState, request)
    state.backendState = backendState
    state.requests = []
    return [applyPatchToDoc(doc, patch, state, true), request]

  } else {
    if (!context) context = new Context(doc, actor)
    const queuedRequest = copyObject(request)
    queuedRequest.before = doc
    queuedRequest.diffs = context.diffs
    state.requests = state.requests.slice() // shallow clone
    state.requests.push(queuedRequest)
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
  applyDiffs(patch.diffs, doc[CACHE], updated, inbound)
  updateParentObjects(doc[CACHE], updated, inbound)

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
 * Mutates the request object `request` (representing a change made locally but
 * not yet applied by the backend), transforming it past the remote `patch`.
 * The transformed version of `request` can be applied after `patch` has been
 * applied, and its effect is the same as when the original version of `request`
 * is applied to the base document without `patch`.
 *
 * This function implements a simple form of Operational Transformation.
 * However, the implementation here is actually incomplete and incorrect.
 * Fortunately, it's actually not a big problem if the transformation here is
 * not quite right, because the transformed request is only used transiently
 * while waiting for a response from the backend. When the backend responds, the
 * transformation result is discarded and replaced with the backend's version.
 *
 * One scenario that is not handled correctly is insertion at the same index:
 * request = {diffs: [{obj: someList, type: 'list', action: 'insert', index: 1}]}
 * patch = {diffs: [{obj: someList, type: 'list', action: 'insert', index: 1}]}
 *
 * Correct behaviour (i.e. consistent with the CRDT) would be to order the two
 * insertions by their elemIds; any subsequent insertions with consecutive
 * indexes may also need to be adjusted accordingly (to keep an insertion
 * sequence by a particular actor uninterrupted).
 *
 * Another scenario that is not handled correctly:
 * requests = [
 *   {diffs: [{obj: someList, type: 'list', action: 'insert', index: 1, value: 'a'}]},
 *   {diffs: [{obj: someList, type: 'list', action: 'set',    index: 1, value: 'b'}]}
 * ]
 * patch = {diffs: [{obj: someList, type: 'list', action: 'remove', index: 1}]}
 *
 * The first request's insertion is correctly left unchanged, but the 'set' action
 * is incorrectly turned into an 'insert' because we don't realise that it is
 * assigning the previously inserted list item (not the deleted item).
 *
 * A third scenario is concurrent assignment to the same list element or map key;
 * this should create a conflict.
 */
function transformRequest(request, patch) {
  let transformed = []

  local_loop:
  for (let local of request.diffs) {
    local = copyObject(local)

    for (let remote of patch.diffs) {
      // If the incoming patch modifies list indexes (because it inserts or removes),
      // adjust the indexes in local diffs accordingly
      if (local.obj === remote.obj && local.type === 'list' &&
          ['insert', 'set', 'remove'].includes(local.action)) {
        if (remote.action === 'insert' && remote.index <=  local.index) local.index += 1
        if (remote.action === 'remove' && remote.index <   local.index) local.index -= 1
        if (remote.action === 'remove' && remote.index === local.index) {
          if (local.action === 'set') local.action = 'insert'
          if (local.action === 'remove') continue local_loop // drop this diff
        }
      }
    }
    transformed.push(local)
  }

  request.diffs = transformed
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
 * `options` is an object that can contain the following properties:
 *  - `message`: an optional descriptive string that is attached to the change.
 *  - `undoable`: false if the change should not affect the undo history.
 * If `options` is a string, it is treated as `message`.
 *
 * The actual change is made within the callback function `callback`, which is
 * given a mutable version of the document as argument. Returns a two-element
 * array `[doc, request]` where `doc` is the updated document, and `request`
 * is the change request to send to the backend. If nothing was actually
 * changed, returns the original `doc` and a `null` change request.
 */
function change(doc, options, callback) {
  if (doc[OBJECT_ID] !== ROOT_ID) {
    throw new TypeError('The first argument to Automerge.change must be the document root')
  }
  if (doc[CHANGE]) {
    throw new TypeError('Calls to Automerge.change cannot be nested')
  }
  if (typeof options === 'function' && callback === undefined) {
    ;[options, callback] = [callback, options]
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
    updateParentObjects(doc[CACHE], context.updated, context.inbound)
    return makeChange(doc, 'change', context, options)
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
  return makeChange(doc, 'change', new Context(doc, actorId), options)
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
    request.before = newDoc
    transformRequest(request, patch)
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
 * `request` needs to be sent to the backend. `options` is an object as
 * described in the documentation for the `change` function; it may contain a
 * `message` property with an optional change description to attach to the undo.
 * Note that the undo does not take effect immediately: only after the request
 * is sent to the backend, and the backend responds with a patch, does the
 * user-visible document update actually happen.
 */
function undo(doc, options) {
  if (typeof options === 'string') {
    options = {message: options}
  }
  if (options !== undefined && !isObject(options)) {
    throw new TypeError('Unsupported type of options')
  }
  if (!doc[STATE].canUndo) {
    throw new Error('Cannot undo: there is nothing to be undone')
  }
  if (isUndoRedoInFlight(doc)) {
    throw new Error('Can only have one undo in flight at any one time')
  }
  return makeChange(doc, 'undo', null, options)
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
 * document, and `request` needs to be sent to the backend. `options` is an
 * object as described in the documentation for the `change` function; it may
 * contain a `message` property with an optional change description to attach
 * to the redo. Note that the redo does not take effect immediately: only
 * after the request is sent to the backend, and the backend responds with a
 * patch, does the user-visible document update actually happen.
 */
function redo(doc, options) {
  if (typeof options === 'string') {
    options = {message: options}
  }
  if (options !== undefined && !isObject(options)) {
    throw new TypeError('Unsupported type of options')
  }
  if (!doc[STATE].canRedo) {
    throw new Error('Cannot redo: there is no prior undo')
  }
  if (isUndoRedoInFlight(doc)) {
    throw new Error('Can only have one redo in flight at any one time')
  }
  return makeChange(doc, 'redo', null, options)
}

/**
 * Returns the Automerge object ID of the given object.
 */
function getObjectId(object) {
  return object[OBJECT_ID]
}

/**
 * Returns the object with the given Automerge object ID.
 */
function getObjectById(doc, objectId) {
  const context = doc[CHANGE]
  if (context) {
    // If we're within a change callback, return a proxied object
    return context.instantiateObject(objectId)
  } else {
    return doc[CACHE][objectId]
  }
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
  return object[CONFLICTS][key]
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
