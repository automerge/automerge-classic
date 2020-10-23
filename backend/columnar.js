const { ROOT_ID, copyObject, parseOpId, equalBytes } = require('../src/common')
const {
  utf8ToString, hexStringToBytes, bytesToHexString,
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
const ACTIONS = ['makeMap', 'set', 'makeList', 'del', 'makeText', 'inc', 'makeTable', 'link', 'mov']

const OBJECT_TYPE = {makeMap: 'map', makeList: 'list', makeText: 'text', makeTable: 'table'}

const COMMON_COLUMNS = {
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
  chldCtr:   6 << 3 | COLUMN_TYPE.INT_DELTA
}

const CHANGE_COLUMNS = Object.assign({
  predNum:   7 << 3 | COLUMN_TYPE.GROUP_CARD,
  predActor: 7 << 3 | COLUMN_TYPE.ACTOR_ID,
  predCtr:   7 << 3 | COLUMN_TYPE.INT_DELTA
}, COMMON_COLUMNS)

const DOC_OPS_COLUMNS = Object.assign({
  succNum:   8 << 3 | COLUMN_TYPE.GROUP_CARD,
  succActor: 8 << 3 | COLUMN_TYPE.ACTOR_ID,
  succCtr:   8 << 3 | COLUMN_TYPE.INT_DELTA
}, COMMON_COLUMNS)

const DOC_OPS_COLUMNS_REV = Object.entries(DOC_OPS_COLUMNS)
  .reduce((acc, [k, v]) => {acc[v] = k; return acc}, [])

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
 * Updates `objectTree`, which is a tree of nested objects, so that afterwards
 * `objectTree[path[0]][path[1]][...] === value`. Only the root object is mutated, whereas any
 * nested objects are copied before updating. This means that once the root object has been
 * shallow-copied, this function can be used to update it without mutating the previous version.
 */
function deepCopyUpdate(objectTree, path, value) {
  if (path.length === 1) {
    objectTree[path[0]] = value
  } else {
    let child = Object.assign({}, objectTree[path[0]])
    deepCopyUpdate(child, path.slice(1), value)
    objectTree[path[0]] = child
  }
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
    columns.keyActor.appendValue(null)
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
 * Given `sizeTag` (an unsigned integer read from a VALUE_LEN column) and `bytes` (a Uint8Array
 * read from a VALUE_RAW column, with length `sizeTag >> 4`), this function returns an object of the
 * form `{value: value, datatype: datatypeTag}` where `value` is a JavaScript primitive datatype
 * corresponding to the value, and `datatypeTag` is a datatype annotation such as 'counter'.
 */
function decodeValue(sizeTag, bytes) {
  if (sizeTag === VALUE_TYPE.NULL) {
    return {value: null}
  } else if (sizeTag === VALUE_TYPE.FALSE) {
    return {value: false}
  } else if (sizeTag === VALUE_TYPE.TRUE) {
    return {value: true}
  } else if (sizeTag % 16 === VALUE_TYPE.UTF8) {
    return {value: utf8ToString(bytes)}
  } else {
    if (sizeTag % 16 === VALUE_TYPE.LEB128_UINT) {
      return {value: new Decoder(bytes).readUint53()}
    } else if (sizeTag % 16 === VALUE_TYPE.LEB128_INT) {
      return {value: new Decoder(bytes).readInt53()}
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
      return {value: new Decoder(bytes).readInt53(), datatype: 'counter'}
    } else if (sizeTag % 16 === VALUE_TYPE.TIMESTAMP) {
      return {value: new Decoder(bytes).readInt53(), datatype: 'timestamp'}
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
    const sizeTag = decoder.readValue()
    const rawValue = columns[colIndex + 1].decoder.readRawBytes(sizeTag >> 4)
    const { value, datatype } = decodeValue(sizeTag, rawValue)
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
 * structure for an individual change. Returns an array of `{id, name, encoder}`
 * objects.
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
  for (let [name, id] of Object.entries(forDocument ? DOC_OPS_COLUMNS : CHANGE_COLUMNS)) {
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

function encoderByColumnId(columnId) {
  if ((columnId & 7) === COLUMN_TYPE.INT_DELTA) {
    return new DeltaEncoder()
  } else if ((columnId & 7) === COLUMN_TYPE.BOOLEAN) {
    return new BooleanEncoder()
  } else if ((columnId & 7) === COLUMN_TYPE.STRING_RLE) {
    return new RLEEncoder('utf8')
  } else if ((columnId & 7) === COLUMN_TYPE.VALUE_RAW) {
    return new Encoder()
  } else {
    return new RLEEncoder('uint')
  }
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
    if (buffer.byteLength > 0) {
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
    if (column.encoder.buffer.byteLength > 0) numChangesColumns++
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
  const ops = decodeOps(decodeColumns(opsColumns, actorIds, DOC_OPS_COLUMNS), true)
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
  const col = makeDecoders(opsColumns, DOC_OPS_COLUMNS).reduce(
    (acc, col) => Object.assign(acc, {[col.columnName]: col.decoder}), {})

  let objects = {[ROOT_ID]: {objectId: ROOT_ID, type: 'map'}}
  let property = null

  while (!col.idActor.done) {
    const opId = `${col.idCtr.readValue()}@${actorIds[col.idActor.readValue()]}`
    const action = col.action.readValue(), actionName = ACTIONS[action]
    if (action % 2 === 0) { // even-numbered actions are object creation
      objects[opId] = {objectId: opId, type: OBJECT_TYPE[actionName] || 'unknown'}
    }

    const objActor = col.objActor.readValue(), objCtr = col.objCtr.readValue()
    const objId = objActor === null ? ROOT_ID : `${objCtr}@${actorIds[objActor]}`
    let obj = objects[objId]
    if (!obj) throw new RangeError(`Operation for nonexistent object: ${objId}`)

    const keyActor = col.keyActor.readValue(), keyCtr = col.keyCtr.readValue()
    const keyStr = col.keyStr.readValue(), insert = !!col.insert.readValue()
    const chldActor = col.chldActor.readValue(), chldCtr = col.chldCtr.readValue()
    const childId = chldActor === null ? null : `${chldCtr}@${actorIds[chldActor]}`
    const sizeTag = col.valLen.readValue()
    const rawValue = col.valRaw.readRawBytes(sizeTag >> 4)
    const value = decodeValue(sizeTag, rawValue)
    const succNum = col.succNum.readValue()
    let succ = []
    for (let i = 0; i < succNum; i++) {
      succ.push(`${col.succCtr.readValue()}@${actorIds[col.succActor.readValue()]}`)
    }

    if (!actionName || obj.type === 'unknown') continue

    let key
    if (obj.type === 'list' || obj.type === 'text') {
      if (keyCtr === null || (keyCtr === 0 && !insert)) {
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

/**
 * Scans a chunk of document operations, encoded as columns `docCols`, to find the position at which
 * an operation (or sequence of operations) `ops` should be applied. Returns an object with keys:
 *   - `skipCount`: the number of operations, counted from the start of the chunk, after which the
 *     new operations should be inserted or applied.
 *   - `visibleCount`: if modifying a list object, the number of visible (i.e. non-deleted) list
 *     elements that precede the position where the new operations should be applied.
 */
function seekToOp(ops, docCols, actorIds) {
  const { objActor, objCtr, keyActor, keyCtr, keyStr, idActor, idCtr, insert, action, consecutiveOps } = ops
  const [objActorD, objCtrD, keyActorD, keyCtrD, keyStrD, idActorD, idCtrD, insertD, actionD,
    valLenD, valRawD, chldActorD, chldCtrD, succNumD] = docCols.map(col => col.decoder)
  let skipCount = 0, visibleCount = 0, elemVisible = false, nextObjActor = null, nextObjCtr = null
  let nextIdActor = null, nextIdCtr = null, nextKeyStr = null, nextInsert = null, nextSuccNum = 0

  // Seek to the beginning of the object being updated
  if (objCtr !== null) {
    while (!objCtrD.done || !objActorD.done || !actionD.done) {
      nextObjCtr = objCtrD.readValue()
      nextObjActor = actorIds[objActorD.readValue()]
      actionD.skipValues(1)
      if (nextObjCtr === null || !nextObjActor || nextObjCtr < objCtr ||
          (nextObjCtr === objCtr && nextObjActor < objActor)) {
        skipCount += 1
      } else {
        break
      }
    }
  }
  if (nextObjCtr !== objCtr || nextObjActor !== objActor) return {skipCount, visibleCount}

  // Seek to the appropriate key (if string key is used)
  if (keyStr !== null) {
    keyStrD.skipValues(skipCount)
    while (!keyStrD.done) {
      const objActorIndex = objActorD.readValue()
      nextObjActor = objActorIndex === null ? null : actorIds[objActorIndex]
      nextObjCtr = objCtrD.readValue()
      nextKeyStr = keyStrD.readValue()
      if (nextKeyStr !== null && nextKeyStr < keyStr &&
          nextObjCtr === objCtr && nextObjActor === objActor) {
        skipCount += 1
      } else {
        break
      }
    }
    return {skipCount, visibleCount}
  }

  idCtrD.skipValues(skipCount)
  idActorD.skipValues(skipCount)
  insertD.skipValues(skipCount)
  succNumD.skipValues(skipCount)
  nextIdCtr = idCtrD.readValue()
  nextIdActor = actorIds[idActorD.readValue()]
  nextInsert = insertD.readValue()
  nextSuccNum = succNumD.readValue()

  // If we are inserting into a list, an opId key is used, and we need to seek to a position *after*
  // the referenced operation. Moreover, we need to skip over any existing operations with a greater
  // opId than the new insertion, for CRDT convergence on concurrent insertions in the same place.
  if (insert) {
    // If insertion is not at the head, search for the reference element
    if (keyCtr !== null && keyCtr > 0 && keyActor !== null) {
      skipCount += 1
      while (!idCtrD.done && !idActorD.done && (nextIdCtr !== keyCtr || nextIdActor !== keyActor)) {
        if (nextInsert) elemVisible = false
        if (nextSuccNum === 0 && !elemVisible) {
          visibleCount += 1
          elemVisible = true
        }
        nextIdCtr = idCtrD.readValue()
        nextIdActor = actorIds[idActorD.readValue()]
        nextObjCtr = objCtrD.readValue()
        nextObjActor = actorIds[objActorD.readValue()]
        nextInsert = insertD.readValue()
        nextSuccNum = succNumD.readValue()
        if (nextObjCtr === objCtr && nextObjActor === objActor) skipCount += 1; else break
      }
      if (nextObjCtr !== objCtr || nextObjActor !== objActor || nextIdCtr !== keyCtr ||
          nextIdActor !== keyActor || !nextInsert) {
        throw new RangeError(`Reference element not found: ${keyCtr}@${keyActor}`)
      }
      if (nextInsert) elemVisible = false
      if (nextSuccNum === 0 && !elemVisible) {
        visibleCount += 1
        elemVisible = true
      }

      // Set up the next* variables to the operation following the reference element
      if (idCtrD.done || idActorD.done) return {skipCount, visibleCount}
      nextIdCtr = idCtrD.readValue()
      nextIdActor = actorIds[idActorD.readValue()]
      nextObjCtr = objCtrD.readValue()
      nextObjActor = actorIds[objActorD.readValue()]
      nextInsert = insertD.readValue()
      nextSuccNum = succNumD.readValue()
    }

    // Skip over any list elements with greater ID than the new one, and any non-insertions
    while ((!nextInsert || nextIdCtr > idCtr || (nextIdCtr === idCtr && nextIdActor > idActor)) &&
           nextObjCtr === objCtr && nextObjActor === objActor) {
      skipCount += 1
      if (nextInsert) elemVisible = false
      if (nextSuccNum === 0 && !elemVisible) {
        visibleCount += 1
        elemVisible = true
      }
      if (!idCtrD.done && !idActorD.done) {
        nextIdCtr = idCtrD.readValue()
        nextIdActor = actorIds[idActorD.readValue()]
        nextObjCtr = objCtrD.readValue()
        nextObjActor = actorIds[objActorD.readValue()]
        nextInsert = insertD.readValue()
        nextSuccNum = succNumD.readValue()
      } else {
        break
      }
    }

  } else if (keyCtr !== null && keyCtr > 0 && keyActor !== null) {
    // If we are updating an existing list element, seek to just before the referenced ID
    while ((!nextInsert || nextIdCtr !== keyCtr || nextIdActor !== keyActor) &&
           nextObjCtr === objCtr && nextObjActor === objActor) {
      skipCount += 1
      if (nextInsert) elemVisible = false
      if (nextSuccNum === 0 && !elemVisible) {
        visibleCount += 1
        elemVisible = true
      }
      if (!idCtrD.done && !idActorD.done) {
        nextIdCtr = idCtrD.readValue()
        nextIdActor = actorIds[idActorD.readValue()]
        nextObjCtr = objCtrD.readValue()
        nextObjActor = actorIds[objActorD.readValue()]
        nextInsert = insertD.readValue()
        nextSuccNum = succNumD.readValue()
      } else {
        break
      }
    }
    if (nextObjCtr !== objCtr || nextObjActor !== objActor || nextIdCtr !== keyCtr ||
        nextIdActor !== keyActor || !nextInsert) {
      throw new RangeError(`Element not found for update: ${keyCtr}@${keyActor}`)
    }
  }
  return {skipCount, visibleCount}
}

/**
 * Copies `count` rows from the set of input columns `inCols` to the set of output columns
 * `outCols`. The input columns are given as an array of `{columnId, decoder}` objects, and the
 * output columns are given as an array of `{columnId, encoder}` objects. Both are sorted in
 * increasing order of columnId. If there is no matching input column for a given output column, it
 * is filled in with `count` blank values (according to the column type).
 */
function copyColumns(outCols, inCols, count) {
  if (count === 0) return
  let inIndex = 0, lastGroup = -1, lastCardinality = 0, valueColumn = -1, valueBytes = 0
  for (let outCol of outCols) {
    while (inIndex < inCols.length && inCols[inIndex].columnId < outCol.columnId) inIndex++
    let inCol = null
    if (inIndex < inCols.length && inCols[inIndex].columnId === outCol.columnId &&
        inCols[inIndex].decoder.buf.byteLength > 0) {
      inCol = inCols[inIndex].decoder
    }
    const colCount = (outCol.columnId >> 3 === lastGroup) ? lastCardinality : count

    if (outCol.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
      lastGroup = outCol.columnId >> 3
      if (inCol) {
        lastCardinality = outCol.encoder.copyFrom(inCol, {count, sumValues: true}).sum
      } else {
        outCol.encoder.appendValue(0, count)
        lastCardinality = 0
      }
    } else if (outCol.columnId % 8 === COLUMN_TYPE.VALUE_LEN) {
      if (inCol) {
        if (inIndex + 1 === inCols.length || inCols[inIndex + 1].columnId !== outCol.columnId + 1) {
          throw new RangeError('VALUE_LEN column without accompanying VALUE_RAW column')
        }
        valueColumn = outCol.columnId + 1
        valueBytes = outCol.encoder.copyFrom(inCol, {count: colCount, sumValues: true, sumShift: 4}).sum
      } else {
        outCol.encoder.appendValue(null, colCount)
        valueColumn = outCol.columnId + 1
        valueBytes = 0
      }
    } else if (outCol.columnId % 8 === COLUMN_TYPE.VALUE_RAW) {
      if (outCol.columnId !== valueColumn) {
        throw new RangeError('VALUE_RAW column without accompanying VALUE_LEN column')
      }
      if (valueBytes > 0) {
        outCol.encoder.appendRawBytes(inCol.readRawBytes(valueBytes))
      }
    } else { // ACTOR_ID, INT_RLE, INT_DELTA, BOOLEAN, or STRING_RLE
      if (inCol) {
        outCol.encoder.copyFrom(inCol, {count: colCount})
      } else {
        const blankValue = (outCol.columnId % 8 === COLUMN_TYPE.BOOLEAN) ? false : null
        outCol.encoder.appendValue(blankValue, colCount)
      }
    }
  }
}

/**
 * Parses one operation from a set of columns. The argument `columns` contains a list of objects
 * with `columnId` and `decoder` properties. Returns an array in which the i'th element is the
 * value read from the i'th column in `columns`. Does not interpret datatypes; the only
 * interpretation of values is that if `actorTable` is given, a value `v` in a column of type
 * ACTOR_ID is replaced with `actorTable[v]`.
 */
function readOperation(columns, actorTable) {
  let operation = [], colValue, lastGroup = -1, lastCardinality = 0, valueColumn = -1, valueBytes = 0
  for (let col of columns) {
    if (col.columnId % 8 === COLUMN_TYPE.VALUE_RAW) {
      if (col.columnId !== valueColumn) throw new RangeError('unexpected VALUE_RAW column')
      colValue = col.decoder.readRawBytes(valueBytes)
    } else if (col.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
      lastGroup = col.columnId >> 3
      lastCardinality = col.decoder.readValue() || 0
      colValue = lastCardinality
    } else if (col.columnId >> 3 === lastGroup) {
      colValue = []
      if (col.columnId % 8 === COLUMN_TYPE.VALUE_LEN) {
        valueColumn = col.columnId + 1
        valueBytes = 0
      }
      for (let i = 0; i < lastCardinality; i++) {
        let value = col.decoder.readValue()
        if (col.columnId % 8 === COLUMN_TYPE.ACTOR_ID && actorTable && typeof value === 'number') {
          value = actorTable[value]
        }
        if (col.columnId % 8 === COLUMN_TYPE.VALUE_LEN) {
          valueBytes += colValue >>> 4
        }
        colValue.push(value)
      }
    } else {
      colValue = col.decoder.readValue()
      if (col.columnId % 8 === COLUMN_TYPE.ACTOR_ID && actorTable && typeof colValue === 'number') {
        colValue = actorTable[colValue]
      }
      if (col.columnId % 8 === COLUMN_TYPE.VALUE_LEN) {
        valueColumn = col.columnId + 1
        valueBytes = colValue >>> 4
      }
    }

    operation.push(colValue)
  }
  return operation
}

/**
 * Appends `operation`, in the form returned by `readOperation()`, to the columns in `outCols`. The
 * argument `inCols` provides metadata about the types of columns in `operation`; the value
 * `operation[i]` comes from the column `inCols[i]`.
 */
function appendOperation(outCols, inCols, operation) {
  let inIndex = 0, lastGroup = -1, lastCardinality = 0
  for (let outCol of outCols) {
    while (inIndex < inCols.length && inCols[inIndex].columnId < outCol.columnId) inIndex++

    if (inIndex < inCols.length && inCols[inIndex].columnId === outCol.columnId) {
      const colValue = operation[inIndex]
      if (outCol.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
        lastGroup = outCol.columnId >> 3
        lastCardinality = colValue
        outCol.encoder.appendValue(colValue)
      } else if (outCol.columnId >> 3 === lastGroup) {
        if (!Array.isArray(colValue) || colValue.length !== lastCardinality) {
          throw new RangeError('bad group value')
        }
        for (let v of colValue) outCol.encoder.appendValue(v)
      } else if (outCol.columnId % 8 === COLUMN_TYPE.VALUE_RAW) {
        outCol.encoder.appendRawBytes(colValue)
      } else {
        outCol.encoder.appendValue(colValue)
      }
    } else if (outCol.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
      lastGroup = outCol.columnId >> 3
      lastCardinality = 0
      outCol.encoder.appendValue(0)
    } else if (outCol.columnId % 8 !== COLUMN_TYPE.VALUE_RAW) {
      const count = (outCol.columnId >> 3 === lastGroup) ? lastCardinality : 1
      let blankValue = null
      if (outCol.columnId % 8 === COLUMN_TYPE.BOOLEAN) blankValue = false
      if (outCol.columnId % 8 === COLUMN_TYPE.VALUE_LEN) blankValue = 0
      outCol.encoder.appendValue(blankValue, count)
    }
  }
}

/**
 * Given a change parsed by `decodeChangeColumns()` and its column decoders as instantiated by
 * `makeDecoders()`, reads the operations in the change and groups together any related operations
 * that can be applied at the same time. Returns an object of the form `{opSequences, objectIds}`:
 *    - `opSequences` is an array of operation groups, where each group is an object with a
 *      `consecutiveOps` property indicating how many operations are in that group.
 *    - `objectIds` is an array of objectIds that are created or modified in this change.
 *
 * In order for a set of operations to be related, they have to satisfy the following properties:
 *   1. They must all be for the same object. (Even when several objects are created in the same
 *      change, we don't group together operations from different objects, since those ops may not
 *      be consecutive in the document, since objectIds from different actors can be interleaved.)
 *   2. Operations with string keys must appear in lexicographic order. For operations with opId
 *      keys (i.e. list/text operations), this function does not know whether the order of
 *      operations in the change matches the document order. We optimistically group together any
 *      such operations for the same object, on the basis that the ops are likely to be consecutive
 *      in practice (e.g. deleting a consecutive sequence of characters from text is likely to be
 *      represented by a sequence of deletion operations in document order).
 *   3. On a list, the operations must either all be non-insertions (i.e. updates/deletions of
 *      existing list items), or they must be consecutive insertions (where each operation inserts
 *      immediately after the preceding operations). Non-consecutive insertions are returned as
 *      separate groups.
 *
 * The `objectMeta` argument is a map from objectId to metadata about that object (such as the
 * object type, that object's parent, and the key within the parent object where it is located).
 * This function mutates `objectMeta` to include objects created in this change.
 */
function groupRelatedOps(change, changeCols, objectMeta) {
  const currentActor = change.actorIds[0]
  const [objActorD, objCtrD, keyActorD, keyCtrD, keyStrD, idActorD, idCtrD, insertD, actionD]
    = changeCols.map(col => col.decoder)
  let objIdSeen = {}, firstOp = null, lastOp = null, opIdCtr = change.startOp
  let opSequences = [], objectIds = {}

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
      action   : actionD.readValue(),
      idActorIndex  : -1, // the index of currentActor in the document's actor list, filled in later
      consecutiveOps: 1
    }
    if ((thisOp.objCtr === null && thisOp.objActor !== null) ||
        (thisOp.objCtr !== null && typeof thisOp.objActor !== 'string')) {
      throw new RangeError(`Mismatched object reference: (${thisOp.objCtr}, ${thisOp.objActor})`)
    }
    if ((thisOp.keyCtr === null && thisOp.keyActor !== null) ||
        (thisOp.keyCtr === 0    && thisOp.keyActor !== null) ||
        (thisOp.keyCtr >   0    && typeof thisOp.keyActor !== 'string')) {
      throw new RangeError(`Mismatched operation key: (${thisOp.keyCtr}, ${thisOp.keyActor})`)
    }

    thisOp.opId = `${thisOp.idCtr}@${thisOp.idActor}`
    thisOp.objId = thisOp.objCtr === null ? ROOT_ID : `${thisOp.objCtr}@${thisOp.objActor}`
    objectIds[thisOp.objId] = true

    // An even-numbered action indicates a make* operation that creates a new object.
    // TODO: also handle link/move operations.
    if (thisOp.action % 2 === 0) {
      let parentKey
      if (thisOp.keyStr !== null) {
        parentKey = thisOp.keyStr
      } else if (thisOp.insert) {
        parentKey = thisOp.opId
      } else {
        parentKey = `${thisOp.keyCtr}@${thisOp.keyActor}`
      }
      const type = thisOp.action < ACTIONS.length ? OBJECT_TYPE[ACTIONS[thisOp.action]] : null
      objectMeta[thisOp.opId] = {parentObj: thisOp.objId, parentKey, opId: thisOp.opId, type, children: {}}
      objectIds[thisOp.opId] = true
      deepCopyUpdate(objectMeta, [thisOp.objId, 'children', parentKey, thisOp.opId],
                     {objectId: thisOp.opId, type, props: {}})
    }

    if (!firstOp) {
      firstOp = thisOp
      lastOp = thisOp
    } else if (thisOp.objActor === lastOp.objActor && thisOp.objCtr === lastOp.objCtr && (
        (thisOp.keyStr !== null && lastOp.keyStr !== null && lastOp.keyStr <= thisOp.keyStr) ||
        (thisOp.keyStr === null && lastOp.keyStr === null && !lastOp.insert && !thisOp.insert) ||
        (thisOp.keyStr === null && lastOp.keyStr === null && lastOp.insert && thisOp.insert &&
         thisOp.keyActor === lastOp.idActor && thisOp.keyCtr === lastOp.idCtr))) {
      firstOp.consecutiveOps += 1
      lastOp = thisOp
    } else {
      objIdSeen[thisOp.objId] = true
      opSequences.push(firstOp)
      firstOp = thisOp
      lastOp = thisOp
    }

    opIdCtr += 1
  }

  if (firstOp) opSequences.push(firstOp)
  return {opSequences, objectIds: Object.keys(objectIds)}
}

class BackendDoc {
  constructor(buffer) {
    if (buffer) {
      const doc = decodeDocumentHeader(buffer)
      this.changesColumns = doc.changesColumns
      this.actorIds = doc.actorIds
      this.heads = doc.heads
      this.docColumns = makeDecoders(doc.opsColumns, DOC_OPS_COLUMNS)
      this.numOps = 0 // TODO count actual number of ops in the document
      this.objectMeta = {} // TODO fill this in
    } else {
      this.actorIds = []
      this.heads = []
      this.docColumns = makeDecoders([], DOC_OPS_COLUMNS)
      this.numOps = 0
      this.objectMeta = {[ROOT_ID]: {parentObj: null, parentKey: null, opId: null, type: 'map', children: {}}}
    }
  }

  /**
   * Updates `patches` to reflect the operation `op` within the document with state `docState`.
   * `ops` is the operation sequence (as per `groupRelatedOps`) that we're currently processing.
   * Can be called multiple times if there are multiple operations for the same property (e.g. due
   * to a conflict). `propState` is an object that carries over state between such successive
   * invocations for the same property. If the current object is a list, `listIndex` is the index
   * into that list (counting only visible elements). If the operation `op` was already previously
   * in the document, `oldSuccNum` is the value of `op[succNum]` before the current change was
   * applied (allowing us to determine whether this operation was overwritten or deleted in the
   * current change). `oldSuccNum` must be undefined if the operation came from the current change.
   */
  updatePatchProperty(patches, ops, op, docState, propState, listIndex, oldSuccNum) {
    // FIXME: these constants duplicate those at the beginning of mergeDocChangeOps()
    const objActor = 0, objCtr = 1, keyActor = 2, keyCtr = 3, keyStr = 4, idActor = 5, idCtr = 6, insert = 7, action = 8,
      valLen = 9, valRaw = 10, predNum = 13, predActor = 14, predCtr = 15, succNum = 13, succActor = 14, succCtr = 15

    const objectId = ops.objId
    const elemId = op[keyStr] ? op[keyStr] :
                   op[insert] ? `${op[idCtr]}@${docState.actorIds[op[idActor]]}`
                              : `${op[keyCtr]}@${docState.actorIds[op[keyActor]]}`

    if (!patches[objectId]) patches[objectId] = {objectId, type: docState.objectMeta[objectId].type, props: {}}
    let patch = patches[objectId]

    if (op[keyStr] === null) {
      // Updating a list or text object (with opId key)
      if (!patch.edits) patch.edits = []

      // If the property has a non-overwritten/non-deleted value, it's either an insert or an update
      if (op[succNum] === 0) {
        if (!propState[elemId]) {
          patch.edits.push({action: 'insert', index: listIndex})
          propState[elemId] = {action: 'insert', visibleOps: [], hasChild: false}
        } else if (propState[elemId].action === 'remove') {
          patch.edits.pop()
          propState[elemId].action = 'update'
        }
      }

      // If the property formerly had a non-overwritten value, it's either a remove or an update
      if (oldSuccNum === 0) {
        if (!propState[elemId]) {
          patch.edits.push({action: 'remove', index: listIndex})
          propState[elemId] = {action: 'remove', visibleOps: [], hasChild: false}
        } else if (propState[elemId].action === 'insert') {
          patch.edits.pop()
          propState[elemId].action = 'update'
        }
      }

      if (!patch.props[listIndex] && propState[elemId] && ['insert', 'update'].includes(propState[elemId].action)) {
        patch.props[listIndex] = {}
      }
    } else {
      // Updating a map or table (with string key)
      if (!patch.props[op[keyStr]]) patch.props[op[keyStr]] = {}
    }

    // If one or more of the values of the property is a child object, we update objectMeta to store
    // all of the visible values of the property (even the non-child-object values). Then, when we
    // subsequently process an update within that child object, we can construct the patch to
    // contain the conflicting values.
    if (op[succNum] === 0) {
      if (!propState[elemId]) propState[elemId] = {visibleOps: [], hasChild: false}
      propState[elemId].visibleOps.push(op)
      propState[elemId].hasChild = propState[elemId].hasChild || (op[action] % 2) === 0 // even-numbered action == make* operation

      if (propState[elemId].hasChild) {
        let values = {}
        for (let visible of propState[elemId].visibleOps) {
          const opId = `${visible[idCtr]}@${docState.actorIds[visible[idActor]]}`
          if (ACTIONS[visible[action]] === 'set') {
            values[opId] = decodeValue(visible[valLen], visible[valRaw])
          } else if (visible[action] % 2 === 0) {
            const type = visible[action] < ACTIONS.length ? OBJECT_TYPE[ACTIONS[visible[action]]] : null
            values[opId] = {objectId: opId, type, props: {}}
          }
        }

        // Copy so that objectMeta is not modified if an exception is thrown while applying change
        deepCopyUpdate(docState.objectMeta, [objectId, 'children', elemId], values)
      }
    }

    const key = op[keyStr] !== null ? op[keyStr] : listIndex
    if (op[succNum] === 0 && patch.props[key]) {
      const opId = `${op[idCtr]}@${docState.actorIds[op[idActor]]}`
      if (ACTIONS[op[action]] === 'set') {
        patch.props[key][opId] = decodeValue(op[valLen], op[valRaw])
      } else if (op[action] % 2 === 0) { // even-numbered action == make* operation
        if (!patches[opId]) {
          const type = op[action] < ACTIONS.length ? OBJECT_TYPE[ACTIONS[op[action]]] : null
          patches[opId] = {objectId: opId, type, props: {}}
        }
        patch.props[key][opId] = patches[opId]
      }
    }
  }

  /**
   * Applies a sequence of change operations to the document. `changeCols` contains the columns of
   * the change. Assumes that the decoders of both sets of columns are at the position where we want
   * to start merging. `patches` is mutated to reflect the effect of the change operations. `ops` is
   * the operation sequence to apply (as decoded by `groupRelatedOps()`). `docState` is as
   * documented in `applyOps()`. If the operations are updating a list or text object, `listIndex`
   * is the number of visible elements that precede the position at which we start merging.
   */
  mergeDocChangeOps(patches, outCols, ops, changeCols, docState, listIndex) {
    // Check the first couple of columns are in the positions where we expect them to be
    const objActor = 0, objCtr = 1, keyActor = 2, keyCtr = 3, keyStr = 4, idActor = 5, idCtr = 6, insert = 7, action = 8,
      valLen = 9, valRaw = 10, predNum = 13, predActor = 14, predCtr = 15, succNum = 13, succActor = 14, succCtr = 15
    if (docState.opsCols[objActor ].columnId !== DOC_OPS_COLUMNS.objActor  || changeCols[objActor ].columnId !== CHANGE_COLUMNS.objActor  ||
        docState.opsCols[objCtr   ].columnId !== DOC_OPS_COLUMNS.objCtr    || changeCols[objCtr   ].columnId !== CHANGE_COLUMNS.objCtr    ||
        docState.opsCols[keyActor ].columnId !== DOC_OPS_COLUMNS.keyActor  || changeCols[keyActor ].columnId !== CHANGE_COLUMNS.keyActor  ||
        docState.opsCols[keyCtr   ].columnId !== DOC_OPS_COLUMNS.keyCtr    || changeCols[keyCtr   ].columnId !== CHANGE_COLUMNS.keyCtr    ||
        docState.opsCols[keyStr   ].columnId !== DOC_OPS_COLUMNS.keyStr    || changeCols[keyStr   ].columnId !== CHANGE_COLUMNS.keyStr    ||
        docState.opsCols[idActor  ].columnId !== DOC_OPS_COLUMNS.idActor   || changeCols[idActor  ].columnId !== CHANGE_COLUMNS.idActor   ||
        docState.opsCols[idCtr    ].columnId !== DOC_OPS_COLUMNS.idCtr     || changeCols[idCtr    ].columnId !== CHANGE_COLUMNS.idCtr     ||
        docState.opsCols[insert   ].columnId !== DOC_OPS_COLUMNS.insert    || changeCols[insert   ].columnId !== CHANGE_COLUMNS.insert    ||
        docState.opsCols[action   ].columnId !== DOC_OPS_COLUMNS.action    || changeCols[action   ].columnId !== CHANGE_COLUMNS.action    ||
        docState.opsCols[valLen   ].columnId !== DOC_OPS_COLUMNS.valLen    || changeCols[valLen   ].columnId !== CHANGE_COLUMNS.valLen    ||
        docState.opsCols[valRaw   ].columnId !== DOC_OPS_COLUMNS.valRaw    || changeCols[valRaw   ].columnId !== CHANGE_COLUMNS.valRaw    ||
        docState.opsCols[succNum  ].columnId !== DOC_OPS_COLUMNS.succNum   || changeCols[predNum  ].columnId !== CHANGE_COLUMNS.predNum   ||
        docState.opsCols[succActor].columnId !== DOC_OPS_COLUMNS.succActor || changeCols[predActor].columnId !== CHANGE_COLUMNS.predActor ||
        docState.opsCols[succCtr  ].columnId !== DOC_OPS_COLUMNS.succCtr   || changeCols[predCtr  ].columnId !== CHANGE_COLUMNS.predCtr) {
      throw new RangeError('unexpected columnId')
    }

    let opCount = ops.consecutiveOps, opsAppended = 0, opIdCtr = ops.idCtr
    let foundListElem = false, elemVisible = false, propState = {}
    let docOp = docState.opsCols[action].decoder.done ? null : readOperation(docState.opsCols)
    let docOpsConsumed = (docOp === null ? 0 : 1)
    let docOpOldSuccNum = (docOp === null ? 0 : docOp[succNum])
    let changeOp = null, nextChangeOp = null, changeOps = []

    // Merge the two inputs: the sequence of ops in the doc, and the sequence of ops in the change.
    // At each iteration, we either output the doc's op (possibly updated based on the change's ops)
    // or output an op from the change.
    while (true) {
      // Read operations from the change, and fill the array `changeOps` with all the operations
      // that pertain to the same property (the same key or list element). If the operation
      // sequence consists of consecutive list insertions, `changeOps` contains all of the ops.
      if (changeOps.length === 0) {
        foundListElem = false
        while (changeOps.length === 0 || ops.insert ||
               (nextChangeOp[keyStr] !== null && nextChangeOp[keyStr] === changeOps[0][keyStr]) ||
               (nextChangeOp[keyStr] === null && nextChangeOp[keyActor] === changeOps[0][keyActor] &&
                nextChangeOp[keyCtr] === changeOps[0][keyCtr])) {
          if (nextChangeOp !== null) {
            changeOps.push(nextChangeOp)
          }
          if (opCount === 0) {
            nextChangeOp = null
            break
          }

          nextChangeOp = readOperation(changeCols, docState.actorTable)
          nextChangeOp[idActor] = ops.idActorIndex
          nextChangeOp[idCtr] = opIdCtr
          opCount--
          opIdCtr++
        }
      }

      if (changeOps.length > 0) changeOp = changeOps[0]
      const inCorrectObject = docOp && docOp[objActor] === changeOp[objActor] && docOp[objCtr] === changeOp[objCtr]
      const keyMatches      = docOp && docOp[keyStr] !== null && docOp[keyStr] === changeOp[keyStr]
      const listElemMatches = docOp && docOp[keyStr] === null && changeOp[keyStr] === null &&
        ((!docOp[insert] && docOp[keyActor] === changeOp[keyActor] && docOp[keyCtr] === changeOp[keyCtr]) ||
         ( docOp[insert] && docOp[idActor]  === changeOp[keyActor] && docOp[idCtr]  === changeOp[keyCtr]))

      // We keep going until we run out of ops in the change, except that even when we run out, we
      // keep going until we have processed all doc ops for the current key/list element.
      if (changeOps.length === 0 && !(inCorrectObject && (keyMatches || listElemMatches))) break

      let takeDocOp = false, takeChangeOps = 0

      // The change operations come first if we are inserting list elements (seekToOp already
      // determines the correct insertion position), if there is no document operation, if the next
      // document operation is for a different object, or if the change op's string key is
      // lexicographically first (TODO check ordering of keys beyond the basic multilingual plane).
      if (ops.insert || !inCorrectObject ||
          (docOp[keyStr] === null && changeOp[keyStr] !== null) ||
          (docOp[keyStr] !== null && changeOp[keyStr] !== null && changeOp[keyStr] < docOp[keyStr])) {
        // Take the operations from the change
        takeChangeOps = changeOps.length
        if (!inCorrectObject && !foundListElem && changeOp[keyStr] === null && !changeOp[insert]) {
          // This can happen if we first update one list element, then another one earlier in the
          // list. That is not allowed: list element updates must occur in ascending order.
          throw new RangeError("could not find list element with ID: " +
                               `${changeOp[keyCtr]}@${docState.actorIds[changeOp[keyActor]]}`)
        }

      } else if (keyMatches || listElemMatches || foundListElem) {
        // The doc operation is for the same key or list element in the same object as the change
        // ops, so we merge them. First, if any of the change ops' `pred` matches the opId of the
        // document operation, we update the document operation's `succ` accordingly.
        for (let op of changeOps) {
          for (let i = 0; i < op[predNum]; i++) {
            if (op[predActor][i] === docOp[idActor] && op[predCtr][i] === docOp[idCtr]) {
              // Insert into the doc op's succ list such that the lists remains sorted
              let j = 0
              while (j < docOp[succNum] && (docOp[succCtr][j] < op[idCtr] ||
                     docOp[succCtr][j] === op[idCtr] && docState.actorIds[docOp[succActor][j]] < ops.idActor)) j++
              docOp[succCtr].splice(j, 0, op[idCtr])
              docOp[succActor].splice(j, 0, ops.idActorIndex)
              docOp[succNum]++
              op[predCtr].splice(i, 1)
              op[predActor].splice(i, 1)
              op[predNum]--
              break
            }
          }
        }

        if (listElemMatches) foundListElem = true

        if (foundListElem && !listElemMatches) {
          // If the previous docOp was for the correct list element, and the current docOp is for
          // the wrong list element, then place the current changeOp before the docOp.
          takeChangeOps = changeOps.length

        } else if (changeOps.length === 0 || docOp[idCtr] < changeOp[idCtr] ||
            (docOp[idCtr] === changeOp[idCtr] && docState.actorIds[docOp[idActor]] < ops.idActor)) {
          // When we have several operations for the same object and the same key, we want to keep
          // them sorted in ascending order by opId. Here we have docOp with a lower opId, so we
          // output it first.
          takeDocOp = true
          this.updatePatchProperty(patches, ops, docOp, docState, propState, listIndex, docOpOldSuccNum)

          // A deletion op in the change is represented in the document only by its entries in the
          // succ list of the operations it overwrites; it has no separate row in the set of ops.
          for (let i = changeOps.length - 1; i >= 0; i--) {
            if (ACTIONS[changeOps[i][action]] === 'del' && changeOps[i][predNum] === 0) {
              changeOps.splice(i, 1)
            }
          }

        } else if (docOp[idCtr] === changeOp[idCtr] && docState.actorIds[docOp[idActor]] === ops.idActor) {
          throw new RangeError(`duplicate operation ID: ${changeOp[idCtr]}@${ops.idActor}`)
        } else {
          // The changeOp has the lower opId, so we output it first.
          takeChangeOps = 1
        }
      } else {
        // The document operation comes first if its string key is lexicographically first, or if
        // we're using opId keys and the keys don't match (i.e. we scan the document until we find a
        // matching key).
        takeDocOp = true
      }

      if (takeDocOp) {
        appendOperation(outCols, docState.opsCols, docOp)
        if (docOp[insert] && elemVisible) {
          elemVisible = false
          listIndex++
        }
        if (docOp[succNum] === 0) elemVisible = true
        opsAppended++
        docOp = docState.opsCols[action].decoder.done ? null : readOperation(docState.opsCols)
        if (docOp !== null) {
          docOpsConsumed++
          docOpOldSuccNum = docOp[succNum]
        }
      }

      if (takeChangeOps > 0) {
        for (let i = 0; i < takeChangeOps; i++) {
          const op = changeOps[i]
          // Check that we've seen all ops mentioned in `pred` (they must all have lower opIds than
          // the change op's own opId, so we must have seen them already)
          if (op[predNum] > 0) {
            throw new RangeError(`no matching operation for pred: ${op[predCtr][0]}@${docState.actorIds[op[predActor][0]]}`)
          }
          this.updatePatchProperty(patches, ops, op, docState, propState, listIndex)
          appendOperation(outCols, changeCols, op)
          if (op[insert]) {
            elemVisible = false
            listIndex++
          }
          if (op[succNum] === 0) elemVisible = true
        }

        if (takeChangeOps === changeOps.length) {
          changeOps.length = 0
        } else {
          changeOps.splice(0, takeChangeOps)
        }
        opsAppended += takeChangeOps
      }
    }

    if (docOp) {
      appendOperation(outCols, docState.opsCols, docOp)
      opsAppended++
    }
    return {opsAppended, docOpsConsumed}
  }

  /**
   * Applies the operation sequence in `ops` (as produced by `groupRelatedOps()`) from the change
   * with columns `changeCols` to the document `docState`. `docState` is an object with keys:
   *   - `actorIds` is an array of actorIds (as hex strings) occurring in the document (values in
   *     the document's objActor/keyActor/idActor/... columns are indexes into this array).
   *   - `actorTable` is an array of integers where `actorTable[i]` contains the document's actor
   *     index for the actor that has index `i` in the change (`i == 0` is the author of the change).
   *   - `allCols` is an array of all the columnIds in either the document or the change.
   *   - `opsCols` is an array of columns containing the operations in the document.
   *   - `numOps` is an integer, the number of operations in the document.
   *   - `objectMeta` is a map from objectId to metadata about that object.
   *   - `lastIndex` is an object where the key is an objectId, and the value is the last list index
   *     accessed in that object. This is used to check that accesses occur in ascending order
   *     (which makes it easier to generate patches for lists).
   *
   * `docState` is mutated to contain the updated document state.
   * `patches` is a patch object that is mutated to reflect the operations applied by this function.
   */
  applyOps(patches, ops, changeCols, docState) {
    for (let col of docState.opsCols) col.decoder.reset()
    const {skipCount, visibleCount} = seekToOp(ops, docState.opsCols, docState.actorIds)
    if (docState.lastIndex[ops.objId] && visibleCount < docState.lastIndex[ops.objId]) {
      throw new RangeError('list element accesses must occur in ascending order')
    }
    docState.lastIndex[ops.objId] = visibleCount
    for (let col of docState.opsCols) col.decoder.reset()

    let outCols = docState.allCols.map(columnId => {
      return {columnId, encoder: encoderByColumnId(columnId)}
    })
    copyColumns(outCols, docState.opsCols, skipCount)
    const {opsAppended, docOpsConsumed} = this.mergeDocChangeOps(patches, outCols, ops, changeCols, docState, visibleCount)
    copyColumns(outCols, docState.opsCols, docState.numOps - skipCount - docOpsConsumed)
    for (let col of docState.opsCols) {
      if (!col.decoder.done) throw new RangeError(`excess ops in ${col.columnName} column`)
    }

    docState.opsCols = outCols.map(col => {
      const decoder = decoderByColumnId(col.columnId, col.encoder.buffer)
      return {columnId: col.columnId, columnName: DOC_OPS_COLUMNS_REV[col.columnId], decoder}
    })
    docState.numOps = docState.numOps + opsAppended - docOpsConsumed
  }

  /**
   * Takes `changeCols`, a list of `{columnId, columnName, decoder}` objects for a change, and
   * checks that it has the expected structure. Returns an array of column IDs (integers) of the
   * columns that occur either in the document or in the change.
   */
  getAllColumns(changeCols) {
    const expectedCols = [
      'objActor', 'objCtr', 'keyActor', 'keyCtr', 'keyStr', 'idActor', 'idCtr', 'insert',
      'action', 'valLen', 'valRaw', 'chldActor', 'chldCtr', 'predNum', 'predActor', 'predCtr'
    ]
    let allCols = {}
    for (let i = 0; i < expectedCols.length; i++) {
      if (changeCols[i].columnName !== expectedCols[i]) {
        throw new RangeError(`Expected column ${expectedCols[i]} at index ${i}, got ${changeCols[i].columnName}`)
      }
    }
    for (let col of changeCols) allCols[col.columnId] = true
    for (let [columnName, columnId] of Object.entries(DOC_OPS_COLUMNS)) allCols[columnId] = true

    // Final document should contain any columns in either the document or the change, except for
    // pred, since the document encoding uses succ instead of pred
    delete allCols[CHANGE_COLUMNS.predNum]
    delete allCols[CHANGE_COLUMNS.predActor]
    delete allCols[CHANGE_COLUMNS.predCtr]
    return Object.keys(allCols).map(id => parseInt(id)).sort((a, b) => a - b)
  }

  /**
   * Takes a decoded change header, including an array of actorIds. Returns an object of the form
   * `{actorIds, actorTable}`, where `actorIds` is an updated array of actorIds appearing in the
   * document (including the new change's actorId), and `actorTable` is an array for translating
   * the change's actor indexes into the document's actor indexes.
   */
  getActorTable(change) {
    // TODO check if change is causally ready, enqueue it if not (cf. OpSet.applyQueuedOps)
    let actorIds = this.actorIds
    if (actorIds.indexOf(change.actorIds[0]) < 0) {
      if (change.seq !== 1) {
        throw new RangeError(`Seq ${change.seq} is the first change for actor ${change.actorIds[0]}`)
      }
      // Use concat, not push, so that the original array is not mutated
      actorIds = actorIds.concat([change.actorIds[0]])
    }
    const actorTable = [] // translate from change's actor index to doc's actor index
    for (let actorId of change.actorIds) {
      const index = actorIds.indexOf(actorId)
      if (index < 0) {
        throw new RangeError(`actorId ${actorId} is not known to document`)
      }
      actorTable.push(index)
    }
    return {actorIds, actorTable}
  }

  /**
   * Finalises the patch for a change. `patches` is a map from objectIds to patch for that
   * particular object, `objectIds` is the array of IDs of objects that are created or updated in the
   * change, and `docState` is an object containing various bits of document state, including
   * `objectMeta`, a  map from objectIds to metadata about that object (such as its parent in the
   * document tree). Mutates `patches` such that child objects are linked into their parent object,
   * all the way to the root object.
   */
  setupPatches(patches, objectIds, docState) {
    for (let objectId of objectIds) {
      let meta = docState.objectMeta[objectId], childMeta = null, patchExists = false
      while (true) {
        if (!patches[objectId]) patches[objectId] = {objectId, type: meta.type, props: {}}

        if (childMeta) {
          // key is the property name being updated. In maps and table objects, this is just q
          // string, while in list and text objects, we need to translate the elemID into an index
          let key = childMeta.parentKey
          if (meta.type === 'list' || meta.type === 'text') {
            const obj = parseOpId(objectId), elem = parseOpId(key)
            const seekPos = {
              objActor: obj.actorId,  objCtr: obj.counter,
              keyActor: elem.actorId, keyCtr: elem.counter,
              keyStr:   null,         insert: false
            }
            const {skipCount, visibleCount} = seekToOp(seekPos, docState.opsCols, docState.actorIds)
            key = visibleCount
          }
          if (!patches[objectId].props[key]) patches[objectId].props[key] = {}

          let values = patches[objectId].props[key]
          for (let [opId, value] of Object.entries(meta.children[childMeta.parentKey])) {
            if (values[opId]) {
              patchExists = true
            } else if (value.objectId) {
              if (!patches[value.objectId]) patches[value.objectId] = Object.assign({}, value, {props: {}})
              values[opId] = patches[value.objectId]
            } else {
              values[opId] = value
            }
          }
          if (!values[childMeta.opId]) {
            throw new RangeError(`object metadata did not contain child entry for ${childMeta.opId}`)
          }
        }
        if (patchExists || !meta.parentObj) break
        childMeta = meta
        objectId = meta.parentObj
        meta = docState.objectMeta[objectId]
      }
    }
    return patches
  }

  /**
   * Parses the change given as a Uint8Array in `changeBuffer`, and applies it to the current
   * document. Returns a patch to apply to the frontend. If an exception is thrown, the document
   * object is not modified.
   */
  applyChange(changeBuffer) {
    const change = decodeChangeColumns(changeBuffer) // { actor, seq, startOp, time, message, deps, actorIds, hash, columns }
    const changeCols = makeDecoders(change.columns, CHANGE_COLUMNS)
    const allCols = this.getAllColumns(changeCols)
    const {actorIds, actorTable} = this.getActorTable(change)
    const actorIndex = actorIds.indexOf(change.actorIds[0])
    const objectMeta = Object.assign({}, this.objectMeta)
    const {opSequences, objectIds} = groupRelatedOps(change, changeCols, objectMeta)

    let patches = {[ROOT_ID]: {objectId: ROOT_ID, type: 'map', props: {}}}
    let docState = {
      actorIds, actorTable, allCols, opsCols: this.docColumns, numOps: this.numOps,
      objectMeta, lastIndex: {}
    }
    for (let col of changeCols) col.decoder.reset()
    for (let op of opSequences) {
      op.idActorIndex = actorIndex
      this.applyOps(patches, op, changeCols, docState)
    }
    this.setupPatches(patches, objectIds, docState)

    // Update the document state at the end, so that if any of the earlier code throws an exception,
    // the document is not modified (making `applyChange` atomic in the ACID sense).
    this.actorIds   = docState.actorIds
    this.docColumns = docState.opsCols
    this.numOps     = docState.numOps
    this.objectMeta = docState.objectMeta
    return patches[ROOT_ID]
  }
}

module.exports = {
  COLUMN_TYPE, VALUE_TYPE, ACTIONS, DOC_OPS_COLUMNS, CHANGE_COLUMNS, DOCUMENT_COLUMNS,
  splitContainers, encodeChange, decodeChange, decodeChangeMeta, decodeChanges, encodeDocument, decodeDocument,
  constructPatch, BackendDoc
}
