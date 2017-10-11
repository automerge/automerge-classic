const { Map, Set } = require('immutable')
const serialize = require('serialize-javascript')

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
    const allHandlers = []

    this.docs.keySeq().forEach((docId) => {
      allDocs.push({
        id: docId,
        doc: this._saveDoc(this.docs.get(docId))
      })
    })

    this.handlers.forEach((handler) => {
      try { allHandlers.push(serialize(handler)) } catch(ex) {}
    })

    return {
      _type: 'DocSet',
      docs: allDocs,
      handlers: allHandlers
    }
  }
}

DocSet.fromJSON = (json) => {
  if (json._type != 'DocSet') return null

  const docSet = new DocSet()

  json.docs.forEach((item) => {
    docSet.setDoc(item.id, docSet._loadDoc(item.doc))
  })

  json.handlers.forEach((handler) => {
    const func = eval(handler)
    docSet.registerHandler(func)
  })

  return docSet
}

module.exports = DocSet
