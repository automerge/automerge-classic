const { ROOT_ID, copyObject, parseOpId } = require('../src/common')

// Maybe we should be using the platform's built-in hash implementation?
// Node has the crypto module: https://nodejs.org/api/crypto.html and browsers have
// https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
// However, the WebCrypto API is asynchronous (returns promises), which would
// force all our APIs to become asynchronous as well, which would be annoying.
//
// I think on balance, it's safe enough to use a random library off npm:
// - We only need one hash function (not a full suite of crypto algorithms);
// - SHA256 is quite simple and has fairly few opportunities for subtle bugs
//   (compared to asymmetric cryptography anyway);
// - It does not need a secure source of random bits;
// - I have reviewed the source code and it seems pretty reasonable.
const { Hash } = require('fast-sha256')

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
 * Returns true if the two byte arrays contain the same data, false if not.
 */
function compareBytes(array1, array2) {
  if (array1.byteLength !== array2.byteLength) return false
  for (let i = 0; i < array1.byteLength; i++) {
    if (array1[i] !== array2[i]) return false
  }
  return true
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
   * Appends one byte (0 to 255) to the buffer.
   */
  appendByte(value) {
    if (this.offset >= this.buf.byteLength) this.grow()
    this.buf[this.offset] = value
    this.offset += 1
  }

  /**
   * Appends a LEB128-encoded unsigned integer to the buffer.
   */
  appendUint32(value) {
    if (!Number.isInteger(value)) throw new RangeError('value is not an integer')
    if (value < 0 || value > 0xffffffff) throw new RangeError('number out of range')

    const numBytes = Math.max(1, Math.ceil((32 - Math.clz32(value)) / 7))
    if (this.offset + numBytes > this.buf.byteLength) this.grow()
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
      if (this.offset + numBytes > this.buf.byteLength) this.grow()
      encodeLEB128(value, numBytes, this.buf, this.offset)
      this.offset += numBytes

    } else {
      const numBytes = Math.ceil((33 - Math.clz32(-value - 1)) / 7)
      if (this.offset + numBytes > this.buf.byteLength) this.grow()

      for (let i = 0; i < numBytes; i++) {
        this.buf[this.offset + i] = (value & 0x7f) | (i === numBytes - 1 ? 0x00 : 0x80)
        value >>= 7 // NB. using sign-propagating right shift
      }
      this.offset += numBytes
    }
    return this
  }

  /**
   * Appends the contents of byte buffer `data` to the buffer.
   */
  appendRawBytes(data) {
    if (this.offset + data.byteLength > this.buf.byteLength) this.grow()
    this.buf.set(data, this.offset)
    this.offset += data.byteLength
    return this
  }

  /**
   * Appends a UTF-8 string to the buffer, without any metadata. Returns the
   * number of bytes appended.
   */
  appendRawString(value) {
    if (typeof value !== 'string') throw new TypeError('value is not a string')
    const data = stringToUtf8(value)
    this.appendRawBytes(data)
    return data.byteLength
  }

  /**
   * Appends the contents of byte buffer `data` to the buffer, prefixed with the
   * number of bytes in the buffer (as a LEB128-encoded unsigned integer).
   */
  appendPrefixedBytes(data) {
    this.appendUint32(data.byteLength)
    return this.appendRawBytes(data)
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
   * Reads one byte (0 to 255) from the buffer.
   */
  readByte() {
    this.offset += 1
    return this.buf[this.offset - 1]
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
    return this.readRawBytes(this.readUint32())
  }

  /**
   * Reads a UTF-8 string from the current position in the buffer, prefixed with its
   * length in bytes (where the length is encoded as an unsigned LEB128 integer).
   */
  readPrefixedString() {
    return utf8ToString(this.readPrefixedBytes())
  }
}

/**
 * An encoder that uses run-length encoding to compress sequences of repeated
 * values. The constructor argument specifies the type of values, which may be
 * either 'int32', 'uint32', or 'utf8'. Besides valid values of the selected
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
  }

  /**
   * Appends a new value to the sequence.
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
      for (let v of this.literal) this.appendRawValue(v)
      this.literal = []
    }

    if (this.lastValue === null && this.count > 0) {
      this.appendInt32(0)
      this.appendUint32(this.count)
    } else if (this.count > 1) {
      this.appendInt32(this.count)
      this.appendRawValue(this.lastValue)
    }
    this.lastValue = value
    this.count = (value === undefined ? 0 : 1)
  }

  appendRawValue(value) {
    if (this.type === 'int32') {
      this.appendInt32(value)
    } else if (this.type === 'uint32') {
      this.appendUint32(value)
    } else if (this.type === 'utf8') {
      this.appendPrefixedString(value)
    } else {
      throw new RangeError(`Unknown RLEEncoder datatype: ${this.type}`)
    }
  }

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
   * Returns true if there is still data to be read at the current decoding
   * position, and false if we are at the end of the buffer.
   */
  get done() {
    return (this.count === 0) && (this.offset === this.buf.byteLength)
  }

  /**
   * Returns the next value (or null) in the sequence.
   */
  readValue() {
    if (this.count === 0) {
      this.count = this.readInt32()
      if (this.count > 0) {
        this.lastValue = this.readRawValue()
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
      return this.readRawValue()
    } else {
      return this.lastValue
    }
  }

  readRawValue() {
    if (this.type === 'int32') {
      return this.readInt32()
    } else if (this.type === 'uint32') {
      return this.readUint32()
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
    super('int32')
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
    super('int32', buffer)
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

// These bytes don't mean anything, they were generated randomly
const MAGIC_BYTES = Uint8Array.of(0x85, 0x6f, 0x4a, 0x83)
const CHANGE_COLUMNS = ['action', 'obj_ctr', 'obj_actor', 'key_ctr', 'key_actor', 'key_str',
  'insert', 'val_bytes', 'val_str', 'pred_num', 'pred_ctr', 'pred_actor'] // TODO add `child` column
const ACTIONS = ['set', 'del', 'inc', 'link', 'makeMap', 'makeList', 'makeText', 'makeTable']

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

/**
 * Encodes an array of operations in a set of columns. The operations need to
 * be parsed with `parseAllOpIds()` beforehand. Returns a map from column name
 * to Encoder object.
 */
function encodeOps(ops) {
  const action    = new RLEEncoder('uint32')
  const obj_ctr   = new RLEEncoder('uint32')
  const obj_actor = new RLEEncoder('uint32')
  const key_ctr   = new RLEEncoder('uint32')
  const key_actor = new RLEEncoder('uint32')
  const key_str   = new RLEEncoder('utf8')
  const insert    = new RLEEncoder('uint32') // perhaps make a bitmap type?
  const val_bytes = new RLEEncoder('uint32')
  const val_str   = new Encoder() // TODO: need to encode ints, floating-point, boolean
  const pred_num  = new RLEEncoder('uint32')
  const pred_ctr  = new RLEEncoder('uint32')
  const pred_actor = new RLEEncoder('uint32')

  for (let op of ops) {
    action.appendValue(ACTIONS.indexOf(op.action))

    if (op.obj.value === ROOT_ID) {
      obj_ctr.appendValue(null)
      obj_actor.appendValue(null)
    } else if (op.obj.actorNum >= 0 & op.obj.counter >= 0) {
      obj_ctr.appendValue(op.obj.counter)
      obj_actor.appendValue(op.obj.actorNum)
    } else {
      throw new RangeError(`Unexpected objectId reference: ${JSON.stringify(op.obj)}`)
    }

    if (op.key.value === '_head' && op.insert) {
      key_ctr.appendValue(0)
      key_actor.appendValue(0)
      key_str.appendValue(null)
    } else if (op.key.value) {
      key_ctr.appendValue(null)
      key_actor.appendValue(null)
      key_str.appendValue(op.key.value)
    } else {
      key_ctr.appendValue(op.key.counter)
      key_actor.appendValue(op.key.actorNum)
      key_str.appendValue(null)
    }

    insert.appendValue(op.insert ? 1 : 0)
    if (typeof op.value === 'string') {
      val_bytes.appendValue(val_str.appendRawString(op.value))
    } else {
      val_bytes.appendValue(0)
    }

    pred_num.appendValue(op.pred.length)
    for (let i = 0; i < op.pred.length; i++) {
      pred_ctr.appendValue(op.pred[i].counter)
      pred_actor.appendValue(op.pred[i].actorNum)
    }
  }
  return {action, obj_ctr, obj_actor, key_ctr, key_actor, key_str, insert, val_bytes, val_str, pred_num, pred_ctr, pred_actor}
}

/**
 * Decodes a set of columns (given as a map from column name to byte buffer)
 * into an array of operations. `actorIds` is a list of actors that appear in
 * the change; `actorIds[0]` is the actorId of the change's author.
 */
function decodeOps(columns, actorIds) {
  const action    = new RLEDecoder('uint32', columns.action)
  const obj_ctr   = new RLEDecoder('uint32', columns.obj_ctr)
  const obj_actor = new RLEDecoder('uint32', columns.obj_actor)
  const key_ctr   = new RLEDecoder('uint32', columns.key_ctr)
  const key_actor = new RLEDecoder('uint32', columns.key_actor)
  const key_str   = new RLEDecoder('utf8',   columns.key_str)
  const insert    = new RLEDecoder('uint32', columns.insert)
  const val_bytes = new RLEDecoder('uint32', columns.val_bytes)
  const val_str   = new Decoder(columns.val_str)
  const pred_num  = new RLEDecoder('uint32', columns.pred_num)
  const pred_ctr  = new RLEDecoder('uint32', columns.pred_ctr)
  const pred_actor = new RLEDecoder('uint32', columns.pred_actor)
  const ops = []

  while (!action.done) {
    let op = {action: ACTIONS[action.readValue()]}

    const obj = {counter: obj_ctr.readValue(), actorNum: obj_actor.readValue()}
    if (obj.counter === null && obj.actorNum === null) {
      op.obj = ROOT_ID
    } else if (obj.counter && obj.actorNum !== null && actorIds[obj.actorNum]) {
      op.obj = `${obj.counter}@${actorIds[obj.actorNum]}`
    } else {
      throw new RangeError(`Unexpected objectId reference: ${obj.counter}@${obj.actorNum}`)
    }

    const key = {counter: key_ctr.readValue(), actorNum: key_actor.readValue(), value: key_str.readValue()}
    if (key.value) {
      op.key = key.value
    } else if (key.counter === 0 && key.actorNum === 0) {
      op.key = '_head'
    } else if (key.counter && key.actorNum !== null && actorIds[key.actorNum]) {
      op.key = `${key.counter}@${actorIds[key.actorNum]}`
    } else {
      throw new RangeError(`Unexpected key: ${JSON.stringify(key)}`)
    }

    if (insert.readValue() === 1) op.insert = true
    const valBytes = val_bytes.readValue()
    if (valBytes > 0) op.value = val_str.readRawString(valBytes)

    const numPred = pred_num.readValue()
    op.pred = []
    for (let i = 0; i < numPred; i++) {
      const pred = {counter: pred_ctr.readValue(), actorNum: pred_actor.readValue()}
      op.pred.push(`${pred.counter}@${actorIds[pred.actorNum]}`)
    }
    ops.push(op)
  }
  return ops
}

function encodeColumns(encoder, columns) {
  let columnNum = 0
  for (let columnName of CHANGE_COLUMNS) {
    encoder.appendUint32(columnNum)
    encoder.appendPrefixedBytes(columns[columnName].buffer)
    columnNum += 1
  }
}

function decodeColumns(decoder) {
  let columns = {}
  while (!decoder.done) {
    const columnNum = decoder.readUint32(), columnBuf = decoder.readPrefixedBytes()
    if (CHANGE_COLUMNS[columnNum]) { // ignore unknown columns
      columns[CHANGE_COLUMNS[columnNum]] = columnBuf
    }
  }
  return columns
}

function encodeChangeHeader(encoder, change, actorIds) {
  encoder.appendPrefixedString(change.actor)
  encoder.appendUint32(change.seq)
  encoder.appendUint32(change.startOp)
  encoder.appendInt32(change.time)
  encoder.appendPrefixedString(change.message || '')
  encoder.appendUint32(actorIds.length)
  for (let actor of actorIds) encoder.appendPrefixedString(actor)
  const depsKeys = Object.keys(change.deps).sort()
  encoder.appendUint32(depsKeys.length)
  for (let actor of depsKeys) {
    encoder.appendUint32(actorIds.indexOf(actor) + 1)
    encoder.appendUint32(change.deps[actor])
  }
}

function decodeChangeHeader(decoder) {
  let change = {
    actor:   decoder.readPrefixedString(),
    seq:     decoder.readUint32(),
    startOp: decoder.readUint32(),
    time:    decoder.readInt32(),
    message: decoder.readPrefixedString(),
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

/**
 * Calls the `callback` with an encoder that should be used to encode the
 * contents of the container.
 */
function encodeContainerHeader(chunkType, callback) {
  const HASH_SIZE = 32 // size of SHA-256 hash
  const HEADER_SPACE = MAGIC_BYTES.byteLength + HASH_SIZE + 1 + 5 // 1 byte type + 5 bytes length
  const body = new Encoder()
  // Make space for the header at the beginning of the body buffer. We will
  // copy the header in here later. This is cheaper than copying the body since
  // the body is likely to be much larger than the header.
  body.appendRawBytes(new Uint8Array(HEADER_SPACE))
  callback(body)
  const bodyBuf = body.buffer

  const header = new Encoder()
  if (chunkType === 'document') {
    header.appendByte(0)
  } else if (chunkType === 'change') {
    header.appendByte(1)
  } else {
    throw new RangeError(`Unsupported chunk type: ${chunkType}`)
  }
  header.appendUint32(bodyBuf.byteLength - HEADER_SPACE)

  // Compute the hash over chunkType, length, and body
  const headerBuf = header.buffer
  const hash = new Hash()
  hash.update(headerBuf)
  hash.update(bodyBuf.subarray(HEADER_SPACE))

  // Copy header into the body buffer so that they are contiguous
  bodyBuf.set(MAGIC_BYTES,   HEADER_SPACE - headerBuf.byteLength - HASH_SIZE - MAGIC_BYTES.byteLength)
  bodyBuf.set(hash.digest(), HEADER_SPACE - headerBuf.byteLength - HASH_SIZE)
  bodyBuf.set(headerBuf,     HEADER_SPACE - headerBuf.byteLength)
  //console.log('hash: ', [...hash.digest()].map(x => `0x${x.toString(16)}`).join(', '))
  return bodyBuf.subarray(   HEADER_SPACE - headerBuf.byteLength - HASH_SIZE - MAGIC_BYTES.byteLength)
}

function decodeContainerHeader(decoder) {
  if (!compareBytes(decoder.readRawBytes(MAGIC_BYTES.byteLength), MAGIC_BYTES)) {
    throw new RangeError('Data does not begin with magic bytes 85 6f 4a 83')
  }
  const expectedHash = decoder.readRawBytes(32)
  const hashStartOffset = decoder.offset
  const chunkType = decoder.readByte()
  const chunkLength = decoder.readUint32()
  const chunkData = new Decoder(decoder.readRawBytes(chunkLength))
  const hash = new Hash()
  hash.update(decoder.buf.subarray(hashStartOffset, decoder.offset))
  if (!compareBytes(hash.digest(), expectedHash)) {
    throw new RangeError('Hash does not match data')
  }
  if (chunkType === 0) {
    // decode document
  } else if (chunkType === 1) {
    return decodeChangeHeader(chunkData)
  } else {
    console.log(`Warning: ignoring chunk with unknown type ${chunkType}`)
  }
}

function encodeChange(changeObj) {
  const { change, actorIds } = parseAllOpIds(changeObj)
  return encodeContainerHeader('change', encoder => {
    encodeChangeHeader(encoder, change, actorIds)
    encodeColumns(encoder, encodeOps(change.ops))
  })
}

function decodeChange(buffer) {
  const decoder = new Decoder(buffer), changes = []
  do {
    const change = decodeContainerHeader(decoder)
    if (change) changes.push(change)
  } while (!decoder.done)
  return changes
}

module.exports = { Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, encodeChange, decodeChange }
