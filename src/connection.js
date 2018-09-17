const { Map, fromJS } = require('immutable')
const { lessOrEqual } = require('./common')
const Frontend = require('../frontend')
const Backend = require('../backend')

// Updates the vector clock for `docId` in `clockMap` (mapping from docId to vector clock)
// by merging in the new vector clock `clock`. Returns the updated `clockMap`, in which each node's
// sequence number has been set to the maximum for that node.
function clockUnion(clockMap, docId, clock) {
  clock = clockMap.get(docId, Map()).mergeWith((x, y) => Math.max(x, y), clock)
  return clockMap.set(docId, clock)
}

// Keeps track of the communication with one particular peer. Allows updates for many documents to
// be multiplexed over a single connection.
//
// To integrate a connection with a particular networking stack, two functions are used:
// * `sendMsg` (callback passed to the constructor, will be called when local state is updated)
//   takes a message as argument, and sends it out to the remote peer.
// * `receiveMsg` (method on the connection object) should be called by the network stack when a
//   message is received from the remote peer.
//
// The documents to be synced are managed by a `DocSet`. Whenever a document is changed locally,
// call `setDoc()` on the docSet. The connection registers a callback on the docSet, and it figures
// out whenever there are changes that need to be sent to the remote peer.
//
// theirClock is the most recent VClock that we think the peer has (either because they've told us
// that it's their clock, or because it corresponds to a state we have sent to them on this
// connection). Thus, everything more recent than theirClock should be sent to the peer.
//
// ourClock is the most recent VClock that we've advertised to the peer (i.e. where we've
// told the peer that we have it).
class Connection {
  constructor (docSet, sendMsg) {
    this._docSet = docSet
    this._sendMsg = sendMsg
    this._theirClock = Map()
    this._ourClock = Map()
    this._docChangedHandler = this.docChanged.bind(this)
  }

  open () {
    for (let docId of this._docSet.docIds) this.docChanged(docId, this._docSet.getDoc(docId))
    this._docSet.registerHandler(this._docChangedHandler)
  }

  close () {
    this._docSet.unregisterHandler(this._docChangedHandler)
  }

  sendMsg (docId, clock, changes) {
    const msg = {docId, clock: clock.toJS()}
    this._ourClock = clockUnion(this._ourClock, docId, clock)
    if (changes) msg.changes = changes
    this._sendMsg(msg)
  }

  maybeSendChanges (docId) {
    const doc = this._docSet.getDoc(docId)
    const state = Frontend.getBackendState(doc)
    const clock = state.getIn(['opSet', 'clock'])

    if (this._theirClock.has(docId)) {
      const changes = Backend.getMissingChanges(state, this._theirClock.get(docId))
      if (changes.length > 0) {
        this._theirClock = clockUnion(this._theirClock, docId, clock)
        this.sendMsg(docId, clock, changes)
        return
      }
    }

    if (!clock.equals(this._ourClock.get(docId, Map()))) this.sendMsg(docId, clock)
  }

  // Callback that is called by the docSet whenever a document is changed
  docChanged (docId, doc) {
    const state = Frontend.getBackendState(doc)
    const clock = state.getIn(['opSet', 'clock'])
    if (!clock) {
      throw new TypeError('This object cannot be used for network sync. ' +
                          'Are you trying to sync a snapshot from the history?')
    }

    if (!lessOrEqual(this._ourClock.get(docId, Map()), clock)) {
      throw new RangeError('Cannot pass an old state object to a connection')
    }

    this.maybeSendChanges(docId)
  }

  receiveMsg (msg) {
    if (msg.clock) {
      this._theirClock = clockUnion(this._theirClock, msg.docId, fromJS(msg.clock))
    }
    if (msg.changes) {
      return this._docSet.applyChanges(msg.docId, fromJS(msg.changes))
    }

    if (this._docSet.getDoc(msg.docId)) {
      this.maybeSendChanges(msg.docId)
    } else if (!this._ourClock.has(msg.docId)) {
      // If the remote node has data that we don't, immediately ask for it.
      // TODO should we sometimes exercise restraint in what we ask for?
      this.sendMsg(msg.docId, Map())
    }

    return this._docSet.getDoc(msg.docId)
  }
}

module.exports = Connection
