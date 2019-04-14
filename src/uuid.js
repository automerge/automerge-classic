const uuid = require('uuid/v4')

let factory = uuid

function makeUuid() {
  return factory()
}

makeUuid.setFactory = newFactory => factory = newFactory
makeUuid.reset = () => factory = uuid

module.exports = makeUuid
