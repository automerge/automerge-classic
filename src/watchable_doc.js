const { Map, Set, fromJS } = require('immutable')
const uuid = require('uuid/v4')
const FreezeAPI = require('./freeze_api')

class WatchableDoc {
  constructor (doc) {
    this.doc = doc
    this.handlers = Set()
  }

  get () {
    return this.doc
  }

  set (doc) {
    this.doc = doc
    this.handlers.forEach(handler => handler(doc))
  }

  applyChanges (changes) {
    let doc = this.doc || FreezeAPI.init(uuid())
    doc = FreezeAPI.applyChanges(doc, fromJS(changes), true)
    this.set(doc)
    return doc
  }

  registerHandler (handler) {
    this.handlers = this.handlers.add(handler)
  }

  unregisterHandler (handler) {
    this.handlers = this.handlers.remove(handler)
  }
}

module.exports = WatchableDoc
