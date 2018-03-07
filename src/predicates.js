function isObject(obj) {
  return typeof obj === 'object' && obj !== null
}

function isImmutableJS(obj) {
  return isObject(obj) && !!obj['@@__IMMUTABLE_ITERABLE__@@']
}

module.exports = { isObject, isImmutableJS }
