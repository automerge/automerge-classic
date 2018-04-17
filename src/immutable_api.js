const { Map, List, Set } = require('immutable')
const OpSet = require('./op_set')
const { Text } = require('./text')

function instantiateImmutable(opSet, objectId) {
  const isRoot = (objectId === OpSet.ROOT_ID)
  const objType = opSet.getIn(['byObject', objectId, '_init', 'action'])

  // Don't read the root object from cache, because it may reference an outdated state.
  // The state may change without without invalidating the cache entry for the root object (for
  // example, adding an item to the queue of operations that are not yet causally ready).
  if (!isRoot) {
    if (opSet.hasIn(['cache', objectId])) return opSet.getIn(['cache', objectId])
    if (this.cache && this.cache[objectId]) return this.cache[objectId]
  }

  let obj
  if (isRoot || objType === 'makeMap') {
    const conflicts = OpSet.getObjectConflicts(opSet, objectId, this)
    obj = Map().set('_conflicts', conflicts).set('_objectId', objectId)

    for (let field of OpSet.getObjectFields(opSet, objectId)) {
      obj = obj.set(field, OpSet.getObjectField(opSet, objectId, field, this))
    }
  } else if (objType === 'makeList') {
    obj = List(OpSet.listIterator(opSet, objectId, 'values', this))
  } else if (objType === 'makeText') {
    obj = new Text(opSet, objectId)
  } else {
    throw 'Unknown object type: ' + objType
  }

  obj._objectId = objectId
  if (this.cache) this.cache[objectId] = obj
  return obj
}

function materialize(opSet) {
  opSet = opSet.set('cache', Map())
  const context = {instantiateObject: instantiateImmutable, cache: {}}
  const rootObj = context.instantiateObject(opSet, OpSet.ROOT_ID)
  return [opSet.set('cache', Map(context.cache)), rootObj]
}

function refresh(opSet, objectId) {
  opSet = opSet.deleteIn(['cache', objectId])
  const context = {instantiateObject: instantiateImmutable, cache: {}}
  const object = context.instantiateObject(opSet, objectId)
  return opSet.setIn(['cache', objectId], object)
}

function updateMapObject(opSet, edit) {
  if (edit.action === 'create') {
    const object = Map({_objectId: edit.obj})
    object._objectId = edit.obj
    return opSet.setIn(['cache', edit.obj], object)
  }

  let object = opSet.getIn(['cache', edit.obj])
  if (edit.action === 'set') {
    let conflicts = null
    if (edit.conflicts) {
      conflicts = Map().withMutations(conflicts => {
        for (let conflict of edit.conflicts) {
          const value = conflict.link ? opSet.getIn(['cache', conflict.value]) : conflict.value
          conflicts.set(conflict.actor, value)
        }
      })
    }

    object = object.withMutations(obj => {
      obj.set(edit.key, edit.link ? opSet.getIn(['cache', edit.value]) : edit.value)
      if (conflicts) {
        obj.setIn(['_conflicts', edit.key], conflicts)
      } else {
        obj.deleteIn(['_conflicts', edit.key])
      }
    })
  } else if (edit.action === 'remove') {
    object = object.withMutations(obj => {
      obj.delete(edit.key)
      obj.deleteIn(['_conflicts', edit.key])
    })
  } else throw 'Unknown action type: ' + edit.action

  object._objectId = edit.obj
  return opSet.setIn(['cache', edit.obj], object)
}

function updateListObject(opSet, edit) {
  if (edit.action === 'create') {
    const list = List()
    list._objectId = edit.obj
    return opSet.setIn(['cache', edit.obj], list)
  }

  const value = edit.link ? opSet.getIn(['cache', edit.value]) : edit.value
  let list = opSet.getIn(['cache', edit.obj])

  if (edit.action === 'insert') {
    list = list.insert(edit.index, value)
  } else if (edit.action === 'set') {
    list = list.set(edit.index, value)
  } else if (edit.action === 'remove') {
    list = list.delete(edit.index)
  } else throw 'Unknown action type: ' + edit.action

  list._objectId = edit.obj
  return opSet.setIn(['cache', edit.obj], list)
}

function updateCache(opSet, diffs) {
  let affected = Set()
  for (let edit of diffs) {
    affected = affected.add(edit.obj)
    if (edit.type === 'map') {
      opSet = updateMapObject(opSet, edit)
    } else if (edit.type === 'list') {
      opSet = updateListObject(opSet, edit)
    } else if (edit.type === 'text') {
      opSet = opSet.setIn(['cache', edit.obj], new Text(opSet, edit.obj))
    } else throw 'Unknown object type: ' + edit.type
  }

  // Update cache entries on the path from the root to the modified object
  while (!affected.isEmpty()) {
    affected = affected.flatMap(objectId => {
      return opSet
        .getIn(['byObject', objectId, '_inbound'], Set())
        .map(op => op.get('obj'))
    })
    for (let objectId of affected) opSet = refresh(opSet, objectId)
  }
  return opSet
}

function init(actorId) {
  const [opSet, rootObj] = materialize(OpSet.init())
  rootObj._state = Map({actorId, opSet})
  rootObj._actorId = actorId
  return rootObj
}

function applyChanges(root, changes, incremental) {
  let opSet = root._state.get('opSet'), diffs = [], diff
  for (let change of changes) {
    [opSet, diff] = OpSet.addChange(opSet, change)
    diffs.push(...diff)
  }

  let newRoot
  if (incremental) {
    opSet = updateCache(opSet, diffs)
    newRoot = opSet.getIn(['cache', OpSet.ROOT_ID])
    if (newRoot === root) {
      // Ugly hack to get a clone of the root object (since we mutably assign _state below)
      newRoot = root.set('_ignore', true).remove('_ignore')
    }
  } else {
    [opSet, newRoot] = materialize(opSet)
  }
  newRoot._state = root._state.set('opSet', opSet)
  newRoot._actorId = root._state.get('actorId')
  newRoot._objectId = root._objectId
  return newRoot
}

module.exports = {
  init, applyChanges
}
