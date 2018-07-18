const assert = require('assert')
const { RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, StringEncoder, StringDecoder } = require('../src/encoding')
const leb = require('leb')

describe('Binary encoding', () => {
  describe('RLEEncoder', () => {
    it('encodes no values as an empty byte string', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      encoder.flush()
      assert.strictEqual(encoder.offset, 0)
    })

    it('encodes a single value', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      encoder.writeValue(4)
      encoder.flush()
      assert.strictEqual(encoder.offset, 2)
      assert.deepEqual(encoder.buf.subarray(0, 2), [127, 4])
    })

    it('encodes a repeated value with a counter', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      for (let i = 0; i < 50; i++) encoder.writeValue(42)
      encoder.flush()
      assert.strictEqual(encoder.offset, 2)
      assert.deepEqual(encoder.buf.subarray(0, 2), [50, 42])
    })

    it('encodes non-repeated values with a prefix', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      for (let i = 0; i < 10; i++) encoder.writeValue(i)
      encoder.flush()
      assert.strictEqual(encoder.offset, 11)
      assert.deepEqual(encoder.buf.subarray(0, 11), [0x80 - 10, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    })

    it('allows mixing repeated and non-repeated values', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      encoder.writeValue(1)
      encoder.writeValue(2)
      encoder.writeValue(3); encoder.writeValue(3); encoder.writeValue(3)
      encoder.writeValue(4); encoder.writeValue(4)
      encoder.writeValue(5)
      encoder.writeValue(6)
      encoder.flush()
      assert.strictEqual(encoder.offset, 10)
      assert.deepEqual(encoder.buf.subarray(0, 10), [0x80 - 2, 1, 2, 3, 3, 2, 4, 0x80 - 2, 5, 6])
    })
  })

  describe('RLEDecoder', () => {
    it('decodes an empty byte string as no values', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      encoder.flush()
      const decoder = new RLEDecoder(leb.decodeInt32, encoder.buf, encoder.offset)
      assert.strictEqual(decoder.hasMore(), false)
    })

    it('decodes a single value', () => {
      const decoder = new RLEDecoder(leb.decodeInt32, new Uint8Array([127, 4]))
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 4)
      assert.strictEqual(decoder.hasMore(), false)
    })

    it('decodes a repeated value', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      for (let i = 0; i < 4; i++) encoder.writeValue(42)
      encoder.flush()
      const decoder = new RLEDecoder(leb.decodeInt32, encoder.buf, encoder.offset)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 42)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 42)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 42)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 42)
      assert.strictEqual(decoder.hasMore(), false)
    })

    it('decodes non-repeated values', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      for (let i = 0; i < 10; i++) encoder.writeValue(i)
      encoder.flush()
      const decoder = new RLEDecoder(leb.decodeInt32, encoder.buf, encoder.offset)
      for (let i = 0; i < 10; i++) {
        assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), i)
      }
      assert.strictEqual(decoder.hasMore(), false)
    })

    it('decodes a mixture of repeated and non-repeated values', () => {
      const decoder = new RLEDecoder(leb.decodeInt32, new Uint8Array([126, 1, 2, 3, 3, 2, 4, 126, 5, 6]))
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 1)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 2)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 3)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 3)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 3)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 4)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 4)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 5)
      assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 6)
      assert.strictEqual(decoder.hasMore(), false)
    })

    it('performs a round-trip with large values', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      for (let i = 0; i < 1000; i++) encoder.writeValue(123456789)
      encoder.flush()
      const decoder = new RLEDecoder(leb.decodeInt32, encoder.buf, encoder.offset)
      for (let i = 0; i < 1000; i++) {
        assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), 123456789)
      }
      assert.strictEqual(decoder.hasMore(), false)
    })

    it('performs a round-trip with lots of values', () => {
      const encoder = new RLEEncoder(leb.encodeInt32)
      for (let i = 0; i < 1000; i++) encoder.writeValue(i)
      encoder.flush()
      const decoder = new RLEDecoder(leb.decodeInt32, encoder.buf, encoder.offset)
      for (let i = 0; i < 1000; i++) {
        assert.strictEqual(decoder.hasMore(), true); assert.strictEqual(decoder.readValue(), i)
      }
      assert.strictEqual(decoder.hasMore(), false)
    })
  })

  describe('DeltaEncoder / DeltaDecoder', () => {
    it('encodes/decodes a sequence of no values', () => {
      const encoder = new DeltaEncoder()
      encoder.flush()
      assert.strictEqual(encoder.offset, 0)
      const decoder = new DeltaDecoder(encoder.buf, encoder.offset)
      assert.strictEqual(decoder.hasMore(), false)
    })

    it('encodes an incrementing sequence', () => {
      const encoder = new DeltaEncoder()
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 20; j++) encoder.writeValue(j)
      }
      encoder.flush()
      assert.strictEqual(encoder.offset, 12)
      assert.deepEqual(encoder.buf.subarray(0, 12), [
                       127, 0,         19, 1,
                       127, 0x80 - 19, 19, 1,
                       127, 0x80 - 19, 19, 1])
    })

    it('performs a round-trip on incrementing sequences', () => {
      const encoder = new DeltaEncoder()
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 1000; j++) encoder.writeValue(j)
      }
      encoder.flush()
      const decoder = new DeltaDecoder(encoder.buf, encoder.offset)
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 1000; j++) {
          assert.strictEqual(decoder.hasMore(), true)
          assert.strictEqual(decoder.readValue(), j)
        }
      }
      assert.strictEqual(decoder.hasMore(), false)
    })
  })

  describe('StringEncoder / StringDecoder', () => {
    it('encodes a sequence of no values', () => {
      const encoder = new StringEncoder()
      encoder.flush()
      assert.strictEqual(encoder.strings.offset, 0)
      assert.strictEqual(encoder.lengths.offset, 0)
      const decoder = new StringDecoder(encoder.strings.buf, encoder.strings.offset,
                                        encoder.lengths.buf, encoder.lengths.offset)
      assert.strictEqual(decoder.hasMore(), false)
    })

    it('encodes a sequence of characters', () => {
      const encoder = new StringEncoder()
      for (let str of ['H', 'e', 'l', 'l', 'o', ' ', '😄']) encoder.writeValue(str)
      encoder.flush()
      assert.strictEqual(encoder.strings.offset, 10)
      assert.deepEqual(encoder.strings.buf.subarray(0, 10),
                       [0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0xf0, 0x9f, 0x98, 0x84])
      assert.strictEqual(encoder.lengths.offset, 4)
      assert.deepEqual(encoder.lengths.buf.subarray(0, 4), [6, 1, 127, 4])
    })

    it('performs a round-trip on a sequence of characters', () => {
      const encoder = new StringEncoder()
      for (let str of ['H', 'e', 'l', 'l', 'o', ' ', '😄']) encoder.writeValue(str)
      encoder.flush()
      const decoder = new StringDecoder(encoder.strings.buf, encoder.strings.offset,
                                        encoder.lengths.buf, encoder.lengths.offset)
      for (let str of ['H', 'e', 'l', 'l', 'o', ' ', '😄']) {
        assert.strictEqual(decoder.hasMore(), true)
        assert.strictEqual(decoder.readValue(), str)
      }
      assert.strictEqual(decoder.hasMore(), false)
    })
  })
})
