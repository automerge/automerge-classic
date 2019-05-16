const { OBJECT_ID, ELEM_IDS, MAX_ELEM } = require('./constants')

class Text {
  constructor (objectId, elems, maxElem) {
    return makeInstance(objectId, elems, maxElem)
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
   * Returns the content of the Text object as a simple string, so that the
   * JSON serialization of an Automerge document represents text nicely.
   */
  toJSON() {
    return this.join('')
  }
}

// Read-only methods that can delegate to the JavaScript built-in array
for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
                    'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
                    'slice', 'some', 'toLocaleString', 'toString']) {
  Text.prototype[method] = function (...args) {
    const array = [...this]
    return array[method].call(array, ...args)
  }
}

function makeInstance(objectId, elems, maxElem) {
  const instance = Object.create(Text.prototype)
  instance[OBJECT_ID] = objectId
  instance.elems = elems || []
  instance[MAX_ELEM] = maxElem || 0
  return instance
}

/**
 * Returns the elemId of the `index`-th element. `object` may be either
 * a list object or a Text object.
 */
function getElemId(object, index) {
  return (object instanceof Text) ? object.getElemId(index) : object[ELEM_IDS][index]
}

module.exports = { Text, getElemId }
