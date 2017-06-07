const { Map, List, fromJS } = require('immutable')
const { mapProxy } = require('./proxies')
const OpSet = require('./op_set')
const transit = require('transit-immutable-js')

var UUID = (function() {
  var self = {};
  var lut = []; for (var i=0; i<256; i++) { lut[i] = (i<16?'0':'')+(i).toString(16); }
  self.generate = function() {
    var d0 = Math.random()*0xffffffff|0;
    var d1 = Math.random()*0xffffffff|0;
    var d2 = Math.random()*0xffffffff|0;
    var d3 = Math.random()*0xffffffff|0;
    return lut[d0&0xff]+lut[d0>>8&0xff]+lut[d0>>16&0xff]+lut[d0>>24&0xff]+'-'+
      lut[d1&0xff]+lut[d1>>8&0xff]+'-'+lut[d1>>16&0x0f|0x40]+lut[d1>>24&0xff]+'-'+
      lut[d2&0x3f|0x80]+lut[d2>>8&0xff]+'-'+lut[d2>>16&0xff]+lut[d2>>24&0xff]+
      lut[d3&0xff]+lut[d3>>8&0xff]+lut[d3>>16&0xff]+lut[d3>>24&0xff];
  }
  return self;
})();

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

function makeOp(state, opProps) {
  const opSet = state.get('ops'), actor = state.get('_id'), op = fromJS(opProps)
  return state.set('ops', OpSet.addLocalOp(opSet, op, actor))
}

function insertAfter(state, listId, elemId) {
  if (!state.hasIn(['ops', 'byObject', listId])) throw 'List object does not exist'
  if (!state.hasIn(['ops', 'byObject', listId, elemId]) && elemId !== '_head') {
    throw 'Preceding list element does not exist'
  }
  const counter = state.getIn(['ops', 'byObject', listId, '_counter'], 0) + 1
  state = makeOp(state, { action: 'ins', obj: listId, key: elemId, counter })
  return [state, state.get('_id') + ':' + counter]
}

function createNestedObjects(state, value) {
  if (typeof value._id === 'string') return [state, value._id]
  const objId = UUID.generate()

  if (Array.isArray(value)) {
    state = makeOp(state, { action: 'makeList', obj: objId })
    let elemId = '_head'
    for (let i = 0; i < value.length; i++) {
      [state, elemId] = insertAfter(state, objId, elemId)
      state = setField(state, objId, elemId, value[i])
    }
  } else {
    state = makeOp(state, { action: 'makeMap', obj: objId })
    for (let key of Object.keys(value)) state = setField(state, objId, key, value[key])
  }
  return [state, objId]
}

function setField(state, objId, key, value) {
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
    return deleteField(state, objId, key)
  } else if (isObject(value)) {
    const [newState, newId] = createNestedObjects(state, value)
    return makeOp(newState, { action: 'link', obj: objId, key, value: newId })
  } else {
    return makeOp(state, { action: 'set', obj: objId, key, value })
  }
}

function splice(state, listId, start, deletions, insertions) {
  // Find start position
  let i = 0, prev = '_head', next = OpSet.getNext(state.get('ops'), listId, prev)
  while (next && i < start) {
    if (!OpSet.getFieldOps(state.get('ops'), listId, next).isEmpty()) i += 1
    prev = next
    next = OpSet.getNext(state.get('ops'), listId, prev)
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
    if (!OpSet.getFieldOps(state.get('ops'), listId, next).isEmpty()) {
      state = makeOp(state, { action: 'del', obj: listId, key: next })
      i += 1
    }
    next = OpSet.getNext(state.get('ops'), listId, next)
  }
  return state
}

function setListIndex(state, listId, index, value) {
  let i = -1, elem = OpSet.getNext(state.get('ops'), listId, '_head')
  index = parseListIndex(index)
  while (elem) {
    if (!OpSet.getFieldOps(state.get('ops'), listId, elem).isEmpty()) i += 1
    if (i === index) break
    elem = OpSet.getNext(state.get('ops'), listId, elem)
  }

  if (elem) {
    return setField(state, listId, elem, value)
  } else {
    return splice(state, listId, index, 0, [value])
  }
}

function deleteField(state, objId, key) {
  if (state.getIn(['ops', 'byObject', objId, '_init', 'action']) === 'makeList') {
    return splice(state, objId, parseListIndex(key), 1, [])
  }
  if (!state.hasIn(['ops', 'byObject', objId, key])) {
    throw new RangeError('Field name does not exist: ' + key)
  }
  return makeOp(state, { action: 'del', obj: objId, key: key })
}

function makeChangeset(oldState, newState, message) {
  const actor = oldState.get('_id')
  const clock = OpSet.getVClock(oldState.get('ops'))
    .set(actor, oldState.getIn(['ops', 'byActor', actor], List()).size + 1)
  const changeset = fromJS({actor, clock, message})
    .set('ops', newState.getIn(['ops', 'local']))
  return oldState.set('ops', OpSet.addChangeset(oldState.get('ops'), changeset))
}

///// tesseract.* API

const root_id = '00000000-0000-0000-0000-000000000000'

function makeStore(changeset) {
  return mapProxy(changeset, root_id)
}

function init(actorId) {
  const state = Map()
    .set('_id', actorId || UUID.generate())
    .set('ops', OpSet.init())
  return mapProxy({state}, root_id)
}

function checkTarget(funcName, target, needMutable) {
  if (!target || !target._state || !target._id || !target._state.hasIn(['ops', 'byObject', target._id])) {
    throw new TypeError('The first argument to tesseract.' + funcName +
                        ' must be the object to modify, but you passed ' + JSON.stringify(target))
  }
  if (!target._changeset.mutable && needMutable) {
    throw new TypeError('tesseract.' + funcName + ' requires a writable object as first argument, ' +
                        'but the one you passed is read-only. Please use tesseract.changeset() ' +
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
  if (root._id !== root_id) {
    throw new TypeError('The first argument to tesseract.changeset must be the document root')
  }
  if (root._changeset.mutable) {
    throw new TypeError('Calls to tesseract.changeset cannot be nested')
  }
  if (typeof message === 'function' && callback === undefined) {
    [message, callback] = [callback, message]
  }

  const oldState = root._state
  const changeset = {state: oldState, mutable: true, setField, splice, setListIndex, deleteField}
  callback(mapProxy(changeset, root_id))
  return mapProxy({state: makeChangeset(oldState, changeset.state, message)}, root_id)
}

function assign(target, values) {
  checkTarget('assign', target, true)
  if (!isObject(values)) throw new TypeError('The second argument to tesseract.assign must be an ' +
                                             'object, but you passed ' + JSON.stringify(values))
  let state = target._state
  for (let key of Object.keys(values)) {
    if (target._type === 'list') {
      state = setListIndex(state, target._id, key, values[key])
    } else {
      state = setField(state, target._id, key, values[key])
    }
  }
  target._changeset.state = state
  return makeStore(target._changeset)
}

function load(string, actorId) {
  let ops = OpSet.init()
  transit.fromJSON(string).forEach(changeset => { ops = OpSet.addChangeset(ops, changeset) })
  const state = Map()
    .set('_id', actorId || UUID.generate())
    .set('ops', ops)
  return mapProxy({state}, root_id)
}

function save(store) {
  checkTarget('save', store)
  return transit.toJSON(store._state.getIn(['ops', 'byActor']).valueSeq().flatMap(ops => ops))
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

// Network communication API

function getVClock(store) {
  checkTarget('getVClock', store)
  return OpSet.getVClock(store._state.get('ops')).toJS()
}

function getDeltasAfter(store, vclock) {
  checkTarget('getDeltasAfter', store)
  let queue = []
  store._state.getIn(['ops', 'byActor']).forEach((changesets, origin) => {
    for (let i = vclock[origin] || 0; i < changesets.size; i++) {
      queue.push(changesets.get(i).toJS())
    }
  })
  return queue
}

function applyDeltas(store, deltas) {
  checkTarget('applyDeltas', store)
  let ops = store._state.get('ops')
  for (let delta of deltas) ops = OpSet.addChangeset(ops, fromJS(delta))
  return mapProxy({state: store._state.set('ops', ops)}, root_id)
}

function merge(local, remote) {
  checkTarget('merge', local)
  if (local._state.get('_id') === remote._state.get('_id')) {
    throw new RangeError('Cannot merge a store with itself')
  }
  return applyDeltas(local, getDeltasAfter(remote, getVClock(local)))
}

module.exports = {
  init, changeset, assign, load, save, equals, inspect,
  getVClock, getDeltasAfter, applyDeltas, merge
}
