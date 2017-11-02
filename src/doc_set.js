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
    this.handlers.forEach(handler => handler(docId, doc))
  }

  applyChanges (docId, changes) {
    const doc = this._applyChanges(this.docs.get(docId), changes)
    this.setDoc(docId, doc)
    return doc
  }

  registerHandler (handler) {
    this.handlers = this.handlers.add(handler)
  }

  unregisterHandler (handler) {
    this.handlers = this.handlers.remove(handler)
  }

  toJSON () {
    const allDocs = []

    this.docs.keySeq().forEach((docId) => {
      allDocs.push({
        id: docId,
        doc: this._saveDoc(this.docs.get(docId))
      })
    })

    return {
      _type: 'DocSet',
      docs: allDocs
    }
  }
}

DocSet.fromJSON = (json, handlers = []) => {
  if (json._type != 'DocSet') return null

  const docSet = new DocSet()

  json.docs.forEach((item) => {
    docSet.setDoc(item.id, docSet._loadDoc(item.doc))
  })

  handlers.forEach((handler) => {
    docSet.registerHandler(handler)
  })

  return docSet
}

module.exports = DocSet
