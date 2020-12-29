// Properties of the document root object
const OPTIONS   = Symbol('_options')   // object containing options passed to init()
const CACHE     = Symbol('_cache')     // map from objectId to immutable object
const STATE     = Symbol('_state')     // object containing metadata about current state (e.g. sequence numbers)

// Properties of all Automerge objects
const OBJECT_ID = Symbol('_objectId')  // the object ID of the current object (string)
const CONFLICTS = Symbol('_conflicts') // map or list (depending on object type) of conflicts
const CHANGE    = Symbol('_change')    // the context object on proxy objects used in change callback
const ELEM_IDS  = Symbol('_elemIds')   // list containing the element ID of each list element

module.exports = {
  OPTIONS, CACHE, STATE, OBJECT_ID, CONFLICTS, CHANGE, ELEM_IDS
}
