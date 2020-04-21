const uuid = require('uuid/v4')

function defaultFactory() {
  return uuid().replace(/-/g, '')
}

let factory = defaultFactory

function makeUuid() {
  return factory()
}

makeUuid.setFactory = newFactory => { factory = newFactory }
makeUuid.reset = () => { factory = defaultFactory }

module.exports = makeUuid
