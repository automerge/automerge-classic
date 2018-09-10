const { OPTIONS, CACHE, INBOUND, REQUESTS, MAX_SEQ, DEPS, OBJECT_ID, CONFLICTS } = require('./constants')
const { ROOT_ID, isObject } = require('../src/common')
const uuid = require('../src/uuid')
const { applyDiff, updateParentObjects } = require('./apply_patch')
const { rootObjectProxy } = require('./proxies')
const { Context } = require('./context')

/**
 * Takes a set of objects that have been updated (in `updated`) and an updated
 * mapping from child objectId to parent objectId (in `inbound`), and returns
 * a new immutable document root object based on `doc` that reflects those
 * updates. The request queue `requests`, the sequence number `maxSeq` and the
 * dependencies map `deps` are attached to the new root object.
 */
function updateRootObject(doc, updated, inbound, requests, maxSeq, deps) {
  let newDoc = updated[ROOT_ID]
  if (!newDoc) {
    throw new Error('Root object was not modified by patch')
  }
  Object.defineProperty(newDoc, OPTIONS,  {value: doc[OPTIONS]})
  Object.defineProperty(newDoc, CACHE,    {value: updated})
  Object.defineProperty(newDoc, INBOUND,  {value: inbound})
  Object.defineProperty(newDoc, REQUESTS, {value: requests})
  Object.defineProperty(newDoc, MAX_SEQ,  {value: maxSeq})
  Object.defineProperty(newDoc, DEPS,     {value: deps})

  for (let objectId of Object.keys(doc[CACHE])) {
    if (updated[objectId]) {
      Object.freeze(updated[objectId])
      Object.freeze(updated[objectId][CONFLICTS])
    } else {
      updated[objectId] = doc[CACHE][objectId]
    }
  }

  Object.freeze(updated)
  Object.freeze(inbound)
  return newDoc
}

/**
 * Applies the changes described in `patch` to the document with root object
 * `doc`. The request queue `requests`, the sequence number `maxSeq` and the
 * dependencies map `deps` are attached to the new root object.
 */
function applyPatchToDoc(doc, patch, requests, maxSeq, deps) {
  let inbound = Object.assign({}, doc[INBOUND])
  let updated = {}

  for (let diff of patch.diffs) {
    applyDiff(diff, doc[CACHE], updated, inbound)
  }

  updateParentObjects(doc[CACHE], updated, inbound)
  return updateRootObject(doc, updated, inbound, requests, maxSeq, deps)
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
    local = Object.assign({}, local)

    for (let remote of patch.diffs) {
      // If the incoming patch modifies list indexes (because it inserts or removes),
      // adjust the indexes in local diffs accordingly
      if (local.obj === remote.obj && local.type === 'list' &&
          ['insert', 'set', 'remove'].includes(local.action)) {
        // TODO not correct: for two concurrent inserts with the same index, the order
        // needs to be determined by the elemIds to maintain consistency with the CRDT
        if (remote.action === 'insert' && remote.index <=  local.index) local.index += 1
        if (remote.action === 'remove' && remote.index <   local.index) local.index -= 1
        if (remote.action === 'remove' && remote.index === local.index) {
          if (local.action === 'set') local.action = 'insert'
          if (local.action === 'remove') continue local_loop // drop this diff
        }
      }

      // If the incoming patch assigns a list element or map key, and a local diff updates
      // the same key, make a conflict (since the two assignments are definitely concurrent).
      // The assignment with the highest actor ID determines the default resolution.
      if (local.obj === remote.obj && local.action === 'set' && remote.action === 'set' &&
          ((local.type === 'list' && local.index === remote.index) ||
           (local.type === 'map'  && local.key   === remote.key  ))) {
        // TODO
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
    options = {actorId: uuid()}
  } else if (!isObject(options)) {
    throw new TypeError(`Unsupported value for init() options: ${options}`)
  }

  let root = {}, cache = {[ROOT_ID]: root}
  Object.defineProperty(root, OBJECT_ID, {value: ROOT_ID})
  Object.defineProperty(root, OPTIONS,   {value: Object.freeze(options)})
  Object.defineProperty(root, CONFLICTS, {value: Object.freeze({})})
  Object.defineProperty(root, CACHE,     {value: Object.freeze(cache)})
  Object.defineProperty(root, INBOUND,   {value: Object.freeze({})})
  Object.defineProperty(root, REQUESTS,  {value: Object.freeze([])})
  Object.defineProperty(root, MAX_SEQ,   {value: 0})
  Object.defineProperty(root, DEPS,      {value: Object.freeze({})})
  return Object.freeze(root)
}

/**
 * Changes a document `doc` according to actions taken by the local user.
 * `message` is an optional descriptive string that is attached to the change.
 * The actual change is made within the callback function `callback`, which is
 * given a mutable version of the document as argument.
 */
function change(doc, message, callback) {
  if (doc[OBJECT_ID] !== ROOT_ID) {
    throw new TypeError('The first argument to Automerge.change must be the document root')
  }
  if (doc._change && doc._change.mutable) {
    throw new TypeError('Calls to Automerge.change cannot be nested')
  }
  if (typeof message === 'function' && callback === undefined) {
    ;[message, callback] = [callback, message]
  }
  if (message !== undefined && typeof message !== 'string') {
    throw new TypeError('Change message must be a string')
  }

  let context = new Context(doc)
  callback(rootObjectProxy(context))

  if (Object.keys(context.updated).length === 0) {
    // If the callback didn't change anything, return the original document object unchanged
    return doc
  } else {
    // TODO: If there are multiple assignment operations for the same object and key,
    // we should keep only the most recent (this applies to both ops and diffs)
    updateParentObjects(doc[CACHE], context.updated, context.inbound)

    const actor = doc[OPTIONS].actorId
    const seq = doc[MAX_SEQ] + 1
    const deps = Object.assign({}, doc[DEPS])
    delete deps[actor]

    const requests = doc[REQUESTS].slice() // shallow clone
    const request = {actor, seq, deps, before: doc, ops: context.ops, diffs: context.diffs}
    requests.push(request)

    return updateRootObject(doc, context.updated, context.inbound, requests, seq, doc[DEPS])
  }
}

/**
 * Applies `patch` to the document root object `doc`. This patch must come
 * from the backend; it may be the result of a local change or a remote change.
 * If it is the result of a local change, the `seq` field from the change
 * request should be included in the patch, so that we can match them up here.
 */
function applyPatch(doc, patch) {
  let baseDoc, remainingRequests
  if (patch.actor === getActorId(doc) && patch.seq !== undefined) {
    if (doc[REQUESTS].length === 0) {
      throw new RangeError(`No matching request for sequence number ${patch.seq}`)
    }
    if (doc[REQUESTS][0].seq !== patch.seq) {
      throw new RangeError(`Mismatched sequence number: patch ${patch.seq} does not match next request ${doc[REQUESTS][0].seq}`)
    }
    baseDoc = doc[REQUESTS][0].before
    remainingRequests = doc[REQUESTS].slice(1).map(req => Object.assign({}, req))
  } else if (doc[REQUESTS].length > 0) {
    baseDoc = doc[REQUESTS][0].before
    remainingRequests = doc[REQUESTS].slice().map(req => Object.assign({}, req))
  } else {
    baseDoc = doc
    remainingRequests = []
  }

  const actor = doc[OPTIONS].actorId
  const deps = patch.deps || {}
  const maxSeq = deps[actor] || doc[MAX_SEQ]
  let newDoc = applyPatchToDoc(baseDoc, patch, remainingRequests, maxSeq, patch.deps)

  for (let request of remainingRequests) {
    request.before = newDoc
    transformRequest(request, patch)
    newDoc = applyPatchToDoc(request.before, request, remainingRequests, maxSeq, patch.deps)
  }
  return newDoc
}

/**
 * Returns the Automerge object ID of the given object.
 */
function getObjectId(object) {
  return object[OBJECT_ID]
}

/**
 * Returns the Automerge actor ID of the given document.
 */
function getActorId(doc) {
  return doc[OPTIONS].actorId
}

/**
 * Fetches the conflicts on `object`, which may be any object in a document.
 * If the object is a map, returns an object mapping keys to conflict sets
 * (only for those keys that actually have conflicts). If the object is a list,
 * returns a list that contains null for non-conflicting indexes and a conflict
 * set otherwise.
 */
function getConflicts(object) {
  return object[CONFLICTS]
}

/**
 * Returns the list of change requests pending on the document `doc`.
 */
function getRequests(doc) {
  return doc[REQUESTS].map(req => {
    const { actor, seq, deps, ops } = req
    return { actor, seq, deps, ops }
  })
}

module.exports = {
  init, change, applyPatch, getObjectId, getActorId, getConflicts, getRequests
}
