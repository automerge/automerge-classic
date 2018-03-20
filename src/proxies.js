const { Map, Set, List, Record, fromJS } = require('immutable')
const OpSet = require('./op_set')
const { setField, setListIndex, deleteField, splice } = require('./state')

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
      const deleted = []
      for (let n = 0; n < deleteCount; n++) {
        deleted.push(OpSet.listElemByIndex(context.state.get('opSet'), listId, start + n, context))
      }
      context.state = context.splice(context.state, listId, start, deleteCount, values)
      return deleted
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

class immutableListProxy {
  constructor(context, objectId) {
    // _context and _objectId are private to Automerge
    this._context = context
    this._objectId = objectId

    // size is a public field in the Immutable.js API, and so too here
    this.size = OpSet.listLength(this._context.state.get('opSet'), this._objectId)
  }

  // TODO: do we need/want: _inspect, _type, _state, _actorId, _conflicts, _change,
  // here and/or in properties?
  // TODO: treatment of context here and in map variant simplifyable?
  get(index) {
    return OpSet.listElemByIndex(this._context.state.get('opSet'), this._objectId, index, this._context)
  }

  // TODO: duplicates immutableMapProxy#getIn
  getIn(keys) {
    if (keys.length === 0) {
      throw new TypeError('Must have at least one key to getIn')
    }
    let obj = this
    for (let key of keys) {
      obj = obj.get(key)
      if (obj === undefined) break
    }
    return obj
  }

  // TODO: almost duplicates immutableMapProxy#set (mod setListIndex and constructor)
  // TODO: find intContext for list set and possibly other call sites.
  set(index, value) {
    const newContext = this._context.update('state', (s) => {
      return setListIndex(s, this._objectId, index, value)
    })
    return new immutableListProxy(newContext, this._objectId)
  }

  // TODO: would duplicate immutableMapProxy#setIn except for last line.
  setIn(keys, value) {
    throw new Error('Not yet implemented (and should be unreachable)')
  }

  delete(index) {
    return this.splice(index, 1)
  }

  splice(index, removeNum, ...values) {
    if (removeNum === undefined) {
      removeNum = this.size - index
    }
    const newContext = this._context.update('state', (s) => {
      return splice(s, this._objectId, index, removeNum, values)
    })
    return new immutableMapProxy(newContext, this._objectId)
  }

  insert(index, value) {
    return this.splice(index, 0, value)
  }

  push(...values) {
    return this.splice(this.size, 0, ...values)
  }

  pop() {
    if (this.size == 0) {
      return this
    }
    return this.splice(this.size - 1, 1)
  }

  unshift(value) {
    return this.splice(0, 0, value)
  }

  shift() {
    return this.splice(0, 1)
  }
}

class immutableMapProxy {
  constructor(context, objectId) {
    this._context = context
    this._objectId = objectId
  }

  mustGiveKeys(keys, fnName) {
    if (keys.length === 0) {
      throw new TypeError(`Must have at least one key to ${fnName}`)
    }
  }

  get(key) {
    // TODO: do we need/want: _inspect, _type, _state, _actorId, _conflicts, _change,
    // here and/or in properties?
    return OpSet.getObjectField(this._context.state.get('opSet'), this._objectId, key, this._context)
  }

  getIn(keys) {
    if (keys.length === 0) {
      throw new TypeError('Must have at least one key to getIn')
    }
    let obj = this
    for (let key of keys) {
      obj = obj.get(key)
      if (obj === undefined) break
    }
    return obj
  }

  set(key, value) {
    const intContext = isImmutableProxy(value) ? value._context : this._context
    const newContext = intContext.update('state', (s) => {
      return setField(s, this._objectId, key, value)
    })
    return new immutableMapProxy(newContext, this._objectId)
  }

  // TODO: find intContext for list setIn
  setIn(keys, value) {
    this.mustGiveKeys(keys, 'setIn')

    let keyedObject = this
    for (let i=1; i<keys.length; i++) {
      keyedObject = keyedObject.get(keys[i-1])
      // If we're missing any containers in the chain, we need to create empty
      // maps. To do that, we'll first form the new maps as standard immutable
      // nested values around the original leaf value, and then setIn that new,
      // larger value with the smaller, existing array of keys as the path.
      if (!keyedObject) {
        const keysWithObjects = keys.slice(0, i)
        const keysWithoutObjects = keys.slice(i)
        let newValue = value
        for (let j=keysWithoutObjects.length-1; j>=0; j--) {
          newValue = new Map().set(keysWithoutObjects[j], newValue)
        }
        return this.setIn(keysWithObjects, newValue)
      }
    }
    const intContext = isImmutableProxy(value) ? value._context : this._context
    const newContext = intContext.update('state', (s) => {
      const keyedObjectId = keyedObject._objectId
      const keyedObjectKey = keys[keys.length-1]
      if (keyedObject instanceof immutableMapProxy) {
        return setField(s, keyedObjectId, keyedObjectKey, value)
      } else if (keyedObject instanceof immutableListProxy) {
        return setListIndex(s, keyedObjectId, keyedObjectKey, value)
      } else {
        throw new Error('Unexpected keyedObject (and should be unreachable)')
      }
    })
    return new immutableMapProxy(newContext, this._objectId)
  }

  update(key, fn) {
    if (arguments.length != 2) {
      throw new TypeError('Must use 2-ary form of .update')
    }

    const oldValue = this.get(key)
    const newValue = fn(oldValue)
    return this.set(key, newValue)
  }

  updateIn(keys, fn) {
    this.mustGiveKeys(keys, 'updateIn')
    if (arguments.length != 2) {
      throw new TypeError('Must use 2-ary form of .update')
    }

    const oldValue = this.getIn(keys)
    const newValue = fn(oldValue)
    return this.setIn(keys, newValue)
  }

  delete(key) {
    const newContext = this._context.update('state', (s) => {
      return deleteField(s, this._objectId, key)
    })
    return new immutableMapProxy(newContext, this._objectId)
  }

  deleteIn(keys) {
    if (keys.length === 0) {
      throw new TypeError('Must have at least one key to deleteIn')
    }
    let keyedObj = this
    for (let i=1; i<keys.length; i++) {
      keyedObj = keyedObj.get(keys[i-1])
      if (!keyedObj) {
        return this
      }
    }
    const innerKey = keys[keys.length-1]
    if (!keyedObj.get(innerKey)) {
      return this
    }
    const newContext = this._context.update('state', (s) => {
      return deleteField(s, keyedObj._objectId, innerKey)
    })
    return new immutableMapProxy(newContext, this._objectId)
  }
}

// TODO: different way to factor this to remove combination of this and explicit params?
function instantiateImmutableProxy(opSet, objectId) {
  const objectType = opSet.getIn(['byObject', objectId, '_init', 'action'])
  if (objectType === 'makeMap') {
    return new immutableMapProxy(this, objectId)
  } else if (objectType === 'makeList') {
    return new immutableListProxy(this, objectId)
  } else {
    debugger
    throw new Error('Unknown object type: ' + objectType)
  }
}

function isImmutableProxy(object) {
  return ((object instanceof immutableMapProxy) || (object instanceof immutableListProxy))
}

function rootImmutableProxy(context) {
  const newContext = context.set('instantiateObject', instantiateImmutableProxy)
  return new immutableMapProxy(newContext, '00000000-0000-0000-0000-000000000000')
}

const ImmutableContext = Record({
  state: undefined,
  instantiateObject: undefined,
})

module.exports = { rootObjectProxy, rootImmutableProxy, isImmutableProxy, ImmutableContext }
