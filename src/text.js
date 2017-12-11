const { SkipList } = require('./skip_list')

class Text {
  constructor (opSet, objectId) {
    return makeInstance(opSet, objectId)
  }

  get elemIds () {
    if (this.opSet && this.objectId) {
      return this.opSet.getIn(['byObject', this.objectId, '_elemIds'])
    } else {
      return new SkipList()
    }
  }

  get length () {
    return this.elemIds.length
  }

  get (index) {
    const key = this.elemIds.keyOf(index)
    if (key) return this.elemIds.getValue(key)
  }

  get _objectId () {
    return this.objectId
  }

  [Symbol.iterator] () {
    return this.elemIds.iterator('values')
  }
}

// Read-only methods that can delegate to the JavaScript built-in array
for (let method of ['concat', 'every', 'filter', 'find', 'findIndex', 'forEach', 'includes',
                    'indexOf', 'join', 'lastIndexOf', 'map', 'reduce', 'reduceRight',
                    'slice', 'some', 'toLocaleString', 'toString']) {
  Text.prototype[method] = function (...args) {
    const array = [...this.elemIds.iterator('values')]
    return array[method].call(array, ...args)
  }
}

function makeInstance(opSet, objectId) {
  const instance = Object.create(Text.prototype)
  instance.opSet = opSet
  instance.objectId = objectId
  return Object.freeze(instance)
}

module.exports = {Text}
