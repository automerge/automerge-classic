const { Map, List, fromJS } = require('immutable')
const { mapProxy } = require('./proxies')
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


// Returns true if the two actions are concurrent, that is, they happened without being aware of
// each other (neither happened before the other). Returns false if one supersedes the other.
function isConcurrent(action1, action2) {
  const [clock1, clock2] = [action1.get('clock'), action2.get('clock')]
  let oneFirst = false, twoFirst = false
  clock1.keySeq().concat(clock2.keySeq()).forEach(key => {
    if (clock1.get(key, 0) < clock2.get(key, 0)) oneFirst = true
    if (clock2.get(key, 0) < clock1.get(key, 0)) twoFirst = true
  })
  return oneFirst && twoFirst
}

// Returns true if all actions that causally precede `action` have already been applied in `state`.
function causallyReady(state, action) {
  const storeId = action.get('by')
  const seq = action.getIn(['clock', storeId])
  if (typeof seq !== 'number' || seq <= 0) throw 'Invalid sequence number'

  return action.get('clock')
    .filterNot((seq, node) => {
      const applied = state.getIn(['actions', node], List()).size
      if (node === storeId) {
        return seq === applied + 1
      } else {
        return seq <= applied
      }
    })
    .isEmpty()
}

// Returns true if the action has already been applied to the state.
function isRedundant(state, action) {
  const seq = action.getIn(['clock', action.get('by')])
  const actions = state.getIn(['actions', action.get('by')], List())
  if (typeof seq !== 'number' || seq <= 0) throw 'Invalid sequence number'
  if (seq > actions.size) return false
  if (!actions.get(seq - 1).equals(action)) throw 'Action inconsistency'
  return true
}

function makeAction(state, action) {
  const storeId = state.get('_id')
  const clock = state
    .get('actions')
    .mapEntries(([id, actions]) => [id, actions.size])
    .set(storeId, state.getIn(['actions', storeId], List()).size + 1)
  return fromJS(action).merge({ by: storeId, clock })
}

function applyFieldAction(state, action) {
  const target = action.get('target'), key = action.get('key')
  const actions = state
      .getIn(['objects', target, key], Map())
      .get('actions', List())
      .filter(other => isConcurrent(other, action))
      .push(...(action.get('action') === 'del' ? [] : [action]))
      .sortBy(a => a.get('by'))
      .reverse()
  return state.setIn(['objects', target, key, 'actions'], actions)
}

function parseLamport(stamp) {
  const [, name, count] = /^(.*):(\d+)$/.exec(stamp) || []
  if (count) return [name, parseInt(count)]
}

function lamportLessThan(stamp1, stamp2) {
  const [name1, count1] = parseLamport(stamp1)
  const [name2, count2] = parseLamport(stamp2)
  return (count1 < count2) || (count1 === count2 && name1 < name2)
}

function applyInsertAction(state, action) {
  const target = action.get('target'), after = action.get('after'), elem = action.get('elem')
  const [elemName, elemCount] = parseLamport(elem)
  if (elemCount > state.getIn(['objects', target, 'counter'])) {
    state = state.setIn(['objects', target, 'counter'], elemCount)
  }

  let prev = after, next = state.getIn(['objects', target, after, 'next'])
  while (next && lamportLessThan(elem, next)) {
    prev = next
    next = state.getIn(['objects', target, prev, 'next'])
  }
  return state
    .setIn(['objects', target, prev, 'next'], elem)
    .setIn(['objects', target, elem, 'next'], next)
}

function applyAction(state, action) {
  if (!causallyReady(state, action)) throw 'Cannot apply action'
  const by = action.get('by'), a = action.get('action')
  state = state.setIn(['actions', by], state.getIn(['actions', by], List()).push(action))

  if (a === 'set' || a === 'del' || a === 'link')
    return applyFieldAction(state, action)
  if (a === 'ins')
    return applyInsertAction(state, action)
  if (a === 'makeMap')
    return state.setIn(['objects', action.get('target')],
                       fromJS({_type: 'map'}))
  if (a === 'makeList')
    return state.setIn(['objects', action.get('target')],
                       fromJS({_type: 'list', _head: {next: null}, counter: 0}))
  throw 'Unknown action'
}

function applyQueuedActions(state) {
  let queue = List()
  while (true) {
    state.get('queue').forEach(action => {
      if (causallyReady(state, action)) {
        state = applyAction(state, action)
      } else if (!isRedundant(state, action)) {
        queue = queue.push(action)
      }
    })

    if (queue.count() === state.get('queue').count()) return state
    state = state.set('queue', queue)
    queue = List()
  }
}

function insertAfter(state, listId, elemId) {
  if (!state.hasIn(['objects', listId])) throw 'List object does not exist'
  if (!state.hasIn(['objects', listId, elemId])) throw 'Preceding list element does not exist'
  const newId = state.get('_id') + ':' + (state.getIn(['objects', listId, 'counter']) + 1)
  return [applyAction(state, makeAction(state, { action: 'ins', target: listId, after: elemId, elem: newId })), newId]
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
    state = applyAction(state, makeAction(state, { action: 'makeList', target: objId }))
    let elemId = '_head'
    for (let i = 0; i < value.length; i++) {
      [state, elemId] = insertAfter(state, objId, elemId)
      state = setField(state, objId, elemId, value[i])
    }
  } else {
    state = applyAction(state, makeAction(state, { action: 'makeMap', target: objId }))
    for (let key in value) state = setField(state, objId, key, value[key])
  }
  return [state, objId]
}

function setField(state, fromId, fromKey, value) {
  const error = keyError(fromKey)
  if (error) throw new TypeError(error)
  if (typeof value === 'undefined') {
    return deleteField(state, fromId, fromKey)
  } else if (!isObject(value)) {
    return applyAction(state, makeAction(state, { action: 'set', target: fromId, key: fromKey, value: value }))
  } else {
    const [newState, objId] = createNestedObjects(state, value)
    return applyAction(newState, makeAction(newState, { action: 'link', target: fromId, key: fromKey, value: objId }))
  }
}

function insertAt(state, listId, index, value) {
  const obj = state.getIn(['objects', listId])
  let i = 0, prev = '_head', next = obj.getIn(['_head', 'next'])
  while (next && i < index) {
    if (!obj.get(next).get('actions', List()).isEmpty()) i += 1
    prev = next
    next = obj.getIn([next, 'next'])
  }

  if (i < index) throw new RangeError('Cannot insert at index ' + index +
                                      ', which is past the end of the list')
  const [newState, newElem] = insertAfter(state, listId, prev)
  return setField(newState, listId, newElem, value)
}

function setListIndex(state, listId, index, value) {
  const obj = state.getIn(['objects', listId])
  let i = -1, elem = obj.getIn(['_head', 'next'])
  while (elem) {
    if (!obj.get(elem).get('actions', List()).isEmpty()) i += 1
    if (i === index) break
    elem = obj.getIn([elem, 'next'])
  }

  if (elem) {
    return setField(state, listId, elem, value)
  } else {
    return insertAt(state, listId, index, value)
  }
}

function deleteField(state, targetId, key) {
  const obj = state.getIn(['objects', targetId])
  if (obj.get('_type') === 'list' && typeof key === 'number') {
    let i = -1, elem = obj.getIn(['_head', 'next'])
    while (elem) {
      if (!obj.get(elem).get('actions', List()).isEmpty()) i += 1
      if (i === key) break
      elem = obj.getIn([elem, 'next'])
    }
    if (!elem) throw new RangeError('Index ' + key + ' passed to tesseract.remove ' +
                                    'is past the end of the list')
    key = elem
  }

  if (!obj.has(key)) throw new RangeError('Field name passed to tesseract.remove ' +
                                          'does not exist: ' + key)
  return applyAction(state, makeAction(state, { action: 'del', target: targetId, key: key }))
}

///// Mutation API

const root_id = '00000000-0000-0000-0000-000000000000'

function makeStore(state) {
  return mapProxy(state, root_id)
}

function init(storeId) {
  const _uuid = storeId || UUID.generate()
  return makeStore(fromJS({
    _id:     _uuid,
    queue:   [],
    actions: { },
    objects: { [root_id]: {_type: 'map'} }
  }))
}

function checkTarget(funcName, target) {
  if (!target || !target._state || !target._id || !target._state.hasIn(['objects', target._id])) {
    throw new TypeError('The first argument to tesseract.' + funcName +
                        ' must be the object to modify, but you passed ' + target)
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
  if (!storeId) storeId = UUID.generate()
  return makeStore(transit.fromJSON(string).set('_id', storeId))
}

function save(store) {
  checkTarget('save', store)
  return transit.toJSON(store._state.filter((v, k) => k !== '_id'))
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
  return store._state
    .get('actions')
    .mapEntries(([id, actions]) => [id, actions.size])
    .toJS()
}

function getDeltasAfter(store, vclock) {
  checkTarget('getDeltasAfter', store)
  let queue = []
  store._state.get('actions').forEach((actions, source) => {
    for (let i = vclock[source] || 0; i < actions.size; i++) {
      queue.push(actions.get(i).toJS())
    }
  })
  return queue
}

function applyDeltas(store, deltas) {
  checkTarget('applyDeltas', store)
  const queue = store._state.get('queue').concat(fromJS(deltas))
  return makeStore(applyQueuedActions(store._state.set('queue', queue)))
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
