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
      let list = context.getObject(listId)
      for (let index = (start || 0); index < (end || list.length); index++) {
        context.setListIndex(listId, index, value)
      }
      return this
    },

    insertAt(index, ...values) {
      context.splice(listId, index, 0, values)
      return this
    },

    pop() {
      let list = context.getObject(listId)
      if (list.length == 0) return
      const last = context.getObjectField(listId, list.length - 1)
      context.splice(listId, length - 1, 1, [])
      return last
    },

    push(...values) {
      let list = context.getObject(listId)
      context.splice(listId, list.length, 0, values)
      // need to getObject() again because the list object above may be immutable
      return context.getObject(listId).length
    },

    shift() {
      const first = context.getObjectField(listId, 0)
      context.splice(listId, 0, 1, [])
      return first
    },

    splice(start, deleteCount, ...values) {
      let list = context.getObject(listId)
      if (deleteCount === undefined) {
        deleteCount = list.length - start
      }
      const deleted = []
      for (let n = 0; n < deleteCount; n++) {
        deleted.push(context.getObjectField(listId, start + n))
      }
      context.splice(listId, start, deleteCount, values)
      return deleted
    },

    unshift(...values) {
      context.splice(listId, 0, 0, values)
      return context.getObject(listId).length
    }
  }

  // Read-only methods that can delegate to the JavaScript built-in implementations
  for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
                      'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
                      'slice', 'some', 'toLocaleString', 'toString']) {
    methods[method] = (...args) => {
      const list = context.getObject(listId)
      return list[method].call(list, ...args)
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
    context.setMapKey(objectId, key, value)
    return true
  },

  deleteProperty (target, key) {
    const { context, objectId } = target
    context.deleteMapKey(objectId, key)
    return true
  },

  has (target, key) {
    return ['_type', '_objectId', '_change', '_get'].includes(key) ||
      (key in context.getObject(target.objectId))
  },

  getOwnPropertyDescriptor (target, key) {
    const object = context.getObject(target.objectId)
    return Object.getOwnPropertyDescriptor(object, key)
  },

  ownKeys (target) {
    return Object.keys(context.getObject(target.objectId))
  }
}

const ListHandler = {
  get (target, key) {
    const [context, objectId] = target
    if (key === Symbol.iterator) return context.getObject(objectId)[Symbol.iterator]
    if (key === '_inspect') return JSON.parse(JSON.stringify(listProxy(context, objectId)))
    if (key === '_type') return 'list'
    if (key === '_objectId') return objectId
    if (key === '_change') return context
    if (key === 'length') return context.getObject(objectId).length
    if (typeof key === 'string' && /^[0-9]+$/.test(key)) {
      return context.getObjectField(objectId, parseInt(key))
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
      return parseInt(key) < context.getObject(objectId).length
    }
    return ['length', '_type', '_objectId', '_change'].includes(key)
  },

  getOwnPropertyDescriptor (target, key) {
    const [context, objectId] = target
    const object = context.getObject(objectId)
    return Object.getOwnPropertyDescriptor(object, key)
  },

  ownKeys (target) {
    const [context, objectId] = target
    const object = context.getObject(objectId)
    return Object.keys(object)
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
