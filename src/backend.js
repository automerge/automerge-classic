const { Map, List, fromJS } = require('immutable')
const OpSet = require('./op_set')
const { Text } = require('./text')

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

class MaterializationContext {
  constructor () {
    this.diffs = {}
    this.children = {}
  }

  /**
   * Unpacks `value`: if it's an object of the form `{objectId: '...'}`, updates
   * `diff` to link to that objectId. Otherwise uses `value` as a primitive.
   */
  unpackValue(parentId, diff, value) {
    if (isObject(value)) {
      diff.value = value.objectId
      diff.link = true
      this.children[parentId].push(value.objectId)
    } else {
      diff.value = value
    }
  }

  /**
   * Unpacks `conflicts`: if it's an Immutable.js Map object (where keys are
   * actor IDs and values are primitive or object values), updates `diff` to
   * describe the conflicts.
   */
  unpackConflicts(parentId, diff, conflicts) {
    if (conflicts) {
      diff.conflicts = []

      for (let [actor, value] of conflicts) {
        let conflict = {actor}
        this.unpackValue(parentId, conflict, value)
        diff.conflicts.push(conflict)
      }
    }
  }

  /**
   * Updates `this.diffs[objectId]` to contain the patch necessary to
   * instantiate the map object with ID `objectId`.
   */
  instantiateMap(opSet, objectId) {
    let diffs = this.diffs[objectId]
    if (objectId !== OpSet.ROOT_ID) {
      diffs.push({obj: objectId, type: 'map', action: 'create'})
    }

    const conflicts = OpSet.getObjectConflicts(opSet, objectId, this)

    for (let key of OpSet.getObjectFields(opSet, objectId)) {
      let diff = {obj: objectId, type: 'map', action: 'set', key}
      this.unpackValue(objectId, diff, OpSet.getObjectField(opSet, objectId, key, this))
      this.unpackConflicts(objectId, diff, conflicts.get(key))
      diffs.push(diff)
    }
  }

  /**
   * Updates `this.diffs[objectId]` to contain the patch necessary to
   * instantiate the list or text object with ID `objectId`.
   */
  instantiateList(opSet, objectId, type) {
    let diffs = this.diffs[objectId]
    diffs.push({obj: objectId, type, action: 'create'})

    let conflicts = OpSet.listIterator(opSet, objectId, 'conflicts', this)
    let values    = OpSet.listIterator(opSet, objectId, 'values',    this)

    for (let [index, elemId] of OpSet.listIterator(opSet, objectId, 'elems', this)) {
      let diff = {obj: objectId, type, action: 'insert', index, elemId}
      this.unpackValue(objectId, diff, values.next().value)
      this.unpackConflicts(objectId, diff, conflicts.next().value)
      diffs.push(diff)
    }
  }

  /**
   * Called by OpSet.getOpValue() when recursively instantiating an object in
   * the document tree. Updates `this.diffs[objectId]` to contain the patch
   * necessary to instantiate the object, and returns `{objectId: objectId}`
   * (which is then interpreted by `this.unpackValue()`).
   */
  instantiateObject(opSet, objectId) {
    if (this.diffs[objectId]) return {objectId}

    const isRoot = (objectId === OpSet.ROOT_ID)
    const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])
    this.diffs[objectId] = []
    this.children[objectId] = []

    if (isRoot || objType === 'makeMap') {
      this.instantiateMap(opSet, objectId)
    } else if (objType === 'makeList') {
      this.instantiateList(opSet, objectId, 'list')
    } else if (objType === 'makeText') {
      this.instantiateList(opSet, objectId, 'text')
    } else {
      throw new RangeError(`Unknown object type: ${objType}`)
    }
    return {objectId}
  }

  /**
   * Constructs the list of all `diffs` necessary to instantiate the object tree
   * whose root is the object with ID `objectId`.
   */
  makePatch(objectId, diffs) {
    for (let childId of this.children[objectId]) {
      this.makePatch(childId, diffs)
    }
    diffs.push(...this.diffs[objectId])
  }
}

/**
 * Constructs a patch that instantiates the current state of the entire object
 * tree described by `opSet`.
 */
function materialize(opSet) {
  let diffs = []
  let context = new MaterializationContext(opSet)
  context.instantiateObject(opSet, OpSet.ROOT_ID)
  context.makePatch(OpSet.ROOT_ID, diffs)
  return {diffs}
}

function init(actorId) {
  const opSet = OpSet.init()
  return Map({actorId, opSet})
}

function applyChanges(state, changes, incremental) {
  let diffs = [], opSet = state.get('opSet')
  for (let change of fromJS(changes)) {
    let [newOpSet, diff] = OpSet.addChange(opSet, change)
    diffs.push(...diff)
    opSet = newOpSet
  }

  state = state.set('opSet', opSet)
  if (incremental) {
    return [state, {diffs}]
  } else {
    return [state, materialize(opSet)]
  }
}

module.exports = {
  init, applyChanges
}
