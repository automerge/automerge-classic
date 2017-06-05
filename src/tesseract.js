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
  const origin = state.get('_id')
  const clock = OpSet.getVClock(state.get('ops'))
    .set(origin, state.getIn(['ops', 'byActor', origin], List()).size + 1)
  const op = fromJS(opProps).merge({ actor: origin, clock })
  return state.set('ops', OpSet.add(state.get('ops'), op))
}

function insertAfter(state, listId, elemId) {
  if (!state.hasIn(['ops', 'byObject', listId])) throw 'List object does not exist'
  if (!state.hasIn(['ops', 'byObject', listId, elemId]) && elemId !== '_head') {
    throw 'Preceding list element does not exist'
  }
  const newId = state.get('_id') + ':' + (state.getIn(['ops', 'byObject', listId, '_counter'], 0) + 1)
  return [makeOp(state, { action: 'ins', obj: listId, key: elemId, next: newId }), newId]
}

function keyError(key) {
  if (typeof key !== 'string') {
    return 'The key of a map entry must be a string, but ' + key + ' is a ' + (typeof key)
  }
  if (key === '') {
    return 'The key of a map entry must not be an empty string'
  }
  if (key.startsWith('_')) {
    return 'Map entries starting with underscore are not allowed: ' + key
  }
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

function setField(state, fromId, fromKey, value) {
  const error = keyError(fromKey)
  if (error) throw new TypeError(error)
  if (typeof value === 'undefined') {
    return deleteField(state, fromId, fromKey)
  } else if (!isObject(value)) {
    return makeOp(state, { action: 'set', obj: fromId, key: fromKey, value: value })
  } else {
    const [newState, objId] = createNestedObjects(state, value)
    return makeOp(newState, { action: 'link', obj: fromId, key: fromKey, value: objId })
  }
}

function insertAt(state, listId, index, value) {
  let i = 0, prev = '_head', next = OpSet.getNext(state.get('ops'), listId, prev)
  while (next && i < index) {
    if (!OpSet.getFieldOps(state.get('ops'), listId, next).isEmpty()) i += 1
    prev = next
    next = OpSet.getNext(state.get('ops'), listId, prev)
  }

  if (i < index) throw new RangeError('Cannot insert at index ' + index +
                                      ', which is past the end of the list')
  const [newState, newElem] = insertAfter(state, listId, prev)
  return setField(newState, listId, newElem, value)
}

function setListIndex(state, listId, index, value) {
  let i = -1, elem = OpSet.getNext(state.get('ops'), listId, '_head')
  while (elem) {
    if (!OpSet.getFieldOps(state.get('ops'), listId, elem).isEmpty()) i += 1
    if (i === index) break
    elem = OpSet.getNext(state.get('ops'), listId, elem)
  }

  if (elem) {
    return setField(state, listId, elem, value)
  } else {
    return insertAt(state, listId, index, value)
  }
}

function deleteField(state, objId, key) {
  if (state.getIn(['ops', 'byObject', objId, '_init', 'action']) === 'makeList' && typeof key === 'number') {
    let i = -1, elem = OpSet.getNext(state.get('ops'), objId, '_head')
    while (elem) {
      if (!OpSet.getFieldOps(state.get('ops'), objId, elem).isEmpty()) i += 1
      if (i === key) break
      elem = OpSet.getNext(state.get('ops'), objId, elem)
    }
    if (!elem) throw new RangeError('Index ' + key + ' passed to tesseract.remove ' +
                                    'is past the end of the list')
    key = elem
  }

  if (!state.hasIn(['ops', 'byObject', objId, key])) {
    throw new RangeError('Field name passed to tesseract.remove does not exist: ' + key)
  }
  return makeOp(state, { action: 'del', obj: objId, key: key })
}

///// Mutation API

const root_id = '00000000-0000-0000-0000-000000000000'

function makeStore(state) {
  return mapProxy(state, root_id)
}

function init(storeId) {
  return makeStore(Map()
    .set('_id', storeId || UUID.generate())
    .set('ops', OpSet.init()))
}

function checkTarget(funcName, target) {
  if (!target || !target._state || !target._id || !target._state.hasIn(['ops', 'byObject', target._id])) {
    throw new TypeError('The first argument to tesseract.' + funcName +
                        ' must be the object to modify, but you passed ' + Object.toString(target))
  }
}

function checkTargetKey(funcName, target, key) {
  checkTarget(funcName, target)
  if (target._type === 'map') {
    const error = keyError(key)
    if (error) throw new TypeError('Bad second argument to tesseract.' + funcName + ': ' + error)
    return key
  } else if (target._type === 'list') {
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) key = parseInt(key)
    if (typeof key !== 'number')
      throw new TypeError('You are modifying a list, so the second argument to tesseract.' +
                          funcName + ' must be a numerical index. However, you passed ' + key)
    if (key < 0)
      throw new RangeError('The second argument to tesseract.' + funcName + ' must not be negative')
    return key
  } else {
    throw new TypeError('Unexpected target object type ' + target._type)
  }
}

function set(target, key, value) {
  key = checkTargetKey('set', target, key)
  if (target._type === 'list') {
    return makeStore(setListIndex(target._state, target._id, key, value))
  } else {
    return makeStore(setField(target._state, target._id, key, value))
  }
}

function assign(target, values) {
  checkTarget('assign', target)
  if (!isObject(values)) throw new TypeError('The second argument to tesseract.assign must be an ' +
                                             'object, but you passed ' + values)
  let state = target._state
  for (let key of Object.keys(values)) {
    key = checkTargetKey('assign', target, key)
    if (target._type === 'list') {
      state = setListIndex(state, target._id, key, values[key])
    } else {
      state = setField(state, target._id, key, values[key])
    }
  }
  return makeStore(state)
}

function insert(target, index, value) {
  if (target._type !== 'list') throw new TypeError('Cannot insert into a map, only into a list')
  checkTargetKey('insert', target, index)
  return makeStore(insertAt(target._state, target._id, index, value))
}

function remove(target, key) {
  checkTargetKey('remove', target, key)
  return makeStore(deleteField(target._state, target._id, key))
}

function load(string, storeId) {
  let ops = OpSet.init()
  transit.fromJSON(string).forEach(op => { ops = OpSet.add(ops, op) })
  return makeStore(Map()
    .set('_id', storeId || UUID.generate())
    .set('ops', ops))
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
  store._state.getIn(['ops', 'byActor']).forEach((ops, origin) => {
    for (let i = vclock[origin] || 0; i < ops.size; i++) {
      queue.push(ops.get(i).toJS())
    }
  })
  return queue
}

function applyDeltas(store, deltas) {
  checkTarget('applyDeltas', store)
  let ops = store._state.get('ops')
  for (let delta of deltas) ops = OpSet.add(ops, fromJS(delta))
  return makeStore(store._state.set('ops', ops))
}

function merge(local, remote) {
  checkTarget('merge', local)
  if (local._state.get('_id') === remote._state.get('_id'))
    throw new RangeError('Cannot merge a store with itself')
  return applyDeltas(local, getDeltasAfter(remote, getVClock(local)))
}

module.exports = {
  init, set, assign, insert, remove, load, save, equals, inspect,
  getVClock, getDeltasAfter, applyDeltas, merge
}
