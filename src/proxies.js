const { List, fromJS } = require('immutable')
const util = require('util')
const OpSet = require('./op_set')

function getObjType(changeset, objectId) {
  const action = changeset.state.getIn(['opSet', 'byObject', objectId, '_init', 'action'])
  if (action === 'makeMap') return 'map'
  if (action === 'makeList') return 'list'
}

function getOpValue(changeset, op) {
  if (typeof op !== 'object' || op === null) return op
  const value = op.get('value')
  if (op.get('action') === 'set') return value
  if (op.get('action') === 'link') {
    const type = getObjType(changeset, value)
    if (type === 'map')  return mapProxy(changeset, value)
    if (type === 'list') return listProxy(changeset, value)
  }
}

function validFieldName(key) {
  return (typeof key === 'string' && key !== '' && !key.startsWith('_'))
}

function isFieldPresent(changeset, objectId, key) {
  return validFieldName(key) && !OpSet.getFieldOps(changeset.state.get('opSet'), objectId, key).isEmpty()
}

function getObjectConflicts(changeset, objectId) {
  return changeset.state
    .getIn(['opSet', 'byObject', objectId])
    .filter((field, key) => validFieldName(key) && OpSet.getFieldOps(changeset.state.get('opSet'), objectId, key).size > 1)
    .mapEntries(([key, field]) => [key, field.shift().toMap()
      .mapEntries(([idx, op]) => [op.get('actor'), getOpValue(changeset, op)])
    ]).toJS()
}

function listElemByIndex(changeset, listId, index) {
  let i = -1, elem = OpSet.getNext(changeset.state.get('opSet'), listId, '_head')
  while (elem) {
    const ops = OpSet.getFieldOps(changeset.state.get('opSet'), listId, elem)
    if (!ops.isEmpty()) i += 1
    if (i === index) return getOpValue(changeset, ops.first())
    elem = OpSet.getNext(changeset.state.get('opSet'), listId, elem)
  }
}

function listLength(changeset, listId) {
  let length = 0, elem = OpSet.getNext(changeset.state.get('opSet'), listId, '_head')
  while (elem) {
    if (!OpSet.getFieldOps(changeset.state.get('opSet'), listId, elem).isEmpty()) length += 1
    elem = OpSet.getNext(changeset.state.get('opSet'), listId, elem)
  }
  return length
}

function listImmutable(attempt) {
  throw new TypeError('You tried to ' + attempt + ', but this list is read-only. ' +
                      'Please use tesseract.changeset() to get a writable version.')
}

function listMethods(changeset, listId) {
  return {
    splice(start, deleteCount, ...values) {
      if (!changeset.mutable) listImmutable('splice a list')
      changeset.state = changeset.splice(changeset.state, listId, start, deleteCount || 0, values)
    },

    push(...values) {
      if (!changeset.mutable) listImmutable('push a new list element ' + JSON.stringify(values[0]))
      changeset.state = changeset.splice(changeset.state, listId, listLength(changeset, listId), 0, values)
      return listLength(changeset, listId)
    },

    shift() {
      if (!changeset.mutable) listImmutable('shift the first element off a list')
      const first = listElemByIndex(changeset, listId, 0)
      changeset.state = changeset.splice(changeset.state, listId, 0, 1, [])
      return first
    },

    unshift(...values) {
      if (!changeset.mutable) listImmutable('unshift a new list element ' + JSON.stringify(values[0]))
      changeset.state = changeset.splice(changeset.state, listId, 0, 0, values)
      return listLength(changeset, listId)
    }
  }
}

const MapHandler = {
  get (target, key) {
    const { changeset, objectId } = target
    if (!changeset.state.hasIn(['opSet', 'byObject', objectId])) throw 'Target object does not exist: ' + objectId
    if (key === util.inspect.custom) return () => JSON.parse(JSON.stringify(mapProxy(changeset, objectId)))
    if (key === '_inspect') return JSON.parse(JSON.stringify(mapProxy(changeset, objectId)))
    if (key === '_type') return 'map'
    if (key === '_objectId') return objectId
    if (key === '_state') return changeset.state
    if (key === '_actorId') return changeset.state.get('actorId')
    if (key === '_conflicts') return getObjectConflicts(changeset, objectId)
    if (key === '_changeset') return changeset
    if (!validFieldName(key)) return undefined
    const ops = OpSet.getFieldOps(changeset.state.get('opSet'), objectId, key)
    if (!ops.isEmpty()) return getOpValue(changeset, ops.first())
  },

  set (target, key, value) {
    const { changeset, objectId } = target
    if (!changeset.mutable) {
      throw new TypeError('You tried to set property ' + JSON.stringify(key) + ' to ' +
                          JSON.stringify(value) + ', but this object is read-only. ' +
                          'Please use tesseract.changeset() to get a writable version.')
    }
    changeset.state = changeset.setField(changeset.state, objectId, key, value)
    return true
  },

  deleteProperty (target, key) {
    const { changeset, objectId } = target
    if (!changeset.mutable) {
      throw new TypeError('You tried to delete the property ' + JSON.stringify(key) +
                          ', but this object is read-only. Please use tesseract.changeset() ' +
                          'to get a writable version.')
    }
    changeset.state = changeset.deleteField(changeset.state, objectId, key)
    return true
  },

  has (target, key) {
    return (key === '_type') || (key === '_objectId') || (key === '_state') ||
      (key === '_actorId') || (key === '_conflicts') ||
      isFieldPresent(target.changeset, target.objectId, key)
  },

  getOwnPropertyDescriptor (target, key) {
    if (isFieldPresent(target.changeset, target.objectId, key)) {
      return {configurable: true, enumerable: true}
    }
  },

  ownKeys (target) {
    return target.changeset.state
      .getIn(['opSet', 'byObject', target.objectId])
      .keySeq()
      .filter(key => isFieldPresent(target.changeset, target.objectId, key))
      .toJS()
  }
}

const ListHandler = {
  get (target, key) {
    const [changeset, objectId] = target
    if (!changeset.state.hasIn(['opSet', 'byObject', objectId])) throw 'Target object does not exist: ' + objectId
    if (key === util.inspect.custom) return () => JSON.parse(JSON.stringify(listProxy(changeset, objectId)))
    if (key === '_inspect') return JSON.parse(JSON.stringify(listProxy(changeset, objectId)))
    if (key === '_type') return 'list'
    if (key === '_objectId') return objectId
    if (key === '_state') return changeset.state
    if (key === '_actorId') return changeset.state.get('actorId')
    if (key === '_changeset') return changeset
    if (key === 'length') return listLength(changeset, objectId)
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return listElemByIndex(changeset, objectId, parseInt(key))
    }
    return listMethods(changeset, objectId)[key]
  },

  set (target, key, value) {
    const [changeset, objectId] = target
    if (!changeset.mutable) {
      throw new TypeError('You tried to set index ' + key + ' to ' + JSON.stringify(value) +
                          ', but this list is read-only. Please use tesseract.changeset() ' +
                          'to get a writable version.')
    }
    changeset.state = changeset.setListIndex(changeset.state, objectId, key, value)
    return true
  },

  deleteProperty (target, key) {
    const [changeset, objectId] = target
    if (!changeset.mutable) {
      throw new TypeError('You tried to delete the list index ' + key + ', but this list is ' +
                          'read-only. Please use tesseract.changeset() to get a writable version.')
    }
    changeset.state = changeset.deleteField(changeset.state, objectId, key)
    return true
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

function mapProxy(changeset, objectId) {
  return new Proxy({changeset, objectId}, MapHandler)
}

function listProxy(changeset, objectId) {
  return new Proxy([changeset, objectId], ListHandler)
}

module.exports = { mapProxy }
