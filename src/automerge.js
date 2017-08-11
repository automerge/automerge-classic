const { Map, List, fromJS } = require('immutable')
const uuid = require('uuid/v4')
// let n=0
// const uuid = () => "UUID-" + n++
const { rootObjectProxy } = require('./proxies')
const OpSet = require('./op_set')
const transit = require('transit-immutable-js')

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

function makeOp(state, opProps) {
  const opSet = state.get('opSet'), actor = state.get('actorId'), op = fromJS(opProps)
  return state.set('opSet', OpSet.addLocalOp(opSet, op, actor))
}

function insertAfter(state, listId, elemId) {
  if (!state.hasIn(['opSet', 'byObject', listId])) throw 'List object does not exist'
  if (!state.hasIn(['opSet', 'byObject', listId, elemId]) && elemId !== '_head') {
    throw 'Preceding list element does not exist'
  }
  const elem = state.getIn(['opSet', 'byObject', listId, '_maxElem'], 0) + 1
  state = makeOp(state, { action: 'ins', obj: listId, key: elemId, elem })
  return [state, state.get('actorId') + ':' + elem]
}

function createNestedObjects(state, value) {
  if (typeof value._objectId === 'string') return [state, value._objectId]
  const objectId = uuid()

  if (Array.isArray(value)) {
    state = makeOp(state, { action: 'makeList', obj: objectId })
    let elemId = '_head'
    for (let i = 0; i < value.length; i++) {
      [state, elemId] = insertAfter(state, objectId, elemId)
      state = setField(state, objectId, elemId, value[i])
    }
  } else {
    state = makeOp(state, { action: 'makeMap', obj: objectId })
    for (let key of Object.keys(value)) state = setField(state, objectId, key, value[key])
  }
  return [state, objectId]
}

function setField(state, objectId, key, value) {
  if (typeof key !== 'string') {
    throw new TypeError('The key of a map entry must be a string, but ' +
                        JSON.stringify(key) + ' is a ' + (typeof key))
  }
  if (key === '') {
    throw new TypeError('The key of a map entry must not be an empty string')
  }
  if (key.startsWith('_')) {
    throw new TypeError('Map entries starting with underscore are not allowed: ' + key)
  }

  if (typeof value === 'undefined') {
    return deleteField(state, objectId, key)
  } else if (isObject(value)) {
    const [newState, newId] = createNestedObjects(state, value)
    return makeOp(newState, { action: 'link', obj: objectId, key, value: newId })
  } else {
    return makeOp(state, { action: 'set', obj: objectId, key, value })
  }
}

function splice(state, listId, start, deletions, insertions) {
  // Find start position
  let i = 0, prev = '_head', next = OpSet.getNext(state.get('opSet'), listId, prev)
  while (next && i < start) {
    if (!OpSet.getFieldOps(state.get('opSet'), listId, next).isEmpty()) i += 1
    prev = next
    next = OpSet.getNext(state.get('opSet'), listId, prev)
  }
  if (i < start && insertions.length > 0) {
    throw new RangeError('Cannot insert at index ' + start + ', which is past the end of the list')
  }

  // Apply insertions
  for (let ins of insertions) {
    [state, prev] = insertAfter(state, listId, prev)
    state = setField(state, listId, prev, ins)
  }

  // Apply deletions
  while (next && i < start + deletions) {
    if (!OpSet.getFieldOps(state.get('opSet'), listId, next).isEmpty()) {
      state = makeOp(state, { action: 'del', obj: listId, key: next })
      i += 1
    }
    next = OpSet.getNext(state.get('opSet'), listId, next)
  }
  return state
}

function setListIndex(state, listId, index, value) {
  let i = -1, elem = OpSet.getNext(state.get('opSet'), listId, '_head')
  index = parseListIndex(index)
  while (elem) {
    if (!OpSet.getFieldOps(state.get('opSet'), listId, elem).isEmpty()) i += 1
    if (i === index) break
    elem = OpSet.getNext(state.get('opSet'), listId, elem)
  }

  if (elem) {
    return setField(state, listId, elem, value)
  } else {
    return splice(state, listId, index, 0, [value])
  }
}

function deleteField(state, objectId, key) {
  if (state.getIn(['opSet', 'byObject', objectId, '_init', 'action']) === 'makeList') {
    return splice(state, objectId, parseListIndex(key), 1, [])
  }
  if (!state.hasIn(['opSet', 'byObject', objectId, key])) {
    throw new RangeError('Field name does not exist: ' + key)
  }
  return makeOp(state, { action: 'del', obj: objectId, key: key })
}

function rootObject(state, rootObj) {
  Object.assign(Object.getPrototypeOf(rootObj), {_state: state, _actorId: state.get('actorId')})
  Object.freeze(Object.getPrototypeOf(rootObj))
  return rootObj
}

function applyChangeset(state, changeset) {
  const [opSet, root] = OpSet.addChangeset(state.get('opSet'), changeset)
  return rootObject(state.set('opSet', opSet), root)
}

function makeChangeset(oldState, newState, message) {
  const actor = oldState.get('actorId')
  const seq = oldState.getIn(['opSet', 'clock', actor], 0) + 1
  const deps = oldState.getIn(['opSet', 'deps']).remove(actor)
  const changeset = fromJS({actor, seq, deps, message})
    .set('ops', newState.getIn(['opSet', 'local']))
  return applyChangeset(oldState, changeset)
}

///// Automerge.* API

function init(actorId) {
  const [opSet, rootObj] = OpSet.materialize(OpSet.init())
  const state = Map({actorId: actorId || uuid(), opSet})
  return rootObject(state, rootObj)
}

function checkTarget(funcName, target, needMutable) {
  if (!target || !target._state || !target._objectId ||
      !target._state.hasIn(['opSet', 'byObject', target._objectId])) {
    throw new TypeError('The first argument to Automerge.' + funcName +
                        ' must be the object to modify, but you passed ' + JSON.stringify(target))
  }
  if (needMutable && (!target._changeset || !target._changeset.mutable)) {
    throw new TypeError('Automerge.' + funcName + ' requires a writable object as first argument, ' +
                        'but the one you passed is read-only. Please use Automerge.changeset() ' +
                        'to get a writable version.')
  }
}

function parseListIndex(key) {
  if (typeof key === 'string' && /^[0-9]+$/.test(key)) key = parseInt(key)
  if (typeof key !== 'number')
    throw new TypeError('A list index must be a number, but you passed ' + JSON.stringify(key))
  if (key < 0 || isNaN(key) || key === Infinity || key === -Infinity)
    throw new RangeError('A list index must be positive, but you passed ' + key)
  return key
}

function changeset(root, message, callback) {
  checkTarget('changeset', root)
  if (root._objectId !== '00000000-0000-0000-0000-000000000000') {
    throw new TypeError('The first argument to Automerge.changeset must be the document root')
  }
  if (root._changeset && root._changeset.mutable) {
    throw new TypeError('Calls to Automerge.changeset cannot be nested')
  }
  if (typeof message === 'function' && callback === undefined) {
    [message, callback] = [callback, message]
  }

  const oldState = root._state
  const context = {state: oldState, mutable: true, setField, splice, setListIndex, deleteField}
  callback(rootObjectProxy(context))
  return makeChangeset(oldState, context.state, message)
}

function assign(target, values) {
  checkTarget('assign', target, true)
  if (!isObject(values)) throw new TypeError('The second argument to Automerge.assign must be an ' +
                                             'object, but you passed ' + JSON.stringify(values))
  let state = target._state
  for (let key of Object.keys(values)) {
    if (target._type === 'list') {
      state = setListIndex(state, target._objectId, key, values[key])
    } else {
      state = setField(state, target._objectId, key, values[key])
    }
  }
  target._changeset.state = state
}

function load(string, actorId) {
  return transit.fromJSON(string).reduce(
    (root, changeset) => applyChangeset(root._state, changeset),
    init(actorId)
  )
}

function save(store) {
  checkTarget('save', store)
  const history = store._state
    .getIn(['opSet', 'history'])
    .map(state => state.get('changeset'))
  return transit.toJSON(history)
}

function equals(val1, val2) {
  if (!isObject(val1) || !isObject(val2)) return val1 === val2
  const keys1 = Object.keys(val1).sort(), keys2 = Object.keys(val2).sort()
  if (keys1.length !== keys2.length) return false
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false
    if (!equals(val1[keys1[i]], val2[keys2[i]])) return false
  }
  return true
}

function inspect(store) {
  checkTarget('inspect', store)
  return JSON.parse(JSON.stringify(store))
}

function getHistory(store) {
  checkTarget('inspect', store)
  return store._state.getIn(['opSet', 'history']).toJS()
}

// Network communication API

function getVClock(store) {
  checkTarget('getVClock', store)
  if (!store._state.hasIn(['opSet', 'clock'])) {
    throw new TypeError('This object cannot be used for network sync. ' +
                        'Are you trying to sync a snapshot from the history?')
  }
  return store._state.getIn(['opSet', 'clock']).toJS()
}

function getDeltasAfter(store, vclock) {
  checkTarget('getDeltasAfter', store)
  return OpSet.getMissingChanges(store._state.get('opSet'), fromJS(vclock)).toJS()
}

function applyDeltas(store, deltas) {
  checkTarget('applyDeltas', store)
  return deltas.reduce(
    (root, delta) => applyChangeset(root._state, fromJS(delta)),
    store
  )
}

function merge(local, remote) {
  checkTarget('merge', local)
  if (local._state.get('actorId') === remote._state.get('actorId')) {
    throw new RangeError('Cannot merge a store with itself')
  }
  return applyDeltas(local, getDeltasAfter(remote, getVClock(local)))
}

module.exports = {
  init, changeset, assign, load, save, equals, inspect, getHistory,
  getVClock, getDeltasAfter, applyDeltas, merge
}
