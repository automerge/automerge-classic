const ROOT_ID   = '00000000-0000-0000-0000-000000000000'

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

/**
 * Returns a shallow copy of the object `obj`. Faster than `Object.assign({}, obj)`.
 * https://jsperf.com/cloning-large-objects/1
 */
function copyObject(obj) {
  if (!isObject(obj)) return {}
  let copy = {}
  for (let key of Object.keys(obj)) {
    copy[key] = obj[key]
  }
  return copy
}

/**
 * Returns true if all components of `clock1` are less than or equal to those
 * of `clock2` (both clocks given as Immutable.js Map objects). Returns false
 * if there is at least one component in which `clock1` is greater than
 * `clock2` (that is, either `clock1` is overall greater than `clock2`, or the
 * clocks are incomparable).
 */
function lessOrEqual(clock1, clock2) {
  return clock1.keySeq().concat(clock2.keySeq()).reduce(
    (result, key) => (result && clock1.get(key, 0) <= clock2.get(key, 0)),
    true)
}

/**
 * Takes a string in the form that is used to identify operations (a counter concatenated
 * with an actor ID, separated by an `@` sign) and returns an object `{counter, actorId}`.
 */
function parseOpId(opId) {
  const match = /^(\d+)@(.*)$/.exec(opId || '')
  if (!match) {
    throw new RangeError(`Not a valid opId: ${opId}`)
  }
  return {counter: parseInt(match[1]), actorId: match[2]}
}

module.exports = {
  ROOT_ID, isObject, copyObject, lessOrEqual, parseOpId
}
