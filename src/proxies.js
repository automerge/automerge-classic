const { List, fromJS } = require('immutable')
const util = require('util')
const OpSet = require('./op_set')

function getObjType(state, objId) {
  const action = state.getIn(['ops', 'byObject', objId, '_init', 'action'])
  if (action === 'makeMap') return 'map'
  if (action === 'makeList') return 'list'
}

function getOpValue(state, op) {
  if (typeof op !== 'object' || op === null) return op
  const value = op.get('value')
  if (op.get('action') === 'set') return value
  if (op.get('action') === 'link') {
    const type = getObjType(state, value)
    if (type === 'map')  return mapProxy(state, value)
    if (type === 'list') return listProxy(state, value)
  }
}

function validFieldName(key) {
  return (typeof key === 'string' && key !== '' && !key.startsWith('_'))
}

function isFieldPresent(state, objId, key) {
  return validFieldName(key) && !OpSet.getFieldOps(state.get('ops'), objId, key).isEmpty()
}

function getObjectConflicts(state, objId) {
  return state
    .getIn(['ops', 'byObject', objId])
    .filter((field, key) => validFieldName(key) && OpSet.getFieldOps(state.get('ops'), objId, key).size > 1)
    .mapEntries(([key, field]) => [key, field.shift().toMap()
      .mapEntries(([idx, op]) => [op.get('actor'), getOpValue(state, op)])
    ]).toJS()
}

function listElemByIndex(state, listId, index) {
  let i = -1, elem = OpSet.getNext(state.get('ops'), listId, '_head')
  while (elem) {
    const ops = OpSet.getFieldOps(state.get('ops'), listId, elem)
    if (!ops.isEmpty()) i += 1
    if (i === index) return getOpValue(state, ops.first())
    elem = OpSet.getNext(state.get('ops'), listId, elem)
  }
}

function listLength(state, listId) {
  let length = 0, elem = OpSet.getNext(state.get('ops'), listId, '_head')
  while (elem) {
    if (!OpSet.getFieldOps(state.get('ops'), listId, elem).isEmpty()) length += 1
    elem = OpSet.getNext(state.get('ops'), listId, elem)
  }
  return length
}

const MapHandler = {
  get (target, key) {
    const state = target.get('state'), objId = target.get('objId')
    if (!state.hasIn(['ops', 'byObject', objId])) throw 'Target object does not exist: ' + objId
    if (key === util.inspect.custom) return () => JSON.parse(JSON.stringify(mapProxy(state, objId)))
    if (key === '_inspect') return JSON.parse(JSON.stringify(mapProxy(state, objId)))
    if (key === '_type') return 'map'
    if (key === '_id') return objId
    if (key === '_state') return state
    if (key === '_store_id') return state.get('_id')
    if (key === '_conflicts') return getObjectConflicts(state, objId)
    if (!validFieldName(key)) return undefined
    const ops = OpSet.getFieldOps(state.get('ops'), objId, key)
    if (!ops.isEmpty()) return getOpValue(state, ops.first())
  },

  set (target, key, value) {
    throw new TypeError('You tried to set property ' + key + ' to ' + value + ', but this object ' +
                        'is read-only. Please use tesseract.set() to change it.')
  },

  deleteProperty (target, key) {
    throw new TypeError('You tried to delete the property ' + key + ', but this object ' +
                        'is read-only. Please use tesseract.remove() to change it.')
  },

  has (target, key) {
    return (key === '_type') || (key === '_id') || (key === '_state') ||
      (key === '_store_id') || (key === '_conflicts') ||
      isFieldPresent(target.get('state'), target.get('objId'), key)
  },

  getOwnPropertyDescriptor (target, key) {
    if (isFieldPresent(target.get('state'), target.get('objId'), key)) {
      return {configurable: true, enumerable: true}
    }
  },

  ownKeys (target) {
    const state = target.get('state'), objId = target.get('objId')
    return state
      .getIn(['ops', 'byObject', objId])
      .keySeq()
      .filter(key => isFieldPresent(state, objId, key))
      .toJS()
  }
}

const ListHandler = {
  get (target, key) {
    const [state, objId] = target
    if (!state.hasIn(['ops', 'byObject', objId])) throw 'Target object does not exist: ' + objId
    if (key === util.inspect.custom) return () => JSON.parse(JSON.stringify(listProxy(state, objId)))
    if (key === '_inspect') return JSON.parse(JSON.stringify(listProxy(state, objId)))
    if (key === '_type') return 'list'
    if (key === '_id') return objId
    if (key === '_state') return state
    if (key === '_store_id') return state.get('_id')
    if (key === 'length') return listLength(state, objId)
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return listElemByIndex(state, objId, parseInt(key))
    }
  },

  set (target, key, value) {
    throw new TypeError('You tried to set the list index ' + key + ' to ' + value +
                        ', but this object is read-only. Please use tesseract.set() to change it.')
  },

  deleteProperty (target, key) {
    throw new TypeError('You tried to delete the list index ' + key + ', but this object ' +
                        'is read-only. Please use tesseract.remove() to change it.')
  },

  has (target, key) {
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return parseInt(key) < listLength(...target)
    }
    return key === 'length'
  },

  getOwnPropertyDescriptor (target, key) {
    if (key === 'length') return {}
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      if (parseInt(key) < listLength(...target)) {
        return {configurable: true, enumerable: true}
      }
    }
  },

  ownKeys (target) {
    const length = listLength(...target)
    let keys = ['length']
    for (let i = 0; i < length; i++) keys.push(i.toString())
    return keys
  }
}

function mapProxy(state, objId) {
  return new Proxy(fromJS({state, objId}), MapHandler)
}

function listProxy(state, objId) {
  return new Proxy([state, objId], ListHandler)
}

module.exports = { mapProxy }
