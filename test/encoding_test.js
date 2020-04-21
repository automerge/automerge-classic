const assert = require('assert')
const { checkEncoded } = require('./helpers')
const { Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, BooleanEncoder, BooleanDecoder } = require('../backend/encoding')

describe('Binary encoding', () => {
  describe('Encoder and Decoder', () => {
    describe('32-bit LEB128 encoding', () => {
      it('should encode unsigned integers', () => {
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

      it('should round-trip unsigned integers', () => {
        const examples = [
          0, 1, 0x42, 0x7f, 0x80, 0xff, 0x1234, 0x3fff, 0x4000, 0x5678, 0xfffff, 0x1fffff,
          0x200000, 0xfffffff, 0x10000000, 0x7fffffff, 0x87654321, 0xffffffff
        ]
        for (let value of examples) {
          const encoder = new Encoder()
          encoder.appendUint32(value)
          const decoder = new Decoder(encoder.buffer)
          assert.strictEqual(decoder.readUint32(), value)
          assert.strictEqual(decoder.done, true)
        }
      })

      it('should encode signed integers', () => {
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

      it('should round-trip signed integers', () => {
        const examples = [
          0, 1, -1, 0x3f, 0x40, -0x3f, -0x40, -0x41, 0x1fff, 0x2000, -0x2000,
          -0x2001, 0xfffff, 0x100000, -0x100000, -0x100001, 0x7ffffff, 0x8000000,
          -0x8000000, -0x8000001, 0x76543210, -0x76543210, 0x7fffffff, -0x80000000
        ]
        for (let value of examples) {
          const encoder = new Encoder()
          encoder.appendInt32(value)
          const decoder = new Decoder(encoder.buffer)
          assert.strictEqual(decoder.readInt32(), value)
          assert.strictEqual(decoder.done, true)
        }
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

      it('should not decode values that are out of range', () => {
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x00])).readUint32() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x00])).readInt32() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x10])).readUint32() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x08])).readInt32() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x77])).readInt32() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80])).readUint32() }, /incomplete number/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80])).readInt32() }, /incomplete number/)
      })
    })

    describe('53-bit LEB128 encoding', () => {
      it('should encode unsigned integers', () => {
        function encode(value) {
          const encoder = new Encoder()
          encoder.appendUint53(value)
          return encoder
        }
        checkEncoded(encode(0), [0])
        checkEncoded(encode(0x7f), [0x7f])
        checkEncoded(encode(0x80), [0x80, 0x01])
        checkEncoded(encode(0x3fff), [0xff, 0x7f])
        checkEncoded(encode(0x4000), [0x80, 0x80, 0x01])
        checkEncoded(encode(0x1fffff), [0xff, 0xff, 0x7f])
        checkEncoded(encode(0x200000), [0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0xfffffff), [0xff, 0xff, 0xff, 0x7f])
        checkEncoded(encode(0x10000000), [0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x0f])
        checkEncoded(encode(0x100000000), [0x80, 0x80, 0x80, 0x80, 0x10])
        checkEncoded(encode(0x7ffffffff), [0xff, 0xff, 0xff, 0xff, 0x7f])
        checkEncoded(encode(0x800000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0x3ffffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])
        checkEncoded(encode(0x40000000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0x2000000000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0x123456789abcde), [0xde, 0xf9, 0xea, 0xc4, 0xe7, 0x8a, 0x8d, 0x09])
        checkEncoded(encode(Number.MAX_SAFE_INTEGER), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f])
      })

      it('should round-trip unsigned integers', () => {
        const examples = [
          0, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x200000, 0xfffffff, 0x10000000,
          0xffffffff, 0x100000000, 0x7ffffffff, 0x800000000, 0x3ffffffffff,
          0x40000000000, 0x2000000000000, 0x123456789abcde, Number.MAX_SAFE_INTEGER
        ]
        for (let value of examples) {
          const encoder = new Encoder()
          encoder.appendUint53(value)
          const decoder = new Decoder(encoder.buffer)
          assert.strictEqual(decoder.readUint53(), value)
          assert.strictEqual(decoder.done, true)
        }
      })

      it('should encode signed integers', () => {
        function encode(value) {
          const encoder = new Encoder()
          encoder.appendInt53(value)
          return encoder
        }
        checkEncoded(encode(0), [0])
        checkEncoded(encode(1), [1])
        checkEncoded(encode(-1), [0x7f])
        checkEncoded(encode(0x3f), [0x3f])
        checkEncoded(encode(-0x40), [0x40])
        checkEncoded(encode(0x40), [0xc0, 0x00])
        checkEncoded(encode(-0x41), [0xbf, 0x7f])
        checkEncoded(encode(0x1fff), [0xff, 0x3f])
        checkEncoded(encode(-0x2000), [0x80, 0x40])
        checkEncoded(encode(0x2000), [0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x2001), [0xff, 0xbf, 0x7f])
        checkEncoded(encode(0xfffff), [0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x100000), [0x80, 0x80, 0x40])
        checkEncoded(encode(0x100000), [0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x100001), [0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0x7ffffff), [0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x8000000), [0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0x8000000), [0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x8000001), [0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0x7fffffff), [0xff, 0xff, 0xff, 0xff, 0x07])
        checkEncoded(encode(0x80000000), [0x80, 0x80, 0x80, 0x80, 0x08])
        checkEncoded(encode(-0x80000000), [0x80, 0x80, 0x80, 0x80, 0x78])
        checkEncoded(encode(-0x80000001), [0xff, 0xff, 0xff, 0xff, 0x77])
        checkEncoded(encode(0x3ffffffff), [0xff, 0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x400000000), [0x80, 0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0x400000000), [0x80, 0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x400000001), [0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0x1ffffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x20000000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0x20000000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x20000000001), [0xff, 0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0xffffffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x1000000000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0x1000000000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x1000000000001), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0x123456789abcde), [0xde, 0xf9, 0xea, 0xc4, 0xe7, 0x8a, 0x8d, 0x09])
        checkEncoded(encode(Number.MAX_SAFE_INTEGER), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f])
        checkEncoded(encode(Number.MIN_SAFE_INTEGER), [0x81, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x70])
      })

      it('should round-trip signed integers', () => {
        const examples = [
          0, 1, -1, 0x3f, -0x40, 0x40, -0x41, 0x1fff, -0x2000, 0x2000, -0x2001, 0xfffff,
          -0x100000, 0x100000, -0x100001, 0x7ffffff, -0x8000000, 0x8000000, -0x8000001,
          0x7fffffff, 0x80000000, -0x80000000, -0x80000001, 0x3ffffffff, -0x400000000,
          0x400000000, -0x400000001, 0x1ffffffffff, -0x20000000000, 0x20000000000,
          -0x20000000001, 0xffffffffffff, -0x1000000000000, 0x1000000000000,
          -0x1000000000001, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER,
          0x123, -0x123, 0x1234, -0x1234, 0x12345, -0x12345, 0x123456, -0x123456,
          0x1234567, -0x1234567, 0x12345678, -0x12345678, 0x123456789, -0x123456789,
          0x123456789a, -0x123456789a, 0x123456789ab, -0x123456789ab, 0x123456789abc,
          -0x123456789abc, 0x123456789abcd, -0x123456789abcd, 0x123456789abcde,
          -0x123456789abcde
        ]
        for (let value of examples) {
          const encoder = new Encoder()
          encoder.appendInt53(value)
          const decoder = new Decoder(encoder.buffer)
          assert.strictEqual(decoder.readInt53(), value)
          assert.strictEqual(decoder.done, true)
        }
      })

      it('should not encode values that are out of range', () => {
        assert.throws(() => { new Encoder().appendUint53(Number.MAX_SAFE_INTEGER + 1) }, /out of range/)
        assert.throws(() => { new Encoder().appendUint53(-1) }, /out of range/)
        assert.throws(() => { new Encoder().appendUint53(-0x80000000) }, /out of range/)
        assert.throws(() => { new Encoder().appendUint53(Number.MIN_SAFE_INTEGER) }, /out of range/)
        assert.throws(() => { new Encoder().appendUint53(Number.NEGATIVE_INFINITY) }, /not an integer/)
        assert.throws(() => { new Encoder().appendUint53(Number.NaN) }, /not an integer/)
        assert.throws(() => { new Encoder().appendUint53(Math.PI) }, /not an integer/)
        assert.throws(() => { new Encoder().appendInt53(Number.MAX_SAFE_INTEGER + 1) }, /out of range/)
        assert.throws(() => { new Encoder().appendInt53(Number.MIN_SAFE_INTEGER - 1) }, /out of range/)
        assert.throws(() => { new Encoder().appendInt53(Number.NEGATIVE_INFINITY) }, /not an integer/)
        assert.throws(() => { new Encoder().appendInt53(Number.NaN) }, /not an integer/)
        assert.throws(() => { new Encoder().appendInt53(Math.PI) }, /not an integer/)
      })

      it('should not decode values that are out of range', () => {
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10])).readUint53() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10])).readInt53() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x70])).readInt53() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x6f])).readInt53() }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80])).readUint53() }, /incomplete number/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80])).readInt53() }, /incomplete number/)
      })
    })

    describe('64-bit LEB128 encoding', () => {
      it('should encode unsigned integers', () => {
        function encode(high32, low32) {
          const encoder = new Encoder()
          encoder.appendUint64(high32, low32)
          return encoder
        }
        checkEncoded(encode(0, 0), [0])
        checkEncoded(encode(0, 0x7f), [0x7f])
        checkEncoded(encode(0, 0x80), [0x80, 0x01])
        checkEncoded(encode(0, 0x3fff), [0xff, 0x7f])
        checkEncoded(encode(0, 0x4000), [0x80, 0x80, 0x01])
        checkEncoded(encode(0, 0x1fffff), [0xff, 0xff, 0x7f])
        checkEncoded(encode(0, 0x200000), [0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0, 0xfffffff), [0xff, 0xff, 0xff, 0x7f])
        checkEncoded(encode(0, 0x10000000), [0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x0f])
        checkEncoded(encode(0x1, 0x00000000), [0x80, 0x80, 0x80, 0x80, 0x10])
        checkEncoded(encode(0x7, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x7f])
        checkEncoded(encode(0x8, 0x00000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0x3ff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])
        checkEncoded(encode(0x400, 0x00000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0x1ffff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])
        checkEncoded(encode(0x20000, 0x00000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0xffffff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])
        checkEncoded(encode(0x1000000, 0x00000000), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x01])
        checkEncoded(encode(0xffffffff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01])
      })

      it('should round-trip unsigned integers', () => {
        const examples = [
          {high32: 0, low32: 0}, {high32: 0, low32: 0x7f}, {high32: 0, low32: 0x80},
          {high32: 0, low32: 0x3fff}, {high32: 0, low32: 0x4000}, {high32: 0, low32: 0x1fffff},
          {high32: 0, low32: 0x200000}, {high32: 0, low32: 0xfffffff},
          {high32: 0, low32: 0x10000000}, {high32: 0, low32: 0xffffffff},
          {high32: 0x1, low32: 0x00000000}, {high32: 0x7, low32: 0xffffffff},
          {high32: 0x8, low32: 0x00000000}, {high32: 0x3ff, low32: 0xffffffff},
          {high32: 0x400, low32: 0x00000000}, {high32: 0x1ffff, low32: 0xffffffff},
          {high32: 0x20000, low32: 0x00000000}, {high32: 0xffffff, low32: 0xffffffff},
          {high32: 0x1000000, low32: 0x00000000}, {high32: 0xffffffff, low32: 0xffffffff},
          {high32: 0, low32: 0x123}, {high32: 0, low32: 0x1234}, {high32: 0, low32: 0x12345},
          {high32: 0, low32: 0x123456}, {high32: 0, low32: 0x1234567},
          {high32: 0, low32: 0x12345678}, {high32: 0x9, low32: 0x12345678},
          {high32: 0x98, low32: 0x12345678}, {high32: 0x987, low32: 0x12345678},
          {high32: 0x9876, low32: 0x12345678}, {high32: 0x98765, low32: 0x12345678},
          {high32: 0x987654, low32: 0x12345678}, {high32: 0x9876543, low32: 0x12345678},
          {high32: 0x98765432, low32: 0x12345678}
        ]
        for (let value of examples) {
          const encoder = new Encoder()
          encoder.appendUint64(value.high32, value.low32)
          const decoder = new Decoder(encoder.buffer)
          assert.deepStrictEqual(decoder.readUint64(), value)
          assert.strictEqual(decoder.done, true)
        }
      })

      it('should encode signed integers', () => {
        function encode(high32, low32) {
          const encoder = new Encoder()
          encoder.appendInt64(high32, low32)
          return encoder
        }
        checkEncoded(encode(0, 0), [0])
        checkEncoded(encode(0, 1), [1])
        checkEncoded(encode(-1, -1), [0x7f])
        checkEncoded(encode(0, 0x3f), [0x3f])
        checkEncoded(encode(-1, -0x40), [0x40])
        checkEncoded(encode(0, 0x40), [0xc0, 0x00])
        checkEncoded(encode(-1, -0x41), [0xbf, 0x7f])
        checkEncoded(encode(0, 0x1fff), [0xff, 0x3f])
        checkEncoded(encode(-1, -0x2000), [0x80, 0x40])
        checkEncoded(encode(0, 0x2000), [0x80, 0xc0, 0x00])
        checkEncoded(encode(-1, -0x2001), [0xff, 0xbf, 0x7f])
        checkEncoded(encode(0, 0xfffff), [0xff, 0xff, 0x3f])
        checkEncoded(encode(-1, -0x100000), [0x80, 0x80, 0x40])
        checkEncoded(encode(0, 0x100000), [0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-1, -0x100001), [0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0, 0x7ffffff), [0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-1, -0x8000000), [0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0, 0x8000000), [0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-1, -0x8000001), [0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0, 0x7fffffff), [0xff, 0xff, 0xff, 0xff, 0x07])
        checkEncoded(encode(0, 0x80000000), [0x80, 0x80, 0x80, 0x80, 0x08])
        checkEncoded(encode(0, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x0f])
        checkEncoded(encode(-1, -0x80000000), [0x80, 0x80, 0x80, 0x80, 0x78])
        checkEncoded(encode(-1, 0x7fffffff), [0xff, 0xff, 0xff, 0xff, 0x77])
        checkEncoded(encode(-1, 1), [0x81, 0x80, 0x80, 0x80, 0x70])
        checkEncoded(encode(-1, 0), [0x80, 0x80, 0x80, 0x80, 0x70])
        checkEncoded(encode(-2, -1), [0xff, 0xff, 0xff, 0xff, 0x6f])
        checkEncoded(encode(3, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-4, 0), [0x80, 0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(4, 0), [0x80, 0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-5, -1), [0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0x1ff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x200, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0x200, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x201, -1), [0xff, 0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0xffff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x10000, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0x10000, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x10001, -1), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0x7fffff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x800000, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0x800000, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x800001, -1), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0x3fffffff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x3f])
        checkEncoded(encode(-0x40000000, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x40])
        checkEncoded(encode(0x40000000, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0xc0, 0x00])
        checkEncoded(encode(-0x40000001, -1), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xbf, 0x7f])
        checkEncoded(encode(0x7fffffff, 0xffffffff), [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00])
        checkEncoded(encode(-0x80000000, 0), [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x7f])
      })

      it('should round-trip signed integers', () => {
        const examples = [
          {high32: 0, low32: 0}, {high32: 0, low32: 1}, {high32: -1, low32: -1 >>> 0},
          {high32: 0, low32: 0x3f}, {high32: -1, low32: -0x40 >>> 0}, {high32: 0, low32: 0x40},
          {high32: -1, low32: -0x41 >>> 0}, {high32: 0, low32: 0x1fff}, {high32: -1, low32: -0x2000 >>> 0},
          {high32: 0, low32: 0x2000}, {high32: -1, low32: -0x2001 >>> 0},
          {high32: 0, low32: 0xfffff}, {high32: -1, low32: -0x100000 >>> 0},
          {high32: 0, low32: 0x100000}, {high32: -1, low32: -0x100001 >>> 0},
          {high32: 0, low32: 0x7ffffff}, {high32: -1, low32: -0x8000000 >>> 0},
          {high32: 0, low32: 0x8000000}, {high32: -1, low32: -0x8000001 >>> 0},
          {high32: 0, low32: 0x7fffffff}, {high32: 0, low32: 0x80000000},
          {high32: 0, low32: 0xffffffff}, {high32: -1, low32: -0x80000000 >>> 0},
          {high32: -1, low32: 0x7fffffff}, {high32: -1, low32: 1}, {high32: -1, low32: 0},
          {high32: -2, low32: -1 >>> 0}, {high32: 3, low32: 0xffffffff}, {high32: -4, low32: 0},
          {high32: 4, low32: 0}, {high32: -5, low32: -1 >>> 0}, {high32: 0x1ff, low32: 0xffffffff},
          {high32: -0x200, low32: 0}, {high32: 0x200, low32: 0}, {high32: -0x201, low32: -1 >>> 0},
          {high32: 0xffff, low32: 0xffffffff}, {high32: -0x10000, low32: 0},
          {high32: 0x10000, low32: 0}, {high32: -0x10001, low32: -1 >>> 0},
          {high32: 0x7fffff, low32: 0xffffffff}, {high32: -0x800000, low32: 0},
          {high32: 0x800000, low32: 0}, {high32: -0x800001, low32: -1 >>> 0},
          {high32: 0x3fffffff, low32: 0xffffffff}, {high32: -0x40000000, low32: 0},
          {high32: 0x40000000, low32: 0}, {high32: -0x40000001, low32: -1 >>> 0},
          {high32: 0x7fffffff, low32: 0xffffffff}, {high32: -0x80000000, low32: 0},
          {high32: 0, low32: 0x123}, {high32: -1, low32: -0x123 >>> 0},
          {high32: 0, low32: 0x1234}, {high32: -1, low32: -0x1234 >>> 0},
          {high32: 0, low32: 0x12345}, {high32: -1, low32: -0x12345 >>> 0},
          {high32: 0, low32: 0x123456}, {high32: -1, low32: -0x123456 >>> 0},
          {high32: 0, low32: 0x1234567}, {high32: -1, low32: -0x1234567 >>> 0},
          {high32: 0, low32: 0x12345678}, {high32: -1, low32: -0x12345678 >>> 0},
          {high32: 0x9, low32: 0x12345678}, {high32: -0x9, low32: -0x12345678 >>> 0},
          {high32: 0x98, low32: 0x12345678}, {high32: -0x98, low32: -0x12345678 >>> 0},
          {high32: 0x987, low32: 0x12345678}, {high32: -0x987, low32: -0x12345678 >>> 0},
          {high32: 0x9876, low32: 0x12345678}, {high32: -0x9876, low32: -0x12345678 >>> 0},
          {high32: 0x98765, low32: 0x12345678}, {high32: -0x98765, low32: -0x12345678 >>> 0},
          {high32: 0x987654, low32: 0x12345678}, {high32: -0x987654, low32: -0x12345678 >>> 0},
          {high32: 0x9876543, low32: 0x12345678}, {high32: -0x9876543, low32: -0x12345678 >>> 0},
          {high32: 0x78765432, low32: 0x12345678}, {high32: -0x78765432, low32: -0x12345678 >>> 0}
        ]
        for (let value of examples) {
          const encoder = new Encoder()
          encoder.appendInt64(value.high32, value.low32)
          const decoder = new Decoder(encoder.buffer)
          assert.deepStrictEqual(decoder.readInt64(), value)
          assert.strictEqual(decoder.done, true)
        }
      })

      it('should not encode values that are out of range', () => {
        assert.throws(() => { new Encoder().appendUint64(0, 0x100000000) }, /out of range/)
        assert.throws(() => { new Encoder().appendUint64(0x100000000, 0) }, /out of range/)
        assert.throws(() => { new Encoder().appendUint64(0, -1) }, /out of range/)
        assert.throws(() => { new Encoder().appendUint64(-1, 0) }, /out of range/)
        assert.throws(() => { new Encoder().appendUint64(123, Number.NaN) }, /not an integer/)
        assert.throws(() => { new Encoder().appendUint64(123, Math.PI) }, /not an integer/)
        assert.throws(() => { new Encoder().appendInt64(0, 0x100000000) }, /out of range/)
        assert.throws(() => { new Encoder().appendInt64(0x80000000, 0) }, /out of range/)
        assert.throws(() => { new Encoder().appendInt64(0, -0x80000001) }, /out of range/)
        assert.throws(() => { new Encoder().appendInt64(-0x80000001, 0) }, /out of range/)
        assert.throws(() => { new Encoder().appendInt64(123, Number.NaN) }, /not an integer/)
        assert.throws(() => { new Encoder().appendInt64(123, Math.PI) }, /not an integer/)
      })

      it('should not decode values that are out of range', () => {
        assert.throws(() => {
          new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00])).readUint64()
        }, /out of range/)
        assert.throws(() => {
          new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x00])).readInt64()
        }, /out of range/)
        assert.throws(() => {
          new Decoder(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x02])).readUint64()
        }, /out of range/)
        assert.throws(() => {
          new Decoder(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01])).readInt64()
        }, /out of range/)
        assert.throws(() => {
          new Decoder(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x7e])).readInt64()
        }, /out of range/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80])).readUint64() }, /incomplete number/)
        assert.throws(() => { new Decoder(new Uint8Array([0x80, 0x80])).readInt64() }, /incomplete number/)
      })
    })

    describe('UTF-8 encoding', () => {
      it('should encode strings', () => {
        checkEncoded(new Encoder().appendPrefixedString(''), [0])
        checkEncoded(new Encoder().appendPrefixedString('a'), [1, 0x61])
        checkEncoded(new Encoder().appendPrefixedString('Oh là là'), [10, 79, 104, 32, 108, 195, 160, 32, 108, 195, 160])
        checkEncoded(new Encoder().appendPrefixedString('😄'), [4, 0xf0, 0x9f, 0x98, 0x84])
      })

      it('should round-trip strings', () => {
        assert.strictEqual(new Decoder(new Encoder().appendPrefixedString('').buffer).readPrefixedString(), '')
        assert.strictEqual(new Decoder(new Encoder().appendPrefixedString('a').buffer).readPrefixedString(), 'a')
        assert.strictEqual(new Decoder(new Encoder().appendPrefixedString('Oh là là').buffer).readPrefixedString(), 'Oh là là')
        assert.strictEqual(new Decoder(new Encoder().appendPrefixedString('😄').buffer).readPrefixedString(), '😄')
      })

      it('should encode multiple strings', () => {
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

    describe('hex encoding', () => {
      it('should encode hex strings', () => {
        checkEncoded(new Encoder().appendHexString(''), [0])
        checkEncoded(new Encoder().appendHexString('00'), [1, 0])
        checkEncoded(new Encoder().appendHexString('0123'), [2, 1, 0x23])
        checkEncoded(new Encoder().appendHexString('fedcba9876543210'), [8, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10])
      })

      it('should round-trip strings', () => {
        assert.strictEqual(new Decoder(new Encoder().appendHexString('').buffer).readHexString(), '')
        assert.strictEqual(new Decoder(new Encoder().appendHexString('00').buffer).readHexString(), '00')
        assert.strictEqual(new Decoder(new Encoder().appendHexString('0123').buffer).readHexString(), '0123')
        assert.strictEqual(new Decoder(new Encoder().appendHexString('fedcba9876543210').buffer).readHexString(), 'fedcba9876543210')
      })

      it('should not allow malformed hex strings', () => {
        assert.throws(() => { new Encoder().appendHexString(0x1234) }, /value is not a string/)
        assert.throws(() => { new Encoder().appendHexString('abcd-ef') }, /value is not hexadecimal/)
        assert.throws(() => { new Encoder().appendHexString('0') }, /value is not hexadecimal/)
        assert.throws(() => { new Encoder().appendHexString('ABCD') }, /value is not hexadecimal/)
        assert.throws(() => { new Encoder().appendHexString('zz') }, /value is not hexadecimal/)
      })
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
      checkEncoded(encodeRLE('uint', []), [])
      checkEncoded(encodeRLE('uint', [1, 2, 3]), [0x7d, 1, 2, 3])
      checkEncoded(encodeRLE('uint', [0, 1, 2, 2, 3]), [0x7e, 0, 1, 2, 2, 0x7f, 3])
      checkEncoded(encodeRLE('uint', [1, 1, 1, 1, 1, 1]), [6, 1])
      checkEncoded(encodeRLE('uint', [1, 1, 1, 4, 4, 4]), [3, 1, 3, 4])
      checkEncoded(encodeRLE('uint', [0xff]), [0x7f, 0xff, 0x01])
      checkEncoded(encodeRLE('int', [-0x40]), [0x7f, 0x40])
    })

    it('should encode sequences containing nulls', () => {
      checkEncoded(encodeRLE('uint', [null]), [0, 1])
      checkEncoded(encodeRLE('uint', [null, 1]), [0, 1, 0x7f, 1])
      checkEncoded(encodeRLE('uint', [1, null]), [0x7f, 1, 0, 1])
      checkEncoded(encodeRLE('uint', [1, 1, 1, null]), [3, 1, 0, 1])
      checkEncoded(encodeRLE('uint', [null, null, null, 3, 4, 5, null]), [0, 3, 0x7d, 3, 4, 5, 0, 1])
      checkEncoded(encodeRLE('uint', [null, null, null, 9, 9, 9]), [0, 3, 3, 9])
      checkEncoded(encodeRLE('uint', [1, 1, 1, 1, 1, null, null, null, 1]), [5, 1, 0, 3, 0x7f, 1])
    })

    it('should round-trip sequences without nulls', () => {
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [])), [])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [1, 2, 3])), [1, 2, 3])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [0, 1, 2, 2, 3])), [0, 1, 2, 2, 3])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [1, 1, 1, 1, 1, 1])), [1, 1, 1, 1, 1, 1])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [1, 1, 1, 4, 4, 4])), [1, 1, 1, 4, 4, 4])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [0xff])), [0xff])
      assert.deepStrictEqual(decodeRLE('int', encodeRLE('int', [-0x40])), [-0x40])
    })

    it('should round-trip sequences containing nulls', () => {
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [null])), [null])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [null, 1])), [null, 1])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [1, null])), [1, null])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [1, 1, 1, null])), [1, 1, 1, null])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [null, null, null, 3, 4, 5, null])), [null, null, null, 3, 4, 5, null])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [null, null, null, 9, 9, 9])), [null, null, null, 9, 9, 9])
      assert.deepStrictEqual(decodeRLE('uint', encodeRLE('uint', [1, 1, 1, 1, 1, null, null, null, 1])), [1, 1, 1, 1, 1, null, null, null, 1])
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
