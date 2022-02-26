/**
 * ProxyPolyfill is a dump wrapper for `handler`
 * where `target` is a map and is always passed as parameter.
 */
class MapProxyPolyfill {
  /**
  * Creates ProxyPolyfill and defines methos dynamically.
  * All methods are a dump wrapper to `handler` methods with `target` as first parameter.
  */
  constructor(target, handler) {
    this.target = target
    for (const item in handler) {
      if (Object.prototype.hasOwnProperty.call(handler, item)) {
        this[item] = (...args) => handler[item](this.target, ...args)
      }
    }


    // Implements `getOwnPropertyNames` method for wrapped class.
    // This is needed because it is not possible to override `Object.getOwnPropertyNames()` without a `Proxy`.
    //
    // This method is a dump wrapper of `ownKey()` so it must be created only if the handle has `ownKey()` method.
    // (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/ownKeys for more info)
    if (typeof handler.ownKeys === 'function') {
      this.getOwnPropertyNames = () => handler.ownKeys(this.target)
    }

    // Implements `assign` method for wrapped class.
    // This is needed because it is not possible to override `Object.assign()` without a `Proxy`.
    if (typeof handler.set === 'function') {
      this.assign = (object) => {
        Object.keys(object).forEach(function(key) {
          handler.set(target, key, object[key])
        })
      }
    }
  }

  iterator () {
    // NOTE: this method used to be a generator; it has been converted to a regular
    // method (that mimics the interface of a generator) to avoid having to include
    // generator polyfills in the distribution build.
    // eslint-disable-next-line consistent-this
    const doc = this
    let keys = doc.ownKeys()
    let index = 0
    return {
      next () {
        let key = keys[index]
        if (!key) return { value: undefined, done: true }
        index = index + 1
        return {value: [key, doc.get(key)], done: false}
      },
      [Symbol.iterator]: () => this.iterator(),
    }
  }

  /**
   * Defines iterator. Iterates the map's key and values
  */
  [Symbol.iterator] () {
      return this.iterator()
  }

  /**
   * To be used by JSON.stringify() function.
   * It returns the wrapped instance.
   * (more info https://javascript.info/json#custom-tojson)
  */
  toJSON () {
    const { context, objectId } = this.target
    let object = context.getObject(objectId)
    return object
  }

  /**
   * Implements isArray method for wrapped class.
   * This is needed because it is not possible to override Array.isArray() without a Proxy.
  */
  isArray () {
    return false
  }
}

/**
 * ListProxyPolyfill is a dump wrapper for `handler`
 * where `target` is an array and is always passed as parameter.
 */
class ListProxyPolyfill {
  /**
  * Creates ListProxyPolyfill and defines methos dynamically.
  * All methods are a dump wrapper to `handler` methods with `target` as first parameter.
  */
  constructor(target, handler, listMethods) {
    this.target = target
    for (const item in handler) {
      if (Object.prototype.hasOwnProperty.call(handler, item)) {
        this[item] = (...args) => handler[item](this.target, ...args)
      }
    }

    // Casts `key` to string before calling `handler`s `get` method.
    // This is needed because Proxy does so and the handler is prepared for that.
    this.get = (key) => {
      if (typeof key == 'number') {
        key = key.toString()
      }
      return handler.get(this.target, key)
    }

    // Casts `key` to string before calling `handler`s `get` method.
    // This is needed because Proxy does so and the handler is prepared for that.
    this.has = (key) => {
      if (typeof key == 'number') {
        key = key.toString()
      }
      return handler.has(this.target, key)
    }


    // Implements `objectKeys` method for wrapped class.
    // This is needed because it is not possible to override `Object.keys()` without a `Proxy`.
    //
    // This method returns only enumerable property names.
    // (more info https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/keys)
    if (typeof handler.ownKeys === 'function' && typeof handler.getOwnPropertyDescriptor === 'function') {
      this.objectKeys = () => {
        let keys = []
        for (let key of handler.ownKeys(this.target)) {
          let description = handler.getOwnPropertyDescriptor(this.target, key)
          if (description.enumerable) {
            keys.push(key)
          }
        }
        return keys
      }
    }

    // Implements `getOwnPropertyNames` method for wrapped class.
    // This is needed because it is not possible to override `Object.getOwnPropertyNames()` without a `Proxy`.
    //
    // This method is a dump wrapper of `ownKey()` so it must be created only if the handle has `ownKey()` method.
    // (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy/Proxy/ownKeys for more info)
    if (typeof handler.ownKeys === 'function') {
      this.getOwnPropertyNames = () => handler.ownKeys(this.target)
    }

    // Defines same methods as listMethods
    // All methods are a dump wrapper to the ones defined on listMethods.
    const [context, objectId, path] = target
    const _listMethods = listMethods(context, objectId, path)
    for (const methodName in _listMethods) {
      if (Object.prototype.hasOwnProperty.call(_listMethods, methodName)) {
        this[methodName] = (...args) => _listMethods[methodName](...args)
      }
    }
  }

  iterator () {
    // NOTE: this method used to be a generator; it has been converted to a regular
    // method (that mimics the interface of a generator) to avoid having to include
    // generator polyfills in the distribution build.
    // eslint-disable-next-line consistent-this
    let doc = this
    let keysIterator = doc.keys()
    return {
      next () {
        let nextKey = keysIterator.next()
        if (nextKey.done) return nextKey
        return {value: doc.get(nextKey.value), done: false}
      },
      [Symbol.iterator]: () => this.iterator(),
    }
  }

  /**
   * Defines iterator. Iterates the array's values
  */
  [Symbol.iterator] () {
    return this.iterator()
  }

  /**
   * Implements isArray method for wrapped class.
   * This is needed because it is not possible to override Array.isArray() without a Proxy.
  */
  isArray () {
    return true
  }

  /**
   * Implements length method for wrapped class.
   * This is needed because it is not possible to override .length without a Proxy.
  */
  length () {
    const [context, objectId, /* path */] = this.target
    const object = context.getObject(objectId)
    return object.length
  }

  /**
   * To be used by JSON.stringify() function.
   * It returns the wrapped instance.
   * (more info https://javascript.info/json#custom-tojson)
  */
  toJSON () {
    const [ context, objectId ] = this.target
    let object = context.getObject(objectId)
    return object
  }
}


module.exports = { ListProxyPolyfill, MapProxyPolyfill }
