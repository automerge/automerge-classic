const { Map, List, fromJS } = require('immutable')
const uuid = require('uuid/v4')
const { rootObjectProxy } = require('./proxies')
const { isObject } = require('./predicates')
const OpSet = require('./op_set')
const { setField, splice, setListIndex, deleteField } = require('./state')
const { checkTarget, makeChange, merge, applyChanges} = require('./auto_api')
const FreezeAPI = require('./freeze_api')
const ImmutableAPI = require('./immutable_api')
const { Text } = require('./text')
const transit = require('transit-immutable-js')

///// Automerge.* API

function init(actorId) {
  return FreezeAPI.init(actorId || uuid())
}

function initImmutable(actorId) {
  return ImmutableAPI.init(actorId || uuid())
}

function change(doc, message, callback) {
  if (typeof message === 'function' && callback === undefined) {
    [message, callback] = [callback, message]
  }

  if (ImmutableAPI.isReadObject(doc)) {
    // TODO: We could do more checks here, especially since it's close to the mutable path.
    const context = ImmutableAPI.ImmutableContext({
      state: doc._state,
    })
    const result = callback(ImmutableAPI.rootWriteMap(context))
    if (!ImmutableAPI.isWriteObject(result)) {
      throw new TypeError('you must return a document from the change block')
    }
    if (result._objectId !== '00000000-0000-0000-0000-000000000000') {
      throw new TypeError('you must return the new document root from the change block')
    }
    return makeChange(doc, result._context.state, message)
  } else {
    checkTarget('change', doc)
    if (doc._objectId !== '00000000-0000-0000-0000-000000000000') {
      throw new TypeError('The first argument to Automerge.change must be the document root')
    }
    if (doc._change && doc._change.mutable) {
      throw new TypeError('Calls to Automerge.change cannot be nested')
    }
    const context = {state: doc._state, mutable: true, setField, splice, setListIndex, deleteField}
    callback(rootObjectProxy(context))
    return makeChange(doc, context.state, message)
  }
}

function assign(target, values) {
  checkTarget('assign', target, true)
  if (!isObject(values)) throw new TypeError('The second argument to Automerge.assign must be an ' +
                                             'object, but you passed ' + JSON.stringify(values))
  let state = target._state
  for (let key of Object.keys(values)) {
    if (target._type === 'list') {
      state = setListIndex(state, target._objectId, key, values[key])
    } else {
      state = setField(state, target._objectId, key, values[key])
    }
  }
  target._change.state = state
}

function load(string, actorId) {
  return FreezeAPI.applyChanges(FreezeAPI.init(actorId || uuid()), transit.fromJSON(string), false)
}

function loadImmutable(string, actorId) {
  return ImmutableAPI.applyChanges(ImmutableAPI.init(actorId || uuid()), transit.fromJSON(string), false)
}

function save(doc) {
  checkTarget('save', doc)
  return transit.toJSON(doc._state.getIn(['opSet', 'history']))
}

function equals(val1, val2) {
  if (!isObject(val1) || !isObject(val2)) return val1 === val2
  const keys1 = Object.keys(val1).sort(), keys2 = Object.keys(val2).sort()
  if (keys1.length !== keys2.length) return false
  for (let i = 0; i < keys1.length; i++) {
    if (keys1[i] !== keys2[i]) return false
    if (!equals(val1[keys1[i]], val2[keys2[i]])) return false
  }
  return true
}

function inspect(doc) {
  checkTarget('inspect', doc)
  return JSON.parse(JSON.stringify(doc))
}

function getHistory(doc) {
  checkTarget('inspect', doc)
  const history = doc._state.getIn(['opSet', 'history'])
  return history.map((change, index) => {
    return {
      get change () {
        return change.toJS()
      },
      get snapshot () {
        const root = FreezeAPI.init(doc._state.get('actorId'))
        return FreezeAPI.applyChanges(root, history.slice(0, index + 1), false)
      }
    }
  }).toArray()
}

// Returns true if all components of clock1 are less than or equal to those of clock2.
// Returns false if there is at least one component in which clock1 is greater than clock2
// (that is, either clock1 is overall greater than clock2, or the clocks are incomparable).
function lessOrEqual(clock1, clock2) {
  return clock1.keySeq().concat(clock2.keySeq()).reduce(
    (result, key) => (result && clock1.get(key, 0) <= clock2.get(key, 0)),
    true)
}

function diff(oldState, newState) {
  checkTarget('diff', oldState)

  const oldClock = oldState._state.getIn(['opSet', 'clock'])
  const newClock = newState._state.getIn(['opSet', 'clock'])
  if (!lessOrEqual(oldClock, newClock)) {
    throw new RangeError('Cannot diff two states that have diverged')
  }

  let opSet = oldState._state.get('opSet').set('diff', List())
  const changes = OpSet.getMissingChanges(newState._state.get('opSet'), oldClock)

  let diffs = [], diff
  for (let change of changes) {
    [opSet, diff] = OpSet.addChange(opSet, change)
    diffs.push(...diff)
  }
  return diffs
}

function getConflicts(doc, list) {
  checkTarget('getConflicts', doc)
  const opSet = doc._state.get('opSet')
  const objectId = list._objectId
  if (!objectId || opSet.getIn(['byObject', objectId, '_init', 'action']) !== 'makeList') {
    throw new TypeError('The second argument to Automerge.getConflicts must be a list object')
  }

  const context = {
    cache: {},
    instantiateObject (opSet, objectId) {
      return opSet.getIn(['cache', objectId])
    }
  }
  return List(OpSet.listIterator(opSet, objectId, 'conflicts', context))
}

function getChanges(oldState, newState) {
  checkTarget('getChanges', oldState)

  const oldClock = oldState._state.getIn(['opSet', 'clock'])
  const newClock = newState._state.getIn(['opSet', 'clock'])
  if (!lessOrEqual(oldClock, newClock)) {
    throw new RangeError('Cannot diff two states that have diverged')
  }

  return OpSet.getMissingChanges(newState._state.get('opSet'), oldClock).toJS()
}

function getChangesForActor(state, actorId) {
  checkTarget('getChanges', state)

  // I might want to validate the actorId here

  return OpSet.getChangesForActor(state._state.get('opSet'), actorId).toJS()
}

function getMissingDeps(doc) {
  checkTarget('getMissingDeps', doc)
  return OpSet.getMissingDeps(doc._state.get('opSet'))
}

module.exports = {
  init, change, merge, diff, assign, load, save, equals, inspect, getHistory,
  initImmutable, loadImmutable, getConflicts,
  getChanges, getChangesForActor, applyChanges, getMissingDeps, Text,
  DocSet: require('./doc_set'),
  WatchableDoc: require('./watchable_doc'),
  Connection: require('./connection')
}
