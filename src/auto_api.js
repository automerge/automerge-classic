const { List, fromJS } = require('immutable')
const OpSet = require('./op_set')
const FreezeAPI = require('./freeze_api')
const ImmutableAPI = require('./immutable_api')

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

// TODO when we move to Immutable.js 4.0.0, this function is provided by Immutable.js itself
function isImmutable(obj) {
  return isObject(obj) && !!obj['@@__IMMUTABLE_ITERABLE__@@']
}

function checkTarget(funcName, target, needMutable) {
  if (!target || !target._state || !target._objectId ||
      !target._state.hasIn(['opSet', 'byObject', target._objectId])) {
    throw new TypeError('The first argument to Automerge.' + funcName +
                        ' must be the object to modify, but you passed ' + JSON.stringify(target))
  }
  if (needMutable && (!target._change || !target._change.mutable)) {
    throw new TypeError('Automerge.' + funcName + ' requires a writable object as first argument, ' +
                        'but the one you passed is read-only. Please use Automerge.change() ' +
                        'to get a writable version.')
  }
}

function makeChange(root, newState, message) {
  const actor = root._state.get('actorId')
  const seq = root._state.getIn(['opSet', 'clock', actor], 0) + 1
  const deps = root._state.getIn(['opSet', 'deps']).remove(actor)
  const change = fromJS({actor, seq, deps, message})
    .set('ops', newState.getIn(['opSet', 'local']))

  if (isImmutable(root)) {
    return ImmutableAPI.applyChanges(root, List.of(change), true)
  } else {
    return FreezeAPI.applyChanges(root, List.of(change), true)
  }
}

function applyChanges(doc, changes) {
  checkTarget('applyChanges', doc)
  if (isImmutable(doc)) {
    return ImmutableAPI.applyChanges(doc, fromJS(changes), true)
  } else {
    return FreezeAPI.applyChanges(doc, fromJS(changes), true)
  }
}

function merge(local, remote) {
  checkTarget('merge', local)
  if (local._state.get('actorId') === remote._state.get('actorId')) {
    throw new RangeError('Cannot merge an actor with itself')
  }

  const clock = local._state.getIn(['opSet', 'clock'])
  const changes = OpSet.getMissingChanges(remote._state.get('opSet'), clock)
  if (isImmutable(local)) {
    return ImmutableAPI.applyChanges(local, changes, true)
  } else {
    return FreezeAPI.applyChanges(local, changes, true)
  }
}

module.exports = {
  checkTarget, isObject, isImmutable,
  makeChange,
  applyChanges,
  merge,
}
