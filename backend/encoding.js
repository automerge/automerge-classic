/**
 * UTF-8 decoding and encoding
 */
let stringToUtf8, utf8ToString

if (typeof TextEncoder === 'function' && typeof TextDecoder === 'function') {
  // Modern web browsers:
  // https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder/encode
  // https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode
  const utf8encoder = new TextEncoder(), utf8decoder = new TextDecoder('utf-8')
  stringToUtf8 = (string) => utf8encoder.encode(string)
  utf8ToString = (buffer) => utf8decoder.decode(buffer)

} else if (typeof Buffer === 'function') {
  // Node.js:
  // https://nodejs.org/api/buffer.html
  // https://nodejs.org/api/string_decoder.html
  const { StringDecoder } = require('string_decoder')
  const utf8decoder = new StringDecoder('utf8')
  stringToUtf8 = (string) => Buffer.from(string, 'utf8')
  // In Node >= 10 we can simply do "utf8decoder.end(buffer)". However, in Node 8 there
  // is a bug that causes an Uint8Array to be incorrectly decoded when passed directly to
  // StringDecoder.end(). Wrapping in an additional "Buffer.from()" works around this bug.
  utf8ToString = (buffer) => utf8decoder.end(Buffer.from(buffer))

} else {
  // Could use a polyfill? e.g. https://github.com/anonyco/FastestSmallestTextEncoderDecoder
  throw new Error('Platform does not provide UTF-8 encoding/decoding feature')
}


/**
 * Converts a string consisting of hexadecimal digits into an Uint8Array.
 */
function hexStringToBytes(value) {
  if (typeof value !== 'string') {
    throw new TypeError('value is not a string')
  }
  if (!/^([0-9a-f][0-9a-f])*$/.test(value)) {
    throw new RangeError('value is not hexadecimal')
  }
  if (value === '') {
    return new Uint8Array(0)
  } else {
    return new Uint8Array(value.match(/../g).map(b => parseInt(b, 16)))
  }
}

/**
 * Converts a Uint8Array into the equivalent hexadecimal string.
 */
function bytesToHexString(bytes) {
  const hex = []
  for (let b of bytes) {
    if (b < 0 || b > 255) throw new RangeError(`value does not fit in one byte: ${b}`)
    hex.push(('0' + b.toString(16)).slice(-2))
  }
  return hex.join('')
}

/**
 * Wrapper around an Uint8Array that allows values to be appended to the buffer,
 * and that automatically grows the buffer when space runs out.
 */
class Encoder {
  constructor() {
    this.buf = new Uint8Array(16)
    this.offset = 0
  }

  /**
   * Returns the byte array containing the encoded data.
   */
  get buffer() {
    this.finish()
    return this.buf.subarray(0, this.offset)
  }

  /**
   * Reallocates the encoder's buffer to be bigger.
   */
  grow(minSize = 0) {
    let newSize = this.buf.byteLength * 4
    while (newSize < minSize) newSize *= 2
    const newBuf = new Uint8Array(newSize)
    newBuf.set(this.buf, 0)
    this.buf = newBuf
    return this
  }

  /**
   * Appends one byte (0 to 255) to the buffer.
   */
  appendByte(value) {
    if (this.offset >= this.buf.byteLength) this.grow()
    this.buf[this.offset] = value
    this.offset += 1
  }

  /**
   * Encodes a 32-bit nonnegative integer in a variable number of bytes using
   * the LEB128 encoding scheme (https://en.wikipedia.org/wiki/LEB128) and
   * appends it to the buffer. Returns the number of bytes written.
   */
  appendUint32(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < 0 || value > 0xffffffff) throw new RangeError('number out of range')

    const numBytes = Math.max(1, Math.ceil((32 - Math.clz32(value)) / 7))
    if (this.offset + numBytes > this.buf.byteLength) this.grow()

    for (let i = 0; i < numBytes; i++) {
      this.buf[this.offset + i] = (value & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
      value >>>= 7 // zero-filling right shift
    }
    this.offset += numBytes
    return numBytes
  }

  /**
   * Encodes a 32-bit signed integer in a variable number of bytes using the
   * LEB128 encoding scheme (https://en.wikipedia.org/wiki/LEB128) and appends
   * it to the buffer. Returns the number of bytes written.
   */
  appendInt32(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < -0x80000000 || value > 0x7fffffff) throw new RangeError('number out of range')

    const numBytes = Math.ceil((33 - Math.clz32(value >= 0 ? value : -value - 1)) / 7)
    if (this.offset + numBytes > this.buf.byteLength) this.grow()

    for (let i = 0; i < numBytes; i++) {
      this.buf[this.offset + i] = (value & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
      value >>= 7 // sign-propagating right shift
    }
    this.offset += numBytes
    return numBytes
  }

  /**
   * Encodes a nonnegative integer in a variable number of bytes using the LEB128
   * encoding scheme, up to the maximum size of integers supported by JavaScript
   * (53 bits).
   */
  appendUint53(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('number out of range')
    }
    const high32 = Math.floor(value / 0x100000000)
    const low32 = (value & 0xffffffff) >>> 0 // right shift to interpret as unsigned
    return this.appendUint64(high32, low32)
  }

  /**
   * Encodes a signed integer in a variable number of bytes using the LEB128
   * encoding scheme, up to the maximum size of integers supported by JavaScript
   * (53 bits).
   */
  appendInt53(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < Number.MIN_SAFE_INTEGER || value > Number.MAX_SAFE_INTEGER) {
      throw new RangeError('number out of range')
    }
    const high32 = Math.floor(value / 0x100000000)
    const low32 = (value & 0xffffffff) >>> 0 // right shift to interpret as unsigned
    return this.appendInt64(high32, low32)
  }

  /**
   * Encodes a 64-bit nonnegative integer in a variable number of bytes using
   * the LEB128 encoding scheme, and appends it to the buffer. The number is
   * given as two 32-bit halves since JavaScript cannot accurately represent
   * integers with more than 53 bits in a single variable.
   */
  appendUint64(high32, low32) {
    if (!Number.isInteger(high32) || !Number.isInteger(low32)) {
      throw new RangeError('value is not an integer')
    }
    if (high32 < 0 || high32 > 0xffffffff || low32 < 0 || low32 > 0xffffffff) {
      throw new RangeError('number out of range')
    }
    if (high32 === 0) return this.appendUint32(low32)

    const numBytes = Math.ceil((64 - Math.clz32(high32)) / 7)
    if (this.offset + numBytes > this.buf.byteLength) this.grow()
    for (let i = 0; i < 4; i++) {
      this.buf[this.offset + i] = (low32 & 0x7f) | 0x80
      low32 >>>= 7 // zero-filling right shift
    }
    this.buf[this.offset + 4] = (low32 & 0x0f) | ((high32 & 0x07) << 4) | (numBytes === 5 ? 0x00 : 0x80)
    high32 >>>= 3
    for (let i = 5; i < numBytes; i++) {
      this.buf[this.offset + i] = (high32 & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
      high32 >>>= 7
    }
    this.offset += numBytes
    return numBytes
  }

  /**
   * Encodes a 64-bit signed integer in a variable number of bytes using the
   * LEB128 encoding scheme, and appends it to the buffer. The number is given
   * as two 32-bit halves since JavaScript cannot accurately represent integers
   * with more than 53 bits in a single variable. The sign of the 64-bit
   * number is determined by the sign of the `high32` half; the sign of the
   * `low32` half is ignored.
   */
  appendInt64(high32, low32) {
    if (!Number.isInteger(high32) || !Number.isInteger(low32)) {
      throw new RangeError('value is not an integer')
    }
    if (high32 < -0x80000000 || high32 > 0x7fffffff || low32 < -0x80000000 || low32 > 0xffffffff) {
      throw new RangeError('number out of range')
    }
    low32 >>>= 0 // interpret as unsigned
    if (high32 === 0 && low32 <= 0x7fffffff) return this.appendInt32(low32)
    if (high32 === -1 && low32 >= 0x80000000) return this.appendInt32(low32 - 0x100000000)

    const numBytes = Math.ceil((65 - Math.clz32(high32 >= 0 ? high32 : -high32 - 1)) / 7)
    if (this.offset + numBytes > this.buf.byteLength) this.grow()
    for (let i = 0; i < 4; i++) {
      this.buf[this.offset + i] = (low32 & 0x7f) | 0x80
      low32 >>>= 7 // zero-filling right shift
    }
    this.buf[this.offset + 4] = (low32 & 0x0f) | ((high32 & 0x07) << 4) | (numBytes === 5 ? 0x00 : 0x80)
    high32 >>= 3 // sign-propagating right shift
    for (let i = 5; i < numBytes; i++) {
      this.buf[this.offset + i] = (high32 & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
      high32 >>= 7
    }
    this.offset += numBytes
    return numBytes
  }

  /**
   * Appends the contents of byte buffer `data` to the buffer. Returns the
   * number of bytes appended.
   */
  appendRawBytes(data) {
    if (this.offset + data.byteLength > this.buf.byteLength) {
      this.grow(this.offset + data.byteLength)
    }
    this.buf.set(data, this.offset)
    this.offset += data.byteLength
    return data.byteLength
  }

  /**
   * Appends a UTF-8 string to the buffer, without any metadata. Returns the
   * number of bytes appended.
   */
  appendRawString(value) {
    if (typeof value !== 'string') throw new TypeError('value is not a string')
    return this.appendRawBytes(stringToUtf8(value))
  }

  /**
   * Appends the contents of byte buffer `data` to the buffer, prefixed with the
   * number of bytes in the buffer (as a LEB128-encoded unsigned integer).
   */
  appendPrefixedBytes(data) {
    this.appendUint53(data.byteLength)
    this.appendRawBytes(data)
    return this
  }

  /**
   * Appends a UTF-8 string to the buffer, prefixed with its length in bytes
   * (where the length is encoded as an unsigned LEB128 integer).
   */
  appendPrefixedString(value) {
    if (typeof value !== 'string') throw new TypeError('value is not a string')
    this.appendPrefixedBytes(stringToUtf8(value))
    return this
  }

  /**
   * Takes a value, which must be a string consisting only of hexadecimal
   * digits, maps it to a byte array, and appends it to the buffer, prefixed
   * with its length in bytes.
   */
  appendHexString(value) {
    this.appendPrefixedBytes(hexStringToBytes(value))
    return this
  }

  /**
   * Flushes any unwritten data to the buffer. Call this before reading from
   * the buffer constructed by this Encoder.
   */
  finish() {
  }
}

/**
 * Counterpart to Encoder. Wraps a Uint8Array buffer with a cursor indicating
 * the current decoding position, and allows values to be incrementally read by
 * decoding the bytes at the current position.
 */
class Decoder {
  constructor(buffer) {
    if (!(buffer instanceof Uint8Array)) {
      throw new TypeError(`Not a byte array: ${buffer}`)
    }
    this.buf = buffer
    this.offset = 0
  }

  /**
   * Returns false if there is still data to be read at the current decoding
   * position, and true if we are at the end of the buffer.
   */
  get done() {
    return this.offset === this.buf.byteLength
  }

  /**
   * Moves the current decoding position forward by the specified number of
   * bytes, without decoding anything.
   */
  skip(bytes) {
    if (this.offset + bytes > this.buf.byteLength) {
      throw new RangeError('cannot skip beyond end of buffer')
    }
    this.offset += bytes
  }

  /**
   * Reads one byte (0 to 255) from the buffer.
   */
  readByte() {
    this.offset += 1
    return this.buf[this.offset - 1]
  }

  /**
   * Reads a LEB128-encoded unsigned integer from the current position in the buffer.
   * Throws an exception if the value doesn't fit in a 32-bit unsigned int.
   */
  readUint32() {
    let result = 0, shift = 0
    while (this.offset < this.buf.byteLength) {
      const nextByte = this.buf[this.offset]
      if (shift === 28 && (nextByte & 0xf0) !== 0) { // more than 5 bytes, or value > 0xffffffff
        throw new RangeError('number out of range')
      }
      result = (result | (nextByte & 0x7f) << shift) >>> 0 // right shift to interpret value as unsigned
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) return result
    }
    throw new RangeError('buffer ended with incomplete number')
  }

  /**
   * Reads a LEB128-encoded signed integer from the current position in the buffer.
   * Throws an exception if the value doesn't fit in a 32-bit signed int.
   */
  readInt32() {
    let result = 0, shift = 0
    while (this.offset < this.buf.byteLength) {
      const nextByte = this.buf[this.offset]
      if ((shift === 28 && (nextByte & 0x80) !== 0) || // more than 5 bytes
          (shift === 28 && (nextByte & 0x40) === 0 && (nextByte & 0x38) !== 0) || // positive int > 0x7fffffff
          (shift === 28 && (nextByte & 0x40) !== 0 && (nextByte & 0x38) !== 0x38)) { // negative int < -0x80000000
        throw new RangeError('number out of range')
      }
      result |= (nextByte & 0x7f) << shift
      shift += 7
      this.offset++

      if ((nextByte & 0x80) === 0) {
        if ((nextByte & 0x40) === 0 || shift > 28) {
          return result // positive, or negative value that doesn't need sign-extending
        } else {
          return result | (-1 << shift) // sign-extend negative integer
        }
      }
    }
    throw new RangeError('buffer ended with incomplete number')
  }

  /**
   * Reads a LEB128-encoded unsigned integer from the current position in the
   * buffer. Allows any integer that can be safely represented by JavaScript
   * (up to 2^53 - 1), and throws an exception outside of that range.
   */
  readUint53() {
    const { low32, high32 } = this.readUint64()
    if (high32 < 0 || high32 > 0x1fffff) {
      throw new RangeError('number out of range')
    }
    return high32 * 0x100000000 + low32
  }

  /**
   * Reads a LEB128-encoded signed integer from the current position in the
   * buffer. Allows any integer that can be safely represented by JavaScript
   * (between -(2^53 - 1) and 2^53 - 1), throws an exception outside of that range.
   */
  readInt53() {
    const { low32, high32 } = this.readInt64()
    if (high32 < -0x200000 || (high32 === -0x200000 && low32 === 0) || high32 > 0x1fffff) {
      throw new RangeError('number out of range')
    }
    return high32 * 0x100000000 + low32
  }

  /**
   * Reads a LEB128-encoded unsigned integer from the current position in the
   * buffer. Throws an exception if the value doesn't fit in a 64-bit unsigned
   * int. Returns the number in two 32-bit halves, as an object of the form
   * `{high32, low32}`.
   */
  readUint64() {
    let low32 = 0, high32 = 0, shift = 0
    while (this.offset < this.buf.byteLength && shift <= 28) {
      const nextByte = this.buf[this.offset]
      low32 = (low32 | (nextByte & 0x7f) << shift) >>> 0 // right shift to interpret value as unsigned
      if (shift === 28) {
        high32 = (nextByte & 0x70) >>> 4
      }
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) return { high32, low32 }
    }

    shift = 3
    while (this.offset < this.buf.byteLength) {
      const nextByte = this.buf[this.offset]
      if (shift === 31 && (nextByte & 0xfe) !== 0) { // more than 10 bytes, or value > 2^64 - 1
        throw new RangeError('number out of range')
      }
      high32 = (high32 | (nextByte & 0x7f) << shift) >>> 0
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) return { high32, low32 }
    }
    throw new RangeError('buffer ended with incomplete number')
  }

  /**
   * Reads a LEB128-encoded signed integer from the current position in the
   * buffer. Throws an exception if the value doesn't fit in a 64-bit signed
   * int. Returns the number in two 32-bit halves, as an object of the form
   * `{high32, low32}`. The `low32` half is always non-negative, and the
   * sign of the `high32` half indicates the sign of the 64-bit number.
   */
  readInt64() {
    let low32 = 0, high32 = 0, shift = 0
    while (this.offset < this.buf.byteLength && shift <= 28) {
      const nextByte = this.buf[this.offset]
      low32 = (low32 | (nextByte & 0x7f) << shift) >>> 0 // right shift to interpret value as unsigned
      if (shift === 28) {
        high32 = (nextByte & 0x70) >>> 4
      }
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) {
        if ((nextByte & 0x40) !== 0) { // sign-extend negative integer
          if (shift < 32) low32 = (low32 | (-1 << shift)) >>> 0
          high32 |= -1 << Math.max(shift - 32, 0)
        }
        return { high32, low32 }
      }
    }

    shift = 3
    while (this.offset < this.buf.byteLength) {
      const nextByte = this.buf[this.offset]
      // On the 10th byte there are only two valid values: all 7 value bits zero
      // (if the value is positive) or all 7 bits one (if the value is negative)
      if (shift === 31 && nextByte !== 0 && nextByte !== 0x7f) {
        throw new RangeError('number out of range')
      }
      high32 |= (nextByte & 0x7f) << shift
      shift += 7
      this.offset++
      if ((nextByte & 0x80) === 0) {
        if ((nextByte & 0x40) !== 0 && shift < 32) { // sign-extend negative integer
          high32 |= -1 << shift
        }
        return { high32, low32 }
      }
    }
    throw new RangeError('buffer ended with incomplete number')
  }

  /**
   * Extracts a subarray `length` bytes in size, starting from the current
   * position in the buffer, and moves the position forward.
   */
  readRawBytes(length) {
    const start = this.offset
    if (start + length > this.buf.byteLength) {
      throw new RangeError('subarray exceeds buffer size')
    }
    this.offset += length
    return this.buf.subarray(start, this.offset)
  }

  /**
   * Extracts `length` bytes from the buffer, starting from the current position,
   * and returns the UTF-8 string decoding of those bytes.
   */
  readRawString(length) {
    return utf8ToString(this.readRawBytes(length))
  }

  /**
   * Extracts a subarray from the current position in the buffer, prefixed with
   * its length in bytes (encoded as an unsigned LEB128 integer).
   */
  readPrefixedBytes() {
    return this.readRawBytes(this.readUint53())
  }

  /**
   * Reads a UTF-8 string from the current position in the buffer, prefixed with its
   * length in bytes (where the length is encoded as an unsigned LEB128 integer).
   */
  readPrefixedString() {
    return utf8ToString(this.readPrefixedBytes())
  }

  /**
   * Reads a byte array from the current position in the buffer, prefixed with its
   * length in bytes. Returns that byte array converted to a hexadecimal string.
   */
  readHexString() {
    return bytesToHexString(this.readPrefixedBytes())
  }
}

/**
 * An encoder that uses run-length encoding to compress sequences of repeated
 * values. The constructor argument specifies the type of values, which may be
 * either 'int', 'uint', or 'utf8'. Besides valid values of the selected
 * datatype, values may also be null.
 *
 * The encoded buffer starts with a LEB128-encoded signed integer, the
 * repetition count. The interpretation of the following values depends on this
 * repetition count:
 *   - If this number is a positive value n, the next value in the buffer
 *     (encoded as the specified datatype) is repeated n times in the sequence.
 *   - If the repetition count is a negative value -n, then the next n values
 *     (encoded as the specified datatype) in the buffer are treated as a
 *     literal, i.e. they appear in the sequence without any further
 *     interpretation or repetition.
 *   - If the repetition count is zero, then the next value in the buffer is a
 *     LEB128-encoded unsigned integer indicating the number of null values
 *     that appear at the current position in the sequence.
 *
 * After one of these three has completed, the process repeats, starting again
 * with a repetition count, until we reach the end of the buffer.
 */
class RLEEncoder extends Encoder {
  constructor(type) {
    super()
    this.type = type
    this.lastValue = undefined
    this.count = 0
    this.literal = []
    this.onlyNulls = true
  }

  /**
   * Appends a new value to the sequence.
   */
  appendValue(value) {
    if (value !== null && value !== undefined) {
      this.onlyNulls = false
    }
    if (this.lastValue === undefined) {
      this.lastValue = value
    }
    if (this.lastValue === value) {
      this.count += 1
      return
    }
    if (this.lastValue !== null && this.count === 1) {
      this.literal.push(this.lastValue)
      this.lastValue = value
      this.count = 0
    }

    if ((value === null || value === undefined || this.count > 1) && this.literal.length > 0) {
      this.appendInt53(-this.literal.length)
      for (let v of this.literal) this.appendRawValue(v)
      this.literal = []
    }

    if (this.lastValue === null && this.count > 0) {
      this.appendInt32(0)
      this.appendUint53(this.count)
    } else if (this.count > 1) {
      this.appendInt53(this.count)
      this.appendRawValue(this.lastValue)
    }
    this.lastValue = value
    this.count = (value === undefined ? 0 : 1)
  }

  /**
   * Private method, do not call from outside the class.
   */
  appendRawValue(value) {
    if (this.type === 'int') {
      this.appendInt53(value)
    } else if (this.type === 'uint') {
      this.appendUint53(value)
    } else if (this.type === 'utf8') {
      this.appendPrefixedString(value)
    } else {
      throw new RangeError(`Unknown RLEEncoder datatype: ${this.type}`)
    }
  }

  /**
   * Flushes any unwritten data to the buffer. Call this before reading from
   * the buffer constructed by this Encoder.
   */
  finish() {
    this.appendValue(undefined)
  }
}

/**
 * Counterpart to RLEEncoder: reads values from an RLE-compressed sequence,
 * returning nulls and repeated values as required.
 */
class RLEDecoder extends Decoder {
  constructor(type, buffer) {
    super(buffer)
    this.type = type
    this.lastValue = undefined
    this.count = 0
    this.literal = false
  }

  /**
   * Returns false if there is still data to be read at the current decoding
   * position, and true if we are at the end of the buffer.
   */
  get done() {
    return (this.count === 0) && (this.offset === this.buf.byteLength)
  }

  /**
   * Returns the next value (or null) in the sequence.
   */
  readValue() {
    if (this.done) return null

    if (this.count === 0) {
      this.count = this.readInt53()
      if (this.count > 0) {
        this.lastValue = this.readRawValue()
        this.literal = false
      } else if (this.count < 0) {
        this.count = -this.count
        this.literal = true
      } else { // this.count == 0
        this.count = this.readUint53()
        this.lastValue = null
        this.literal = false
      }
    }

    this.count -= 1
    if (this.literal) {
      return this.readRawValue()
    } else {
      return this.lastValue
    }
  }

  /**
   * Private method, do not call from outside the class.
   */
  readRawValue() {
    if (this.type === 'int') {
      return this.readInt53()
    } else if (this.type === 'uint') {
      return this.readUint53()
    } else if (this.type === 'utf8') {
      return this.readPrefixedString()
    } else {
      throw new RangeError(`Unknown RLEDecoder datatype: ${this.type}`)
    }
  }
}

/**
 * A variant of RLEEncoder: rather than storing the actual values passed to
 * appendValue(), this version stores only the first value, and for all
 * subsequent values it stores the difference to the previous value. This
 * encoding is good when values tend to come in sequentially incrementing runs,
 * because the delta between successive values is 1, and repeated values of 1
 * are easily compressed with run-length encoding.
 *
 * Null values are also allowed, as with RLEEncoder.
 */
class DeltaEncoder extends RLEEncoder {
  constructor() {
    super('int')
    this.absoluteValue = 0
  }

  /**
   * Appends a new integer value to the sequence.
   */
  appendValue(value) {
    if (typeof value === 'number') {
      super.appendValue(value - this.absoluteValue)
      this.absoluteValue = value
    } else {
      super.appendValue(value)
    }
  }
}

/**
 * Counterpart to DeltaEncoder: reads values from a delta-compressed sequence of
 * numbers (may include null values).
 */
class DeltaDecoder extends RLEDecoder {
  constructor(buffer) {
    super('int', buffer)
    this.absoluteValue = 0
  }

  /**
   * Returns the next integer (or null) value in the sequence.
   */
  readValue() {
    const value = super.readValue()
    if (value === null) return null
    this.absoluteValue += value
    return this.absoluteValue
  }
}

/**
 * Encodes a sequence of boolean values by mapping it to a sequence of integers:
 * the number of false values, followed by the number of true values, followed
 * by the number of false values, and so on. Each number is encoded as a LEB128
 * unsigned integer. This encoding is a bit like RLEEncoder, except that we
 * only encode the repetition count but not the actual value, since the values
 * just alternate between false and true (starting with false).
 */
class BooleanEncoder extends Encoder {
  constructor() {
    super()
    this.lastValue = false
    this.count = 0
  }

  /**
   * Appends a new value to the sequence.
   */
  appendValue(value) {
    if (value !== false && value !== true) {
      throw new RangeError(`Unsupported value for BooleanEncoder: ${value}`)
    }
    if (this.lastValue === value) {
      this.count += 1
    } else {
      this.appendUint53(this.count)
      this.lastValue = value
      this.count = 1
    }
  }

  /**
   * Flushes any unwritten data to the buffer. Call this before reading from
   * the buffer constructed by this Encoder.
   */
  finish() {
    if (this.count > 0) {
      this.appendUint53(this.count)
      this.count = 0
    }
  }
}

/**
 * Counterpart to BooleanEncoder: reads boolean values from a runlength-encoded
 * sequence.
 */
class BooleanDecoder extends Decoder {
  constructor(buffer) {
    super(buffer)
    this.lastValue = true // is negated the first time we read a count
    this.count = 0
  }

  /**
   * Returns false if there is still data to be read at the current decoding
   * position, and true if we are at the end of the buffer.
   */
  get done() {
    return (this.count === 0) && (this.offset === this.buf.byteLength)
  }

  /**
   * Returns the next value (or null) in the sequence.
   */
  readValue() {
    while (this.count === 0) {
      this.count = this.readUint53()
      this.lastValue = !this.lastValue
    }
    this.count -= 1
    return this.lastValue
  }
}

module.exports = {
  hexStringToBytes, bytesToHexString,
  Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, BooleanEncoder, BooleanDecoder
}
