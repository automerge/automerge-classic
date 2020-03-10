const { ROOT_ID, copyObject, parseOpId } = require('../src/common')
const { Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, BooleanEncoder, BooleanDecoder } = require('./encoding')

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

// These bytes don't mean anything, they were generated randomly
const MAGIC_BYTES = Uint8Array.of(0x85, 0x6f, 0x4a, 0x83)
const CHANGE_COLUMNS = ['action', 'obj_ctr', 'obj_actor', 'key_ctr', 'key_actor', 'key_str',
  'insert', 'val_bytes', 'val_str', 'pred_num', 'pred_ctr', 'pred_actor'] // TODO add `child` column
const ACTIONS = ['set', 'del', 'inc', 'link', 'makeMap', 'makeList', 'makeText', 'makeTable']

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

module.exports = { encodeChange, decodeChange }
