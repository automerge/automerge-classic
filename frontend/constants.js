// Properties of the document root object
const OPTIONS   = Symbol('_options')   // object containing options passed to init()
const CACHE     = Symbol('_cache')     // map from objectId to immutable object
const INBOUND   = Symbol('_inbound')   // map from child objectId to parent objectId
const REQUESTS  = Symbol('_requests')  // list of changes applied locally but not yet confirmed by backend
const MAX_SEQ   = Symbol('_maxSeq')    // maximum sequence number generated so far
const DEPS      = Symbol('_deps')      // map from actorId to max sequence number received from that actor

// Properties of all Automerge objects
const OBJECT_ID = Symbol('_objectId')  // the object ID of the current object (string)
const CONFLICTS = Symbol('_conflicts') // map or list (depending on object type) of conflicts

// Properties of Automerge list objects
const ELEM_IDS  = Symbol('_elemIds')   // list containing the element ID of each list element
const MAX_ELEM  = Symbol('_maxElem')   // maximum element counter value in this list (number)

module.exports = {
  OPTIONS, CACHE, INBOUND, REQUESTS, MAX_SEQ, DEPS, OBJECT_ID, CONFLICTS, ELEM_IDS, MAX_ELEM
}
