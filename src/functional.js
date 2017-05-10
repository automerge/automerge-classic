const immutable = require('immutable')
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
  if (action.get('action') === 'set')  return action.get('value')
  if (action.get('action') === 'link') return mapProxy(state, action.get('value'))
}

function getObjectValue(state, id) {
  let obj = {}
  state.getIn(['objects', id])
    .filterNot(field => field.isEmpty())
    .forEach((field, key) => { obj[key] = getActionValue(state, field.first()) })
  return obj
}

function getObjectConflicts(state, id) {
  return state.getIn(['objects', id])
    .filter((field, key) => field.size > 1)
    .mapEntries(([key, field]) => [key, field.shift().toMap()
      .mapEntries(([idx, action]) => [action.get('by'), getActionValue(state, action)])
    ]).toJS()
}

const MapHandler = {
  get (target, key) {
    const obj = target.getIn(['state', 'objects', target.get('id')])
    if (key === util.inspect.custom) return () => getObjectValue(target.get('state'), target.get('id'))
    if (typeof key !== 'string') return target[key]
    if (obj === undefined) return undefined
    if (key === '_id') return target.get('id')
    if (key === '_direct') return obj
    if (key === '_conflicts') return getObjectConflicts(target.get('state'), target.get('id'))
    return getActionValue(target.get('state'), obj.get(key, immutable.List()).first())
  },

  set (target, key, value) {
    throw 'This object is read-only. Use Store.assign() to change it.'
  },

  deleteProperty (target, key) {
    throw 'This object is read-only. Use Store.assign() to change it.'
  },

  ownKeys (target) {
    return target.getIn(['state', 'objects', target.get('id')]).keySeq().toJS()
  }
}

function mapProxy(state, id) {
  return new Proxy(immutable.fromJS({state, id}), MapHandler)
}

const root_id = '00000000-0000-0000-0000-000000000000'

function makeStore(state) {
  const root = mapProxy(state, root_id)
  return {
    state: state,
    root: root,
    merge (other) {
      return makeStore(mergeActions(state, other.state))
    },
    assign (obj, values) {
      if (values === undefined) {
        return makeStore(assignObject(state, root, obj))
      } else {
        return makeStore(assignObject(state, obj, values))
      }
    },
    [util.inspect.custom]: () => root
  }
}

function Store(storeId) {
  const _uuid = storeId || UUID.generate()
  return makeStore(immutable.fromJS({
    _id:     _uuid,
    actions: { [_uuid]:   [] },
    objects: { [root_id]: {} }
  }))
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
      const applied = state.getIn(['actions', node], immutable.List()).size
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
  return immutable.fromJS(action).merge({ by: storeId, clock })
}

function applyFieldAction(state, action) {
  const { by, clock, target, key } = action.toObject()
  const actions = state
      .getIn(['objects', target, key], immutable.List())
      .filter(other => isConcurrent(other, action))
      .push(...(action.get('action') === 'del' ? [] : [action]))
      .sortBy(a => a.get('by'))
      .reverse()
  if (actions.isEmpty()) {
    return state.deleteIn(['objects', target, key])
  } else {
    return state.setIn(['objects', target, key], actions)
  }
}

function applyAction(state, action) {
  if (!causallyReady(state, action)) throw 'Cannot apply action'
  const by = action.get('by'), a = action.get('action')
  const actions = state.getIn(['actions', by], immutable.List()).push(action)

  if (a === 'set' || a === 'del' || a === 'link')
    return applyFieldAction(state, action)
        .setIn(['actions', by], actions)
  if (a === 'create')
    return state
        .setIn(['objects', action.get('target')], immutable.Map())
        .setIn(['actions', by], actions)
  if (a === 'splice') throw 'Not yet implemented'
  throw 'Unknown action'
}

function mergeActions(local, remote) {
  let applied = 0, state = local
  do {
    applied = 0
    remote.get('actions').forEach((remoteActions, by) => {
      const localActions = state.getIn(['actions', by], immutable.List())
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

function createObject(state) {
  const id = UUID.generate()
  return [applyAction(state, makeAction(state, { action: 'create', target: id })), id]
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

function setField(state, fromId, fromKey, value) {
  if (!isObject(value)) {
    return setFieldValue(state, fromId, fromKey, value)
  }
  if ('_id' in value) {
    return setFieldLink(state, fromId, fromKey, value._id)
  }

  let [newState, objId] = createObject(state)
  for (let key in value) newState = setField(newState, objId, key, value[key])
  return setFieldLink(newState, fromId, fromKey, objId)
}

function assignObject(state, obj, values) {
  if (!obj || !obj._id) throw 'Cannot assign to an object that does not exist'
  if (!isObject(values)) throw 'Must supply values to assign'

  for (let key in values) {
    if (key.startsWith('_')) throw 'Invalid Key'
    if (isObject(obj[key]) && isObject(values[key])) {
      state = assignObject(state, obj[key], values[key])
    } else {
      state = setField(state, obj._id, key, values[key])
    }
  }
  return state
}

module.exports = { Store }
