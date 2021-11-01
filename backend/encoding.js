/**
 * UTF-8 decoding and encoding using API that is supported in Node >= 12 and modern browsers:
 * https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder/encode
 * https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode
 * If you're running in an environment where it's not available, please use a polyfill, such as:
 * https://github.com/anonyco/FastestSmallestTextEncoderDecoder
 */
const utf8encoder = new TextEncoder()
const utf8decoder = new TextDecoder('utf-8')

function stringToUtf8(string) {
  return utf8encoder.encode(string)
}

function utf8ToString(buffer) {
  return utf8decoder.decode(buffer)
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

const NIBBLE_TO_HEX = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f']
const BYTE_TO_HEX = new Array(256)
for (let i = 0; i < 256; i++) {
  BYTE_TO_HEX[i] = `${NIBBLE_TO_HEX[(i >>> 4) & 0xf]}${NIBBLE_TO_HEX[i & 0xf]}`;
}

/**
 * Converts a Uint8Array into the equivalent hexadecimal string.
 */
function bytesToHexString(bytes) {
  let hex = '', len = bytes.byteLength
  for (let i = 0; i < len; i++) {
    hex += BYTE_TO_HEX[bytes[i]]
  }
  return hex
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
   * Resets the cursor position, so that the next read goes back to the
   * beginning of the buffer.
   */
  reset() {
    this.offset = 0
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
    this.state = 'empty'
    this.lastValue = undefined
    this.count = 0
    this.literal = []
  }

  /**
   * Appends a new value to the sequence. If `repetitions` is given, the value is repeated
   * `repetitions` times.
   */
  appendValue(value, repetitions = 1) {
    this._appendValue(value, repetitions)
  }

  /**
   * Like `appendValue()`, but this method is not overridden by `DeltaEncoder`.
   */
  _appendValue(value, repetitions = 1) {
    if (repetitions <= 0) return
    if (this.state === 'empty') {
      this.state = (value === null ? 'nulls' : (repetitions === 1 ? 'loneValue' : 'repetition'))
      this.lastValue = value
      this.count = repetitions
    } else if (this.state === 'loneValue') {
      if (value === null) {
        this.flush()
        this.state = 'nulls'
        this.count = repetitions
      } else if (value === this.lastValue) {
        this.state = 'repetition'
        this.count = 1 + repetitions
      } else if (repetitions > 1) {
        this.flush()
        this.state = 'repetition'
        this.count = repetitions
        this.lastValue = value
      } else {
        this.state = 'literal'
        this.literal = [this.lastValue]
        this.lastValue = value
      }
    } else if (this.state === 'repetition') {
      if (value === null) {
        this.flush()
        this.state = 'nulls'
        this.count = repetitions
      } else if (value === this.lastValue) {
        this.count += repetitions
      } else if (repetitions > 1) {
        this.flush()
        this.state = 'repetition'
        this.count = repetitions
        this.lastValue = value
      } else {
        this.flush()
        this.state = 'loneValue'
        this.lastValue = value
      }
    } else if (this.state === 'literal') {
      if (value === null) {
        this.literal.push(this.lastValue)
        this.flush()
        this.state = 'nulls'
        this.count = repetitions
      } else if (value === this.lastValue) {
        this.flush()
        this.state = 'repetition'
        this.count = 1 + repetitions
      } else if (repetitions > 1) {
        this.literal.push(this.lastValue)
        this.flush()
        this.state = 'repetition'
        this.count = repetitions
        this.lastValue = value
      } else {
        this.literal.push(this.lastValue)
        this.lastValue = value
      }
    } else if (this.state === 'nulls') {
      if (value === null) {
        this.count += repetitions
      } else if (repetitions > 1) {
        this.flush()
        this.state = 'repetition'
        this.count = repetitions
        this.lastValue = value
      } else {
        this.flush()
        this.state = 'loneValue'
        this.lastValue = value
      }
    }
  }

  /**
   * Copies values from the RLEDecoder `decoder` into this encoder. The `options` object may
   * contain the following keys:
   *  - `count`: The number of values to copy. If not specified, copies all remaining values.
   *  - `sumValues`: If true, the function computes the sum of all numeric values as they are
   *    copied (null values are counted as zero), and returns that number.
   *  - `sumShift`: If set, values are shifted right by `sumShift` bits before adding to the sum.
   *
   * Returns an object of the form `{nonNullValues, sum}` where `nonNullValues` is the number of
   * non-null values copied, and `sum` is the sum (only if the `sumValues` option is set).
   */
  copyFrom(decoder, options = {}) {
    const { count, sumValues, sumShift } = options
    if (!(decoder instanceof RLEDecoder) || (decoder.type !== this.type)) {
      throw new TypeError('incompatible type of decoder')
    }
    let remaining = (typeof count === 'number' ? count : Number.MAX_SAFE_INTEGER)
    let nonNullValues = 0, sum = 0
    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
    if (remaining === 0 || decoder.done) return sumValues ? {nonNullValues, sum} : {nonNullValues}

    // Copy a value so that we have a well-defined starting state. NB: when super.copyFrom() is
    // called by the DeltaEncoder subclass, the following calls to readValue() and appendValue()
    // refer to the overridden methods, while later readRecord(), readRawValue() and _appendValue()
    // calls refer to the non-overridden RLEDecoder/RLEEncoder methods.
    let firstValue = decoder.readValue()
    if (firstValue === null) {
      const numNulls = Math.min(decoder.count + 1, remaining)
      remaining -= numNulls
      decoder.count -= numNulls - 1
      this.appendValue(null, numNulls)
      if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
      if (remaining === 0 || decoder.done) return sumValues ? {nonNullValues, sum} : {nonNullValues}
      firstValue = decoder.readValue()
      if (firstValue === null) throw new RangeError('null run must be followed by non-null value')
    }
    this.appendValue(firstValue)
    remaining--
    nonNullValues++
    if (sumValues) sum += (sumShift ? (firstValue >>> sumShift) : firstValue)
    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
    if (remaining === 0 || decoder.done) return sumValues ? {nonNullValues, sum} : {nonNullValues}

    // Copy data at the record level without expanding repetitions
    let firstRun = (decoder.count > 0)
    while (remaining > 0 && !decoder.done) {
      if (!firstRun) decoder.readRecord()
      const numValues = Math.min(decoder.count, remaining)
      decoder.count -= numValues

      if (decoder.state === 'literal') {
        nonNullValues += numValues
        for (let i = 0; i < numValues; i++) {
          if (decoder.done) throw new RangeError('incomplete literal')
          const value = decoder.readRawValue()
          if (value === decoder.lastValue) throw new RangeError('Repetition of values is not allowed in literal')
          decoder.lastValue = value
          this._appendValue(value)
          if (sumValues) sum += (sumShift ? (value >>> sumShift) : value)
        }
      } else if (decoder.state === 'repetition') {
        nonNullValues += numValues
        if (sumValues) sum += numValues * (sumShift ? (decoder.lastValue >>> sumShift) : decoder.lastValue)
        const value = decoder.lastValue
        this._appendValue(value)
        if (numValues > 1) {
          this._appendValue(value)
          if (this.state !== 'repetition') throw new RangeError(`Unexpected state ${this.state}`)
          this.count += numValues - 2
        }
      } else if (decoder.state === 'nulls') {
        this._appendValue(null)
        if (this.state !== 'nulls') throw new RangeError(`Unexpected state ${this.state}`)
        this.count += numValues - 1
      }

      firstRun = false
      remaining -= numValues
    }
    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
    return sumValues ? {nonNullValues, sum} : {nonNullValues}
  }

  /**
   * Private method, do not call from outside the class.
   */
  flush() {
    if (this.state === 'loneValue') {
      this.appendInt32(-1)
      this.appendRawValue(this.lastValue)
    } else if (this.state === 'repetition') {
      this.appendInt53(this.count)
      this.appendRawValue(this.lastValue)
    } else if (this.state === 'literal') {
      this.appendInt53(-this.literal.length)
      for (let v of this.literal) this.appendRawValue(v)
    } else if (this.state === 'nulls') {
      this.appendInt32(0)
      this.appendUint53(this.count)
    }
    this.state = 'empty'
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
    if (this.state === 'literal') this.literal.push(this.lastValue)
    // Don't write anything if the only values we have seen are nulls
    if (this.state !== 'nulls' || this.offset > 0) this.flush()
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
    this.state = undefined
  }

  /**
   * Returns false if there is still data to be read at the current decoding
   * position, and true if we are at the end of the buffer.
   */
  get done() {
    return (this.count === 0) && (this.offset === this.buf.byteLength)
  }

  /**
   * Resets the cursor position, so that the next read goes back to the
   * beginning of the buffer.
   */
  reset() {
    this.offset = 0
    this.lastValue = undefined
    this.count = 0
    this.state = undefined
  }

  /**
   * Returns the next value (or null) in the sequence.
   */
  readValue() {
    if (this.done) return null
    if (this.count === 0) this.readRecord()
    this.count -= 1
    if (this.state === 'literal') {
      const value = this.readRawValue()
      if (value === this.lastValue) throw new RangeError('Repetition of values is not allowed in literal')
      this.lastValue = value
      return value
    } else {
      return this.lastValue
    }
  }

  /**
   * Discards the next `numSkip` values in the sequence.
   */
  skipValues(numSkip) {
    while (numSkip > 0 && !this.done) {
      if (this.count === 0) {
        this.count = this.readInt53()
        if (this.count > 0) {
          this.lastValue = (this.count <= numSkip) ? this.skipRawValues(1) : this.readRawValue()
          this.state = 'repetition'
        } else if (this.count < 0) {
          this.count = -this.count
          this.state = 'literal'
        } else { // this.count == 0
          this.count = this.readUint53()
          this.lastValue = null
          this.state = 'nulls'
        }
      }

      const consume = Math.min(numSkip, this.count)
      if (this.state === 'literal') this.skipRawValues(consume)
      numSkip -= consume
      this.count -= consume
    }
  }

  /**
   * Private method, do not call from outside the class.
   * Reads a repetition count from the buffer and sets up the state appropriately.
   */
  readRecord() {
    this.count = this.readInt53()
    if (this.count > 1) {
      const value = this.readRawValue()
      if ((this.state === 'repetition' || this.state === 'literal') && this.lastValue === value) {
        throw new RangeError('Successive repetitions with the same value are not allowed')
      }
      this.state = 'repetition'
      this.lastValue = value
    } else if (this.count === 1) {
      throw new RangeError('Repetition count of 1 is not allowed, use a literal instead')
    } else if (this.count < 0) {
      this.count = -this.count
      if (this.state === 'literal') throw new RangeError('Successive literals are not allowed')
      this.state = 'literal'
    } else { // this.count == 0
      if (this.state === 'nulls') throw new RangeError('Successive null runs are not allowed')
      this.count = this.readUint53()
      if (this.count === 0) throw new RangeError('Zero-length null runs are not allowed')
      this.lastValue = null
      this.state = 'nulls'
    }
  }

  /**
   * Private method, do not call from outside the class.
   * Reads one value of the datatype configured on construction.
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

  /**
   * Private method, do not call from outside the class.
   * Skips over `num` values of the datatype configured on construction.
   */
  skipRawValues(num) {
    if (this.type === 'utf8') {
      for (let i = 0; i < num; i++) this.skip(this.readUint53())
    } else {
      while (num > 0 && this.offset < this.buf.byteLength) {
        if ((this.buf[this.offset] & 0x80) === 0) num--
        this.offset++
      }
      if (num > 0) throw new RangeError('cannot skip beyond end of buffer')
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
   * Appends a new integer value to the sequence. If `repetitions` is given, the value is repeated
   * `repetitions` times.
   */
  appendValue(value, repetitions = 1) {
    if (repetitions <= 0) return
    if (typeof value === 'number') {
      super.appendValue(value - this.absoluteValue, 1)
      this.absoluteValue = value
      if (repetitions > 1) super.appendValue(0, repetitions - 1)
    } else {
      super.appendValue(value, repetitions)
    }
  }

  /**
   * Copies values from the DeltaDecoder `decoder` into this encoder. The `options` object may
   * contain the key `count`, indicating the number of values to copy. If not specified, copies
   * all remaining values in the decoder.
   */
  copyFrom(decoder, options = {}) {
    if (options.sumValues) {
      throw new RangeError('unsupported options for DeltaEncoder.copyFrom()')
    }
    if (!(decoder instanceof DeltaDecoder)) {
      throw new TypeError('incompatible type of decoder')
    }

    let remaining = options.count
    if (remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${remaining} values`)
    if (remaining === 0 || decoder.done) return

    // Copy any null values, and the first non-null value, so that appendValue() computes the
    // difference between the encoder's last value and the decoder's first (absolute) value.
    let value = decoder.readValue(), nulls = 0
    this.appendValue(value)
    if (value === null) {
      nulls = decoder.count + 1
      if (remaining !== undefined && remaining < nulls) nulls = remaining
      decoder.count -= nulls - 1
      this.count += nulls - 1
      if (remaining > nulls && decoder.done) throw new RangeError(`cannot copy ${remaining} values`)
      if (remaining === nulls || decoder.done) return

      // The next value read is certain to be non-null because we're not at the end of the decoder,
      // and a run of nulls must be followed by a run of non-nulls.
      if (decoder.count === 0) this.appendValue(decoder.readValue())
    }

    // Once we have the first value, the subsequent relative values can be copied verbatim without
    // any further processing. Note that the first value copied by super.copyFrom() is an absolute
    // value, while subsequent values are relative. Thus, the sum of all of the (non-null) copied
    // values must equal the absolute value of the final element copied.
    if (remaining !== undefined) remaining -= nulls + 1
    const { nonNullValues, sum } = super.copyFrom(decoder, {count: remaining, sumValues: true})
    if (nonNullValues > 0) {
      this.absoluteValue = sum
      decoder.absoluteValue = sum
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
   * Resets the cursor position, so that the next read goes back to the
   * beginning of the buffer.
   */
  reset() {
    this.offset = 0
    this.lastValue = undefined
    this.count = 0
    this.state = undefined
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

  /**
   * Discards the next `numSkip` values in the sequence.
   */
  skipValues(numSkip) {
    while (numSkip > 0 && !this.done) {
      if (this.count === 0) this.readRecord()
      const consume = Math.min(numSkip, this.count)
      if (this.state === 'literal') {
        for (let i = 0; i < consume; i++) {
          this.lastValue = this.readRawValue()
          this.absoluteValue += this.lastValue
        }
      } else if (this.state === 'repetition') {
        this.absoluteValue += consume * this.lastValue
      }
      numSkip -= consume
      this.count -= consume
    }
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
   * Appends a new value to the sequence. If `repetitions` is given, the value is repeated
   * `repetitions` times.
   */
  appendValue(value, repetitions = 1) {
    if (value !== false && value !== true) {
      throw new RangeError(`Unsupported value for BooleanEncoder: ${value}`)
    }
    if (repetitions <= 0) return
    if (this.lastValue === value) {
      this.count += repetitions
    } else {
      this.appendUint53(this.count)
      this.lastValue = value
      this.count = repetitions
    }
  }

  /**
   * Copies values from the BooleanDecoder `decoder` into this encoder. The `options` object may
   * contain the key `count`, indicating the number of values to copy. If not specified, copies
   * all remaining values in the decoder.
   */
  copyFrom(decoder, options = {}) {
    if (!(decoder instanceof BooleanDecoder)) {
      throw new TypeError('incompatible type of decoder')
    }

    const { count } = options
    let remaining = (typeof count === 'number' ? count : Number.MAX_SAFE_INTEGER)
    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
    if (remaining === 0 || decoder.done) return

    // Copy one value to bring decoder and encoder state into sync, then finish that value's repetitions
    this.appendValue(decoder.readValue())
    remaining--
    const firstCopy = Math.min(decoder.count, remaining)
    this.count += firstCopy
    decoder.count -= firstCopy
    remaining -= firstCopy

    while (remaining > 0 && !decoder.done) {
      decoder.count = decoder.readUint53()
      if (decoder.count === 0) throw new RangeError('Zero-length runs are not allowed')
      decoder.lastValue = !decoder.lastValue
      this.appendUint53(this.count)

      const numCopied = Math.min(decoder.count, remaining)
      this.count = numCopied
      this.lastValue = decoder.lastValue
      decoder.count -= numCopied
      remaining -= numCopied
    }

    if (count && remaining > 0 && decoder.done) throw new RangeError(`cannot copy ${count} values`)
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
    this.firstRun = true
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
   * Resets the cursor position, so that the next read goes back to the
   * beginning of the buffer.
   */
  reset() {
    this.offset = 0
    this.lastValue = true
    this.firstRun = true
    this.count = 0
  }

  /**
   * Returns the next value in the sequence.
   */
  readValue() {
    if (this.done) return false
    while (this.count === 0) {
      this.count = this.readUint53()
      this.lastValue = !this.lastValue
      if (this.count === 0 && !this.firstRun) {
        throw new RangeError('Zero-length runs are not allowed')
      }
      this.firstRun = false
    }
    this.count -= 1
    return this.lastValue
  }

  /**
   * Discards the next `numSkip` values in the sequence.
   */
  skipValues(numSkip) {
    while (numSkip > 0 && !this.done) {
      if (this.count === 0) {
        this.count = this.readUint53()
        this.lastValue = !this.lastValue
        if (this.count === 0 && !this.firstRun) {
          throw new RangeError('Zero-length runs are not allowed')
        }
        this.firstRun = false
      }
      if (this.count < numSkip) {
        numSkip -= this.count
        this.count = 0
      } else {
        this.count -= numSkip
        numSkip = 0
      }
    }
  }
}

module.exports = {
  stringToUtf8, utf8ToString, hexStringToBytes, bytesToHexString,
  Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, BooleanEncoder, BooleanDecoder
}
