const { Map, List, fromJS } = require('immutable')
const transit = require('transit-immutable-js')
const util = require('util')

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

function getActionValue(state, action) {
  if (!isObject(action)) return action
  const value = action.get('value')
  if (action.get('action') === 'set') return value
  if (action.get('action') === 'link') {
    const type = state.getIn(['objects', value, '_type'])
    if (type === 'map')  return mapProxy(state, value)
    if (type === 'list') return listProxy(state, value)
  }
}

function getObjectValue(state, id) {
  const src = state.getIn(['objects', id])
  if (src.get('_type') === 'map') {
    let obj = {}
    src.filterNot((field, key) => key.startsWith('_') || field.get('actions', List()).isEmpty())
      .forEach((field, key) => { obj[key] = getActionValue(state, field.get('actions').first()) })
    return obj
  }

  if (src.get('_type') === 'list') {
    let list = [], elem = '_head'
    while (elem) {
      const actions = src.get(elem).get('actions', List())
      if (!actions.isEmpty()) list.push(getActionValue(state, actions.first()))
      elem = src.getIn([elem, 'next'])
    }
    return list
  }
}

function getObjectConflicts(state, id) {
  return state.getIn(['objects', id])
    .filter((field, key) => field.size > 1)
    .mapEntries(([key, field]) => [key, field.shift().toMap()
      .mapEntries(([idx, action]) => [action.get('by'), getActionValue(state, action)])
    ]).toJS()
}

function listElemByIndex(state, obj, index) {
  let i = -1, elem = obj.getIn(['_head', 'next'])
  while (elem) {
    if (!obj.get(elem).get('actions', List()).isEmpty()) i += 1
    if (i === index) return getActionValue(state, obj.getIn([elem, 'actions']).first())
    elem = obj.getIn([elem, 'next'])
  }
}

function listLength(obj) {
  let length = 0, elem = obj.getIn(['_head', 'next'])
  while (elem) {
    if (!obj.get(elem).get('actions', List()).isEmpty()) length += 1
    elem = obj.getIn([elem, 'next'])
  }
  return length
}

const MapHandler = {
  get (target, key) {
    const obj = target.getIn(['state', 'objects', target.get('id')])
    if (key === util.inspect.custom) return () => getObjectValue(target.get('state'), target.get('id'))
    if (typeof key !== 'string') return target[key]
    if (obj === undefined) return undefined
    if (key === '_type') return 'map'
    if (key === '_id') return target.get('id')
    if (key === '_state') return target.get('state')
    if (key === '_conflicts') return getObjectConflicts(target.get('state'), target.get('id'))
    return getActionValue(target.get('state'), obj.getIn([key, 'actions'], List()).first())
  },

  set (target, key, value) {
    throw 'This object is read-only. Use tesseract.set() to change it.'
  },

  deleteProperty (target, key) {
    throw 'This object is read-only. Use tesseract.remove() to change it.'
  },

  has (target, key) {
    return target.hasIn(['state', 'objects', target.get('id'), key])
  },

  getOwnPropertyDescriptor (target, key) {
    if (!key.startsWith('_') && target.hasIn(['state', 'objects', target.get('id'), key])) {
      return {configurable: true, enumerable: true}
    }
  },

  ownKeys (target) {
    return target.getIn(['state', 'objects', target.get('id')]).keySeq().toJS()
  }
}

const ListHandler = {
  get (target, key) {
    const obj = target.getIn(['state', 'objects', target.get('id')])
    if (key === util.inspect.custom) return () => getObjectValue(target.get('state'), target.get('id'))
    if (key === '_type') return 'list'
    if (key === '_id') return target.get('id')
    if (key === '_state') return target.get('state')
    if (key === 'length') return listLength(obj)
    if (obj && typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return listElemByIndex(target.get('state'), obj, parseInt(key))
    }
  },

  set (target, key, value) {
    throw 'This object is read-only. Use tesseract.set() to change it.'
  },

  deleteProperty (target, key) {
    throw 'This object is read-only. Use tesseract.remove() to change it.'
  },

  has (target, key) {
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return parseInt(key) < listLength(target.getIn(['state', 'objects', target.get('id')]))
    }
    return false
  },

  getOwnPropertyDescriptor (target, key) {
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      if (parseInt(key) < listLength(target.getIn(['state', 'objects', target.get('id')]))) {
        return {configurable: true, enumerable: true}
      }
    }
  },

  ownKeys (target) {
    const length = listLength(target.getIn(['state', 'objects', target.get('id')]))
    let keys = []
    for (let i = 0; i < length; i++) keys.push(i.toString())
    return keys
  }
}

function mapProxy(state, id) {
  return new Proxy(fromJS({state, id}), MapHandler)
}

function listProxy(state, id) {
  return new Proxy(fromJS({state, id}), ListHandler)
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

function makeAction(state, action) {
  const storeId = state.get('_id')
  const clock = state
    .get('actions')
    .mapEntries(([id, actions]) => [id, id === storeId ? actions.size + 1 : actions.size])
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

function mergeActions(local, remote) {
  let applied = 0, state = local
  do {
    applied = 0
    remote.get('actions').forEach((remoteActions, by) => {
      const localActions = state.getIn(['actions', by], List())
      for (let i = localActions.size; i < remoteActions.size; i++) {
        const action = remoteActions.get(i)
        if (causallyReady(state, action)) {
          state = applyAction(state, action)
          applied += 1
        }
      }
    })
  } while (applied > 0)
  return state
}

function setFieldValue(state, targetId, targetKey, value) {
  if (!state.hasIn(['objects', targetId])) throw 'Target object does not exist'
  if (typeof targetKey !== 'string' || targetKey === '') throw 'Field name must be a string'
  if (isObject(value)) throw 'Field value must be a primitive'
  if (typeof value === 'undefined') throw 'Field value must be defined'
  return applyAction(state, makeAction(state, { action: 'set', target: targetId, key: targetKey, value: value }))
}

function setFieldLink(state, fromId, fromKey, toId) {
  if (!state.hasIn(['objects', fromId])) throw 'Referencing object does not exist'
  if (!state.hasIn(['objects', toId])) throw 'Referenced object does not exist'
  if (typeof fromKey !== 'string' || fromKey === '') throw 'Field name must be a string'
  return applyAction(state, makeAction(state, { action: 'link', target: fromId, key: fromKey, value: toId }))
}

function insertAfter(state, listId, elemId) {
  if (!state.hasIn(['objects', listId])) throw 'List object does not exist'
  if (!state.hasIn(['objects', listId, elemId])) throw 'Preceding list element does not exist'
  const newId = state.get('_id') + ':' + (state.getIn(['objects', listId, 'counter']) + 1)
  return [applyAction(state, makeAction(state, { action: 'ins', target: listId, after: elemId, elem: newId })), newId]
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
  if (!isObject(value)) {
    return setFieldValue(state, fromId, fromKey, value)
  } else {
    const [newState, objId] = createNestedObjects(state, value)
    return setFieldLink(newState, fromId, fromKey, objId)
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

  if (i < index) throw 'Cannot insert past the end of the list'
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
    if (!elem) throw 'Cannot delete list element that does not exist'
    key = elem
  }

  if (!obj.has(key)) throw 'Cannot delete field that does not exist'
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
    actions: { [_uuid]:   [] },
    objects: { [root_id]: {_type: 'map'} }
  }))
}

function set(target, key, value) {
  if (!target || !target._id) throw 'Cannot modify object that does not exist'
  if (target._type === 'list') {
    if (typeof key !== 'number' || key < 0) throw 'Invalid index'
    return makeStore(setListIndex(target._state, target._id, key, value))
  }
  if (key.startsWith('_')) throw 'Invalid key'
  return makeStore(setField(target._state, target._id, key, value))
}

function insert(target, index, value) {
  if (!target || !target._id) throw 'Cannot modify an object that does not exist'
  if (target._type !== 'list') throw 'Cannot insert into a map'
  if (typeof index !== 'number' || index < 0) throw 'Invalid index'
  return makeStore(insertAt(target._state, target._id, index, value))
}

function remove(target, key) {
  if (!target || !target._id) throw 'Cannot modify an object that does not exist'
  return makeStore(deleteField(target._state, target._id, key))
}

function merge(local, remote) {
  if (local._state.get('_id') === remote._state.get('_id')) throw 'Cannot merge a store with itself'
  return makeStore(mergeActions(local._state, remote._state))
}

function load(string, storeId) {
  if (!storeId) storeId = UUID.generate()
  return makeStore(transit.fromJSON(string).set('_id', storeId))
}

function save(store) {
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

module.exports = { init, set, insert, remove, merge, load, save, equals }
