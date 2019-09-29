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
  utf8ToString = (buffer) => utf8decoder.end(buffer)

} else {
  // Could use a polyfill? e.g. https://github.com/anonyco/FastestSmallestTextEncoderDecoder
  throw new Error('Platform does not provide UTF-8 encoding/decoding feature')
}


/**
 * Encodes a nonnegative integer in a variable number of bytes using the LEB128
 * encoding scheme. https://en.wikipedia.org/wiki/LEB128
 */
function encodeLEB128(value, numBytes, buf, index) {
  for (let i = 0; i < numBytes; i++) {
    buf[index + i] = (value & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
    value >>>= 7 // NB. using zero-filling right shift
  }
}


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
  grow() {
    const newBuf = new Uint8Array(this.buf.byteLength * 4)
    newBuf.set(this.buf, 0)
    this.buf = newBuf
    return this
  }

  /**
   * Appends the contents of byte buffer `data` to the buffer.
   */
  append(data) {
    if (this.offset + data.byteLength >= this.buf.byteLength) this.grow()
    this.buf.set(data, this.offset)
    this.offset += data.byteLength
    return this
  }

  /**
   * Appends a LEB128-encoded unsigned integer to the buffer.
   */
  appendUint32(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < 0 || value > 0xffffffff) throw new RangeError('number out of range')

    const numBytes = Math.max(1, Math.ceil((32 - Math.clz32(value)) / 7))
    if (this.offset + numBytes >= this.buf.byteLength) this.grow()
    encodeLEB128(value, numBytes, this.buf, this.offset)
    this.offset += numBytes
    return this
  }

  /**
   * Appends a LEB128-encoded signed integer to the buffer.
   */
  appendInt32(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < -0x80000000 || value > 0x7fffffff) throw new RangeError('number out of range')

    if (value >= 0) {
      const numBytes = Math.ceil((33 - Math.clz32(value)) / 7)
      if (this.offset + numBytes >= this.buf.byteLength) this.grow()
      encodeLEB128(value, numBytes, this.buf, this.offset)
      this.offset += numBytes

    } else {
      const numBytes = Math.ceil((33 - Math.clz32(-value - 1)) / 7)
      if (this.offset + numBytes >= this.buf.byteLength) this.grow()

      for (let i = 0; i < numBytes; i++) {
        this.buf[this.offset + i] = (value & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
        value >>= 7 // NB. using sign-propagating right shift
      }
      this.offset += numBytes
    }
    return this
  }

  /**
   * Appends a UTF-8 string to the buffer, prefixed with its length in bytes
   * (where the length is encoded as an unsigned LEB128 integer).
   */
  appendPrefixedString(value) {
    if (typeof value !== 'string') throw new TypeError('value is not a string')
    const utf8 = stringToUtf8(value)
    this.appendUint32(utf8.byteLength)
    this.append(utf8)
    return this
  }

  finish() {
  }
}


class Decoder {
  constructor(buffer) {
    this.buf = buffer
    this.offset = 0
  }

  /**
   * Reads a LEB128-encoded unsigned integer from the current position in the buffer.
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
   * Reads a UTF-8 string from the current position in the buffer, prefixed with its
   * length in bytes (where the length is encoded as an unsigned LEB128 integer).
   */
  readPrefixedString() {
    const length = this.readUint32()
    if (this.offset + length > this.buf.byteLength) {
      throw new RangeError('buffer ended with incomplete string')
    }
    return utf8ToString(this.buf.subarray(this.offset, this.offset + length))
  }
}


module.exports = { Encoder, Decoder }
