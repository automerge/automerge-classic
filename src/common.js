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

/**
 * Returns true if the two byte arrays contain the same data, false if not.
 */
function equalBytes(array1, array2) {
  if (!(array1 instanceof Uint8Array) || !(array2 instanceof Uint8Array)) {
    throw new TypeError('equalBytes can only compare Uint8Arrays')
  }
  if (array1.byteLength !== array2.byteLength) return false
  for (let i = 0; i < array1.byteLength; i++) {
    if (array1[i] !== array2[i]) return false
  }
  return true
}

function appendEdit(existingEdits, nextEdit) {
  if (existingEdits.length === 0) {
    existingEdits.push(nextEdit)
    return
  }
  let lastEdit = existingEdits[existingEdits.length - 1]
  if (nextEdit.action === 'insert') {
    if (lastEdit.action === 'insert' && lastEdit.index === nextEdit.index - 1){
      if (lastEdit.value.type === 'value') {
        if (nextEdit.value.type === 'value') {
          lastEdit.values = [lastEdit.value.value, nextEdit.value.value]
          lastEdit.action = 'multi-insert'
          delete lastEdit.value
          return
        }
      }
    } else if (lastEdit.action === 'multi-insert') {
      if (lastEdit.index + lastEdit.values.length === nextEdit.index) {
        if (nextEdit.value.type === 'value') {
          lastEdit.values.push(nextEdit.value.value)
          return
        }
      }
    }
  }
  if (nextEdit.action === 'remove') {
    if (lastEdit.action === 'remove') {
      if (lastEdit.index === nextEdit.index) {
        lastEdit.count += nextEdit.count
        return
      }
    }
  }
  existingEdits.push(nextEdit)
}

module.exports = {
  isObject, copyObject, parseOpId, equalBytes, appendEdit
}
