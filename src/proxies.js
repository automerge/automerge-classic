const { List, fromJS } = require('immutable')
const util = require('util')

function getActionValue(state, action) {
  if (typeof action !== 'object' || action === null) return action
  const value = action.get('value')
  if (action.get('action') === 'set') return value
  if (action.get('action') === 'link') {
    const type = state.getIn(['objects', value, '_type'])
    if (type === 'map')  return mapProxy(state, value)
    if (type === 'list') return listProxy(state, value)
  }
}

function isFieldPresent(obj, key) {
  if (typeof obj === undefined) return false
  if (typeof key !== 'string' || key === '' || key.startsWith('_')) return false
  return obj.hasIn([key, 'actions']) && !obj.getIn([key, 'actions']).isEmpty()
}

function getObjectValue(state, id) {
  const src = state.getIn(['objects', id])
  if (src.get('_type') === 'map') {
    let obj = {}
    src.forEach((field, key) => {
      if (isFieldPresent(src, key)) {
        obj[key] = getActionValue(state, field.get('actions').first())
      }
    })
    return obj
  }

  if (src.get('_type') === 'list') {
    let list = [], elem = '_head'
    while (elem) {
      if (isFieldPresent(src, elem)) {
        list.push(getActionValue(state, src.getIn([elem, 'actions']).first()))
      }
      elem = src.getIn([elem, 'next'])
    }
    return list
  }
}

function getObjectConflicts(state, id) {
  const obj = state.getIn(['objects', id])
  return obj
    .filter((field, key) => isFieldPresent(obj, key) && field.get('actions').size > 1)
    .mapEntries(([key, field]) => [key, field.shift().toMap()
      .mapEntries(([idx, action]) => [action.get('by'), getActionValue(state, action)])
    ]).toJS()
}

function listElemByIndex(state, obj, index) {
  let i = -1, elem = obj.getIn(['_head', 'next'])
  while (elem) {
    if (isFieldPresent(obj, elem)) i += 1
    if (i === index) return getActionValue(state, obj.getIn([elem, 'actions']).first())
    elem = obj.getIn([elem, 'next'])
  }
}

function listLength(obj) {
  let length = 0, elem = obj.getIn(['_head', 'next'])
  while (elem) {
    if (isFieldPresent(obj, elem)) length += 1
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
    if (key === '_store_id') return target.getIn(['state', '_id'])
    if (key === '_conflicts') return getObjectConflicts(target.get('state'), target.get('id'))
    return getActionValue(target.get('state'), obj.getIn([key, 'actions'], List()).first())
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
      isFieldPresent(target.getIn(['state', 'objects', target.get('id')]), key)
  },

  getOwnPropertyDescriptor (target, key) {
    if (isFieldPresent(target.getIn(['state', 'objects', target.get('id')]), key)) {
      return {configurable: true, enumerable: true}
    }
  },

  ownKeys (target) {
    const obj = target.getIn(['state', 'objects', target.get('id')])
    return obj.keySeq().filter(key => isFieldPresent(obj, key)).toJS()
  }
}

const ListHandler = {
  get (target, key) {
    const obj = target.getIn(['state', 'objects', target.get('id')])
    if (key === util.inspect.custom) return () => getObjectValue(target.get('state'), target.get('id'))
    if (key === '_type') return 'list'
    if (key === '_id') return target.get('id')
    if (key === '_state') return target.get('state')
    if (key === '_store_id') return target.getIn(['state', '_id'])
    if (key === 'length') return listLength(obj)
    if (obj && typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return listElemByIndex(target.get('state'), obj, parseInt(key))
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

module.exports = { mapProxy }
