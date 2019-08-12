const { OBJECT_ID, ELEM_IDS, MAX_ELEM } = require('./constants')

class Text {
  constructor (text) {
    if (typeof text === 'string') {
      const elems = text.split('').map(value => ({value}))
      return instantiateText(undefined, elems, undefined)
    } else if (Array.isArray(text)) {
      const elems = text.map(value => ({value}))
      return instantiateText(undefined, elems, undefined)
    } else if (text === undefined) {
      return instantiateText(undefined, [], 0)
    } else {
      throw new TypeError(`Unsupported initial value for Text: ${text}`)
    }
  }

  get length () {
    return this.elems.length
  }

  get (index) {
    return this.elems[index].value
  }

  getElemId (index) {
    return this.elems[index].elemId
  }

  [Symbol.iterator] () {
    let elems = this.elems, index = -1
    return {
      next () {
        index += 1
        if (index < elems.length) {
          return {done: false, value: elems[index].value}
        } else {
          return {done: true}
        }
      }
    }
  }

  /**
   * Returns the content of the Text object as a simple string.
   */
  toString() {
    return this.join('')
  }
  /**
   * Returns the content of the Text object as a simple string, so that the
   * JSON serialization of an Automerge document represents text nicely.
   */
  toJSON() {
    return this.join('')
  }

  /**
   * Returns a writeable instance of this object. This instance is returned when
   * the text object is accessed within a change callback. `context` is the
   * proxy context that keeps track of the mutations.
   */
  getWriteable(context) {
    if (!this[OBJECT_ID]) {
      throw new RangeError('getWriteable() requires the objectId to be set')
    }

    const instance = instantiateText(this[OBJECT_ID], this.elems, this[MAX_ELEM])
    instance.context = context
    return instance
  }

  /**
   * Updates the list item at position `index` to a new value `value`.
   */
  set (index, value) {
    if (this.context) {
      this.context.setListIndex(this[OBJECT_ID], index, value)
    } else if (!this[OBJECT_ID]) {
      this.elems[index].value = value
    } else {
      throw new TypeError('Automerge.Text object cannot be modified outside of a change block')
    }
    return this
  }

  /**
   * Inserts new list items `values` starting at position `index`.
   */
  insertAt(index, ...values) {
    if (this.context) {
      this.context.splice(this[OBJECT_ID], index, 0, values)
    } else if (!this[OBJECT_ID]) {
      this.elems.splice(index, 0, ...values.map(value => ({value})))
    } else {
      throw new TypeError('Automerge.Text object cannot be modified outside of a change block')
    }
    return this
  }

  /**
   * Deletes `numDelete` list items starting at position `index`.
   * if `numDelete` is not given, one item is deleted.
   */
  deleteAt(index, numDelete) {
    if (this.context) {
      this.context.splice(this[OBJECT_ID], index, numDelete || 1, [])
    } else if (!this[OBJECT_ID]) {
      this.elems.splice(index, numDelete || 1)
    } else {
      throw new TypeError('Automerge.Text object cannot be modified outside of a change block')
    }
    return this
  }
}

// Read-only methods that can delegate to the JavaScript built-in array
for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
                    'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
                    'slice', 'some', 'toLocaleString']) {
  Text.prototype[method] = function (...args) {
    const array = [...this]
    return array[method].call(array, ...args)
  }
}

function instantiateText(objectId, elems, maxElem) {
  const instance = Object.create(Text.prototype)
  instance[OBJECT_ID] = objectId
  instance.elems = elems
  instance[MAX_ELEM] = maxElem
  return instance
}

/**
 * Returns the elemId of the `index`-th element. `object` may be either
 * a list object or a Text object.
 */
function getElemId(object, index) {
  return (object instanceof Text) ? object.getElemId(index) : object[ELEM_IDS][index]
}

module.exports = { Text, getElemId, instantiateText }
