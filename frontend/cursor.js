const { OBJECT_ID, ELEM_IDS } = require('./constants')
const { isObject } = require('../src/common')

/**
 * A cursor references a particular element in a list, or a character in an
 * Automerge.Text object. As list elements get inserted/deleted ahead of the
 * cursor position, the index of the cursor is automatically recomputed.
 */
class Cursor {
  constructor(object, index, elemId = undefined) {
    if (Array.isArray(object) && typeof index === 'number') {
      if (!object[OBJECT_ID] || !object[ELEM_IDS]) {
        throw new RangeError('The object referenced by a cursor must be part of a document')
      }
      if (index < 0 || index >= object[ELEM_IDS].length) {
        throw new RangeError('list index out of bounds')
      }
      this.objectId = object[OBJECT_ID]
      this.elemId = object[ELEM_IDS][index]
      this.index = index
    } else if (isObject(object) && object.getElemId && typeof index === 'number') {
      if (!object[OBJECT_ID]) {
        throw new RangeError('The object referenced by a cursor must be part of a document')
      }
      this.objectId = object[OBJECT_ID]
      this.elemId = object.getElemId(index)
      this.index = index
    } else if (typeof object == 'string' && typeof index === 'number' && typeof elemId === 'string') {
      this.objectId = object
      this.elemId = elemId
      this.index = index
    } else {
      throw new TypeError('Construct a cursor using a list/text object and index')
    }
  }

  /**
   * Called when a cursor is accessed within a change callback. `context` is the
   * proxy context that keeps track of any mutations.
   */
  getWriteable(context, path) {
    const instance = new Cursor(this.objectId, this.index, this.elemId)
    instance.context = context
    instance.path = path
    return instance
  }
}

module.exports = { Cursor }
