const { OBJECT_ID, CONFLICTS } = require('./constants')

/**
 * Allows an application to register a callback when a particular object in
 * a document changes.
 *
 * NOTE: This API is experimental and may change without warning in minor releases.
 */
class Observable {
  constructor() {
    this.observers = {} // map from objectId to array of observers for that object
  }

  /**
   * Called by an Automerge document when `patch` is applied. `before` is the
   * state of the document before the patch, and `after` is the state after
   * applying it. `local` is true if the update is a result of locally calling
   * `Automerge.change()`, and false otherwise. `changes` is an array of
   * changes that were applied to the document (as Uint8Arrays).
   */
  patchCallback(patch, before, after, local, changes) {
    this._objectUpdate(patch.diffs, before, after, local, changes)
  }

  /**
   * Recursively walks a patch and calls the callbacks for all objects that
   * appear in the patch.
   */
  _objectUpdate(diff, before, after, local, changes) {
    if (!diff.objectId) return
    if (this.observers[diff.objectId]) {
      for (let callback of this.observers[diff.objectId]) {
        callback(diff, before, after, local, changes)
      }
    }

    if (diff.type === 'map' && diff.props) {
      for (const propName of Object.keys(diff.props)) {
        for (const opId of Object.keys(diff.props[propName])) {
          this._objectUpdate(diff.props[propName][opId],
                             before && before[CONFLICTS] && before[CONFLICTS][propName] && before[CONFLICTS][propName][opId],
                             after && after[CONFLICTS] && after[CONFLICTS][propName] && after[CONFLICTS][propName][opId],
                             local, changes)
        }
      }

    } else if (diff.type === 'table' && diff.props) {
      for (const rowId of Object.keys(diff.props)) {
        for (const opId of Object.keys(diff.props[rowId])) {
          this._objectUpdate(diff.props[rowId][opId],
                             before && before.byId(rowId),
                             after && after.byId(rowId),
                             local, changes)
        }
      }

    } else if (diff.type === 'list' && diff.edits) {
      let offset = 0
      for (const edit of diff.edits) {
        if (edit.action === 'insert') {
          offset -= 1
          this._objectUpdate(edit.value, undefined,
                             after && after[CONFLICTS] && after[CONFLICTS][edit.index] && after[CONFLICTS][edit.index][edit.elemId],
                             local, changes)
        } else if (edit.action === 'multi-insert') {
          offset -= edit.values.length
        } else if (edit.action === 'update') {
          this._objectUpdate(edit.value,
                             before && before[CONFLICTS] && before[CONFLICTS][edit.index + offset] &&
                               before[CONFLICTS][edit.index + offset][edit.opId],
                             after && after[CONFLICTS] && after[CONFLICTS][edit.index] && after[CONFLICTS][edit.index][edit.opId],
                             local, changes)
        } else if (edit.action === 'remove') {
          offset += edit.count
        }
      }

    } else if (diff.type === 'text' && diff.edits) {
      let offset = 0
      for (const edit of diff.edits) {
        if (edit.action === 'insert') {
          offset -= 1
          this._objectUpdate(edit.value, undefined, after && after.get(edit.index), local, changes)
        } else if (edit.action === 'multi-insert') {
          offset -= edit.values.length
        } else if (edit.action === 'update') {
          this._objectUpdate(edit.value,
                             before && before.get(edit.index + offset),
                             after && after.get(edit.index),
                             local, changes)
        } else if (edit.action === 'remove') {
          offset += edit.count
        }
      }
    }
  }

  /**
   * Call this to register a callback that will get called whenever a particular
   * object in a document changes. The callback is passed five arguments: the
   * part of the patch describing the update to that object, the old state of
   * the object, the new state of the object, a boolean that is true if the
   * change is the result of calling `Automerge.change()` locally, and the array
   * of binary changes applied to the document.
   */
  observe(object, callback) {
    const objectId = object[OBJECT_ID]
    if (!objectId) throw new TypeError('The observed object must be part of an Automerge document')
    if (!this.observers[objectId]) this.observers[objectId] = []
    this.observers[objectId].push(callback)
  }
}

module.exports = { Observable }
