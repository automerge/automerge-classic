const { Map, List, Set } = require('immutable')
const OpSet = require('./op_set')
const { Text } = require('./text')

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

function updateMapObject(opSet, diffs) {
  const objectId = diffs[0].obj
  const oldObject = opSet.getIn(['cache', objectId])
  const conflicts = Object.assign({}, isObject(oldObject) ? oldObject._conflicts : undefined)
  const object = Object.assign({}, oldObject)
  Object.defineProperty(object, '_objectId',  {value: objectId})
  Object.defineProperty(object, '_conflicts', {value: conflicts})

  for (let edit of diffs) {
    if (edit.action === 'create') {
      // do nothing
    } else if (edit.action === 'set') {
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
  }

  Object.freeze(conflicts)
  if (objectId !== OpSet.ROOT_ID) Object.freeze(object)
  return opSet.setIn(['cache', objectId], object)
}

function parentMapObject(opSet, ref) {
  const oldObject = opSet.getIn(['cache', ref.get('obj')])
  const conflicts = Object.assign({}, oldObject._conflicts)
  const object = Object.assign({}, oldObject)
  Object.defineProperty(object, '_objectId',  {value: oldObject._objectId})
  Object.defineProperty(object, '_conflicts', {value: conflicts})
  const value = opSet.getIn(['cache', ref.get('value')])
  let changed = false

  if (isObject(object[ref.get('key')]) && object[ref.get('key')]._objectId === ref.get('value')) {
    object[ref.get('key')] = value
    changed = true
  }
  if (isObject(conflicts[ref.get('key')])) {
    for (let actor of Object.keys(conflicts[ref.get('key')])) {
      const conflict = conflicts[ref.get('key')][actor]
      if (isObject(conflict) && conflict._objectId === ref.get('value')) {
        conflicts[ref.get('key')] = Object.assign({}, conflicts[ref.get('key')])
        conflicts[ref.get('key')][actor] = value
        Object.freeze(conflicts[ref.get('key')])
        changed = true
      }
    }
  }

  if (changed) {
    Object.freeze(conflicts)
    if (ref.get('obj') !== OpSet.ROOT_ID) Object.freeze(object)
    opSet = opSet.setIn(['cache', ref.get('obj')], object)
  }
  return opSet
}

function updateListObject(opSet, diffs) {
  const objectId = diffs[0].obj
  const oldList = opSet.getIn(['cache', objectId])
  const list = oldList ? oldList.slice() : [] // slice() makes a shallow clone
  const conflicts = (oldList && oldList._conflicts) ? oldList._conflicts.slice() : []
  Object.defineProperty(list, '_objectId',  {value: objectId})
  Object.defineProperty(list, '_conflicts', {value: conflicts})

  for (let edit of diffs) {
    const value = edit.link ? opSet.getIn(['cache', edit.value]) : edit.value
    let conflict = null
    if (edit.conflicts) {
      conflict = {}
      for (let c of edit.conflicts) {
        conflict[c.actor] = c.link ? opSet.getIn(['cache', c.value]) : c.value
      }
      Object.freeze(conflict)
    }

    if (edit.action === 'create') {
      // do nothing
    } else if (edit.action === 'insert') {
      list.splice(edit.index, 0, value)
      conflicts.splice(edit.index, 0, conflict)
    } else if (edit.action === 'set') {
      list[edit.index] = value
      conflicts[edit.index] = conflict
    } else if (edit.action === 'remove') {
      list.splice(edit.index, 1)
      conflicts.splice(edit.index, 1)
    } else throw 'Unknown action type: ' + edit.action
  }

  Object.freeze(conflicts)
  return opSet.setIn(['cache', objectId], Object.freeze(list))
}

function parentListObject(opSet, ref) {
  const index = opSet.getIn(['byObject', ref.get('obj'), '_elemIds']).indexOf(ref.get('key'))
  if (index < 0) return opSet

  let changed = false
  let list = opSet.getIn(['cache', ref.get('obj')])
  const value = opSet.getIn(['cache', ref.get('value')])
  const conflicts = list._conflicts.slice()
  list = list.slice() // shallow clone
  Object.defineProperty(list, '_objectId',  {value: ref.get('obj')})
  Object.defineProperty(list, '_conflicts', {value: conflicts})

  if (isObject(list[index]) && list[index]._objectId === ref.get('value')) {
    list[index] = value
    changed = true
  }
  if (isObject(conflicts[index])) {
    for (let actor of Object.keys(conflicts[index])) {
      const conflict = conflicts[index][actor]
      if (isObject(conflict) && conflict._objectId === ref.get('value')) {
        conflicts[index] = Object.assign({}, conflicts[index])
        conflicts[index][actor] = value
        Object.freeze(conflicts[index])
        changed = true
      }
    }
  }

  if (changed) {
    Object.freeze(conflicts)
    opSet = opSet.setIn(['cache', ref.get('obj')], Object.freeze(list))
  }
  return opSet
}

function updateCache(opSet, diffs) {
  let affected = Set(), lastIndex = -1
  // Group consecutive runs of diffs for the same object into a single cache update
  for (let i = 0; i < diffs.length; i++) {
    if ((i === diffs.length - 1) || (diffs[i + 1].obj !== diffs[i].obj)) {
      const slice = diffs.slice(lastIndex + 1, i + 1)
      lastIndex = i
      if (!affected.includes(slice[0].obj)) affected = affected.add(slice[0].obj)

      if (slice[0].type === 'map') {
        opSet = updateMapObject(opSet, slice)
      } else if (slice[0].type === 'list') {
        opSet = updateListObject(opSet, slice)
      } else if (slice[0].type === 'text') {
        opSet = opSet.setIn(['cache', slice[0].obj], new Text(opSet, slice[0].obj))
      } else throw 'Unknown object type: ' + slice[0].type
    }
  }

  // Update cache entries on the path from the root to the modified object
  while (!affected.isEmpty()) {
    const parentOps = affected.flatMap(objectId => opSet.getIn(['byObject', objectId, '_inbound'], Set()))
    affected = Set()
    for (let ref of parentOps) {
      affected = affected.add(ref.get('obj'))
      const objType = opSet.getIn(['byObject', ref.get('obj'), '_init', 'action'])
      if (objType === 'makeList') {
        opSet = parentListObject(opSet, ref)
      } else if (objType === 'makeMap' || ref.get('obj') === OpSet.ROOT_ID) {
        opSet = parentMapObject(opSet, ref)
      } else if (objType === 'makeText') {
        opSet = opSet.setIn(['cache', ref.get('obj')], new Text(opSet, ref.get('obj')))
      } else {
        throw 'Unknown object type: ' + objType
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
  if (!isRoot) {
    if (opSet.hasIn(['cache', objectId])) return opSet.getIn(['cache', objectId])
    if (this.cache && this.cache[objectId]) return this.cache[objectId]
  }

  let obj
  if (isRoot || objType === 'makeMap') {
    obj = {}
    const conflicts = OpSet.getObjectConflicts(opSet, objectId, this).toJS()
    Object.defineProperty(obj, '_objectId',  {value: objectId})
    Object.defineProperty(obj, '_conflicts', {value: Object.freeze(conflicts)})
    for (let field of OpSet.getObjectFields(opSet, objectId)) {
      obj[field] = OpSet.getObjectField(opSet, objectId, field, this)
    }
  } else if (objType === 'makeList') {
    obj = [...OpSet.listIterator(opSet, objectId, 'values', this)]
    const conflicts = List(OpSet.listIterator(opSet, objectId, 'conflicts', this)).toJS()
    Object.defineProperty(obj, '_objectId',  {value: objectId})
    Object.defineProperty(obj, '_conflicts', {value: Object.freeze(conflicts)})
  } else if (objType === 'makeText') {
    obj = new Text(opSet, objectId)
  } else {
    throw 'Unknown object type: ' + objType
  }

  if (!isRoot) Object.freeze(obj)
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
  Object.defineProperty(rootObj, '_state',   {value: state})
  Object.defineProperty(rootObj, '_actorId', {value: state.get('actorId')})
  Object.freeze(rootObj)
  return rootObj
}

function init(actorId) {
  const [opSet, rootObj] = materialize(OpSet.init())
  const state = Map({actorId, opSet})
  return rootObject(state, rootObj)
}

function applyChanges(root, changes, incremental) {
  let opSet = root._state.get('opSet'), diffs = []
  for (let change of changes) {
    let [newOpSet, diff] = OpSet.addChange(opSet, change)
    diffs.push(...diff)
    opSet = newOpSet
  }

  let newRoot
  if (incremental) {
    opSet = updateCache(opSet, diffs)
    newRoot = opSet.getIn(['cache', OpSet.ROOT_ID])
    if (newRoot === root) {
      newRoot = Object.assign({}, root)
      Object.defineProperty(newRoot, '_objectId',  {value: root._objectId})
      Object.defineProperty(newRoot, '_conflicts', {value: root._conflicts})
      opSet = opSet.setIn(['cache', OpSet.ROOT_ID], newRoot)
    }
  } else {
    ;[opSet, newRoot] = materialize(opSet)
  }
  return rootObject(root._state.set('opSet', opSet), newRoot)
}

module.exports = {
  init, applyChanges
}
