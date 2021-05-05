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
      if (Array.isArray(buffer)) buffer = new Uint8Array(buffer)
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

    it('should allow repetition counts to be specified', () => {
      let e
      e = new RLEEncoder('uint'); e.appendValue(3, 0); checkEncoded(e, [])
      e = new RLEEncoder('uint'); e.appendValue(3, 10); checkEncoded(e, [10, 3])
      e = new RLEEncoder('uint'); e.appendValue(3, 10); e.appendValue(3, 10); checkEncoded(e, [20, 3])
      e = new RLEEncoder('uint'); e.appendValue(3, 10); e.appendValue(4, 10); checkEncoded(e, [10, 3, 10, 4])
      e = new RLEEncoder('uint'); e.appendValue(3, 10); e.appendValue(null, 10); checkEncoded(e, [10, 3, 0, 10])
      e = new RLEEncoder('uint'); e.appendValue(1); e.appendValue(1, 2); checkEncoded(e, [3, 1])
      e = new RLEEncoder('uint'); e.appendValue(1); e.appendValue(2, 3); checkEncoded(e, [0x7f, 1, 3, 2])
      e = new RLEEncoder('uint'); e.appendValue(1); e.appendValue(2); e.appendValue(3, 3); checkEncoded(e, [0x7e, 1, 2, 3, 3])
      e = new RLEEncoder('uint'); e.appendValue(null); e.appendValue(3, 3); checkEncoded(e, [0, 1, 3, 3])
      e = new RLEEncoder('uint'); e.appendValue(null); e.appendValue(null, 3); e.appendValue(1); checkEncoded(e, [0, 4, 0x7f, 1])
    })

    it('should return an empty buffer if the values are only nulls', () => {
      assert.strictEqual(encodeRLE('uint', []).byteLength, 0)
      assert.strictEqual(encodeRLE('uint', [null]).byteLength, 0)
      assert.strictEqual(encodeRLE('uint', [null, null, null, null]).byteLength, 0)
    })

    it('should strictly enforce canonical encoded form', () => {
      assert.throws(() => { decodeRLE('int', [1, 1]) }, /Repetition count of 1 is not allowed/)
      assert.throws(() => { decodeRLE('int', [2, 1, 2, 1]) }, /Successive repetitions with the same value/)
      assert.throws(() => { decodeRLE('int', [0, 1, 0, 2]) }, /Successive null runs are not allowed/)
      assert.throws(() => { decodeRLE('int', [0, 0]) }, /Zero-length null runs are not allowed/)
      assert.throws(() => { decodeRLE('int', [0x7f, 1, 0x7f, 2]) }, /Successive literals are not allowed/)
      assert.throws(() => { decodeRLE('int', [0x7d, 1, 2, 2]) }, /Repetition of values is not allowed/)
      assert.throws(() => { decodeRLE('int', [2, 0, 0x7e, 0, 1]) }, /Repetition of values is not allowed/)
      assert.throws(() => { decodeRLE('int', [0x7e, 1, 2, 2, 2]) }, /Successive repetitions with the same value/)
    })

    it('should allow skipping string values', () => {
      const example = [null, null, null, 'a', 'a', 'a', 'b', 'c', 'd', 'e']
      const encoded = encodeRLE('utf8', example)
      for (let skipNum = 0; skipNum < example.length; skipNum++) {
        const decoder = new RLEDecoder('utf8', encoded), values = []
        decoder.skipValues(skipNum)
        while (!decoder.done) values.push(decoder.readValue())
        assert.deepStrictEqual(values, example.slice(skipNum), `skipping ${skipNum} values failed`)
      }
    })

    it('should allow skipping integer values', () => {
      const example = [null, null, null, 1, 1, 1, 2, 3, 4, 5]
      const encoded = encodeRLE('uint', example)
      for (let skipNum = 0; skipNum < example.length; skipNum++) {
        const decoder = new RLEDecoder('uint', encoded), values = []
        decoder.skipValues(skipNum)
        while (!decoder.done) values.push(decoder.readValue())
        assert.deepStrictEqual(values, example.slice(skipNum), `skipping ${skipNum} values failed`)
      }
    })

    describe('copying from a decoder', () => {
      function doCopy(input1, input2, options = {}) {
        let encoder1 = input1
        if (Array.isArray(input1)) {
          encoder1 = new RLEEncoder('uint')
          for (let value of input1) encoder1.appendValue(value)
        }

        const encoder2 = new RLEEncoder('uint')
        for (let value of input2) encoder2.appendValue(value)
        const decoder2 = new RLEDecoder('uint', encoder2.buffer)
        if (options.skip) decoder2.skipValues(options.skip)
        encoder1.copyFrom(decoder2, options)
        return encoder1
      }

      it('should copy a sequence', () => {
        checkEncoded(doCopy([], [0, 1, 2]), [0x7d, 0, 1, 2])
        checkEncoded(doCopy([0, 1, 2], []), [0x7d, 0, 1, 2])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 5, 6]), [0x79, 0, 1, 2, 3, 4, 5, 6])
        checkEncoded(doCopy([0, 1], [2, 3, 4, 4, 4]), [0x7c, 0, 1, 2, 3, 3, 4])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 4, 4]), [0x7c, 0, 1, 2, 3, 3, 4])
        checkEncoded(doCopy([0, 1, 2], [3, 3, 3, 4, 4, 4]), [0x7d, 0, 1, 2, 3, 3, 3, 4])
        checkEncoded(doCopy([0, 1, 2], [null, null, 4, 4, 4]), [0x7d, 0, 1, 2, 0, 2, 3, 4])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 4, null, null]), [0x7c, 0, 1, 2, 3, 2, 4, 0, 2])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 4, 5, 6, 6]), [0x7c, 0, 1, 2, 3, 2, 4, 0x7f, 5, 2, 6])
        checkEncoded(doCopy([0, 1, 2], [2, 2, 3, 3, 4, 5, 6]), [0x7e, 0, 1, 3, 2, 2, 3, 0x7d, 4, 5, 6])
        checkEncoded(doCopy([0, 0, 0], [0, 0, 0]), [6, 0])
        checkEncoded(doCopy([0, 0, 0], [0, 1, 1]), [4, 0, 2, 1])
        checkEncoded(doCopy([0, 0, 0], [1, 2, 2]), [3, 0, 0x7f, 1, 2, 2])
        checkEncoded(doCopy([0, 0, 0], [1, 2, 3]), [3, 0, 0x7d, 1, 2, 3])
        checkEncoded(doCopy([0, 0, 0], [null, null, 2, 2]), [3, 0, 0, 2, 2, 2])
        checkEncoded(doCopy([0, 0, 0], [null, 0, 0, 0]), [3, 0, 0, 1, 3, 0])
        checkEncoded(doCopy([0, 0, null], [null, 0, 0]), [2, 0, 0, 2, 2, 0])
        checkEncoded(doCopy([0, 0, null], [0, 0, 0]), [2, 0, 0, 1, 3, 0])
        checkEncoded(doCopy([0, 0, null], [1, 2, 3]), [2, 0, 0, 1, 0x7d, 1, 2, 3])
      })

      it('should copy multiple sequences', () => {
        checkEncoded(doCopy(doCopy([0, 0, 1], [1, 2]), [2, 3]), [2, 0, 2, 1, 2, 2, 0x7f, 3])
        checkEncoded(doCopy(doCopy([0], [0, 0, 1, 1, 2]), [2, 3, 3, 4]), [3, 0, 2, 1, 2, 2, 2, 3, 0x7f, 4])
        checkEncoded(doCopy(doCopy([0, 1, 2], [3, 4]), [5, 6]), [0x79, 0, 1, 2, 3, 4, 5, 6])
        checkEncoded(doCopy(doCopy([0, 0, 0], [0, 0, 1, 1]), [1, 1]), [5, 0, 4, 1])
        checkEncoded(doCopy(doCopy([0, null], [null, 1, null]), [null, 2]), [0x7f, 0, 0, 2, 0x7f, 1, 0, 2, 0x7f, 2])
      })

      it('should copy a sub-sequence', () => {
        checkEncoded(doCopy([0, 1, 2], [3, 4, 5, 6], {skip: 0, count: 0}), [0x7d, 0, 1, 2])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 5, 6], {skip: 0, count: 1}), [0x7c, 0, 1, 2, 3])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 5, 6], {skip: 0, count: 2}), [0x7b, 0, 1, 2, 3, 4])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 5, 6], {skip: 0, count: 4}), [0x79, 0, 1, 2, 3, 4, 5, 6])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 5, 6], {skip: 1, count: 1}), [0x7c, 0, 1, 2, 4])
        checkEncoded(doCopy([0, 1, 2], [3, 4, 5, 6], {skip: 1, count: 2}), [0x7b, 0, 1, 2, 4, 5])
        checkEncoded(doCopy([0, 1, 2], [3, 3, 3, 3], {skip: 0, count: 2}), [0x7d, 0, 1, 2, 2, 3])
        checkEncoded(doCopy([0, 0, 0], [0, 0, 0, 0], {skip: 0, count: 2}), [5, 0])
        checkEncoded(doCopy([0, 0], [0, 0, 1, 1, 1], {skip: 0, count: 4}), [4, 0, 2, 1])
        checkEncoded(doCopy([0, 0], [0, 0, 1, 1, 2, 2], {skip: 1, count: 4}), [3, 0, 2, 1, 0x7f, 2])
        checkEncoded(doCopy([0, 0], [1, 1, 2, 3, 4, 5], {skip: 0, count: 3}), [2, 0, 2, 1, 0x7f, 2])
        checkEncoded(doCopy([null], [null, 1, 1, null], {skip: 0, count: 2}), [0, 2, 0x7f, 1])
        checkEncoded(doCopy([null], [null, 1, 1, null], {skip: 1, count: 3}), [0, 1, 2, 1, 0, 1])
        checkEncoded(doCopy([], [null, null, null, 0, 0], {skip: 0, count: 5}), [0, 3, 2, 0])
      })

      it('should allow insertion into a sequence', () => {
        const decoder1 = new RLEDecoder('uint', encodeRLE('uint', [0, 1, 2, 3, 4, 5, 6]))
        const decoder2 = new RLEDecoder('uint', encodeRLE('uint', [3, 3, 3]))
        const encoder = new RLEEncoder('uint')
        encoder.copyFrom(decoder1, {count: 4})
        encoder.copyFrom(decoder2)
        encoder.copyFrom(decoder1)
        checkEncoded(encoder, [0x7d, 0, 1, 2, 4, 3, 0x7d, 4, 5, 6])
      })

      it('should allow insertion into repetition run', () => {
        const decoder1 = new RLEDecoder('uint', encodeRLE('uint', [1, 2, 3, 3, 4]))
        const decoder2 = new RLEDecoder('uint', encodeRLE('uint', [5]))
        const encoder = new RLEEncoder('uint')
        encoder.copyFrom(decoder1, {count: 3})
        encoder.copyFrom(decoder2)
        encoder.copyFrom(decoder1)
        checkEncoded(encoder, [0x7a, 1, 2, 3, 5, 3, 4])
      })

      it('should allow copying from a decoder starting with nulls', () => {
        const decoder = new RLEDecoder('uint', new Uint8Array([0, 2, 0x7f, 0])) // null, null, 0
        new RLEEncoder('uint').copyFrom(decoder, {count: 1})
        assert.strictEqual(decoder.readValue(), null)
        assert.strictEqual(decoder.readValue(), 0)
        decoder.reset()
        new RLEEncoder('uint').copyFrom(decoder, {count: 2})
        assert.strictEqual(decoder.readValue(), 0)
      })

      it('should compute the sum of values copied', () => {
        const encoder1 = new RLEEncoder('uint'), encoder2 = new RLEEncoder('uint')
        for (let v of [1, 2, 3, 10, 10, 10]) encoder2.appendValue(v)
        assert.deepStrictEqual(
          encoder1.copyFrom(new RLEDecoder('uint', encoder2.buffer), {sumValues: true}),
          {nonNullValues: 6, sum: 36})
        assert.deepStrictEqual(
          encoder1.copyFrom(new RLEDecoder('uint', encoder2.buffer), {sumValues: true, sumShift: 2}),
          {nonNullValues: 6, sum: 6})
      })

      it('should throw an exception if the decoder has too few values', () => {
        assert.throws(() => { doCopy([0, 1, 2], [], {count: 1}) }, /cannot copy 1 values/)
        assert.throws(() => { doCopy([0, 1, 2], [3], {count: 2}) }, /cannot copy 2 values/)
        assert.throws(() => { doCopy([0, 1, 2], [3, 4, 5, 6], {count: 5}) }, /cannot copy 5 values/)
        assert.throws(() => { doCopy([0, 1, 2], [3], {count: 2}) }, /cannot copy 2 values/)
        assert.throws(() => { doCopy([0, 1, 2], [3, 3, 3], {count: 4}) }, /cannot copy 4 values/)
        assert.throws(() => { doCopy([0, 1, 2], [3, 3, 4, 4, 5, 5], {count: 7}) }, /cannot copy 7 values/)
        assert.throws(() => { new RLEEncoder('uint').copyFrom(new RLEDecoder('uint', new Uint8Array([0x7e, 1]))) }, /incomplete literal/)
        assert.throws(() => { new RLEEncoder('uint').copyFrom(new RLEDecoder('uint', new Uint8Array([2, 1, 0x7f, 1]))) }, /Repetition of values/)
      })

      it('should check the type of the decoder', () => {
        const encoder1 = new RLEEncoder('uint')
        assert.throws(() => { encoder1.copyFrom(new Decoder(new Uint8Array(0))) }, /incompatible type of decoder/)
        assert.throws(() => { encoder1.copyFrom(new RLEDecoder('int', new Uint8Array(0))) }, /incompatible type of decoder/)
      })
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
      checkEncoded(encodeDelta([18, 2, 9, 15, 16, 19, 25]), [0x79, 18, 0x70, 7, 6, 1, 3, 6])
      checkEncoded(encodeDelta([1, 2, 3, 4, 5, 6, 7, 8]), [8, 1])
      checkEncoded(encodeDelta([10, 11, 12, 13, 14, 15]), [0x7f, 10, 5, 1])
      checkEncoded(encodeDelta([10, 11, 12, 13, 0, 1, 2, 3]), [0x7f, 10, 3, 1, 0x7f, 0x73, 3, 1])
      checkEncoded(encodeDelta([0, 1, 2, 3, null, null, null, 4, 5, 6]), [0x7f, 0, 3, 1, 0, 3, 3, 1])
      checkEncoded(encodeDelta([-64, -60, -56, -52, -48, -44, -40, -36]), [0x7f, 0x40, 7, 4])
    })

    it('should encode-decode round-trip sequences', () => {
      assert.deepStrictEqual(decodeDelta(encodeDelta([])), [])
      assert.deepStrictEqual(decodeDelta(encodeDelta([18, 2, 9, 15, 16, 19, 25])), [18, 2, 9, 15, 16, 19, 25])
      assert.deepStrictEqual(decodeDelta(encodeDelta([1, 2, 3, 4, 5, 6, 7, 8])), [1, 2, 3, 4, 5, 6, 7, 8])
      assert.deepStrictEqual(decodeDelta(encodeDelta([10, 11, 12, 13, 14, 15])), [10, 11, 12, 13, 14, 15])
      assert.deepStrictEqual(decodeDelta(encodeDelta([10, 11, 12, 13, 0, 1, 2, 3])), [10, 11, 12, 13, 0, 1, 2, 3])
      assert.deepStrictEqual(decodeDelta(encodeDelta([0, 1, 2, 3, null, null, null, 4, 5, 6])), [0, 1, 2, 3, null, null, null, 4, 5, 6])
      assert.deepStrictEqual(decodeDelta(encodeDelta([-64, -60, -56, -52, -48, -44, -40, -36])), [-64, -60, -56, -52, -48, -44, -40, -36])
    })

    it('should allow repetition counts to be specified', () => {
      let e
      e = new DeltaEncoder(); e.appendValue(3, 0); checkEncoded(e, [])
      e = new DeltaEncoder(); e.appendValue(3, 10); checkEncoded(e, [0x7f, 3, 9, 0])
      e = new DeltaEncoder(); e.appendValue(1, 3); e.appendValue(1, 3); checkEncoded(e, [0x7f, 1, 5, 0])
    })

    it('should allow skipping values', () => {
      const example = [null, null, null, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 40, 11, 13, 21, 103]
      const encoded = encodeDelta(example)
      for (let skipNum = 0; skipNum < example.length; skipNum++) {
        const decoder = new DeltaDecoder(encoded), values = []
        decoder.skipValues(skipNum)
        while (!decoder.done) values.push(decoder.readValue())
        assert.deepStrictEqual(values, example.slice(skipNum), `skipping ${skipNum} values failed`)
      }
    })

    describe('copying from a decoder', () => {
      function doCopy(input1, input2, options = {}) {
        let encoder1 = input1
        if (Array.isArray(input1)) {
          encoder1 = new DeltaEncoder()
          for (let value of input1) encoder1.appendValue(value)
        }

        const encoder2 = new DeltaEncoder()
        for (let value of input2) encoder2.appendValue(value)
        const decoder2 = new DeltaDecoder(encoder2.buffer)
        if (options.skip) decoder2.skipValues(options.skip)
        encoder1.copyFrom(decoder2, options)
        return encoder1
      }

      it('should copy a sequence', () => {
        checkEncoded(doCopy([], [0, 0, 0]), [3, 0])
        checkEncoded(doCopy([0, 0, 0], []), [3, 0])
        checkEncoded(doCopy([0, 0, 0], [0, 0, 0]), [6, 0])
        checkEncoded(doCopy([1, 2, 3], [4, 5, 6]), [6, 1])
        checkEncoded(doCopy([1, 2, 3], [4, 10, 20]), [4, 1, 0x7e, 6, 10])
        checkEncoded(doCopy([1, 2, 3], [1, 2, 3, 4]), [3, 1, 0x7f, 0x7e, 3, 1])
        checkEncoded(doCopy([0, 1, 3], [6, 10, 15]), [0x7a, 0, 1, 2, 3, 4, 5])
        checkEncoded(doCopy([0, 1, 3], [5, 9, 14]), [0x7e, 0, 1, 2, 2, 0x7e, 4, 5])
        checkEncoded(doCopy([1, 2, 4], [5, 6, 8, 9, 10, 12]), [2, 1, 0x7f, 2, 2, 1, 0x7f, 2, 2, 1, 0x7f, 2])
        checkEncoded(doCopy([4, 4, 4], [4, 4, 4, 5, 6, 7]), [0x7f, 4, 5, 0, 3, 1])
        checkEncoded(doCopy([0, 1, 4], [9, 6, 2, 5, 3]), [0x78, 0, 1, 3, 5, 0x7d, 0x7c, 3, 0x7e])
        checkEncoded(doCopy([1, 2, 3], [null, 4, 5, 6]), [3, 1, 0, 1, 3, 1])
        checkEncoded(doCopy([1, 2, 3], [null, 6, 6, 6]), [3, 1, 0, 1, 0x7f, 3, 2, 0])
        checkEncoded(doCopy([1, 2, 3], [null, null, 4, 5, 7, 9]), [3, 1, 0, 2, 2, 1, 2, 2])
        checkEncoded(doCopy([1, 2, null], [3, 4, 5]), [2, 1, 0, 1, 3, 1])
        checkEncoded(doCopy([1, 2, null], [6, 6, 6]), [2, 1, 0, 1, 0x7f, 4, 2, 0])
        checkEncoded(doCopy([1, 2, null], [null, 3, 4]), [2, 1, 0, 2, 2, 1])
        checkEncoded(doCopy([1, 2, null], [null, 6, 6]), [2, 1, 0, 2, 0x7e, 4, 0])
      })

      it('should copy a sub-sequence', () => {
        checkEncoded(doCopy([1, 2, 3], [4, 5, 6, 7], {count: 2}), [5, 1])
        checkEncoded(doCopy([1, 2, 3], [null, null, 4], {count: 1}), [3, 1, 0, 1])
        checkEncoded(doCopy([1, 2, 3], [null, null, 4], {count: 2}), [3, 1, 0, 2])
      })

      it('should copy non-ascending sequences', () => {
        const decoder = new DeltaDecoder(new Uint8Array([2, 1, 0x7e, 2, 0x7f])) // 1, 2, 4, 3
        const encoder = new DeltaEncoder()
        encoder.copyFrom(decoder, {count: 4})
        encoder.appendValue(5)
        checkEncoded(encoder, [2, 1, 0x7d, 2, 0x7f, 2]) // 1, 2, 4, 3, 5
      })

      it('should be able to pause and resume copying', () => {
        const numValues = 13 // 1, 3, 4, 2, null, 3, 4, 5, null, null, 4, 2, -1
        const bytes = [0x7c, 1, 2, 1, 0x7e, 0, 1, 3, 1, 0, 2, 0x7d, 0x7f, 0x7e, 0x7d]
        const decoder = new DeltaDecoder(new Uint8Array(bytes))
        for (let i = 0; i <= numValues; i++) {
          const encoder = new DeltaEncoder()
          encoder.copyFrom(decoder, {count: i})
          encoder.copyFrom(decoder, {count: numValues - i})
          checkEncoded(encoder, bytes)
          decoder.reset()
        }
      })

      it('should handle copying followed by appending', () => {
        const encoder1 = doCopy([], [1, 2, 3])
        encoder1.appendValue(4)
        checkEncoded(encoder1, [4, 1])

        const encoder2 = doCopy([5], [6, null, null, null, 7, 8])
        encoder2.appendValue(9)
        checkEncoded(encoder2, [0x7e, 5, 1, 0, 3, 3, 1])

        const encoder3 = doCopy([1], [2])
        encoder3.appendValue(3)
        checkEncoded(encoder3, [3, 1])
      })

      it('should throw an exception if the decoder has too few values', () => {
        assert.throws(() => { doCopy([0, 1, 2], [], {count: 1}) }, /cannot copy 1 values/)
        assert.throws(() => { doCopy([0, 1, 2], [null, 3], {count: 3}) }, /cannot copy 1 values/)
        assert.throws(() => { new DeltaEncoder().copyFrom(new DeltaDecoder(new Uint8Array([0, 2])), {count: 3}) }, /cannot copy 3 values/)
      })

      it('should check the arguments are valid', () => {
        const encoder1 = new DeltaEncoder('uint')
        assert.throws(() => { encoder1.copyFrom(new Decoder(new Uint8Array(0))) }, /incompatible type of decoder/)
        assert.throws(() => { encoder1.copyFrom(new DeltaDecoder(new Uint8Array(0)), {sumValues: true}) }, /unsupported options/)
      })
    })
  })

  describe('BooleanEncoder and BooleanDecoder', () => {
    function encodeBools(values) {
      const encoder = new BooleanEncoder()
      for (let value of values) encoder.appendValue(value)
      return encoder.buffer
    }

    function decodeBools(buffer) {
      if (Array.isArray(buffer)) buffer = new Uint8Array(buffer)
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

    it('should allow repetition counts to be specified', () => {
      let e
      e = new BooleanEncoder(); e.appendValue(false, 0); checkEncoded(e, [])
      e = new BooleanEncoder(); e.appendValue(false, 2); e.appendValue(false, 2); checkEncoded(e, [4])
      e = new BooleanEncoder(); e.appendValue(true, 2); e.appendValue(false, 2); checkEncoded(e, [0, 2, 2])
    })

    it('should allow skipping values', () => {
      const example = [false, false, false, true, true, true, false, true, false, true]
      const encoded = encodeBools(example)
      for (let skipNum = 0; skipNum < example.length; skipNum++) {
        const decoder = new BooleanDecoder(encoded), values = []
        decoder.skipValues(skipNum)
        while (!decoder.done) values.push(decoder.readValue())
        assert.deepStrictEqual(values, example.slice(skipNum), `skipping ${skipNum} values failed`)
      }
    })

    it('should strictly enforce canonical encoded form', () => {
      assert.throws(() => { decodeBools([1, 0]) }, /Zero-length runs are not allowed/)
      assert.throws(() => { decodeBools([1, 1, 0]) }, /Zero-length runs are not allowed/)
      const decoder = new BooleanDecoder(new Uint8Array([2, 0, 1]))
      decoder.skipValues(1)
      assert.throws(() => { decoder.skipValues(2) }, /Zero-length runs are not allowed/)
    })

    describe('copying from a decoder', () => {
      function doCopy(input1, input2, options = {}) {
        let encoder1 = input1
        if (Array.isArray(input1)) {
          encoder1 = new BooleanEncoder()
          for (let value of input1) encoder1.appendValue(value)
        }

        const encoder2 = new BooleanEncoder()
        for (let value of input2) encoder2.appendValue(value)
        const decoder2 = new BooleanDecoder(encoder2.buffer)
        if (options.skip) decoder2.skipValues(options.skip)
        encoder1.copyFrom(decoder2, options)
        return encoder1
      }

      it('should copy a sequence', () => {
        checkEncoded(doCopy([false, false, true], []), [2, 1])
        checkEncoded(doCopy([], [false, false, true, true]), [2, 2])
        checkEncoded(doCopy([false, false], [false, false, true, true]), [4, 2])
        checkEncoded(doCopy([true, true], [false, false, true, true]), [0, 2, 2, 2])
        checkEncoded(doCopy([true, true], [true, true]), [0, 4])
      })

      it('should copy a sub-sequence', () => {
        checkEncoded(doCopy([false], [false, false, false, true], {count: 2}), [3])
        checkEncoded(doCopy([false], [true, true, true, true], {count: 3}), [1, 3])
        checkEncoded(doCopy([false], [false, true, true, true], {skip: 1}), [1, 3])
        checkEncoded(doCopy([false], [false, true, true, true], {skip: 2}), [1, 2])
      })

      it('should throw an exception if the decoder has too few values', () => {
        assert.throws(() => { doCopy([false], [], {count: 1}) }, /cannot copy 1 values/)
        assert.throws(() => { doCopy([false], [true, false], {count: 3}) }, /cannot copy 3 values/)
      })

      it('should check the arguments are valid', () => {
        assert.throws(() => { new BooleanEncoder().copyFrom(new Decoder(new Uint8Array(0))) }, /incompatible type of decoder/)
        assert.throws(() => { new BooleanEncoder().copyFrom(new BooleanDecoder(new Uint8Array([2, 0]))) }, /Zero-length runs/)
      })
    })
  })
})
