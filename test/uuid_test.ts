import * as assert from 'assert'
import uuid from 'uuid'

describe('uuid', () => {
  describe('default implementation', () => {
    it('generates unique values', () => {
      assert.notEqual(uuid(), uuid())
    })
  })
})
