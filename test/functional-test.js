const assert = require('assert')
const tesseract = require('../src/functional')

describe('Functional Tesseract', () => {
  let s1, s2, s3
  beforeEach(() => {
    s1 = tesseract.init('s1')
    s2 = tesseract.init('s2')
    s3 = tesseract.init('s3')
  })

  describe('maps', () => {
    it('should allow property assignment', () => {
      s1 = tesseract.set(s1,'foo','bar')
      assert.equal(s1.foo, 'bar')
    })
  })
})
