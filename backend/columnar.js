const { ROOT_ID, copyObject, parseOpId, equalBytes } = require('../src/common')
const {
  hexStringToBytes, bytesToHexString,
  Encoder, Decoder, RLEEncoder, RLEDecoder, DeltaEncoder, DeltaDecoder, BooleanEncoder, BooleanDecoder
} = require('./encoding')

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
// - It does not need a secure source of random bits and does not need to be
//   constant-time;
// - I have reviewed the source code and it seems pretty reasonable.
const { Hash } = require('fast-sha256')

// These bytes don't mean anything, they were generated randomly
const MAGIC_BYTES = Uint8Array.of(0x85, 0x6f, 0x4a, 0x83)

const COLUMN_TYPE = {
  GROUP_CARD: 0, ACTOR_ID: 1, INT_RLE: 2, INT_DELTA: 3, BOOLEAN: 4,
  STRING_RLE: 5, VALUE_LEN: 6, VALUE_RAW: 7
}

const VALUE_TYPE = {
  NULL: 0, FALSE: 1, TRUE: 2, LEB128_UINT: 3, LEB128_INT: 4, IEEE754: 5,
  UTF8: 6, BYTES: 7, COUNTER: 8, TIMESTAMP: 9, MIN_UNKNOWN: 10, MAX_UNKNOWN: 15
}

// make* actions must be at even-numbered indexes in this list
const ACTIONS = ['makeMap', 'set', 'makeList', 'del', 'makeText', 'inc', 'makeTable', 'link']

const CHANGE_COLUMNS = {
  objActor:  0 << 3 | COLUMN_TYPE.ACTOR_ID,
  objCtr:    0 << 3 | COLUMN_TYPE.INT_RLE,
  keyActor:  1 << 3 | COLUMN_TYPE.ACTOR_ID,
  keyCtr:    1 << 3 | COLUMN_TYPE.INT_DELTA,
  keyStr:    1 << 3 | COLUMN_TYPE.STRING_RLE,
  idActor:   2 << 3 | COLUMN_TYPE.ACTOR_ID,
  idCtr:     2 << 3 | COLUMN_TYPE.INT_DELTA,
  insert:    3 << 3 | COLUMN_TYPE.BOOLEAN,
  action:    4 << 3 | COLUMN_TYPE.INT_RLE,
  valLen:    5 << 3 | COLUMN_TYPE.VALUE_LEN,
  valRaw:    5 << 3 | COLUMN_TYPE.VALUE_RAW,
  chldActor: 6 << 3 | COLUMN_TYPE.ACTOR_ID,
  chldCtr:   6 << 3 | COLUMN_TYPE.INT_DELTA,
  predNum:   7 << 3 | COLUMN_TYPE.GROUP_CARD,
  predActor: 7 << 3 | COLUMN_TYPE.ACTOR_ID,
  predCtr:   7 << 3 | COLUMN_TYPE.INT_DELTA,
  succNum:   8 << 3 | COLUMN_TYPE.GROUP_CARD,
  succActor: 8 << 3 | COLUMN_TYPE.ACTOR_ID,
  succCtr:   8 << 3 | COLUMN_TYPE.INT_DELTA
}

const DOCUMENT_COLUMNS = {
  actor:     0 << 3 | COLUMN_TYPE.ACTOR_ID,
  seq:       0 << 3 | COLUMN_TYPE.INT_DELTA,
  maxOp:     1 << 3 | COLUMN_TYPE.INT_DELTA,
  time:      2 << 3 | COLUMN_TYPE.INT_DELTA,
  message:   3 << 3 | COLUMN_TYPE.STRING_RLE,
  depsNum:   4 << 3 | COLUMN_TYPE.GROUP_CARD,
  depsIndex: 4 << 3 | COLUMN_TYPE.INT_DELTA
}

/**
 * Parses a string of the form '12345@someActorId' into an object of the form
 * {counter: 12345, actorId: 'someActorId'}, and any other string into an object
 * of the form {value: 'originalString'}.
 */
function maybeParseOpId(value) {
  if (value === undefined) return {}
  // FIXME when parsing the "key" of an operation, need to correctly handle
  // map property names that happen to contain an @ sign
  return (value.indexOf('@') >= 0) ? parseOpId(value) : {value}
}

/**
 * Maps an opId of the form {counter: 12345, actorId: 'someActorId'} to the form
 * {counter: 12345, actorNum: 123, actorId: 'someActorId'}, where the actorNum
 * is the index into the `actorIds` array.
 */
function actorIdToActorNum(opId, actorIds) {
  if (!opId.actorId) return opId
  const counter = opId.counter
  const actorNum = actorIds.indexOf(opId.actorId)
  if (actorNum < 0) throw new RangeError('missing actorId') // should not happen
  return {counter, actorNum, actorId: opId.actorId}
}

/**
 * Takes `changes`, an array of changes (represented as JS objects). Returns an
 * object `{changes, actorIds}`, where `changes` is a copy of the argument in
 * which all string opIds have been replaced with `{counter, actorNum}` objects,
 * and where `actorIds` is a lexicographically sorted array of actor IDs occurring
 * in any of the operations. `actorNum` is an index into that array of actorIds.
 * If `single` is true, the actorId of the author of the change is moved to the
 * beginning of the array of actorIds, so that `actorNum` is zero when referencing
 * the author of the change itself. This special-casing is omitted if `single` is
 * false.
 */
function parseAllOpIds(changes, single) {
  const actors = {}, newChanges = []
  for (let change of changes) {
    change = copyObject(change)
    actors[change.actor] = true
    change.ops = change.ops.map(op => {
      op = copyObject(op)
      op.obj = maybeParseOpId(op.obj)
      op.key = maybeParseOpId(op.key)
      op.child = maybeParseOpId(op.child)
      if (op.pred) op.pred = op.pred.map(parseOpId)
      if (op.obj.actorId) actors[op.obj.actorId] = true
      if (op.key.actorId) actors[op.key.actorId] = true
      if (op.child.actorId) actors[op.child.actorId] = true
      for (let pred of op.pred) actors[pred.actorId] = true
      return op
    })
    newChanges.push(change)
  }

  let actorIds = Object.keys(actors).sort()
  if (single) {
    actorIds = [changes[0].actor].concat(actorIds.filter(actor => actor !== changes[0].actor))
  }
  for (let change of newChanges) {
    change.actorNum = actorIds.indexOf(change.actor)
    for (let i = 0; i < change.ops.length; i++) {
      let op = change.ops[i]
      op.id = {counter: change.startOp + i, actorNum: change.actorNum, actorId: change.actor}
      op.obj = actorIdToActorNum(op.obj, actorIds)
      op.key = actorIdToActorNum(op.key, actorIds)
      op.child = actorIdToActorNum(op.child, actorIds)
      op.pred = op.pred.map(pred => actorIdToActorNum(pred, actorIds))
    }
  }
  return {changes: newChanges, actorIds}
}

/**
 * Encodes the `obj` property of operation `op` into the two columns
 * `objActor` and `objCtr`.
 */
function encodeObjectId(op, columns) {
  if (op.obj.value === ROOT_ID) {
    columns.objActor.appendValue(null)
    columns.objCtr.appendValue(null)
  } else if (op.obj.actorNum >= 0 && op.obj.counter > 0) {
    columns.objActor.appendValue(op.obj.actorNum)
    columns.objCtr.appendValue(op.obj.counter)
  } else {
    throw new RangeError(`Unexpected objectId reference: ${JSON.stringify(op.obj)}`)
  }
}

/**
 * Encodes the `key` property of operation `op` into the three columns
 * `keyActor`, `keyCtr`, and `keyStr`.
 */
function encodeOperationKey(op, columns) {
  if (op.key.value === '_head' && op.insert) {
    columns.keyActor.appendValue(0)
    columns.keyCtr.appendValue(0)
    columns.keyStr.appendValue(null)
  } else if (op.key.value) {
    columns.keyActor.appendValue(null)
    columns.keyCtr.appendValue(null)
    columns.keyStr.appendValue(op.key.value)
  } else if (op.key.actorNum >= 0 && op.key.counter > 0) {
    columns.keyActor.appendValue(op.key.actorNum)
    columns.keyCtr.appendValue(op.key.counter)
    columns.keyStr.appendValue(null)
  } else {
    throw new RangeError(`Unexpected operation key: ${JSON.stringify(op.key)}`)
  }
}

/**
 * Encodes the `action` property of operation `op` into the `action` column.
 */
function encodeOperationAction(op, columns) {
  const actionCode = ACTIONS.indexOf(op.action)
  if (actionCode >= 0) {
    columns.action.appendValue(actionCode)
  } else if (typeof op.action === 'number') {
    columns.action.appendValue(op.action)
  } else {
    throw new RangeError(`Unexpected operation action: ${op.action}`)
  }
}

/**
 * Encodes the integer `value` into the two columns `valLen` and `valRaw`,
 * with the datatype tag set to `typeTag`. If `typeTag` is zero, it is set
 * automatically to signed or unsigned depending on the sign of the value.
 * Values with non-zero type tags are always encoded as signed integers.
 */
function encodeInteger(value, typeTag, columns) {
  let numBytes
  if (value < 0 || typeTag > 0) {
    numBytes = columns.valRaw.appendInt53(value)
    if (!typeTag) typeTag = VALUE_TYPE.LEB128_INT
  } else {
    numBytes = columns.valRaw.appendUint53(value)
    typeTag = VALUE_TYPE.LEB128_UINT
  }
  columns.valLen.appendValue(numBytes << 4 | typeTag)
}

/**
 * Encodes the `value` property of operation `op` into the two columns
 * `valLen` and `valRaw`.
 */
function encodeValue(op, columns) {
  if ((op.action !== 'set' && op.action !== 'inc') || op.value === null) {
    columns.valLen.appendValue(VALUE_TYPE.NULL)
  } else if (op.value === false) {
    columns.valLen.appendValue(VALUE_TYPE.FALSE)
  } else if (op.value === true) {
    columns.valLen.appendValue(VALUE_TYPE.TRUE)
  } else if (typeof op.value === 'string') {
    const numBytes = columns.valRaw.appendRawString(op.value)
    columns.valLen.appendValue(numBytes << 4 | VALUE_TYPE.UTF8)
  } else if (ArrayBuffer.isView(op.value)) {
    const numBytes = columns.valRaw.appendRawBytes(new Uint8Array(op.value.buffer))
    columns.valLen.appendValue(numBytes << 4 | VALUE_TYPE.BYTES)
  } else if (op.datatype === 'counter' && typeof op.value === 'number') {
    encodeInteger(op.value, VALUE_TYPE.COUNTER, columns)
  } else if (op.datatype === 'timestamp' && typeof op.value === 'number') {
    encodeInteger(op.value, VALUE_TYPE.TIMESTAMP, columns)
  } else if (typeof op.datatype === 'number' && op.datatype >= VALUE_TYPE.MIN_UNKNOWN &&
             op.datatype <= VALUE_TYPE.MAX_UNKNOWN && op.value instanceof Uint8Array) {
    const numBytes = columns.valRaw.appendRawBytes(op.value)
    columns.valLen.appendValue(numBytes << 4 | op.datatype)
  } else if (op.datatype) {
      throw new RangeError(`Unknown datatype ${op.datatype} for value ${op.value}`)
  } else if (typeof op.value === 'number') {
    if (Number.isInteger(op.value) && op.value <= Number.MAX_SAFE_INTEGER && op.value >= Number.MIN_SAFE_INTEGER) {
      encodeInteger(op.value, 0, columns)
    } else {
      // Encode number in 32-bit float if this can be done without loss of precision
      const buf32 = new ArrayBuffer(4), view32 = new DataView(buf32)
      view32.setFloat32(0, op.value, true) // true means little-endian
      if (view32.getFloat32(0, true) === op.value) {
        columns.valRaw.appendRawBytes(new Uint8Array(buf32))
        columns.valLen.appendValue(4 << 4 | VALUE_TYPE.IEEE754)
      } else {
        const buf64 = new ArrayBuffer(8), view64 = new DataView(buf64)
        view64.setFloat64(0, op.value, true) // true means little-endian
        columns.valRaw.appendRawBytes(new Uint8Array(buf64))
        columns.valLen.appendValue(8 << 4 | VALUE_TYPE.IEEE754)
      }
    }
  } else {
    throw new RangeError(`Unsupported value in operation: ${op.value}`)
  }
}

/**
 * Given decoders for two columns with type tags VALUE_LEN and VALUE_RAW respectively,
 * reads one value from those columns. Returns an object of the form
 * `{value: value, datatype: datatypeTag}`.
 */
function decodeValue(lenColumn, rawColumn) {
  const sizeTag = lenColumn.readValue()
  if (sizeTag === VALUE_TYPE.NULL) {
    return {value: null}
  } else if (sizeTag === VALUE_TYPE.FALSE) {
    return {value: false}
  } else if (sizeTag === VALUE_TYPE.TRUE) {
    return {value: true}
  } else if (sizeTag % 16 === VALUE_TYPE.UTF8) {
    return {value: rawColumn.readRawString(sizeTag >> 4)}
  } else {
    const bytes = rawColumn.readRawBytes(sizeTag >> 4), valDecoder = new Decoder(bytes)
    if (sizeTag % 16 === VALUE_TYPE.LEB128_UINT) {
      return {value: valDecoder.readUint53()}
    } else if (sizeTag % 16 === VALUE_TYPE.LEB128_INT) {
      return {value: valDecoder.readInt53()}
    } else if (sizeTag % 16 === VALUE_TYPE.IEEE754) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (bytes.byteLength === 4) {
        return {value: view.getFloat32(0, true)} // true means little-endian
      } else if (bytes.byteLength === 8) {
        return {value: view.getFloat64(0, true)}
      } else {
        throw new RangeError(`Invalid length for floating point number: ${bytes.byteLength}`)
      }
    } else if (sizeTag % 16 === VALUE_TYPE.COUNTER) {
      return {value: valDecoder.readInt53(), datatype: 'counter'}
    } else if (sizeTag % 16 === VALUE_TYPE.TIMESTAMP) {
      return {value: valDecoder.readInt53(), datatype: 'timestamp'}
    } else {
      return {value: bytes, datatype: sizeTag % 16}
    }
  }
}

/**
 * Reads one value from the column `columns[colIndex]` and interprets it based
 * on the column type. `actorIds` is a list of actors that appear in the change;
 * `actorIds[0]` is the actorId of the change's author. Mutates the `result`
 * object with the value, and returns the number of columns processed (this is 2
 * in the case of a pair of VALUE_LEN and VALUE_RAW columns, which are processed
 * in one go).
 */
function decodeValueColumns(columns, colIndex, actorIds, result) {
  const { columnId, columnName, decoder } = columns[colIndex]
  if (columnId % 8 === COLUMN_TYPE.VALUE_LEN && colIndex + 1 < columns.length &&
      columns[colIndex + 1].columnId === columnId + 1) {
    const { value, datatype } = decodeValue(decoder, columns[colIndex + 1].decoder)
    result[columnName] = value
    if (datatype) result[columnName + '_datatype'] = datatype
    return 2
  } else if (columnId % 8 === COLUMN_TYPE.ACTOR_ID) {
    const actorNum = decoder.readValue()
    if (actorNum === null) {
      result[columnName] = null
    } else {
      if (!actorIds[actorNum]) throw new RangeError(`No actor index ${actorNum}`)
      result[columnName] = actorIds[actorNum]
    }
  } else {
    result[columnName] = decoder.readValue()
  }
  return 1
}

/**
 * Encodes an array of operations in a set of columns. The operations need to
 * be parsed with `parseAllOpIds()` beforehand. If `forDocument` is true, we use
 * the column structure of a whole document, otherwise we use the column
 * structure for an individual change. Returns a map from column name
 * to Encoder object.
 */
function encodeOps(ops, forDocument) {
  const columns = {
    objActor  : new RLEEncoder('uint'),
    objCtr    : new RLEEncoder('uint'),
    keyActor  : new RLEEncoder('uint'),
    keyCtr    : new DeltaEncoder(),
    keyStr    : new RLEEncoder('utf8'),
    insert    : new BooleanEncoder(),
    action    : new RLEEncoder('uint'),
    valLen    : new RLEEncoder('uint'),
    valRaw    : new Encoder(),
    chldActor : new RLEEncoder('uint'),
    chldCtr   : new DeltaEncoder()
  }

  if (forDocument) {
    columns.idActor   = new RLEEncoder('uint')
    columns.idCtr     = new DeltaEncoder()
    columns.succNum   = new RLEEncoder('uint')
    columns.succActor = new RLEEncoder('uint')
    columns.succCtr   = new DeltaEncoder()
  } else {
    columns.predNum   = new RLEEncoder('uint')
    columns.predCtr   = new DeltaEncoder()
    columns.predActor = new RLEEncoder('uint')
  }

  for (let op of ops) {
    encodeObjectId(op, columns)
    encodeOperationKey(op, columns)
    columns.insert.appendValue(!!op.insert)
    encodeOperationAction(op, columns)
    encodeValue(op, columns)

    if (op.child.counter) {
      columns.chldActor.appendValue(op.child.actorNum)
      columns.chldCtr.appendValue(op.child.counter)
    } else {
      columns.chldActor.appendValue(null)
      columns.chldCtr.appendValue(null)
    }

    if (forDocument) {
      columns.idActor.appendValue(op.id.actorNum)
      columns.idCtr.appendValue(op.id.counter)
      columns.succNum.appendValue(op.succ.length)
      for (let i = 0; i < op.succ.length; i++) {
        columns.succActor.appendValue(op.succ[i].actorNum)
        columns.succCtr.appendValue(op.succ[i].counter)
      }
    } else {
      columns.predNum.appendValue(op.pred.length)
      for (let i = 0; i < op.pred.length; i++) {
        columns.predActor.appendValue(op.pred[i].actorNum)
        columns.predCtr.appendValue(op.pred[i].counter)
      }
    }
  }

  let columnList = []
  for (let [name, id] of Object.entries(CHANGE_COLUMNS)) {
    if (columns[name]) columnList.push({id, name, encoder: columns[name]})
  }
  return columnList.sort((a, b) => a.id - b.id)
}

/**
 * Takes a change as decoded by `decodeColumns`, and changes it into the form
 * expected by the rest of the backend. If `forDocument` is true, we use the op
 * structure of a whole document, otherwise we use the op structure for an
 * individual change.
 */
function decodeOps(ops, forDocument) {
  const newOps = []
  for (let op of ops) {
    const newOp = {
      obj: op.objCtr === null ? ROOT_ID : `${op.objCtr}@${op.objActor}`,
      key: op.keyCtr === 0 ? '_head' : (op.keyStr || `${op.keyCtr}@${op.keyActor}`),
      action: ACTIONS[op.action] || op.action
    }
    newOp.insert = !!op.insert
    if (ACTIONS[op.action] === 'set' || ACTIONS[op.action] === 'inc') {
      newOp.value = op.valLen
      if (op.valLen_datatype) newOp.datatype = op.valLen_datatype
    }
    if (!!op.chldCtr !== !!op.chldActor) {
      throw new RangeError(`Mismatched child columns: ${op.chldCtr} and ${op.chldActor}`)
    }
    if (op.chldCtr !== null) newOp.child = `${op.chldCtr}@${op.chldActor}`
    if (forDocument) {
      newOp.id = `${op.idCtr}@${op.idActor}`
      newOp.succ = op.succNum.map(succ => `${succ.succCtr}@${succ.succActor}`)
    } else {
      newOp.pred = op.predNum.map(pred => `${pred.predCtr}@${pred.predActor}`)
    }
    newOps.push(newOp)
  }
  return newOps
}

function decoderByColumnId(columnId, buffer) {
  if ((columnId & 7) === COLUMN_TYPE.INT_DELTA) {
    return new DeltaDecoder(buffer)
  } else if ((columnId & 7) === COLUMN_TYPE.BOOLEAN) {
    return new BooleanDecoder(buffer)
  } else if ((columnId & 7) === COLUMN_TYPE.STRING_RLE) {
    return new RLEDecoder('utf8', buffer)
  } else if ((columnId & 7) === COLUMN_TYPE.VALUE_RAW) {
    return new Decoder(buffer)
  } else {
    return new RLEDecoder('uint', buffer)
  }
}

function makeDecoders(columns, columnSpec) {
  // By default, every column decodes an empty byte array
  const emptyBuf = Uint8Array.of(), decoders = {}
  for (let [columnName, columnId] of Object.entries(columnSpec)) {
    decoders[columnId] = decoderByColumnId(columnId, emptyBuf)
  }
  for (let column of columns) {
    decoders[column.columnId] = decoderByColumnId(column.columnId, column.buffer)
  }

  let result = []
  for (let columnId of Object.keys(decoders).map(id => parseInt(id)).sort((a, b) => a - b)) {
    let [columnName, _] = Object.entries(columnSpec).find(([name, id]) => id === columnId)
    if (!columnName) columnName = columnId.toString()
    result.push({columnId, columnName, decoder: decoders[columnId]})
  }
  return result
}

function decodeColumns(columns, actorIds, columnSpec) {
  columns = makeDecoders(columns, columnSpec)
  let parsedRows = []
  while (columns.some(col => !col.decoder.done)) {
    let row = {}, col = 0
    while (col < columns.length) {
      const columnId = columns[col].columnId
      let groupId = columnId >> 3, groupCols = 1
      while (col + groupCols < columns.length && columns[col + groupCols].columnId >> 3 === groupId) {
        groupCols++
      }

      if (columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
        const values = [], count = columns[col].decoder.readValue()
        for (let i = 0; i < count; i++) {
          let value = {}
          for (let colOffset = 1; colOffset < groupCols; colOffset++) {
            decodeValueColumns(columns, col + colOffset, actorIds, value)
          }
          values.push(value)
        }
        row[columns[col].columnName] = values
        col += groupCols
      } else {
        col += decodeValueColumns(columns, col, actorIds, row)
      }
    }
    parsedRows.push(row)
  }
  return parsedRows
}

function readColumns(decoder, numColumns = Number.MAX_SAFE_INTEGER) {
  let lastColumnId = -1, columns = []
  while (!decoder.done && columns.length < numColumns) {
    const columnId = decoder.readUint32()
    const columnBuf = decoder.readPrefixedBytes()
    if (columnId <= lastColumnId) throw new RangeError('Columns must be in ascending order')
    lastColumnId = columnId
    columns.push({columnId, buffer: columnBuf})
  }
  return columns
}

function decodeChangeHeader(decoder) {
  let change = {
    actor:   decoder.readHexString(),
    seq:     decoder.readUint53(),
    startOp: decoder.readUint53(),
    time:    decoder.readInt53(),
    message: decoder.readPrefixedString(),
    deps: []
  }
  const actorIds = [change.actor], numActorIds = decoder.readUint53()
  for (let i = 0; i < numActorIds; i++) actorIds.push(decoder.readHexString())
  const numDeps = decoder.readUint53()
  for (let i = 0; i < numDeps; i++) {
    change.deps.push(bytesToHexString(decoder.readRawBytes(32)))
  }
  change.actorIds = actorIds
  return change
}

/**
 * Assembles a chunk of encoded data containing a checksum, headers, and a
 * series of encoded columns. Calls `encodeHeaderCallback` with an encoder that
 * should be used to add the headers. The columns should be given as `columns`.
 */
function encodeContainer(chunkType, columns, encodeHeaderCallback) {
  const CHECKSUM_SIZE = 4 // checksum is first 4 bytes of SHA-256 hash of the rest of the data
  const HEADER_SPACE = MAGIC_BYTES.byteLength + CHECKSUM_SIZE + 1 + 5 // 1 byte type + 5 bytes length
  const body = new Encoder()
  // Make space for the header at the beginning of the body buffer. We will
  // copy the header in here later. This is cheaper than copying the body since
  // the body is likely to be much larger than the header.
  body.appendRawBytes(new Uint8Array(HEADER_SPACE))
  encodeHeaderCallback(body)

  for (let column of columns) {
    const buffer = column.encoder.buffer
    if (!column.encoder.onlyNulls && buffer.byteLength > 0) {
      //if (chunkType === 'document') console.log(`${column.name} column: ${buffer.byteLength} bytes`)
      body.appendUint53(column.id)
      body.appendPrefixedBytes(buffer)
    }
  }

  const bodyBuf = body.buffer
  const header = new Encoder()
  if (chunkType === 'document') {
    header.appendByte(0)
  } else if (chunkType === 'change') {
    header.appendByte(1)
  } else {
    throw new RangeError(`Unsupported chunk type: ${chunkType}`)
  }
  header.appendUint53(bodyBuf.byteLength - HEADER_SPACE)

  // Compute the hash over chunkType, length, and body
  const headerBuf = header.buffer
  const sha256 = new Hash()
  sha256.update(headerBuf)
  sha256.update(bodyBuf.subarray(HEADER_SPACE))
  const hash = sha256.digest(), checksum = hash.subarray(0, CHECKSUM_SIZE)

  // Copy header into the body buffer so that they are contiguous
  bodyBuf.set(MAGIC_BYTES, HEADER_SPACE - headerBuf.byteLength - CHECKSUM_SIZE - MAGIC_BYTES.byteLength)
  bodyBuf.set(checksum,    HEADER_SPACE - headerBuf.byteLength - CHECKSUM_SIZE)
  bodyBuf.set(headerBuf,   HEADER_SPACE - headerBuf.byteLength)
  //console.log('checksum: ', [...checksum].map(x => `0x${('0' + x.toString(16)).slice(-2)}`).join(', '))
  return {hash, bytes: bodyBuf.subarray( HEADER_SPACE - headerBuf.byteLength - CHECKSUM_SIZE - MAGIC_BYTES.byteLength)}
}

function decodeContainerHeader(decoder, computeHash) {
  if (!equalBytes(decoder.readRawBytes(MAGIC_BYTES.byteLength), MAGIC_BYTES)) {
    throw new RangeError('Data does not begin with magic bytes 85 6f 4a 83')
  }
  const expectedHash = decoder.readRawBytes(4)
  const hashStartOffset = decoder.offset
  const chunkType = decoder.readByte()
  const chunkLength = decoder.readUint53()
  const header = {chunkType, chunkLength, chunkData: decoder.readRawBytes(chunkLength)}

  if (computeHash) {
    const sha256 = new Hash()
    sha256.update(decoder.buf.subarray(hashStartOffset, decoder.offset))
    const binaryHash = sha256.digest()
    if (!equalBytes(binaryHash.subarray(0, 4), expectedHash)) {
      throw new RangeError('checksum does not match data')
    }
    header.hash = bytesToHexString(binaryHash)
  }
  return header
}

function encodeChange(changeObj) {
  const { changes, actorIds } = parseAllOpIds([changeObj], true)
  const change = changes[0]

  const { hash, bytes } = encodeContainer('change', encodeOps(change.ops, false), encoder => {
    encoder.appendHexString(change.actor)
    encoder.appendUint53(change.seq)
    encoder.appendUint53(change.startOp)
    encoder.appendInt53(change.time)
    encoder.appendPrefixedString(change.message || '')
    encoder.appendUint53(actorIds.length - 1)
    for (let actor of actorIds.slice(1)) encoder.appendHexString(actor)
    if (!Array.isArray(change.deps)) throw new TypeError('deps is not an array')
    encoder.appendUint53(change.deps.length)
    for (let hash of change.deps.slice().sort()) {
      encoder.appendRawBytes(hexStringToBytes(hash))
    }
  })

  const hexHash = bytesToHexString(hash)
  if (changeObj.hash && changeObj.hash !== hexHash) {
    throw new RangeError(`Change hash does not match encoding: ${changeObj.hash} != ${hexHash}`)
  }
  return bytes
}

function decodeChangeColumns(buffer) {
  const decoder = new Decoder(buffer)
  const header = decodeContainerHeader(decoder, true)
  const chunkDecoder = new Decoder(header.chunkData)
  if (!decoder.done) throw new RangeError('Encoded change has trailing data')
  if (header.chunkType !== 1) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)

  const change = decodeChangeHeader(chunkDecoder)
  change.hash = header.hash
  change.columns = readColumns(chunkDecoder)
  return change
}

/**
 * Decodes one change in binary format into its JS object representation.
 */
function decodeChange(buffer) {
  const change = decodeChangeColumns(buffer)
  change.ops = decodeOps(decodeColumns(change.columns, change.actorIds, CHANGE_COLUMNS), false)
  delete change.actorIds
  delete change.columns
  return change
}

/**
 * Decodes the header fields of a change in binary format, but does not decode
 * the operations. Saves work when we only need to inspect the headers. Only
 * computes the hash of the change if `computeHash` is true.
 */
function decodeChangeMeta(buffer, computeHash) {
  const header = decodeContainerHeader(new Decoder(buffer), computeHash)
  if (header.chunkType !== 1) {
    throw new RangeError('Buffer chunk type is not a change')
  }
  const meta = decodeChangeHeader(new Decoder(header.chunkData))
  if (computeHash) meta.hash = header.hash
  return meta
}

/**
 * Takes an Uint8Array that may contain multiple concatenated changes, and
 * returns an array of subarrays, each subarray containing one change.
 */
function splitContainers(buffer) {
  let decoder = new Decoder(buffer), chunks = [], startOffset = 0
  while (!decoder.done) {
    decodeContainerHeader(decoder, false)
    chunks.push(buffer.subarray(startOffset, decoder.offset))
    startOffset = decoder.offset
  }
  return chunks
}

/**
 * Decodes a list of changes from the binary format into JS objects.
 * `binaryChanges` is an array of `Uint8Array` objects.
 */
function decodeChanges(binaryChanges) {
  let decoded = []
  for (let binaryChange of binaryChanges) {
    for (let chunk of splitContainers(binaryChange)) {
      if (chunk[8] === 0) {
        decoded = decoded.concat(decodeDocument(chunk))
      } else if (chunk[8] === 1) {
        decoded.push(decodeChange(chunk))
      } else {
        // ignoring chunk of unknown type
      }
    }
  }
  return decoded
}

function sortOpIds(a, b) {
  if (a === b) return 0
  if (a === ROOT_ID) return -1
  if (b === ROOT_ID) return +1
  const a_ = parseOpId(a), b_ = parseOpId(b)
  if (a_.counter < b_.counter) return -1
  if (a_.counter > b_.counter) return +1
  if (a_.actorId < b_.actorId) return -1
  if (a_.actorId > b_.actorId) return +1
  return 0
}

function groupDocumentOps(changes) {
  let byObjectId = {}, byReference = {}, objectType = {}
  for (let change of changes) {
    for (let i = 0; i < change.ops.length; i++) {
      const op = change.ops[i], opId = `${op.id.counter}@${op.id.actorId}`
      const objectId = (op.obj.value === ROOT_ID) ? ROOT_ID : `${op.obj.counter}@${op.obj.actorId}`
      if (op.action.startsWith('make')) {
        objectType[opId] = op.action
        if (op.action === 'makeList' || op.action === 'makeText') {
          byReference[opId] = {'_head': []}
        }
      }

      let key
      if (objectId === ROOT_ID || objectType[objectId] === 'makeMap' || objectType[objectId] === 'makeTable') {
        key = op.key.value
      } else if (objectType[objectId] === 'makeList' || objectType[objectId] === 'makeText') {
        if (op.insert) {
          key = opId
          const ref = (op.key.value === '_head') ? '_head' : `${op.key.counter}@${op.key.actorId}`
          byReference[objectId][ref].push(opId)
          byReference[objectId][opId] = []
        } else {
          key = `${op.key.counter}@${op.key.actorId}`
        }
      } else {
        throw new RangeError(`Unknown object type for object ${objectId}`)
      }

      if (!byObjectId[objectId]) byObjectId[objectId] = {}
      if (!byObjectId[objectId][key]) byObjectId[objectId][key] = {}
      byObjectId[objectId][key][opId] = op
      op.succ = []

      for (let pred of op.pred) {
        const predId = `${pred.counter}@${pred.actorId}`
        if (!byObjectId[objectId][key][predId]) {
          throw new RangeError(`No predecessor operation ${predId}`)
        }
        byObjectId[objectId][key][predId].succ.push(op.id)
      }
    }
  }

  let ops = []
  for (let objectId of Object.keys(byObjectId).sort(sortOpIds)) {
    let keys = []
    if (objectType[objectId] === 'makeList' || objectType[objectId] === 'makeText') {
      let stack = ['_head']
      while (stack.length > 0) {
        const key = stack.pop()
        if (key !== '_head') keys.push(key)
        for (let opId of byReference[objectId][key].sort(sortOpIds)) stack.push(opId)
      }
    } else {
      // FIXME JavaScript sorts based on UTF-16 encoding. We should change this to use the UTF-8
      // encoding instead (the sort order will be different beyond the basic multilingual plane)
      keys = Object.keys(byObjectId[objectId]).sort()
    }

    for (let key of keys) {
      for (let opId of Object.keys(byObjectId[objectId][key]).sort(sortOpIds)) {
        const op = byObjectId[objectId][key][opId]
        if (op.action !== 'del') ops.push(op)
      }
    }
  }
  return ops
}

/**
 * Takes a set of operations `ops` loaded from an encoded document, and
 * reconstructs the changes that they originally came from.
 * Does not return anything, only mutates `changes`.
 */
function groupChangeOps(changes, ops) {
  let changesByActor = {} // map from actorId to array of changes by that actor
  for (let change of changes) {
    change.ops = []
    if (!changesByActor[change.actor]) changesByActor[change.actor] = []
    if (change.seq !== changesByActor[change.actor].length + 1) {
      throw new RangeError(`Expected seq = ${changesByActor[change.actor].length + 1}, got ${change.seq}`)
    }
    if (change.seq > 1 && changesByActor[change.actor][change.seq - 2].maxOp > change.maxOp) {
      throw new RangeError('maxOp must increase monotonically per actor')
    }
    changesByActor[change.actor].push(change)
  }

  let opsById = {}
  for (let op of ops) {
    if (op.action === 'del') throw new RangeError('document should not contain del operations')
    op.pred = opsById[op.id] ? opsById[op.id].pred : []
    opsById[op.id] = op
    for (let succ of op.succ) {
      if (!opsById[succ]) {
        const key = op.insert ? op.id : op.key
        opsById[succ] = {id: succ, action: 'del', obj: op.obj, key, pred: []}
      }
      opsById[succ].pred.push(op.id)
    }
    delete op.succ
  }
  for (let op of Object.values(opsById)) {
    if (op.action === 'del') ops.push(op)
  }

  for (let op of ops) {
    const { counter, actorId } = parseOpId(op.id)
    const actorChanges = changesByActor[actorId]
    // Binary search to find the change that should contain this operation
    let left = 0, right = actorChanges.length
    while (left < right) {
      const index = Math.floor((left + right) / 2)
      if (actorChanges[index].maxOp < counter) {
        left = index + 1
      } else {
        right = index
      }
    }
    if (left >= actorChanges.length) {
      throw new RangeError(`Operation ID ${op.id} outside of allowed range`)
    }
    actorChanges[left].ops.push(op)
  }

  for (let change of changes) {
    change.ops.sort((op1, op2) => sortOpIds(op1.id, op2.id))
    change.startOp = change.maxOp - change.ops.length + 1
    delete change.maxOp
    for (let i = 0; i < change.ops.length; i++) {
      const op = change.ops[i], expectedId = `${change.startOp + i}@${change.actor}`
      if (op.id !== expectedId) {
        throw new RangeError(`Expected opId ${expectedId}, got ${op.id}`)
      }
      delete op.id
    }
  }
}

function encodeDocumentChanges(changes) {
  const columns = { // see DOCUMENT_COLUMNS
    actor     : new RLEEncoder('uint'),
    seq       : new DeltaEncoder(),
    maxOp     : new DeltaEncoder(),
    time      : new DeltaEncoder(),
    message   : new RLEEncoder('utf8'),
    depsNum   : new RLEEncoder('uint'),
    depsIndex : new DeltaEncoder()
  }
  let indexByHash = {} // map from change hash to its index in the changes array
  let heads = {} // change hashes that are not a dependency of any other change

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    indexByHash[change.hash] = i
    heads[change.hash] = true

    columns.actor.appendValue(change.actorNum)
    columns.seq.appendValue(change.seq)
    columns.maxOp.appendValue(change.startOp + change.ops.length - 1)
    columns.time.appendValue(change.time)
    columns.message.appendValue(change.message)
    columns.depsNum.appendValue(change.deps.length)

    for (let dep of change.deps) {
      if (typeof indexByHash[dep] !== 'number') {
        throw new RangeError(`Unknown dependency hash: ${dep}`)
      }
      columns.depsIndex.appendValue(indexByHash[dep])
      if (heads[dep]) delete heads[dep]
    }
  }

  let changesColumns = []
  for (let [name, id] of Object.entries(DOCUMENT_COLUMNS)) {
    changesColumns.push({id, name, encoder: columns[name]})
  }
  changesColumns.sort((a, b) => a.id - b.id)
  return { changesColumns, heads: Object.keys(heads).sort() }
}

function decodeDocumentChanges(changes, expectedHeads) {
  let heads = {} // change hashes that are not a dependency of any other change
  for (let i = 0; i < changes.length; i++) {
    let change = changes[i]
    change.deps = []
    for (let index of change.depsNum.map(d => d.depsIndex)) {
      if (!changes[index] || !changes[index].hash) {
        throw new RangeError(`No hash for index ${index} while processing index ${i}`)
      }
      const hash = changes[index].hash
      change.deps.push(hash)
      if (heads[hash]) delete heads[hash]
    }
    change.deps.sort()
    delete change.depsNum

    // Encoding and decoding again to compute the hash of the change
    changes[i] = decodeChange(encodeChange(change))
    heads[changes[i].hash] = true
  }

  const actualHeads = Object.keys(heads).sort()
  let headsEqual = (actualHeads.length === expectedHeads.length), i = 0
  while (headsEqual && i < actualHeads.length) {
    headsEqual = (actualHeads[i] === expectedHeads[i])
    i++
  }
  if (!headsEqual) {
    throw new RangeError(`Mismatched heads hashes: expected ${expectedHeads.join(', ')}, got ${actualHeads.join(', ')}`)
  }
}

/**
 * Transforms a list of changes into a binary representation of the document state.
 */
function encodeDocument(binaryChanges) {
  const { changes, actorIds } = parseAllOpIds(decodeChanges(binaryChanges), false)
  const { changesColumns, heads } = encodeDocumentChanges(changes)
  const opsColumns = encodeOps(groupDocumentOps(changes), true)

  let numChangesColumns = 0
  for (let column of changesColumns) {
    if (!column.encoder.onlyNulls && column.encoder.buffer.byteLength > 0) numChangesColumns++
  }

  return encodeContainer('document', changesColumns.concat(opsColumns), encoder => {
    encoder.appendUint53(actorIds.length)
    for (let actor of actorIds) {
      encoder.appendHexString(actor)
    }
    encoder.appendUint53(heads.length)
    for (let head of heads.sort()) {
      encoder.appendRawBytes(hexStringToBytes(head))
    }
    encoder.appendUint53(numChangesColumns)
  }).bytes
}

function decodeDocumentHeader(buffer) {
  const documentDecoder = new Decoder(buffer)
  const header = decodeContainerHeader(documentDecoder, true)
  const decoder = new Decoder(header.chunkData)
  if (!documentDecoder.done) throw new RangeError('Encoded document has trailing data')
  if (header.chunkType !== 0) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)

  const actorIds = [], numActors = decoder.readUint53()
  for (let i = 0; i < numActors; i++) {
    actorIds.push(decoder.readHexString())
  }
  const heads = [], numHeads = decoder.readUint53()
  for (let i = 0; i < numHeads; i++) {
    heads.push(bytesToHexString(decoder.readRawBytes(32)))
  }

  const changesColumns = readColumns(decoder, decoder.readUint53())
  const opsColumns = readColumns(decoder)
  return { changesColumns, opsColumns, actorIds, heads }
}

function decodeDocument(buffer) {
  const { changesColumns, opsColumns, actorIds, heads } = decodeDocumentHeader(buffer)
  const changes = decodeColumns(changesColumns, actorIds, DOCUMENT_COLUMNS)
  const ops = decodeOps(decodeColumns(opsColumns, actorIds, CHANGE_COLUMNS), true)
  groupChangeOps(changes, ops)
  decodeDocumentChanges(changes, heads)
  return changes
}

/**
 * Takes all the operations for the same property (i.e. the same key in a map, or the same list
 * element) and mutates the object patch to reflect the current value(s) of that property. There
 * might be multiple values in the case of a conflict. `objects` is a map from objectId to the
 * patch for that object. `property` contains `objId`, `key`, and list of `ops`.
 */
function addPatchProperty(objects, property) {
  let values = {}, counter = null
  for (let op of property.ops) {
    // Apply counters and their increments regardless of the number of successor operations
    if (op.actionName === 'set' && op.value.datatype === 'counter') {
      if (!counter) counter = {opId: op.opId, value: 0, succ: {}}
      counter.value += op.value.value
      for (let succId of op.succ) counter.succ[succId] = true
    } else if (op.actionName === 'inc') {
      if (!counter) throw new RangeError(`inc operation ${op.opId} without a counter`)
      counter.value += op.value.value
      delete counter.succ[op.opId]
      for (let succId of op.succ) counter.succ[succId] = true

    } else if (op.succ.length === 0) { // Ignore any ops that have been overwritten
      if (op.actionName.startsWith('make')) {
        values[op.opId] = objects[op.opId]
      } else if (op.actionName === 'set') {
        values[op.opId] = op.value
      } else if (op.actionName === 'link') {
        // NB. This assumes that the ID of the child object is greater than the ID of the current
        // object. This is true as long as link operations are only used to redo undone make*
        // operations, but it will cease to be true once subtree moves are allowed.
        if (!op.childId) throw new RangeError(`link operation ${op.opId} without a childId`)
        values[op.opId] = objects[op.childId]
      } else {
        throw new RangeError(`Unexpected action type: ${op.actionName}`)
      }
    }
  }

  // If the counter had any successor operation that was not an increment, that means the counter
  // must have been deleted, so we omit it from the patch.
  if (counter && Object.keys(counter.succ).length === 0) {
    values[counter.opId] = {value: counter.value, datatype: 'counter'}
  }

  if (Object.keys(values).length > 0) {
    let obj = objects[property.objId]
    if (!obj.props) obj.props = {}
    if (obj.type === 'map' || obj.type === 'table') {
      obj.props[property.key] = values
    } else if (obj.type === 'list' || obj.type === 'text') {
      if (!obj.edits) obj.edits = []
      obj.props[obj.edits.length] = values
      obj.edits.push({action: 'insert', index: obj.edits.length})
    }
  }
}

/**
 * Parses the document (in compressed binary format) given as `documentBuffer`
 * and returns a patch that can be sent to the frontend to instantiate the
 * current state of that document.
 */
function constructPatch(documentBuffer) {
  const { opsColumns, actorIds } = decodeDocumentHeader(documentBuffer)
  const col = makeDecoders(opsColumns, CHANGE_COLUMNS).reduce(
    (acc, col) => Object.assign(acc, {[col.columnName]: col.decoder}), {})

  const objType = {makeMap: 'map', makeList: 'list', makeText: 'text', makeTable: 'table'}
  let objects = {[ROOT_ID]: {objectId: ROOT_ID, type: 'map'}}
  let property = null

  while (!col.idActor.done) {
    const opId = `${col.idCtr.readValue()}@${actorIds[col.idActor.readValue()]}`
    const action = col.action.readValue(), actionName = ACTIONS[action]
    if (action % 2 === 0) { // even-numbered actions are object creation
      objects[opId] = {objectId: opId, type: objType[actionName] || 'unknown'}
    }

    const objActor = col.objActor.readValue(), objCtr = col.objCtr.readValue()
    const objId = objActor === null ? ROOT_ID : `${objCtr}@${actorIds[objActor]}`
    let obj = objects[objId]
    if (!obj) throw new RangeError(`Operation for nonexistent object: ${objId}`)

    const keyActor = col.keyActor.readValue(), keyCtr = col.keyCtr.readValue()
    const keyStr = col.keyStr.readValue(), insert = !!col.insert.readValue()
    const chldActor = col.chldActor.readValue(), chldCtr = col.chldCtr.readValue()
    const childId = chldActor === null ? null : `${chldCtr}@${actorIds[chldActor]}`
    const value = decodeValue(col.valLen, col.valRaw), succNum = col.succNum.readValue()
    let succ = []
    for (let i = 0; i < succNum; i++) {
      succ.push(`${col.succCtr.readValue()}@${actorIds[col.succActor.readValue()]}`)
    }

    if (!actionName || obj.type === 'unknown') continue

    let key
    if (obj.type === 'list' || obj.type === 'text') {
      if (keyActor === null || keyCtr === null || (keyCtr === 0 && !insert)) {
        throw new RangeError(`Operation ${opId} on ${obj.type} object has no key`)
      }
      key = insert ? opId : `${keyCtr}@${actorIds[keyActor]}`
    } else {
      if (keyStr === null) {
        throw new RangeError(`Operation ${opId} on ${obj.type} object has no key`)
      }
      key = keyStr
    }

    if (!property || property.objId !== objId || property.key !== key) {
      if (property) addPatchProperty(objects, property)
      property = {objId, key, ops: []}
    }
    property.ops.push({opId, actionName, value, childId, succ})
  }

  if (property) addPatchProperty(objects, property)
  return objects[ROOT_ID]
}

function applyOps(docCols, ops, changeCols, actorIds) {
  for (let col of docCols) col.decoder.reset()
  const { objActor, objCtr, keyActor, keyCtr, keyStr, idActor, idCtr, insert, action } = ops[0]
  const [objActorD, objCtrD, keyActorD, keyCtrD, keyStrD, idActorD, idCtrD, insertD, actionD]
    = docCols.map(col => col.decoder)
  let skipCount = 0, nextObjActor = null, nextObjCtr = null
  let nextIdActor = null, nextIdCtr = null, nextKeyStr = null

  // Seek to the beginning of the object being updated
  if (objCtr !== null) {
    while (!objCtrD.done && !objActorD.done) {
      nextObjCtr = objCtrD.readValue()
      nextObjActor = actorIds[objActorD.readValue()]
      if (nextObjCtr === null || !nextObjActor || nextObjCtr < objCtr ||
          (nextObjCtr === objCtr && nextObjActor < objActor)) {
        skipCount += 1
      } else {
        break
      }
    }
  }

  // Seek to the appropriate key (if string key is used)
  if (keyStr !== null && nextObjCtr === objCtr && nextObjActor === objActor) {
    keyStrD.skipValues(skipCount)
    while (!keyStrD.done) {
      nextKeyStr = keyStrD.readValue()
      nextObjCtr = objCtrD.readValue()
      nextObjActor = actorIds[objActorD.readValue()]
      if (nextKeyStr !== null && nextKeyStr < keyStr &&
          nextObjCtr === objCtr && nextObjActor === objActor) {
        skipCount += 1
      } else {
        break
      }
    }
  }

  // Seek to the appropriate list element (if opId key is used)
  if (keyCtr !== null && keyActor !== null && keyCtr > 0 && nextObjCtr === objCtr && nextObjActor === objActor) {
    idCtrD.skipValues(skipCount)
    idActorD.skipValues(skipCount)
    while (!idCtrD.done && !idActorD.done && (nextIdCtr !== keyCtr || nextIdActor !== keyActor)) {
      nextIdCtr = idCtrD.readValue()
      nextIdActor = actorIds[idActorD.readValue()]
      nextObjCtr = objCtrD.readValue()
      nextObjActor = actorIds[objActorD.readValue()]
      if (nextObjCtr === objCtr && nextObjActor === objActor) skipCount += 1; else break
    }
    if (nextIdCtr !== keyCtr || nextIdActor !== keyActor) {
      throw new RangeError(`Reference element not found: ${keyCtr}@${keyActor}`)
    }

    // Skip over any list elements with greater ID than the new one
    while (!idCtrD.done && !idActorD.done) {
      nextIdCtr = idCtrD.readValue()
      nextIdActor = actorIds[idActorD.readValue()]
      nextObjCtr = objCtrD.readValue()
      nextObjActor = actorIds[objActorD.readValue()]
      if ((nextIdCtr > idCtr || (nextIdCtr === idCtr && nextIdActor > idActor)) &&
          nextObjCtr === objCtr && nextObjActor === objActor) {
        skipCount += 1
      } else {
        break
      }
    }
  }

  // TODO: if there are several ops with the target key, need to rewrite them to update their succ
  // field, and insert the new op at the appropriate position
  return skipCount
}

function applyChange(docBuffer, changeBuffer) {
  const doc = decodeDocumentHeader(docBuffer) // { changesColumns, opsColumns, actorIds, heads }
  const docCols = makeDecoders(doc.opsColumns, CHANGE_COLUMNS)
  const change = decodeChangeColumns(changeBuffer) // { actor, seq, startOp, time, message, deps, actorIds, hash, columns }
  const changeCols = makeDecoders(change.columns, CHANGE_COLUMNS)
  const expectedCols = [
    'objActor', 'objCtr', 'keyActor', 'keyCtr', 'keyStr', 'idActor', 'idCtr', 'insert',
    'action', 'valLen', 'valRaw', 'chldActor', 'chldCtr', 'predNum', 'predActor', 'predCtr',
    'succNum', 'succActor', 'succCtr'
  ]
  for (let cols of [docCols, changeCols]) {
    for (let i = 0; i < expectedCols.length; i++) {
      if (cols[i].columnName !== expectedCols[i]) {
        throw new RangeError(`Expected column ${expectedCols[i]} at index ${i}, got ${cols[i].columnName}`)
      }
    }
  }

  // TODO check if change is causally ready, enqueue it if not (cf. OpSet.applyQueuedOps)
  if (doc.actorIds.indexOf(change.actorIds[0]) < 0) {
    if (change.seq !== 1) {
      throw new RangeError(`Seq ${change.seq} is the first change for actor ${change.actorIds[0]}`)
    }
    doc.actorIds.push(change.actorIds[0])
  }
  for (let actorId of change.actorIds) {
    if (doc.actorIds.indexOf(actorId) < 0) {
      throw new RangeError(`actorId ${actorId} is not known to document`)
    }
  }

  const currentActor = change.actorIds[0]
  const [objActorD, objCtrD, keyActorD, keyCtrD, keyStrD, idActorD, idCtrD, insertD, actionD]
    = changeCols.map(col => col.decoder)
  let consecutiveOps = [], opIdCtr = change.startOp

  while (!actionD.done) {
    const objActor = objActorD.readValue(), keyActor = keyActorD.readValue()
    const thisOp = {
      objActor : objActor === null ? null : change.actorIds[objActor],
      objCtr   : objCtrD.readValue(),
      keyActor : keyActor === null ? null : change.actorIds[keyActor],
      keyCtr   : keyCtrD.readValue(),
      keyStr   : keyStrD.readValue(),
      idActor  : currentActor,
      idCtr    : opIdCtr,
      insert   : insertD.readValue(),
      action   : actionD.readValue()
    }
    if ((thisOp.objCtr === null && thisOp.objActor !== null) ||
        (thisOp.objCtr !== null && typeof thisOp.objActor !== 'string')) {
      throw new RangeError(`Mismatched object reference: (${thisOp.objCtr}, ${thisOp.objActor})`)
    }
    if ((thisOp.keyCtr === null && thisOp.keyActor !== null) ||
        (thisOp.keyCtr !== null && typeof thisOp.keyActor !== 'string')) {
      throw new RangeError(`Mismatched operation key: (${thisOp.keyCtr}, ${thisOp.keyActor})`)
    }

    // Collect any operations that are guaranteed to be consecutive in the compressed document.
    // These must all be for the same object (since objectIds of concurrently created objects may be
    // interleaved in the compressed document). For ops that reference a string key, the object
    // being updated must have been created in the current change, and keys must be in ascending
    // order. For ops that reference an opId key, the opId must match the preceding operation (this
    // is the case when a sequence of list elements/text chars are inserted consecutively).
    if (consecutiveOps.length === 0) {
      consecutiveOps.push(thisOp)
    } else {
      const lastOp = consecutiveOps[consecutiveOps.length - 1]
      if (thisOp.objActor === lastOp.objActor && thisOp.objCtr === lastOp.objCtr && (
          (thisOp.keyStr !== null && lastOp.keyStr !== null && lastOp.keyStr <= thisOp.keyStr &&
           thisOp.objActor === currentActor && thisOp.objCtr >= change.startOp) ||
          (thisOp.keyActor === lastOp.idActor && thisOp.keyCtr === lastOp.idCtr && lastOp.insert))) {
        consecutiveOps.push(thisOp)
      } else {
        applyOps(docCols, consecutiveOps, changeCols, doc.actorIds)
        consecutiveOps = [thisOp]
      }
    }

    opIdCtr += 1
  }
  if (consecutiveOps.length > 0) return applyOps(docCols, consecutiveOps, changeCols, doc.actorIds)
}

/*
*/

module.exports = {
  splitContainers, encodeChange, decodeChange, decodeChangeMeta, decodeChanges, encodeDocument, decodeDocument,
  constructPatch, applyChange
}
