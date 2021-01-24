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

  /**
   * Returns a cursor that points to a specific point in the text.
   * For now, represented by a plain object.
   */
  getCursorAt (index) {
    return {
      // todo: are there any points in the lifecycle where the Text object doesn't have an ID?
      textId: this[OBJECT_ID], 
      elemId: this.getElemId(index)
    }
  }

  /**
   * Finds the latest integer index of a cursor object.
   * If the character was deleted, returns -1.
   * 
   * todos:
   * - consider returning the closest character if deleted
   * - consider optimizing the linear search
   */
  findCursorIndex (cursor) {
    if(cursor.textId === undefined || cursor.elemId === undefined) {
      throw new TypeError('Invalid cursor object')
    }
    if(cursor.textId !== this[OBJECT_ID]) {
      throw new TypeError('Cursor was initialized with a different text object')
    }
    return this.elems.findIndex(e => e.elemId === cursor.elemId)
  }

  /**
   * Iterates over the text elements character by character, including any
   * inline objects.
   */
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
   * Returns the content of the Text object as a simple string, ignoring any
   * non-character elements.
   */
  toString() {
    // Concatting to a string is faster than creating an array and then
    // .join()ing for small (<100KB) arrays.
    // https://jsperf.com/join-vs-loop-w-type-test
    let str = ''
    for (const elem of this.elems) {
      if (typeof elem.value === 'string') str += elem.value
    }
    return str
  }

  /**
   * Returns the content of the Text object as a sequence of strings,
   * interleaved with non-character elements.
   *
   * For example, the value ['a', 'b', {x: 3}, 'c', 'd'] has spans:
   * => ['ab', {x: 3}, 'cd']
   */
  toSpans() {
    let spans = []
    let chars = ''
    for (const elem of this.elems) {
      if (typeof elem.value === 'string') {
        chars += elem.value
      } else {
        if (chars.length > 0) {
          spans.push(chars)
          chars = ''
        }
        spans.push(elem.value)
      }
    }
    if (chars.length > 0) {
      spans.push(chars)
    }
    return spans
  }

  /**
   * Returns the content of the Text object as a simple string, so that the
   * JSON serialization of an Automerge document represents text nicely.
   */
  toJSON() {
    return this.toString()
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
  deleteAt(index, numDelete = 1) {
    if (this.context) {
      this.context.splice(this[OBJECT_ID], index, numDelete, [])
    } else if (!this[OBJECT_ID]) {
      this.elems.splice(index, numDelete)
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
