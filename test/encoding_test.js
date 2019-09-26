const assert = require('assert')
const { Encoder } = require('../backend/encoding')

function checkEncoded(encoder, bytes) {
  const encoded = encoder.buffer, expected = new Uint8Array(bytes)
  const message = `${encoded} equals ${expected}`
  assert(encoded.byteLength === expected.byteLength, message)
  for (let i = 0; i < encoded.byteLength; i++) {
    assert(encoded[i] === expected[i], message)
  }
}

describe('Binary encoding', () => {
  describe('Encoder', () => {
    it('should LEB128-encode unsigned integers', () => {
      checkEncoded(new Encoder().appendUint32(0), [0])
      checkEncoded(new Encoder().appendUint32(1), [1])
      checkEncoded(new Encoder().appendUint32(0x42), [0x42])
      checkEncoded(new Encoder().appendUint32(0x7f), [0x7f])
      checkEncoded(new Encoder().appendUint32(0x80), [0x80, 0x01])
      checkEncoded(new Encoder().appendUint32(0xff), [0xff, 0x01])
      checkEncoded(new Encoder().appendUint32(0x1234), [0xb4, 0x24])
      checkEncoded(new Encoder().appendUint32(0x3fff), [0xff, 0x7f])
      checkEncoded(new Encoder().appendUint32(0x4000), [0x80, 0x80, 0x01])
      checkEncoded(new Encoder().appendUint32(0x5678), [0xf8, 0xac, 0x01])
      checkEncoded(new Encoder().appendUint32(0xfffff), [0xff, 0xff, 0x3f])
      checkEncoded(new Encoder().appendUint32(0x1fffff), [0xff, 0xff, 0x7f])
      checkEncoded(new Encoder().appendUint32(0x200000), [0x80, 0x80, 0x80, 0x01])
      checkEncoded(new Encoder().appendUint32(0xfffffff), [0xff, 0xff, 0xff, 0x7f])
      checkEncoded(new Encoder().appendUint32(0x10000000), [0x80, 0x80, 0x80, 0x80, 0x01])
      checkEncoded(new Encoder().appendUint32(0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x0f])
    })

    it('should LEB128-encode signed integers', () => {
      checkEncoded(new Encoder().appendInt32(0), [0])
      checkEncoded(new Encoder().appendInt32(1), [1])
      checkEncoded(new Encoder().appendInt32(-1), [0x7f])
      checkEncoded(new Encoder().appendInt32(0x3f), [0x3f])
      checkEncoded(new Encoder().appendInt32(0x40), [0xc0, 0x00])
      checkEncoded(new Encoder().appendInt32(-0x3f), [0x41])
      checkEncoded(new Encoder().appendInt32(-0x40), [0x40])
      checkEncoded(new Encoder().appendInt32(-0x41), [0xbf, 0x7f])
      checkEncoded(new Encoder().appendInt32(0x1fff), [0xff, 0x3f])
      checkEncoded(new Encoder().appendInt32(0x2000), [0x80, 0xc0, 0x00])
      checkEncoded(new Encoder().appendInt32(-0x2000), [0x80, 0x40])
      checkEncoded(new Encoder().appendInt32(-0x2001), [0xff, 0xbf, 0x7f])
      checkEncoded(new Encoder().appendInt32(0xfffff), [0xff, 0xff, 0x3f])
      checkEncoded(new Encoder().appendInt32(0x100000), [0x80, 0x80, 0xc0, 0x00])
      checkEncoded(new Encoder().appendInt32(-0x100000), [0x80, 0x80, 0x40])
      checkEncoded(new Encoder().appendInt32(-0x100001), [0xff, 0xff, 0xbf, 0x7f])
      checkEncoded(new Encoder().appendInt32(0x7ffffff), [0xff, 0xff, 0xff, 0x3f])
      checkEncoded(new Encoder().appendInt32(0x8000000), [0x80, 0x80, 0x80, 0xc0, 0x00])
      checkEncoded(new Encoder().appendInt32(-0x8000000), [0x80, 0x80, 0x80, 0x40])
      checkEncoded(new Encoder().appendInt32(-0x8000001), [0xff, 0xff, 0xff, 0xbf, 0x7f])
      checkEncoded(new Encoder().appendInt32(0x7fffffff), [0xff, 0xff, 0xff, 0xff, 0x07])
      checkEncoded(new Encoder().appendInt32(-0x80000000), [0x80, 0x80, 0x80, 0x80, 0x78])
    })

    it('should not encode values that are out of range', () => {
      assert.throws(() => { new Encoder().appendUint32(0x100000000) }, /out of range/)
      assert.throws(() => { new Encoder().appendUint32(Number.MAX_SAFE_INTEGER) }, /out of range/)
      assert.throws(() => { new Encoder().appendUint32(-1) }, /out of range/)
      assert.throws(() => { new Encoder().appendUint32(-0x80000000) }, /out of range/)
      assert.throws(() => { new Encoder().appendUint32(Number.NEGATIVE_INFINITY) }, /not an integer/)
      assert.throws(() => { new Encoder().appendUint32(Number.NaN) }, /not an integer/)
      assert.throws(() => { new Encoder().appendUint32(Math.PI) }, /not an integer/)
      assert.throws(() => { new Encoder().appendInt32(0x80000000) }, /out of range/)
      assert.throws(() => { new Encoder().appendInt32(Number.MAX_SAFE_INTEGER) }, /out of range/)
      assert.throws(() => { new Encoder().appendInt32(-0x80000001) }, /out of range/)
      assert.throws(() => { new Encoder().appendInt32(Number.NEGATIVE_INFINITY) }, /not an integer/)
      assert.throws(() => { new Encoder().appendInt32(Number.NaN) }, /not an integer/)
      assert.throws(() => { new Encoder().appendInt32(Math.PI) }, /not an integer/)
    })

    it('should encode strings as UTF-8', () => {
      checkEncoded(new Encoder().appendPrefixedString(''), [0])
      checkEncoded(new Encoder().appendPrefixedString('a'), [1, 0x61])
      checkEncoded(new Encoder().appendPrefixedString('Oh là là'), [10, 79, 104, 32, 108, 195, 160, 32, 108, 195, 160])
      checkEncoded(new Encoder().appendPrefixedString('😄'), [4, 0xf0, 0x9f, 0x98, 0x84])
    })
  })
})
