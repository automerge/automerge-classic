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


module.exports = { Encoder }
