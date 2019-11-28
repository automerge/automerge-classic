const { ROOT_ID, copyObject, parseOpId } = require('../src/common')

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
 * Encodes a nonnegative integer in a variable number of bytes using the LEB128
 * encoding scheme. https://en.wikipedia.org/wiki/LEB128
 */
function encodeLEB128(value, numBytes, buf, index) {
  for (let i = 0; i < numBytes; i++) {
    buf[index + i] = (value & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
    value >>>= 7 // NB. using zero-filling right shift
  }
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
  grow() {
    const newBuf = new Uint8Array(this.buf.byteLength * 4)
    newBuf.set(this.buf, 0)
    this.buf = newBuf
    return this
  }

  /**
   * Appends the contents of byte buffer `data` to the buffer, prefixed with the
   * number of bytes in the buffer (as a LEB128-encoded unsigned integer).
   */
  appendBytes(data) {
    this.appendUint32(data.byteLength)
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
    this.appendBytes(stringToUtf8(value))
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
    this.buf = buffer
    this.offset = 0
  }

  /**
   * Returns true if there is still data to be read at the current decoding
   * position, and false if we are at the end of the buffer.
   */
  get done() {
    return this.offset === this.buf.byteLength
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
   * Extracts a subarray from the current position in the buffer, prefixed with
   * its length in bytes (encoded as an unsigned LEB128 integer).
   */
  readBytes() {
    const length = this.readUint32(), start = this.offset
    if (start + length > this.buf.byteLength) {
      throw new RangeError('subarray exceeds buffer size')
    }
    this.offset += length
    return this.buf.subarray(start, this.offset)
  }

  /**
   * Reads a UTF-8 string from the current position in the buffer, prefixed with its
   * length in bytes (where the length is encoded as an unsigned LEB128 integer).
   */
  readPrefixedString() {
    return utf8ToString(this.readBytes())
  }
}

/**
 * An encoder that uses run-length encoding to compress sequences of repeated
 * values. Values must be either signed or unsigned 32-bit integers (the
 * constructor argument specifies which type is used), or a null value that is
 * distinct from all of the integers.
 *
 * The encoded buffer starts with a LEB128-encoded signed integer, the
 * repetition count. The interpretation of the following values depends on this
 * repetition count:
 *   - If this number is a positive value n, the next LEB128-encoded integer in
 *     the buffer (signed or unsigned as specified) appears in the sequence
 *     repeated n times.
 *   - If the repetition count is a negative value -n, then the next n
 *     LEB128-encoded integers in the buffer are treated as a literal, i.e. they
 *     appear in the sequence without any further interpretation or repetition.
 *   - If the repetition count is zero, then the next LEB128-encoded integer in
 *     the buffer is an unsigned integer indicating the number of null values
 *     that appear at the current position in the sequence.
 *
 * After one of these three has completed, the process repeats, starting again
 * with a repetition count, until we reach the end of the buffer.
 */
class RLEEncoder extends Encoder {
  constructor(signed) {
    super()
    this.signed = signed
    this.lastValue = undefined
    this.count = 0
    this.literal = []
  }

  /**
   * Appends a new integer value to the sequence.
   */
  appendValue(value) {
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
      this.appendInt32(-this.literal.length)
      if (this.signed) {
        for (let v of this.literal) this.appendInt32(v)
      } else {
        for (let v of this.literal) this.appendUint32(v)
      }
      this.literal = []
    }

    if (this.lastValue === null && this.count > 0) {
      this.appendInt32(0)
      this.appendUint32(this.count)
    } else if (this.count > 1) {
      this.appendInt32(this.count)
      this.signed ? this.appendInt32(this.lastValue) : this.appendUint32(this.lastValue)
    }
    this.lastValue = value
    this.count = (value === undefined ? 0 : 1)
  }

  finish() {
    this.appendValue(undefined)
  }
}

/**
 * Counterpart to RLEEncoder: reads values from an RLE-compressed sequence of
 * numbers, returning repeated values as required.
 */
class RLEDecoder extends Decoder {
  constructor(signed, buffer) {
    super(buffer)
    this.signed = signed
    this.lastValue = undefined
    this.count = 0
    this.literal = false
  }

  /**
   * Returns true if there is still data to be read at the current decoding
   * position, and false if we are at the end of the buffer.
   */
  get done() {
    return (this.count === 0) && (this.offset === this.buf.byteLength)
  }

  /**
   * Returns the next integer (or null) value in the sequence.
   */
  readValue() {
    if (this.count === 0) {
      this.count = this.readInt32()
      if (this.count > 0) {
        this.lastValue = this.signed ? this.readInt32() : this.readUint32()
        this.literal = false
      } else if (this.count < 0) {
        this.count = -this.count
        this.literal = true
      } else { // this.count == 0
        this.count = this.readUint32()
        this.lastValue = null
        this.literal = false
      }
    }

    this.count -= 1
    if (this.literal) {
      return this.signed ? this.readInt32() : this.readUint32()
    } else {
      return this.lastValue
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
    super(true)
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
    super(true, buffer)
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
 * Parses a string of the form '12345@someActorId' into an object of the form
 * {counter: 12345, actorId: 'someActorId'}, and any other string into an object
 * of the form {value: 'originalString'}.
 */
function maybeParseOpId(value) {
  // FIXME when parsing the "key" of an operation, need to correctly handle
  // map property names that happen to contain an @ sign
  return (value.indexOf('@') >= 0) ? parseOpId(value) : {value}
}

/**
 * Maps an opId of the form {counter: 12345, actorId: 'someActorId'} to the form
 * {counter: 12345, actorNum: 123}, where the actorNum is zero for the actor
 * `ownActor`, and the (1-based) index into the `actorIds` array otherwise.
 */
function actorIdToActorNum(opId, ownActor, actorIds) {
  if (!opId.actorId) return opId
  const counter = opId.counter
  if (opId.actorId === ownActor) return {counter, actorNum: 0}
  const actorNum = actorIds.indexOf(opId.actorId) + 1
  if (actorNum === 0) throw new RangeError('missing actorId') // should not happen
  return {counter, actorNum}
}

/**
 * Returns an object `{change, actorIds}` where `change` is a copy of the argument
 * in which all string opIds have been replaced with `{counter, actorNum}` objects,
 * and where `actorIds` is a lexicographically sorted array of actor IDs occurring
 * in any of the operations, excluding the actorId of the change itself. An
 * `actorNum` value of zero indicates the actorId is the author of the change
 * itself, and an `actorNum` greater than zero is an index into the array of
 * actorIds (indexed starting from 1).
 */
function parseAllOpIds(change) {
  const actors = {}
  change = copyObject(change)
  for (let actor of Object.keys(change.deps)) actors[actor] = true
  change.ops = change.ops.map(op => {
    op = copyObject(op)
    op.obj = maybeParseOpId(op.obj)
    op.key = maybeParseOpId(op.key)
    if (op.obj.actorId) actors[op.obj.actorId] = true
    if (op.key.actorId) actors[op.key.actorId] = true
    op.pred = op.pred.map(parseOpId)
    for (let pred of op.pred) actors[pred.actorId] = true
    return op
  })
  const actorIds = Object.keys(actors).filter(actor => actor !== change.actor).sort()
  for (let op of change.ops) {
    op.obj = actorIdToActorNum(op.obj, change.actor, actorIds)
    op.key = actorIdToActorNum(op.key, change.actor, actorIds)
    op.pred = op.pred.map(pred => actorIdToActorNum(pred, change.actor, actorIds))
  }
  return {change, actorIds}
}

function encodeOps(ops) {
  const obj_ctr   = new RLEEncoder(false)
  const obj_actor = new RLEEncoder(false)
  for (let op of ops) {
    if (op.obj.value === ROOT_ID) {
      obj_ctr.appendValue(null)
      obj_actor.appendValue(null)
    } else if (op.obj.actorNum >= 0 & op.obj.counter >= 0) {
      obj_ctr.appendValue(op.obj.counter)
      obj_actor.appendValue(op.obj.actorNum)
    } else {
      throw new RangeError(`Unexpected objectId reference: ${JSON.stringify(op.obj)}`)
    }
  }
  return { obj_ctr, obj_actor }
}

function decodeOps(columns, actorIds) {
  const obj_ctr   = new RLEDecoder(false, columns.obj_ctr)
  const obj_actor = new RLEDecoder(false, columns.obj_actor)
  let ops = []
  while (!obj_ctr.done) {
    let op = {}
    const obj = {counter: obj_ctr.readValue(), actorNum: obj_actor.readValue()}
    if (obj.counter === null && obj.actorNum === null) {
      op.obj = ROOT_ID
    } else if (obj.counter !== null && obj.counter >= 0 && obj.actorNum !== null && actorIds[obj.actorNum]) {
      op.obj = `${obj.counter}@${actorIds[obj.actorNum]}`
    } else {
      throw new RangeError(`Unexpected objectId reference: ${obj.counter}@${obj.actorNum}`)
    }
    ops.push(op)
  }
  return ops
}

const CHANGE_COLUMNS = ['obj_ctr', 'obj_actor']

function encodeColumns(encoder, columns) {
  let columnNum = 0
  for (let columnName of CHANGE_COLUMNS) {
    encoder.appendUint32(columnNum)
    encoder.appendBytes(columns[columnName].buffer)
    columnNum += 1
  }
}

function decodeColumns(decoder) {
  let columns = {}
  while (!decoder.done) {
    const columnNum = decoder.readUint32(), columnBuf = decoder.readBytes()
    if (CHANGE_COLUMNS[columnNum]) { // ignore unknown columns
      columns[CHANGE_COLUMNS[columnNum]] = columnBuf
    }
  }
  return columns
}

function encodeChange(changeObj) {
  const { change, actorIds } = parseAllOpIds(changeObj)
  const encoder = new Encoder()
  encoder.appendUint32(1) // version
  encoder.appendPrefixedString(change.actor)
  encoder.appendUint32(change.seq)
  encoder.appendUint32(change.startOp)
  encoder.appendUint32(actorIds.length)
  for (let actor of actorIds) encoder.appendPrefixedString(actor)
  const depsKeys = Object.keys(change.deps).sort()
  encoder.appendUint32(depsKeys.length)
  for (let actor of depsKeys) {
    encoder.appendUint32(actorIds.indexOf(actor) + 1)
    encoder.appendUint32(change.deps[actor])
  }
  encodeColumns(encoder, encodeOps(change.ops))
  return encoder.buffer
}

function decodeChange(buffer) {
  const decoder = new Decoder(buffer)
  const version = decoder.readUint32()
  if (version !== 1) throw new RangeError(`Unsupported change version: ${version}`)
  let change = {
    actor:   decoder.readPrefixedString(),
    seq:     decoder.readUint32(),
    startOp: decoder.readUint32(),
    deps: {}
  }
  const actorIds = [change.actor], numActorIds = decoder.readUint32()
  for (let i = 0; i < numActorIds; i++) actorIds.push(decoder.readPrefixedString())
  const numDeps = decoder.readUint32()
  for (let i = 0; i < numDeps; i++) {
    change.deps[actorIds[decoder.readUint32()]] = decoder.readUint32()
  }
  change.ops = decodeOps(decodeColumns(decoder), actorIds)
  return change
}

module.exports = { Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, encodeChange, decodeChange }
