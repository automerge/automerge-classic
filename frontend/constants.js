// Properties of the document root object
const OPTIONS   = Symbol('_options')   // object containing options passed to init()
const CACHE     = Symbol('_cache')     // map from objectId to immutable object
const INBOUND   = Symbol('_inbound')   // map from child objectId to parent objectId
const STATE     = Symbol('_state')     // object containing metadata about current state (e.g. sequence numbers)

// Properties of all Automerge objects
const OBJECT_ID = Symbol('_objectId')  // the object ID of the current object (string)
const CONFLICTS = Symbol('_conflicts') // map or list (depending on object type) of conflicts
const DEFAULT_V = Symbol('_defaultV')  // map or list containing the operation ID of the value chosen as default resolution of a conflict
const CHANGE    = Symbol('_change')    // the context object on proxy objects used in change callback

// Properties of Automerge list objects
const ELEM_IDS  = Symbol('_elemIds')   // list containing the element ID of each list element
const MAX_ELEM  = Symbol('_maxElem')   // maximum element counter value in this list (number)

module.exports = {
  OPTIONS, CACHE, INBOUND, STATE, OBJECT_ID, CONFLICTS, DEFAULT_V, CHANGE, ELEM_IDS, MAX_ELEM
}
