const { Map, Set } = require('immutable')
const transit = require('transit-immutable-js')

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
    return {
      _type: 'DocSet',
      docs: transit.toJSON(this.docs),
      handlers: transit.toJSON(this.handlers)
    }
  }
}

DocSet.fromJSON = (json) => {
  if (json._type != 'DocSet') return null

  const docSet = new DocSet()

  const docs = transit.fromJSON(json.docs)
  const handlers = transit.fromJSON(json.handlers)

  handlers.forEach(handler => docSet.registerHandler(handler))
  docs.keySeq().forEach(docId => docSet.setDoc(docId, docs.get(docId)))

  return docSet
}

module.exports = DocSet
