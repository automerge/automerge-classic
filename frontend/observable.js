const { OBJECT_ID, CONFLICTS } = require('./constants')
const { isObject, parseOpId } = require('../src/common')

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

    let changedProps = {}
    if (diff.props) {
      changedProps = diff.props
    } else if (diff.edits) {
      const elemDiffs = Array(before[CONFLICTS].length)
      for (const edit of diff.edits) {
        if (edit.action === 'update') {
          const elemDiff = elemDiffs[edit.index]
          if (!elemDiff) elemDiff = {}
          elemDiff[edit.opId] = edit.value
          elemDiffs[edit.index] = elemDiff
        } else if (edit.action === 'multi-insert') {
          for (i = 0; i < edit.count; i++) {
            let startOpId = parseOpId(edit.elemId)
            let counter = startOpId.counter + index
            let opid = `${counter}@${startOpId.actorId}`
            let index = edit.index + i
            elemDiffs[index] = {[opid]: {value: edit.values[i], type: 'value'}}
          }
        } else if (edit.action === 'insert') {
          const elemDiff = elemDiffs[edit.index]
          if (!elemDiff) elemDiff = {}
          elemDiff[edit.elemId] = edit.value
        } else if (edit.action === 'remove') {
          elemDiffs.splice(edit.index, edit.count)
        }
      }
      for (i = 0; i < elemDiffs.lenght; i++) {
        let elemDiff = elemDiffs[i]
        if (elemDiff) {
          changedProps[i] = elemDiff
        }
      }
    }
    for (let propName of Object.keys(changedProps)) {
      for (let opId of Object.keys(changedProps[propName])) {
        let childDiff = diff.props[propName][opId], childBefore, childAfter

        if (diff.type === 'map') {
          childBefore = before && before[CONFLICTS] && before[CONFLICTS][propName] &&
            before[CONFLICTS][propName][opId]
          childAfter = after && after[CONFLICTS] && after[CONFLICTS][propName] &&
            after[CONFLICTS][propName][opId]

        } else if (diff.type === 'table') {
          childBefore = before && before.byId(propName)
          childAfter = after && after.byId(propName)

        } else if (diff.type === 'list') {
          const index = parseInt(propName)
          // Don't try to get the child object before if the indexes might have changed
          if (!diff.edits || diff.edits.length === 0) {
            childBefore = before && before[CONFLICTS] && before[CONFLICTS][index] &&
              before[CONFLICTS][index][opId]
          }
          childAfter = after && after[CONFLICTS] && after[CONFLICTS][index] &&
            after[CONFLICTS][index][opId]

        } else if (diff.type === 'text') {
          const index = parseInt(propName)
          // Don't try to get the child object before if the indexes might have changed
          if (!diff.edits || diff.edits.length === 0) {
            childBefore = before && before.get(index)
          }
          childAfter = after && after.get(index)
        }

        this._objectUpdate(childDiff, childBefore, childAfter, local, changes)
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
