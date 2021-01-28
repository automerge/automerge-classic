const { OBJECT_ID, CONFLICTS } = require('./constants')
const { isObject } = require('../src/common')

/**
 * Allows an application to register a callback when a particular object in
 * a document changes.
 */
class Observable {
  constructor() {
    this.observers = {} // map from objectId to array of observers for that object
  }

  /**
   * Called by an Automerge document when `patch` is applied. `before` is the
   * state of the document before the patch, and `after` is the state after
   * applying it. `local` is true if the update is a result of locally calling
   * `Automerge.change()`, and false otherwise.
   */
  patchCallback(patch, before, after, local) {
    this._objectUpdate(patch.diffs, before, after, local)
  }

  /**
   * Recursively walks a patch and calls the callbacks for all objects that
   * appear in the patch.
   */
  _objectUpdate(diff, before, after, local) {
    if (!diff.objectId) return
    if (this.observers[diff.objectId]) {
      for (let callback of this.observers[diff.objectId]) {
        callback(diff, before, after, local)
      }
    }

    if (!diff.props) return
    for (let propName of Object.keys(diff.props)) {
      for (let opId of Object.keys(diff.props[propName])) {
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

        this._objectUpdate(childDiff, childBefore, childAfter, local)
      }
    }
  }

  /**
   * Call this to register a callback that will get called whenever a particular
   * object in a document changes. The callback is passed four arguments: the
   * part of the patch describing the update to that object, the old state of
   * the object, the new state of the object, and a boolean that is true if the
   * change is the result of calling `Automerge.change()` locally.
   */
  observe(object, callback) {
    const objectId = object[OBJECT_ID]
    if (!objectId) throw new TypeError('The observed object must be part of an Automerge document')
    if (!this.observers[objectId]) this.observers[objectId] = []
    this.observers[objectId].push(callback)
  }
}

module.exports = { Observable }
