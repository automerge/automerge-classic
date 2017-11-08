const { List, fromJS } = require('immutable')
const OpSet = require('./op_set')

function listImmutable(attempt) {
  throw new TypeError('You tried to ' + attempt + ', but this list is read-only. ' +
                      'Please use Automerge.change() to get a writable version.')
}

function listMethods(context, listId) {
  const methods = {
    deleteAt(index, numDelete) {
      if (!context.mutable) listImmutable('delete the list element at index ' + index)
      context.state = context.splice(context.state, listId, index, numDelete || 1, [])
      return this
    },

    fill(value, start, end) {
      if (!context.mutable) listImmutable('fill a list with a value')
      for (let [index, elem] of OpSet.listIterator(context.state.get('opSet'), listId, 'elems', context)) {
        if (end && index >= end) break
        if (index >= (start || 0)) {
          context.state = context.setField(context.state, listId, elem, value)
        }
      }
      return this
    },

    insertAt(index, ...values) {
      if (!context.mutable) listImmutable('insert a list element at index ' + index)
      context.state = context.splice(context.state, listId, index, 0, values)
      return this
    },

    pop() {
      if (!context.mutable) listImmutable('pop the last element off a list')
      const length = OpSet.listLength(context.state.get('opSet'), listId)
      if (length == 0) return
      const last = OpSet.listElemByIndex(context.state.get('opSet'), listId, length - 1, context)
      context.state = context.splice(context.state, listId, length - 1, 1, [])
      return last
    },

    push(...values) {
      if (!context.mutable) listImmutable('push a new list element ' + JSON.stringify(values[0]))
      const length = OpSet.listLength(context.state.get('opSet'), listId)
      context.state = context.splice(context.state, listId, length, 0, values)
      return OpSet.listLength(context.state.get('opSet'), listId)
    },

    shift() {
      if (!context.mutable) listImmutable('shift the first element off a list')
      const first = OpSet.listElemByIndex(context.state.get('opSet'), listId, 0, context)
      context.state = context.splice(context.state, listId, 0, 1, [])
      return first
    },

    splice(start, deleteCount, ...values) {
      if (!context.mutable) listImmutable('splice a list')
      if (deleteCount === undefined) {
        deleteCount = OpSet.listLength(context.state.get('opSet'), listId) - start
      }
      context.state = context.splice(context.state, listId, start, deleteCount, values)
    },

    unshift(...values) {
      if (!context.mutable) listImmutable('unshift a new list element ' + JSON.stringify(values[0]))
      context.state = context.splice(context.state, listId, 0, 0, values)
      return OpSet.listLength(context.state.get('opSet'), listId)
    }
  }

  for (let iterator of ['entries', 'keys', 'values']) {
    methods[iterator] = () => OpSet.listIterator(context.state.get('opSet'), listId, iterator, context)
  }

  // Read-only methods that can delegate to the JavaScript built-in implementations
  for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
                      'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
                      'slice', 'some', 'toLocaleString', 'toString']) {
    methods[method] = (...args) => {
      const array = [...OpSet.listIterator(context.state.get('opSet'), listId, 'values', context)]
      return array[method].call(array, ...args)
    }
  }

  return methods
}

const MapHandler = {
  get (target, key) {
    const { context, objectId } = target
    if (!context.state.hasIn(['opSet', 'byObject', objectId])) throw 'Target object does not exist: ' + objectId
    if (key === '_inspect') return JSON.parse(JSON.stringify(mapProxy(context, objectId)))
    if (key === '_type') return 'map'
    if (key === '_objectId') return objectId
    if (key === '_state') return context.state
    if (key === '_actorId') return context.state.get('actorId')
    if (key === '_conflicts') return OpSet.getObjectConflicts(context.state.get('opSet'), objectId, context).toJS()
    if (key === '_change') return context
    return OpSet.getObjectField(context.state.get('opSet'), objectId, key, context)
  },

  set (target, key, value) {
    const { context, objectId } = target
    if (!context.mutable) {
      throw new TypeError('You tried to set property ' + JSON.stringify(key) + ' to ' +
                          JSON.stringify(value) + ', but this object is read-only. ' +
                          'Please use Automerge.change() to get a writable version.')
    }
    context.state = context.setField(context.state, objectId, key, value)
    return true
  },

  deleteProperty (target, key) {
    const { context, objectId } = target
    if (!context.mutable) {
      throw new TypeError('You tried to delete the property ' + JSON.stringify(key) +
                          ', but this object is read-only. Please use Automerge.change() ' +
                          'to get a writable version.')
    }
    context.state = context.deleteField(context.state, objectId, key)
    return true
  },

  has (target, key) {
    return (key === '_type') || (key === '_state') || (key === '_actorId') || (key === '_conflicts') ||
      OpSet.getObjectFields(target.context.state.get('opSet'), target.objectId).has(key)
  },

  getOwnPropertyDescriptor (target, key) {
    if (OpSet.getObjectFields(target.context.state.get('opSet'), target.objectId).has(key)) {
      return {configurable: true, enumerable: true}
    }
  },

  ownKeys (target) {
    return OpSet.getObjectFields(target.context.state.get('opSet'), target.objectId).toJS()
  }
}

const ListHandler = {
  get (target, key) {
    const [context, objectId] = target
    if (!context.state.hasIn(['opSet', 'byObject', objectId])) throw 'Target object does not exist: ' + objectId
    if (key === Symbol.iterator) return () => OpSet.listIterator(context.state.get('opSet'), objectId, 'values', context)
    if (key === '_inspect') return JSON.parse(JSON.stringify(listProxy(context, objectId)))
    if (key === '_type') return 'list'
    if (key === '_objectId') return objectId
    if (key === '_state') return context.state
    if (key === '_actorId') return context.state.get('actorId')
    if (key === '_change') return context
    if (key === 'length') return OpSet.listLength(context.state.get('opSet'), objectId)
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return OpSet.listElemByIndex(context.state.get('opSet'), objectId, parseInt(key), context)
    }
    return listMethods(context, objectId)[key]
  },

  set (target, key, value) {
    const [context, objectId] = target
    if (!context.mutable) {
      throw new TypeError('You tried to set index ' + key + ' to ' + JSON.stringify(value) +
                          ', but this list is read-only. Please use Automerge.change() ' +
                          'to get a writable version.')
    }
    context.state = context.setListIndex(context.state, objectId, key, value)
    return true
  },

  deleteProperty (target, key) {
    const [context, objectId] = target
    if (!context.mutable) {
      throw new TypeError('You tried to delete the list index ' + key + ', but this list is ' +
                          'read-only. Please use Automerge.change() to get a writable version.')
    }
    context.state = context.deleteField(context.state, objectId, key)
    return true
  },

  has (target, key) {
    const [context, objectId] = target
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return parseInt(key) < OpSet.listLength(context.state.get('opSet'), objectId)
    }
    return (key === 'length') || (key === '_type') || (key === '_objectId') ||
      (key === '_state') || (key === '_actorId')
  },

  getOwnPropertyDescriptor (target, key) {
    const [context, objectId] = target
    if (key === 'length') return {}
    if (key === '_objectId' || (typeof key === 'string' && /^[0-9]+$/.test(key))) {
      if (parseInt(key) < OpSet.listLength(context.state.get('opSet'), objectId)) {
        return {configurable: true, enumerable: true}
      }
    }
  },

  ownKeys (target) {
    const [context, objectId] = target
    const length = OpSet.listLength(context.state.get('opSet'), objectId)
    let keys = ['length', '_objectId']
    for (let i = 0; i < length; i++) keys.push(i.toString())
    return keys
  }
}

function mapProxy(context, objectId) {
  return new Proxy({context, objectId}, MapHandler)
}

function listProxy(context, objectId) {
  return new Proxy([context, objectId], ListHandler)
}

function instantiateProxy(opSet, objectId) {
  const objectType = opSet.getIn(['byObject', objectId, '_init', 'action'])
  if (objectType === 'makeMap') {
    return mapProxy(this, objectId)
  } else if (objectType === 'makeList' || objectType === 'makeText') {
    return listProxy(this, objectId)
  } else throw 'Unknown object type: ' + objectType
}

function rootObjectProxy(context) {
  context.instantiateObject = instantiateProxy
  return mapProxy(context, '00000000-0000-0000-0000-000000000000')
}

module.exports = { rootObjectProxy }
