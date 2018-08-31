// Frontend-only (OpSet-free) version of proxies.js
// TODO unify the two versions!

const ROOT_ID = '00000000-0000-0000-0000-000000000000'

function listMethods(context, listId) {
  const methods = {
    deleteAt(index, numDelete) {
      context.splice(listId, index, numDelete || 1, [])
      return this
    },

    fill(value, start, end) {
      for (let [index, elem] of OpSet.listIterator(context.state.get('opSet'), listId, 'elems', context)) {
        if (end && index >= end) break
        if (index >= (start || 0)) {
          context.setField(listId, elem, value, true) // TODO setField doesn't exist any more
        }
      }
      return this
    },

    insertAt(index, ...values) {
      context.splice(listId, index, 0, values)
      return this
    },

    pop() {
      const length = OpSet.listLength(context.state.get('opSet'), listId)
      if (length == 0) return
      const last = OpSet.listElemByIndex(context.state.get('opSet'), listId, length - 1, context)
      context.splice(listId, length - 1, 1, [])
      return last
    },

    push(...values) {
      const length = OpSet.listLength(context.state.get('opSet'), listId)
      context.splice(listId, length, 0, values)
      return OpSet.listLength(context.state.get('opSet'), listId)
    },

    shift() {
      const first = OpSet.listElemByIndex(context.state.get('opSet'), listId, 0, context)
      context.splice(listId, 0, 1, [])
      return first
    },

    splice(start, deleteCount, ...values) {
      if (deleteCount === undefined) {
        deleteCount = OpSet.listLength(context.state.get('opSet'), listId) - start
      }
      const deleted = []
      for (let n = 0; n < deleteCount; n++) {
        deleted.push(OpSet.listElemByIndex(context.state.get('opSet'), listId, start + n, context))
      }
      context.splice(listId, start, deleteCount, values)
      return deleted
    },

    unshift(...values) {
      context.splice(listId, 0, 0, values)
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
    if (key === '_inspect') return JSON.parse(JSON.stringify(mapProxy(context, objectId)))
    if (key === '_type') return 'map'
    if (key === '_objectId') return objectId
    if (key === '_change') return context
    if (key === '_get') return context._get
    return context.getObjectField(objectId, key)
  },

  set (target, key, value) {
    const { context, objectId } = target
    context.setMapKey(objectId, key, value, true)
    return true
  },

  deleteProperty (target, key) {
    const { context, objectId } = target
    context.deleteMapKey(objectId, key)
    return true
  },

  has (target, key) {
    return ['_type', '_state', '_actorId', '_objectId', '_conflicts'].includes(key) ||
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
    context.setListIndex(objectId, key, value)
    return true
  },

  deleteProperty (target, key) {
    const [context, objectId] = target
    context.deleteField(objectId, key)
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

/**
 * Instantiates a proxy object for the given `objectId`.
 * This function is added as a method to the context object by rootObjectProxy().
 * When it is called, `this` is the context object.
 */
function instantiateProxy(objectId) {
  const object = this.getObject(objectId)
  if (Array.isArray(object)) {
    return listProxy(this, objectId)
  } else {
    return mapProxy(this, objectId)
  }
}

function rootObjectProxy(context) {
  context.instantiateObject = instantiateProxy
  context._get = (objId) => instantiateProxy.call(context, objId)
  return mapProxy(context, ROOT_ID)
}

module.exports = { rootObjectProxy }
