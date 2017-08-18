const { Map, Set } = require('immutable')

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
    this.handlers.forEach(connection => connection.docChanged(docId, doc))
  }

  applyChanges (docId, changes) {
    const doc = this.applyChangesets(this.docs.get(docId), changes)
    this.setDoc(docId, doc)
    return doc
  }

  registerHandler (connection) {
    this.handlers = this.handlers.add(connection)
  }

  unregisterHandler (connection) {
    this.handlers = this.handlers.remove(connection)
  }
}

module.exports = DocSet
