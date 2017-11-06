const { Map, List, Set } = require('immutable')
const OpSet = require('./op_set')

function updateMapObject(opSet, edit) {
  if (edit.action === 'create') {
    return opSet.setIn(['cache', edit.obj], Object.freeze({_objectId: edit.obj}))
  }

  const oldObject = opSet.getIn(['cache', edit.obj])
  const conflicts = Object.assign({}, oldObject._conflicts)
  const object = Object.assign(Object.create({_conflicts: conflicts}), oldObject)

  if (edit.action === 'set') {
    object[edit.key] = edit.link ? opSet.getIn(['cache', edit.value]) : edit.value
    if (edit.conflicts) {
      conflicts[edit.key] = {}
      for (let conflict of edit.conflicts) {
        const value = conflict.link ? opSet.getIn(['cache', conflict.value]) : conflict.value
        conflicts[edit.key][conflict.actor] = value
      }
      Object.freeze(conflicts[edit.key])
    } else {
      delete conflicts[edit.key]
    }
  } else if (edit.action === 'remove') {
    delete object[edit.key]
    delete conflicts[edit.key]
  } else throw 'Unknown action type: ' + edit.action

  Object.freeze(conflicts)
  return opSet.setIn(['cache', edit.obj], Object.freeze(object))
}

function updateListObject(opSet, edit) {
  if (edit.action === 'create') {
    let list = []
    Object.defineProperty(list, '_objectId', {value: edit.obj})
    return opSet.setIn(['cache', edit.obj], Object.freeze(list))
  }

  let value = edit.link ? opSet.getIn(['cache', edit.value]) : edit.value
  let list = opSet.getIn(['cache', edit.obj]).slice()
  Object.defineProperty(list, '_objectId', {value: edit.obj})

  if (edit.action === 'insert') {
    list.splice(edit.index, 0, value)
  } else if (edit.action === 'set') {
    list[edit.index] = value
  } else if (edit.action === 'remove') {
    list.splice(edit.index, 1)
  } else throw 'Unknown action type: ' + edit.action
  return opSet.setIn(['cache', edit.obj], Object.freeze(list))
}

function updateCache(opSet, diffs) {
  let affected = Set()
  for (let edit of diffs) {
    affected = affected.add(edit.obj)
    if (edit.type === 'map') {
      opSet = updateMapObject(opSet, edit)
    } else if (edit.type === 'list') {
      opSet = updateListObject(opSet, edit)
    } else throw 'Unknown object type: ' + edit.type
  }

  // Update cache entries on the path from the root to the modified object
  while (!affected.isEmpty()) {
    const parentOps = affected.flatMap(objectId => opSet.getIn(['byObject', objectId, '_inbound'], Set()))
    affected = Set()
    for (let ref of parentOps) {
      const objectId = ref.get('obj')
      const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])
      affected = affected.add(objectId)

      if (objType === 'makeList') {
        const index = opSet.getIn(['byObject', objectId, '_elemIds']).indexOf(ref.get('key'))
        const edit = {action: 'set', obj: objectId, index, value: ref.get('value'), link: true}
        opSet = updateListObject(opSet, edit)
      } else {
        const edit = {action: 'set', obj: objectId, key: ref.get('key'), value: ref.get('value'), link: true}
        // TODO get conflicts
        opSet = updateMapObject(opSet, edit)
      }
    }
  }
  return opSet
}

function instantiateImmutable(opSet, objectId) {
  const isRoot = (objectId === OpSet.ROOT_ID)
  const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])

  // Don't read the root object from cache, because it may reference an outdated state.
  // The state may change without without invalidating the cache entry for the root object (for
  // example, adding an item to the queue of operations that are not yet causally ready).
  if (!isRoot && this.cache && this.cache[objectId]) return this.cache[objectId]

  let obj
  if (isRoot || objType === 'makeMap') {
    const conflicts = OpSet.getObjectConflicts(opSet, objectId, this)
    obj = Object.create({_conflicts: Object.freeze(conflicts.toJS())})

    OpSet.getObjectFields(opSet, objectId).forEach(field => {
      obj[field] = OpSet.getObjectField(opSet, objectId, field, this)
    })
  } else if (objType === 'makeList') {
    obj = [...OpSet.listIterator(opSet, objectId, 'values', this)]
    Object.defineProperty(obj, '_objectId', {value: objectId})
  } else {
    throw 'Unknown object type: ' + objType
  }

  Object.freeze(obj)
  if (this.cache) this.cache[objectId] = obj
  return obj
}

function materialize(opSet) {
  opSet = opSet.set('cache', Map())
  const context = {instantiateObject: instantiateImmutable, cache: {}}
  const snapshot = context.instantiateObject(opSet, OpSet.ROOT_ID)
  return [opSet.set('cache', Map(context.cache)), snapshot]
}

function rootObject(state, rootObj) {
  Object.assign(Object.getPrototypeOf(rootObj), {_state: state, _actorId: state.get('actorId')})
  Object.freeze(Object.getPrototypeOf(rootObj))
  return rootObj
}

function init(actorId) {
  const [opSet, rootObj] = materialize(OpSet.init())
  const state = Map({actorId, opSet})
  return rootObject(state, rootObj)
}

function applyChanges(root, changes, incremental) {
  let opSet = root._state.get('opSet'), diffs = [], diff
  for (let change of changes) {
    [opSet, diff] = OpSet.addChange(opSet, change)
    diffs.push(...diff)
  }

  if (incremental) opSet = updateCache(opSet, diffs)
  let newRoot
  [opSet, newRoot] = materialize(opSet)
  return rootObject(root._state.set('opSet', opSet), newRoot)
}

module.exports = {
  init, applyChanges
}
