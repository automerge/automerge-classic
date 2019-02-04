const ROOT_ID   = '00000000-0000-0000-0000-000000000000'

function isObject(obj) {
  return typeof obj === 'object' && obj !== null
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
 * Takes a string in the form that is used to identify list elements (an actor
 * ID concatenated with a counter, separated by a colon) and returns an object
 * of the structure `{counter, actorId}`.
 */
function parseElemId(elemId) {
  const match = /^(.*):(\d+)$/.exec(elemId || '')
  if (!match) {
    throw new RangeError(`Not a valid elemId: ${elemId}`)
  }
  return {counter: parseInt(match[2]), actorId: match[1]}
}

module.exports = {
  ROOT_ID, isObject, lessOrEqual, parseElemId
}
