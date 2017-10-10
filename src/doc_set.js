const { Map, Set } = require('immutable')
const transit = require('transit-immutable-js')
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
    const allHandlers = []

    this.handlers.forEach(handler => allHandlers.push(serialize(handler)))

    return {
      _type: 'DocSet',
      docs: transit.toJSON(this.docs),
      handlers: allHandlers
    }
  }
}

DocSet.fromJSON = (json) => {
  if (json._type != 'DocSet') return null

  const docSet = new DocSet()

  json.handlers.forEach(handler => docSet.registerHandler(eval('(' + handler + ')')))

  const docs = transit.fromJSON(json.docs)
  docs.keySeq().forEach(docId => docSet.setDoc(docId, docs.get(docId)))

  return docSet
}

module.exports = DocSet
