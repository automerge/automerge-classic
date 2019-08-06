/**
 * The most basic CRDT: an integer value that can be changed only by
 * incrementing and decrementing. Since addition of integers is commutative,
 * the value trivially converges.
 */
class Counter {
  constructor(value) {
    this.value = value || 0
    Object.freeze(this)
  }

  /**
   * A peculiar JavaScript language feature from its early days: if the object
   * `x` has a `valueOf()` method that returns a number, you can use numerical
   * operators on the object `x` directly, such as `x + 1` or `x < 4`.
   * This method is also called when coercing a value to a string by
   * concatenating it with another string, as in `x + ''`.
   * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/valueOf
   */
  valueOf() {
    return this.value
  }

  /**
   * Returns the counter value as a decimal string. If `x` is a counter object,
   * this method is called e.g. when you do `['value: ', x].join('')` or when
   * you use string interpolation: `value: ${x}`.
   */
  toString() {
    return this.valueOf().toString()
  }

  /**
   * Returns the counter value, so that a JSON serialization of an Automerge
   * document represents the counter simply as an integer.
   */
  toJSON() {
    return this.value
  }
}

/**
 * An instance of this class is used when a counter is accessed within a change
 * callback.
 */
class WriteableCounter extends Counter {
  /**
   * Increases the value of the counter by `delta`. If `delta` is not given,
   * increases the value of the counter by 1.
   */
  increment(delta) {
    delta = typeof delta === 'number' ? delta : 1
    this.context.increment(this.path, this.key, delta)
    this.value += delta
    return this.value
  }

  /**
   * Decreases the value of the counter by `delta`. If `delta` is not given,
   * decreases the value of the counter by 1.
   */
  decrement(delta) {
    return this.increment(typeof delta === 'number' ? -delta : -1)
  }
}

/**
 * Returns an instance of `WriteableCounter` for use in a change callback.
 * `context` is the proxy context that keeps track of the mutations.
 * `objectId` is the ID of the object containing the counter, and `key` is
 * the property name (key in map, or index in list) where the counter is
 * located.
*/
function getWriteableCounter(value, context, path, objectId, key) {
  const instance = Object.create(WriteableCounter.prototype)
  instance.value = value
  instance.context = context
  instance.path = path
  instance.objectId = objectId
  instance.key = key
  return instance
}

module.exports = { Counter, getWriteableCounter }
