const { Map, Set } = require('immutable')
const uuid = require('uuid/v4')
const FreezeAPI = require('./freeze_api')

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

  setDoc (docId, doc) {
    this.docs = this.docs.set(docId, doc)
    this.handlers.forEach(handler => handler(docId, doc))
  }

  applyChanges (docId, changes) {
    let doc = this.docs.get(docId) || FreezeAPI.init(uuid())
    doc = FreezeAPI.applyChanges(doc, changes, true)
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
