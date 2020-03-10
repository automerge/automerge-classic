const assert = require('assert')
const { checkEncoded } = require('./helpers')
const { Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, BooleanEncoder, BooleanDecoder } = require('../backend/encoding')

describe('Binary encoding', () => {
  describe('Encoder and Decoder', () => {
    it('should LEB128-encode unsigned integers', () => {
      function encode(value) {
        const encoder = new Encoder()
        encoder.appendUint32(value)
        return encoder
      }
      checkEncoded(encode(0), [0])
      checkEncoded(encode(1), [1])
      checkEncoded(encode(0x42), [0x42])
      checkEncoded(encode(0x7f), [0x7f])
      checkEncoded(encode(0x80), [0x80, 0x01])
      checkEncoded(encode(0xff), [0xff, 0x01])
      checkEncoded(encode(0x1234), [0xb4, 0x24])
      checkEncoded(encode(0x3fff), [0xff, 0x7f])
      checkEncoded(encode(0x4000), [0x80, 0x80, 0x01])
      checkEncoded(encode(0x5678), [0xf8, 0xac, 0x01])
      checkEncoded(encode(0xfffff), [0xff, 0xff, 0x3f])
      checkEncoded(encode(0x1fffff), [0xff, 0xff, 0x7f])
      checkEncoded(encode(0x200000), [0x80, 0x80, 0x80, 0x01])
      checkEncoded(encode(0xfffffff), [0xff, 0xff, 0xff, 0x7f])
      checkEncoded(encode(0x10000000), [0x80, 0x80, 0x80, 0x80, 0x01])
      checkEncoded(encode(0x7fffffff), [0xff, 0xff, 0xff, 0xff, 0x07])
      checkEncoded(encode(0x87654321), [0xa1, 0x86, 0x95, 0xbb, 0x08])
      checkEncoded(encode(0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x0f])
    })

    it('should encode-decode round-trip unsigned integers', () => {
      function codec(value) {
        const encoder = new Encoder()
        encoder.appendUint32(value)
        return new Decoder(encoder.buffer).readUint32()
      }
      assert.strictEqual(codec(0), 0)
      assert.strictEqual(codec(1), 1)
      assert.strictEqual(codec(0x42), 0x42)
      assert.strictEqual(codec(0x7f), 0x7f)
      assert.strictEqual(codec(0x80), 0x80)
      assert.strictEqual(codec(0xff), 0xff)
      assert.strictEqual(codec(0x1234), 0x1234)
      assert.strictEqual(codec(0x3fff), 0x3fff)
      assert.strictEqual(codec(0x4000), 0x4000)
      assert.strictEqual(codec(0x5678), 0x5678)
      assert.strictEqual(codec(0xfffff), 0xfffff)
      assert.strictEqual(codec(0x1fffff), 0x1fffff)
      assert.strictEqual(codec(0x200000), 0x200000)
      assert.strictEqual(codec(0xfffffff), 0xfffffff)
      assert.strictEqual(codec(0x10000000), 0x10000000)
      assert.strictEqual(codec(0x7fffffff), 0x7fffffff)
      assert.strictEqual(codec(0x87654321), 0x87654321)
      assert.strictEqual(codec(0xffffffff), 0xffffffff)
    })

    it('should LEB128-encode signed integers', () => {
      function encode(value) {
        const encoder = new Encoder()
        encoder.appendInt32(value)
        return encoder
      }
      checkEncoded(encode(0), [0])
      checkEncoded(encode(1), [1])
      checkEncoded(encode(-1), [0x7f])
      checkEncoded(encode(0x3f), [0x3f])
      checkEncoded(encode(0x40), [0xc0, 0x00])
      checkEncoded(encode(-0x3f), [0x41])
      checkEncoded(encode(-0x40), [0x40])
      checkEncoded(encode(-0x41), [0xbf, 0x7f])
      checkEncoded(encode(0x1fff), [0xff, 0x3f])
      checkEncoded(encode(0x2000), [0x80, 0xc0, 0x00])
      checkEncoded(encode(-0x2000), [0x80, 0x40])
      checkEncoded(encode(-0x2001), [0xff, 0xbf, 0x7f])
      checkEncoded(encode(0xfffff), [0xff, 0xff, 0x3f])
      checkEncoded(encode(0x100000), [0x80, 0x80, 0xc0, 0x00])
      checkEncoded(encode(-0x100000), [0x80, 0x80, 0x40])
      checkEncoded(encode(-0x100001), [0xff, 0xff, 0xbf, 0x7f])
      checkEncoded(encode(0x7ffffff), [0xff, 0xff, 0xff, 0x3f])
      checkEncoded(encode(0x8000000), [0x80, 0x80, 0x80, 0xc0, 0x00])
      checkEncoded(encode(-0x8000000), [0x80, 0x80, 0x80, 0x40])
      checkEncoded(encode(-0x8000001), [0xff, 0xff, 0xff, 0xbf, 0x7f])
      checkEncoded(encode(0x76543210), [0x90, 0xe4, 0xd0, 0xb2, 0x07])
      checkEncoded(encode(-0x76543210), [0xf0, 0x9b, 0xaf, 0xcd, 0x78])
      checkEncoded(encode(0x7fffffff), [0xff, 0xff, 0xff, 0xff, 0x07])
      checkEncoded(encode(-0x80000000), [0x80, 0x80, 0x80, 0x80, 0x78])
    })

    it('should encode-decode round-trip signed integers', () => {
      function codec(value) {
        const encoder = new Encoder()
        encoder.appendInt32(value)
        return new Decoder(encoder.buffer).readInt32()
      }
      assert.strictEqual(codec(0), 0)
      assert.strictEqual(codec(1), 1)
      assert.strictEqual(codec(-1), -1)
      assert.strictEqual(codec(0x3f), 0x3f)
      assert.strictEqual(codec(0x40), 0x40)
      assert.strictEqual(codec(-0x3f), -0x3f)
      assert.strictEqual(codec(-0x40), -0x40)
      assert.strictEqual(codec(-0x41), -0x41)
      assert.strictEqual(codec(0x1fff), 0x1fff)
      assert.strictEqual(codec(0x2000), 0x2000)
      assert.strictEqual(codec(-0x2000), -0x2000)
      assert.strictEqual(codec(-0x2001), -0x2001)
      assert.strictEqual(codec(0xfffff), 0xfffff)
      assert.strictEqual(codec(0x100000), 0x100000)
      assert.strictEqual(codec(-0x100000), -0x100000)
      assert.strictEqual(codec(-0x100001), -0x100001)
      assert.strictEqual(codec(0x7ffffff), 0x7ffffff)
      assert.strictEqual(codec(0x8000000), 0x8000000)
      assert.strictEqual(codec(-0x8000000), -0x8000000)
      assert.strictEqual(codec(-0x8000001), -0x8000001)
      assert.strictEqual(codec(0x76543210), 0x76543210)
      assert.strictEqual(codec(-0x76543210), -0x76543210)
      assert.strictEqual(codec(0x7fffffff), 0x7fffffff)
      assert.strictEqual(codec(-0x80000000), -0x80000000)
    })

    it('should not encode number values that are out of range', () => {
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

    it('should not decode number values that are out of range', () => {
      assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x00])).readUint32() }, /out of range/)
      assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x00])).readInt32() }, /out of range/)
      assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x10])).readUint32() }, /out of range/)
      assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x08])).readInt32() }, /out of range/)
      assert.throws(() => { new Decoder(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x77])).readInt32() }, /out of range/)
      assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80])).readUint32() }, /incomplete number/)
      assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80])).readInt32() }, /incomplete number/)
    })

    it('should encode strings as UTF-8', () => {
      checkEncoded(new Encoder().appendPrefixedString(''), [0])
      checkEncoded(new Encoder().appendPrefixedString('a'), [1, 0x61])
      checkEncoded(new Encoder().appendPrefixedString('Oh là là'), [10, 79, 104, 32, 108, 195, 160, 32, 108, 195, 160])
      checkEncoded(new Encoder().appendPrefixedString('😄'), [4, 0xf0, 0x9f, 0x98, 0x84])
    })

    it('should encode-decode round-trip UTF-8 strings', () => {
      assert.strictEqual(new Decoder(new Encoder().appendPrefixedString('').buffer).readPrefixedString(), '')
      assert.strictEqual(new Decoder(new Encoder().appendPrefixedString('a').buffer).readPrefixedString(), 'a')
      assert.strictEqual(new Decoder(new Encoder().appendPrefixedString('Oh là là').buffer).readPrefixedString(), 'Oh là là')
      assert.strictEqual(new Decoder(new Encoder().appendPrefixedString('😄').buffer).readPrefixedString(), '😄')
    })

    it('should encode multiple UTF-8 strings', () => {
      const encoder = new Encoder()
      encoder.appendPrefixedString('one')
      encoder.appendPrefixedString('two')
      encoder.appendPrefixedString('three')
      const decoder = new Decoder(encoder.buffer)
      assert.strictEqual(decoder.readPrefixedString(), 'one')
      assert.strictEqual(decoder.readPrefixedString(), 'two')
      assert.strictEqual(decoder.readPrefixedString(), 'three')
    })
  })

  describe('RLEEncoder and RLEDecoder', () => {
    function encodeRLE(type, values) {
      const encoder = new RLEEncoder(type)
      for (let value of values) encoder.appendValue(value)
      return encoder.buffer
    }

    function decodeRLE(type, buffer) {
      const decoder = new RLEDecoder(type, buffer), values = []
      while (!decoder.done) values.push(decoder.readValue())
      return values
    }

    it('should encode sequences without nulls', () => {
      checkEncoded(encodeRLE('uint32', []), [])
      checkEncoded(encodeRLE('uint32', [1, 2, 3]), [0x7d, 1, 2, 3])
      checkEncoded(encodeRLE('uint32', [0, 1, 2, 2, 3]), [0x7e, 0, 1, 2, 2, 0x7f, 3])
      checkEncoded(encodeRLE('uint32', [1, 1, 1, 1, 1, 1]), [6, 1])
      checkEncoded(encodeRLE('uint32', [1, 1, 1, 4, 4, 4]), [3, 1, 3, 4])
      checkEncoded(encodeRLE('uint32', [0xff]), [0x7f, 0xff, 0x01])
      checkEncoded(encodeRLE('int32', [-0x40]), [0x7f, 0x40])
    })

    it('should encode sequences containing nulls', () => {
      checkEncoded(encodeRLE('uint32', [null]), [0, 1])
      checkEncoded(encodeRLE('uint32', [null, 1]), [0, 1, 0x7f, 1])
      checkEncoded(encodeRLE('uint32', [1, null]), [0x7f, 1, 0, 1])
      checkEncoded(encodeRLE('uint32', [1, 1, 1, null]), [3, 1, 0, 1])
      checkEncoded(encodeRLE('uint32', [null, null, null, 3, 4, 5, null]), [0, 3, 0x7d, 3, 4, 5, 0, 1])
      checkEncoded(encodeRLE('uint32', [null, null, null, 9, 9, 9]), [0, 3, 3, 9])
      checkEncoded(encodeRLE('uint32', [1, 1, 1, 1, 1, null, null, null, 1]), [5, 1, 0, 3, 0x7f, 1])
    })

    it('should round-trip sequences without nulls', () => {
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [])), [])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [1, 2, 3])), [1, 2, 3])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [0, 1, 2, 2, 3])), [0, 1, 2, 2, 3])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [1, 1, 1, 1, 1, 1])), [1, 1, 1, 1, 1, 1])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [1, 1, 1, 4, 4, 4])), [1, 1, 1, 4, 4, 4])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [0xff])), [0xff])
      assert.deepStrictEqual(decodeRLE('int32', encodeRLE('int32', [-0x40])), [-0x40])
    })

    it('should round-trip sequences containing nulls', () => {
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [null])), [null])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [null, 1])), [null, 1])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [1, null])), [1, null])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [1, 1, 1, null])), [1, 1, 1, null])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [null, null, null, 3, 4, 5, null])), [null, null, null, 3, 4, 5, null])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [null, null, null, 9, 9, 9])), [null, null, null, 9, 9, 9])
      assert.deepStrictEqual(decodeRLE('uint32', encodeRLE('uint32', [1, 1, 1, 1, 1, null, null, null, 1])), [1, 1, 1, 1, 1, null, null, null, 1])
    })

    it('should support encoding string values', () => {
      checkEncoded(encodeRLE('utf8', ['a']), [0x7f, 1, 0x61])
      checkEncoded(encodeRLE('utf8', ['a', 'b', 'c', 'd']), [0x7c, 1, 0x61, 1, 0x62, 1, 0x63, 1, 0x64])
      checkEncoded(encodeRLE('utf8', ['a', 'a', 'a', 'a']), [4, 1, 0x61])
      checkEncoded(encodeRLE('utf8', ['a', 'a', null, null, 'a', 'a']), [2, 1, 0x61, 0, 2, 2, 1, 0x61])
      checkEncoded(encodeRLE('utf8', [null, null, null, null, 'abc']), [0, 4, 0x7f, 3, 0x61, 0x62, 0x63])
    })

    it('should round-trip sequences of string values', () => {
      assert.deepStrictEqual(decodeRLE('utf8', encodeRLE('utf8', ['a'])), ['a'])
      assert.deepStrictEqual(decodeRLE('utf8', encodeRLE('utf8', ['a', 'b', 'c', 'd'])), ['a', 'b', 'c', 'd'])
      assert.deepStrictEqual(decodeRLE('utf8', encodeRLE('utf8', ['a', 'a', 'a', 'a'])), ['a', 'a', 'a', 'a'])
      assert.deepStrictEqual(decodeRLE('utf8', encodeRLE('utf8', ['a', 'a', null, null, 'a', 'a'])), ['a', 'a', null, null, 'a', 'a'])
      assert.deepStrictEqual(decodeRLE('utf8', encodeRLE('utf8', [null, null, null, null, 'abc'])), [null, null, null, null, 'abc'])
    })
  })

  describe('DeltaEncoder and DeltaDecoder', () => {
    function encodeDelta(values) {
      const encoder = new DeltaEncoder()
      for (let value of values) encoder.appendValue(value)
      return encoder.buffer
    }

    function decodeDelta(buffer) {
      const decoder = new DeltaDecoder(buffer), values = []
      while (!decoder.done) values.push(decoder.readValue())
      return values
    }

    it('should encode sequences', () => {
      checkEncoded(encodeDelta([]), [])
      checkEncoded(encodeDelta([null]), [0, 1])
      checkEncoded(encodeDelta([18, 2, 9, 15, 16, 19, 25]), [0x79, 18, 0x70, 7, 6, 1, 3, 6])
      checkEncoded(encodeDelta([1, 2, 3, 4, 5, 6, 7, 8]), [8, 1])
      checkEncoded(encodeDelta([10, 11, 12, 13, 14, 15]), [0x7f, 10, 5, 1])
      checkEncoded(encodeDelta([10, 11, 12, 13, 0, 1, 2, 3]), [0x7f, 10, 3, 1, 0x7f, 0x73, 3, 1])
      checkEncoded(encodeDelta([0, 1, 2, 3, null, null, null, 4, 5, 6]), [0x7f, 0, 3, 1, 0, 3, 3, 1])
      checkEncoded(encodeDelta([-64, -60, -56, -52, -48, -44, -40, -36]), [0x7f, 0x40, 7, 4])
    })

    it('should encode-decode round-trip sequences', () => {
      assert.deepStrictEqual(decodeDelta(encodeDelta([])), [])
      assert.deepStrictEqual(decodeDelta(encodeDelta([null])), [null])
      assert.deepStrictEqual(decodeDelta(encodeDelta([18, 2, 9, 15, 16, 19, 25])), [18, 2, 9, 15, 16, 19, 25])
      assert.deepStrictEqual(decodeDelta(encodeDelta([1, 2, 3, 4, 5, 6, 7, 8])), [1, 2, 3, 4, 5, 6, 7, 8])
      assert.deepStrictEqual(decodeDelta(encodeDelta([10, 11, 12, 13, 14, 15])), [10, 11, 12, 13, 14, 15])
      assert.deepStrictEqual(decodeDelta(encodeDelta([10, 11, 12, 13, 0, 1, 2, 3])), [10, 11, 12, 13, 0, 1, 2, 3])
      assert.deepStrictEqual(decodeDelta(encodeDelta([0, 1, 2, 3, null, null, null, 4, 5, 6])), [0, 1, 2, 3, null, null, null, 4, 5, 6])
      assert.deepStrictEqual(decodeDelta(encodeDelta([-64, -60, -56, -52, -48, -44, -40, -36])), [-64, -60, -56, -52, -48, -44, -40, -36])
    })
  })

  describe('BooleanEncoder and BooleanDecoder', () => {
    function encodeBools(values) {
      const encoder = new BooleanEncoder()
      for (let value of values) encoder.appendValue(value)
      return encoder.buffer
    }

    function decodeBools(buffer) {
      const decoder = new BooleanDecoder(buffer), values = []
      while (!decoder.done) values.push(decoder.readValue())
      return values
    }

    it('should encode sequences of booleans', () => {
      checkEncoded(encodeBools([]), [])
      checkEncoded(encodeBools([false]), [1])
      checkEncoded(encodeBools([true]), [0, 1])
      checkEncoded(encodeBools([false, false, false, true, true]), [3, 2])
      checkEncoded(encodeBools([true, true, true, false, false]), [0, 3, 2])
      checkEncoded(encodeBools([true, false, true, false, true, true, false]), [0, 1, 1, 1, 1, 2, 1])
    })

    it('should encode-decode round-trip booleans', () => {
      assert.deepStrictEqual(decodeBools(encodeBools([])), [])
      assert.deepStrictEqual(decodeBools(encodeBools([false])), [false])
      assert.deepStrictEqual(decodeBools(encodeBools([true])), [true])
      assert.deepStrictEqual(decodeBools(encodeBools([false, false, false, true, true])), [false, false, false, true, true])
      assert.deepStrictEqual(decodeBools(encodeBools([true, true, true, false, false])), [true, true, true, false, false])
      assert.deepStrictEqual(decodeBools(encodeBools([true, false, true, false, true, true, false])), [true, false, true, false, true, true, false])
    })

    it('should not allow non-boolean values', () => {
      assert.throws(() => { encodeBools([42]) }, /Unsupported value/)
      assert.throws(() => { encodeBools([null]) }, /Unsupported value/)
      assert.throws(() => { encodeBools(['false']) }, /Unsupported value/)
      assert.throws(() => { encodeBools([undefined]) }, /Unsupported value/)
    })
  })
})
