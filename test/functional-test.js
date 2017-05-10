const assert = require('assert')
const {Store} = require('../src/functional')

describe('Functional Tesseract', () => {
  let s1, s2, s3
  beforeEach(() => {
    s1 = Store('s1')
    s2 = Store('s2')
    s3 = Store('s3')
  })

  describe('maps', () => {
    it('should allow property assignment', () => {
      s1 = s1.assign({foo: 'foo'})
      assert.equal(s1.root.foo, 'foo')
    })
  })
})
