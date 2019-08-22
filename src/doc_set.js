const { Map, Set } = require('immutable')
const uuid = require('./uuid')
const Frontend = require('../frontend')
const Backend = require('../backend')

class DocSet {
  constructor () {
    this.docs = Map()
    this.handlers = Set()
  }

  get docIds () {
    return this.docs.keys()
  }

  getDoc (docId) {
    return this.docs.get(docId)
  }

  removeDoc (docId) {
    this.docs = this.docs.delete(docId)
  }

  setDoc (docId, doc) {
    this.docs = this.docs.set(docId, doc)
    this.handlers.forEach(handler => handler(docId, doc))
  }

  applyChanges (docId, changes) {
    let doc = this.docs.get(docId) || Frontend.init({backend: Backend})
    const oldState = Frontend.getBackendState(doc)
    const [newState, patch] = Backend.applyChanges(oldState, changes)
    patch.state = newState
    doc = Frontend.applyPatch(doc, patch)
    this.setDoc(docId, doc)
    return doc
  }

  registerHandler (handler) {
    this.handlers = this.handlers.add(handler)
  }

  unregisterHandler (handler) {
    this.handlers = this.handlers.remove(handler)
  }
}

module.exports = DocSet
