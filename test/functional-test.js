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
      s1 = tesseract.set(s1,'zip','zap')
      assert.equal(s1.foo, 'bar')
      assert.deepEqual(s1, {'foo':'bar', 'zip':'zap' })
    })
    it('should allow be able to merge', () => {
      s1 = tesseract.set(s1,'foo','bar')
      s2 = tesseract.set(s2,'hello','world')
      s3 = tesseract.merge(s1,s2)
      assert.deepEqual(s3, {'foo':'bar', 'hello':'world' })
    })
    it('should allow be able to have nested objects', () => {
      s1 = tesseract.set(s1,'foo',{"hello":"world"})
      assert.deepEqual(s1, {'foo':{'hello':'world' }})
      s2 = tesseract.set(s2,'aaa',{"bbb":"ccc"})
      assert.deepEqual(s2, {'aaa':{'bbb':'ccc'}})
      s3 = tesseract.merge(s3,s2)
      s3 = tesseract.merge(s3,s1)
      assert.deepEqual(s3, {'foo':{'hello':'world'}, 'aaa':{'bbb':'ccc'}})
      s3 = tesseract.set(s3.foo,'key','val')
      assert.deepEqual(s3, {'foo':{'key':'val','hello':'world'}, 'aaa':{'bbb':'ccc'}})
    })
  })
})
