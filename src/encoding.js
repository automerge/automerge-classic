const leb = require('leb') // https://en.wikipedia.org/wiki/LEB128

// The TextEncoder API is provided natively by Chrome and Firefox, but not by Node.
// https://developer.mozilla.org/en-US/docs/Web/API/TextEncoder
//
// FIXME: The text-encoding package includes a file called encoding-indexes.js containing
// translation tables for various charsets. It's about 500 kB in size and we don't need it, since we
// only use UTF8 and no other encoding. It bloats the bundled webpack output so it would be good to
// omit it if possible. But I don't know how to configure webpack accordingly.
// Some discussion here: https://github.com/inexorabletash/text-encoding/issues/44
const { TextEncoder, TextDecoder } = require('text-encoding')
const UTF8Encoder = new TextEncoder()
const UTF8Decoder = new TextDecoder('utf-8')


// A byte array to which new data (also given as a byte array) can be appended.
// Dynamically grows the byte array as required.
class Encoder {
  constructor (valueEncoder) {
    this.valueEncoder = valueEncoder
    this.buf = new Uint8Array(16)
    this.offset = 0
  }

  write (data) {
    if (this.offset + data.byteLength >= this.buf.byteLength) {
      const newBuf = new Uint8Array(this.buf.byteLength * 4)
      newBuf.set(this.buf, 0)
      this.buf = newBuf
    }

    this.buf.set(data, this.offset)
    this.offset += data.byteLength
  }

  writeValue (value) {
    this.write(this.valueEncoder(value))
  }

  writeUInt32 (value) {
    this.write(leb.encodeUInt32(value))
  }

  writeInt32 (value) {
    this.write(leb.encodeInt32(value))
  }

  flush () {
  }
}


// Decodes data in a byte array into values.
class Decoder {
  constructor (valueDecoder, buf, length) {
    this.valueDecoder = valueDecoder
    this.buf = buf
    this.offset = 0
    this.length = (typeof length === 'number') ? length : buf.byteLength
  }

  hasMore () {
    return this.offset < this.length
  }

  readValue () {
    const { value, nextIndex } = this.valueDecoder(this.buf, this.offset)
    this.offset = nextIndex
    return value
  }

  readUInt32 () {
    const { value, nextIndex } = leb.decodeUInt32(this.buf, this.offset)
    this.offset = nextIndex
    return value
  }

  readInt32 () {
    const { value, nextIndex } = leb.decodeInt32(this.buf, this.offset)
    this.offset = nextIndex
    return value
  }
}


// A run-length encoder that compactly encodes repeated values; the function to encode a value is
// passed to the constructor. The encoding starts with a LEB128-encoded signed integer. If it is
// positive number n, the following value is repeated n times. If it is a negative number n, the
// following -n values each appear once.
class RLEEncoder extends Encoder {
  constructor (valueEncoder) {
    super(valueEncoder)
    this.values = []
    this.count = 0
  }

  writeValue (value) {
    if (this.values.length === 0) {
      this.values.push(value)
    }

    if (this.values[this.values.length - 1] === value) {
      // Value is repeated
      this.count += 1
      if (this.values.length > 1) {
        this.writeIndividualValues(this.values.splice(0, this.values.length - 1))
      }

    } else if (this.count === 1) {
      // Value is different from before, and previous value occurred only once
      this.values.push(value)

    } else {
      // Value is different from before, and previous value was repeated
      this.writeRepeatedValue()
      this.values[0] = value
      this.count = 1
    }
  }

  writeIndividualValues (values) {
    this.writeInt32(-values.length)
    for (const value of values) {
      super.writeValue(value)
    }
  }

  writeRepeatedValue () {
    if (this.values.length !== 1) {
      throw new Error('This should never happen')
    }
    this.writeInt32(this.count)
    super.writeValue(this.values[0])
  }

  flush () {
    if (this.count > 1) {
      this.writeRepeatedValue()
    } else if (this.values.length > 0) {
      this.writeIndividualValues(this.values)
    }
    this.values = []
    this.count = 0
  }
}


// Decodes data in a byte array encoded by RLEEncoder.
class RLEDecoder extends Decoder {
  constructor (valueDecoder, buf, length) {
    super(valueDecoder, buf, length)
    this.repeats = 0
    this.individuals = 0
  }

  hasMore () {
    return (this.repeats > 0) || (this.individuals > 0) || super.hasMore()
  }

  readValue () {
    if (this.repeats === 0 && this.individuals === 0) {
      const count = this.readInt32()
      if (count === 0) {
        throw new RangeError('Zero RLE count is not allowed')
      } else if (count > 0) {
        this.repeats = count
        this.lastValue = super.readValue()
      } else {
        this.individuals = -count
      }
    }

    if (this.repeats > 0) {
      this.repeats -= 1
      return this.lastValue
    }

    if (this.individuals > 0) {
      this.individuals -= 1
      return super.readValue()
    }
  }
}


// An encoder for numbers that tend to appear in incrementing sequences. For each value, it takes
// the difference to the previous value, and run-length encodes that sequence of differences.
class DeltaEncoder extends RLEEncoder {
  constructor () {
    super(leb.encodeInt32)
    this.lastInput = 0
  }

  writeValue (input) {
    super.writeValue(input - this.lastInput)
    this.lastInput = input
  }
}

// A decoder for data encoded by DeltaEncoder.
class DeltaDecoder extends RLEDecoder {
  constructor (buf, length) {
    super(leb.decodeInt32, buf, length)
    this.lastOutput = 0
  }

  readValue () {
    this.lastOutput += super.readValue()
    return this.lastOutput
  }
}


// An encoder for strings that uses two underlying encoders: one for the UTF8 character data, and
// one for the length of each string. This structure has the advantage that if most of the strings
// have a 1-byte UTF8 encoding, the underlying byte array is essentially just the concatenation of
// the strings, and the lengths are encoded very compactly (due to run-length encoding).
class StringEncoder {
  constructor () {
    this.strings = new Encoder()
    this.lengths = new RLEEncoder(leb.encodeUInt32)
  }

  writeValue (value) {
    const utf8 = UTF8Encoder.encode(value)
    this.strings.write(utf8)
    this.lengths.writeValue(utf8.byteLength)
  }

  flush () {
    this.strings.flush()
    this.lengths.flush()
  }
}

// A decoder for data encoded by StringEncoder.
class StringDecoder {
  constructor (stringsBuf, stringsLen, lengthsBuf, lengthsLen) {
    this.strings = new Decoder(null, stringsBuf, stringsLen)
    this.lengths = new RLEDecoder(leb.decodeUInt32, lengthsBuf, lengthsLen)
  }

  hasMore () {
    return this.lengths.hasMore()
  }

  readValue () {
    const length = this.lengths.readValue()
    const slice = this.strings.buf.subarray(this.strings.offset, this.strings.offset + length)
    this.strings.offset += length
    return UTF8Decoder.decode(slice)
  }
}


module.exports = {
  RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, StringEncoder, StringDecoder
}
