const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

const uuid = Automerge.uuid

describe('uuid', () => {
  afterEach(() => {
    uuid.reset()
  })

  describe('default implementation', () => {
    it('generates unique values', () => {
      assert.notEqual(uuid(), uuid())
    })
  })

  describe('custom implementation', () => {
    let counter

    function customUuid() {
      return `custom-uuid-${counter++}`
    }

    before(() => uuid.setFactory(customUuid))
    beforeEach(() => counter = 0)

    it('invokes the custom factory', () => {
      assert.equal(uuid(), 'custom-uuid-0')
      assert.equal(uuid(), 'custom-uuid-1')
    })
  })
})
