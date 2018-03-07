const { List, Map, fromJS, is } = require('immutable')
const uuid = require('uuid/v4')

const { isObject, isImmutableJS } = require('./predicates')
const OpSet = require('./op_set')
const { Text } = require('./text')

function parseListIndex(key) {
  if (typeof key === 'string' && /^[0-9]+$/.test(key)) key = parseInt(key)
  if (typeof key !== 'number')
    throw new TypeError('A list index must be a number, but you passed ' + JSON.stringify(key))
  if (key < 0 || isNaN(key) || key === Infinity || key === -Infinity)
    throw new RangeError('A list index must be positive, but you passed ' + key)
  return key
}

function makeOp(state, opProps) {
  const opSet = state.get('opSet'), actor = state.get('actorId'), op = fromJS(opProps)
  let [opSet2, diff] = OpSet.addLocalOp(opSet, op, actor)
  return state.set('opSet', opSet2)
}

function insertAfter(state, listId, elemId) {
  if (!state.hasIn(['opSet', 'byObject', listId])) throw 'List object does not exist'
  if (!state.hasIn(['opSet', 'byObject', listId, elemId]) && elemId !== '_head') {
    throw 'Preceding list element does not exist'
  }
  const elem = state.getIn(['opSet', 'byObject', listId, '_maxElem'], 0) + 1
  state = makeOp(state, { action: 'ins', obj: listId, key: elemId, elem })
  return [state, state.get('actorId') + ':' + elem]
}

function createNestedObjects(state, value) {
  if (typeof value._objectId === 'string') return [state, value._objectId]
  const objectId = uuid()

  if (isImmutableJS(value)) {
    if (List.isList(value)) {
      state = makeOp(state, { action: 'makeList', obj: objectId })
      let elemId = '_head'
      for (let [i, v] of value.entries()) {
        [state, elemId] = insertAfter(state, objectId, elemId)
        state = setField(state, objectId, elemId, v)
      }
    } else if (Map.isMap(value)) {
      state = makeOp(state, { action: 'makeMap', obj: objectId })
      for (let [k, v] of value.entries()) {
        state = setField(state, objectId, k, v)
      }
    } else {
      throw new Error('unrecognized immutable value (and should be unreachable)')
    }
  } else {
    if (value instanceof Text) {
      state = makeOp(state, { action: 'makeText', obj: objectId })
      if (value.length > 0) throw 'assigning non-empty text is not yet supported'
    } else if (Array.isArray(value)) {
      state = makeOp(state, { action: 'makeList', obj: objectId })
      let elemId = '_head'
      for (let i = 0; i < value.length; i++) {
        [state, elemId] = insertAfter(state, objectId, elemId)
        state = setField(state, objectId, elemId, value[i])
      }
    } else {
      state = makeOp(state, { action: 'makeMap', obj: objectId })
      for (let key of Object.keys(value)) state = setField(state, objectId, key, value[key])
    }
  }
  return [state, objectId]
}

function setField(state, objectId, key, value) {
  if (typeof key !== 'string') {
    throw new TypeError('The key of a map entry must be a string, but ' +
                        JSON.stringify(key) + ' is a ' + (typeof key))
  }
  if (key === '') {
    throw new TypeError('The key of a map entry must not be an empty string')
  }
  if (key.startsWith('_')) {
    throw new TypeError('Map entries starting with underscore are not allowed: ' + key)
  }

  if (typeof value === 'undefined') {
    return deleteField(state, objectId, key)
  } else if (isObject(value)) {
    const [newState, newId] = createNestedObjects(state, value)
    return makeOp(newState, { action: 'link', obj: objectId, key, value: newId })
  } else {
    return makeOp(state, { action: 'set', obj: objectId, key, value })
  }
}

function splice(state, objectId, start, deletions, insertions) {
  let elemIds = state.getIn(['opSet', 'byObject', objectId, '_elemIds'])
  for (let i = 0; i < deletions; i++) {
    let elemId = elemIds.keyOf(start)
    if (elemId) {
      state = makeOp(state, {action: 'del', obj: objectId, key: elemId})
      elemIds = state.getIn(['opSet', 'byObject', objectId, '_elemIds'])
    }
  }

  // Apply insertions
  let prev = (start === 0) ? '_head' : elemIds.keyOf(start - 1)
  if (!prev && insertions.length > 0) {
    throw new RangeError('Cannot insert at index ' + start + ', which is past the end of the list')
  }
  for (let ins of insertions) {
    [state, prev] = insertAfter(state, objectId, prev)
    state = setField(state, objectId, prev, ins)
  }
  return state
}

function setListIndex(state, listId, index, value) {
  const elemIds = state.getIn(['opSet', 'byObject', listId, '_elemIds'])
  const elem = elemIds.keyOf(parseListIndex(index))
  if (elem) {
    return setField(state, listId, elem, value)
  } else {
    return splice(state, listId, index, 0, [value])
  }
}

function deleteField(state, objectId, key) {
  const objType = state.getIn(['opSet', 'byObject', objectId, '_init', 'action'])
  if (objType === 'makeList' || objType === 'makeText') {
    return splice(state, objectId, parseListIndex(key), 1, [])
  }
  if (!state.hasIn(['opSet', 'byObject', objectId, key])) {
    throw new RangeError('Field name does not exist: ' + key)
  }
  return makeOp(state, { action: 'del', obj: objectId, key: key })
}

module.exports = { setField, splice, setListIndex, deleteField }
