const pako = require('pako')
const { copyObject, parseOpId, equalBytes } = require('../src/common')
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
const MAGIC_BYTES = new Uint8Array([0x85, 0x6f, 0x4a, 0x83])

const CHUNK_TYPE_DOCUMENT = 0
const CHUNK_TYPE_CHANGE = 1
const CHUNK_TYPE_DEFLATE = 2 // like CHUNK_TYPE_CHANGE but with DEFLATE compression

// Minimum number of bytes in a value before we enable DEFLATE compression (there is no point
// compressing very short values since compression may actually make them bigger)
const DEFLATE_MIN_SIZE = 256

// The least-significant 3 bits of a columnId indicate its datatype
const COLUMN_TYPE = {
  GROUP_CARD: 0, ACTOR_ID: 1, INT_RLE: 2, INT_DELTA: 3, BOOLEAN: 4,
  STRING_RLE: 5, VALUE_LEN: 6, VALUE_RAW: 7
}

// The 4th-least-significant bit of a columnId is set if the column is DEFLATE-compressed
const COLUMN_TYPE_DEFLATE = 8

// In the values in a column of type VALUE_LEN, the bottom four bits indicate the type of the value,
// one of the following types in VALUE_TYPE. The higher bits indicate the length of the value in the
// associated VALUE_RAW column (in bytes).
const VALUE_TYPE = {
  NULL: 0, FALSE: 1, TRUE: 2, LEB128_UINT: 3, LEB128_INT: 4, IEEE754: 5,
  UTF8: 6, BYTES: 7, COUNTER: 8, TIMESTAMP: 9, MIN_UNKNOWN: 10, MAX_UNKNOWN: 15
}

// make* actions must be at even-numbered indexes in this list
const ACTIONS = ['makeMap', 'set', 'makeList', 'del', 'makeText', 'inc', 'makeTable', 'link']

const OBJECT_TYPE = {makeMap: 'map', makeList: 'list', makeText: 'text', makeTable: 'table'}

const COMMON_COLUMNS = [
  {columnName: 'objActor',  columnId: 0 << 4 | COLUMN_TYPE.ACTOR_ID},
  {columnName: 'objCtr',    columnId: 0 << 4 | COLUMN_TYPE.INT_RLE},
  {columnName: 'keyActor',  columnId: 1 << 4 | COLUMN_TYPE.ACTOR_ID},
  {columnName: 'keyCtr',    columnId: 1 << 4 | COLUMN_TYPE.INT_DELTA},
  {columnName: 'keyStr',    columnId: 1 << 4 | COLUMN_TYPE.STRING_RLE},
  {columnName: 'idActor',   columnId: 2 << 4 | COLUMN_TYPE.ACTOR_ID},
  {columnName: 'idCtr',     columnId: 2 << 4 | COLUMN_TYPE.INT_DELTA},
  {columnName: 'insert',    columnId: 3 << 4 | COLUMN_TYPE.BOOLEAN},
  {columnName: 'action',    columnId: 4 << 4 | COLUMN_TYPE.INT_RLE},
  {columnName: 'valLen',    columnId: 5 << 4 | COLUMN_TYPE.VALUE_LEN},
  {columnName: 'valRaw',    columnId: 5 << 4 | COLUMN_TYPE.VALUE_RAW},
  {columnName: 'chldActor', columnId: 6 << 4 | COLUMN_TYPE.ACTOR_ID},
  {columnName: 'chldCtr',   columnId: 6 << 4 | COLUMN_TYPE.INT_DELTA}
]

const CHANGE_COLUMNS = COMMON_COLUMNS.concat([
  {columnName: 'predNum',   columnId: 7 << 4 | COLUMN_TYPE.GROUP_CARD},
  {columnName: 'predActor', columnId: 7 << 4 | COLUMN_TYPE.ACTOR_ID},
  {columnName: 'predCtr',   columnId: 7 << 4 | COLUMN_TYPE.INT_DELTA}
])

const DOC_OPS_COLUMNS = COMMON_COLUMNS.concat([
  {columnName: 'succNum',   columnId: 8 << 4 | COLUMN_TYPE.GROUP_CARD},
  {columnName: 'succActor', columnId: 8 << 4 | COLUMN_TYPE.ACTOR_ID},
  {columnName: 'succCtr',   columnId: 8 << 4 | COLUMN_TYPE.INT_DELTA}
])

const DOCUMENT_COLUMNS = [
  {columnName: 'actor',     columnId: 0 << 4 | COLUMN_TYPE.ACTOR_ID},
  {columnName: 'seq',       columnId: 0 << 4 | COLUMN_TYPE.INT_DELTA},
  {columnName: 'maxOp',     columnId: 1 << 4 | COLUMN_TYPE.INT_DELTA},
  {columnName: 'time',      columnId: 2 << 4 | COLUMN_TYPE.INT_DELTA},
  {columnName: 'message',   columnId: 3 << 4 | COLUMN_TYPE.STRING_RLE},
  {columnName: 'depsNum',   columnId: 4 << 4 | COLUMN_TYPE.GROUP_CARD},
  {columnName: 'depsIndex', columnId: 4 << 4 | COLUMN_TYPE.INT_DELTA},
  {columnName: 'extraLen',  columnId: 5 << 4 | COLUMN_TYPE.VALUE_LEN},
  {columnName: 'extraRaw',  columnId: 5 << 4 | COLUMN_TYPE.VALUE_RAW}
]

/**
 * Maps an opId of the form {counter: 12345, actorId: 'someActorId'} to the form
 * {counter: 12345, actorNum: 123, actorId: 'someActorId'}, where the actorNum
 * is the index into the `actorIds` array.
 */
function actorIdToActorNum(opId, actorIds) {
  if (!opId || !opId.actorId) return opId
  const counter = opId.counter
  const actorNum = actorIds.indexOf(opId.actorId)
  if (actorNum < 0) throw new RangeError('missing actorId') // should not happen
  return {counter, actorNum, actorId: opId.actorId}
}

/**
 * Comparison function to pass to Array.sort(), which compares two opIds in the
 * form produced by `actorIdToActorNum` so that they are sorted in increasing
 * Lamport timestamp order (sorted first by counter, then by actorId).
 */
function compareParsedOpIds(id1, id2) {
  if (id1.counter < id2.counter) return -1
  if (id1.counter > id2.counter) return +1
  if (id1.actorId < id2.actorId) return -1
  if (id1.actorId > id2.actorId) return +1
  return 0
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
    change.ops = expandMultiOps(change.ops, change.startOp, change.actor)
    change.ops = change.ops.map(op => {
      op = copyObject(op)
      if (op.obj !== '_root') op.obj = parseOpId(op.obj)
      if (op.elemId && op.elemId !== '_head') op.elemId = parseOpId(op.elemId)
      if (op.child) op.child = parseOpId(op.child)
      if (op.pred) op.pred = op.pred.map(parseOpId)
      if (op.obj.actorId) actors[op.obj.actorId] = true
      if (op.elemId && op.elemId.actorId) actors[op.elemId.actorId] = true
      if (op.child && op.child.actorId) actors[op.child.actorId] = true
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
      op.elemId = actorIdToActorNum(op.elemId, actorIds)
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
  if (op.obj === '_root') {
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
 * Encodes the `key` and `elemId` properties of operation `op` into the three
 * columns `keyActor`, `keyCtr`, and `keyStr`.
 */
function encodeOperationKey(op, columns) {
  if (op.key) {
    columns.keyActor.appendValue(null)
    columns.keyCtr.appendValue(null)
    columns.keyStr.appendValue(op.key)
  } else if (op.elemId === '_head' && op.insert) {
    columns.keyActor.appendValue(null)
    columns.keyCtr.appendValue(0)
    columns.keyStr.appendValue(null)
  } else if (op.elemId && op.elemId.actorNum >= 0 && op.elemId.counter > 0) {
    columns.keyActor.appendValue(op.elemId.actorNum)
    columns.keyCtr.appendValue(op.elemId.counter)
    columns.keyStr.appendValue(null)
  } else {
    throw new RangeError(`Unexpected operation key: ${JSON.stringify(op)}`)
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
 * Given the datatype for a number, determine the typeTag and the value to encode
 * otherwise guess
 */
function getNumberTypeAndValue(op) {
  switch (op.datatype) {
    case "counter":
      return [ VALUE_TYPE.COUNTER, op.value ]
    case "timestamp":
      return [ VALUE_TYPE.TIMESTAMP, op.value ]
    case "uint":
      return [ VALUE_TYPE.LEB128_UINT, op.value ]
    case "int":
      return [ VALUE_TYPE.LEB128_INT, op.value ]
    case "float64": {
      const buf64 = new ArrayBuffer(8), view64 = new DataView(buf64)
      view64.setFloat64(0, op.value, true)
      return [ VALUE_TYPE.IEEE754,  new Uint8Array(buf64) ]
    }
    default:
      // increment operators get resolved here ...
      if (Number.isInteger(op.value) && op.value <= Number.MAX_SAFE_INTEGER && op.value >= Number.MIN_SAFE_INTEGER) {
        return [ VALUE_TYPE.LEB128_INT, op.value ]
      } else {
        const buf64 = new ArrayBuffer(8), view64 = new DataView(buf64)
        view64.setFloat64(0, op.value, true)
        return [ VALUE_TYPE.IEEE754,  new Uint8Array(buf64) ]
      }
  }
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
  } else if (typeof op.value === 'number') {
    let [typeTag, value] = getNumberTypeAndValue(op)
    let numBytes
    if (typeTag === VALUE_TYPE.LEB128_UINT) {
      numBytes = columns.valRaw.appendUint53(value)
    } else if (typeTag === VALUE_TYPE.IEEE754) {
      numBytes = columns.valRaw.appendRawBytes(value)
    } else {
      numBytes = columns.valRaw.appendInt53(value)
    }
    columns.valLen.appendValue(numBytes << 4 | typeTag)
  } else if (typeof op.datatype === 'number' && op.datatype >= VALUE_TYPE.MIN_UNKNOWN &&
             op.datatype <= VALUE_TYPE.MAX_UNKNOWN && op.value instanceof Uint8Array) {
    const numBytes = columns.valRaw.appendRawBytes(op.value)
    columns.valLen.appendValue(numBytes << 4 | op.datatype)
  } else if (op.datatype) {
      throw new RangeError(`Unknown datatype ${op.datatype} for value ${op.value}`)
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
      return {value: new Decoder(bytes).readUint53(), datatype: "uint"}
    } else if (sizeTag % 16 === VALUE_TYPE.LEB128_INT) {
      return {value: new Decoder(bytes).readInt53(), datatype: "int"}
    } else if (sizeTag % 16 === VALUE_TYPE.IEEE754) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      if (bytes.byteLength === 8) {
        return {value: view.getFloat64(0, true), datatype: "float64"}
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
 * structure for an individual change. Returns an array of
 * `{columnId, columnName, encoder}` objects.
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

    if (op.child && op.child.counter) {
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
      op.succ.sort(compareParsedOpIds)
      for (let i = 0; i < op.succ.length; i++) {
        columns.succActor.appendValue(op.succ[i].actorNum)
        columns.succCtr.appendValue(op.succ[i].counter)
      }
    } else {
      columns.predNum.appendValue(op.pred.length)
      op.pred.sort(compareParsedOpIds)
      for (let i = 0; i < op.pred.length; i++) {
        columns.predActor.appendValue(op.pred[i].actorNum)
        columns.predCtr.appendValue(op.pred[i].counter)
      }
    }
  }

  let columnList = []
  for (let {columnName, columnId} of forDocument ? DOC_OPS_COLUMNS : CHANGE_COLUMNS) {
    if (columns[columnName]) columnList.push({columnId, columnName, encoder: columns[columnName]})
  }
  return columnList.sort((a, b) => a.columnId - b.columnId)
}

function validDatatype(value, datatype) {
  if (datatype === undefined) {
    return (typeof value === 'string' || typeof value === 'boolean' || value === null)
  } else {
    return typeof value === 'number'
  }
}

function expandMultiOps(ops, startOp, actor) {
  let opNum = startOp
  let expandedOps = []
  for (const op of ops) {
    if (op.action === 'set' && op.values && op.insert) {
      if (op.pred.length !== 0) throw new RangeError('multi-insert pred must be empty')
      let lastElemId = op.elemId
      const datatype = op.datatype
      for (const value of op.values) {
        if (!validDatatype(value, datatype)) throw new RangeError(`Decode failed: bad value/datatype association (${value},${datatype})`)
        expandedOps.push({action: 'set', obj: op.obj, elemId: lastElemId, datatype, value, pred: [], insert: true})
        lastElemId = `${opNum}@${actor}`
        opNum += 1
      }
    } else if (op.action === 'del' && op.multiOp > 1) {
      if (op.pred.length !== 1) throw new RangeError('multiOp deletion must have exactly one pred')
      const startElemId = parseOpId(op.elemId), startPred = parseOpId(op.pred[0])
      for (let i = 0; i < op.multiOp; i++) {
        const elemId = `${startElemId.counter + i}@${startElemId.actorId}`
        const pred = [`${startPred.counter + i}@${startPred.actorId}`]
        expandedOps.push({action: 'del', obj: op.obj, elemId, pred})
        opNum += 1
      }
    } else {
      expandedOps.push(op)
      opNum += 1
    }
  }
  return expandedOps
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
    const obj = (op.objCtr === null) ? '_root' : `${op.objCtr}@${op.objActor}`
    const elemId = op.keyStr ? undefined : (op.keyCtr === 0 ? '_head' : `${op.keyCtr}@${op.keyActor}`)
    const action = ACTIONS[op.action] || op.action
    const newOp = elemId ? {obj, elemId, action} : {obj, key: op.keyStr, action}
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
      checkSortedOpIds(op.succNum.map(succ => ({counter: succ.succCtr, actorId: succ.succActor})))
    } else {
      newOp.pred = op.predNum.map(pred => `${pred.predCtr}@${pred.predActor}`)
      checkSortedOpIds(op.predNum.map(pred => ({counter: pred.predCtr, actorId: pred.predActor})))
    }
    newOps.push(newOp)
  }
  return newOps
}

/**
 * Throws an exception if the opIds in the given array are not in sorted order.
 */
function checkSortedOpIds(opIds) {
  let last = null
  for (let opId of opIds) {
    if (last && compareParsedOpIds(last, opId) !== -1) {
      throw new RangeError('operation IDs are not in ascending order')
    }
    last = opId
  }
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
  const emptyBuf = new Uint8Array(0)
  let decoders = [], columnIndex = 0, specIndex = 0

  while (columnIndex < columns.length || specIndex < columnSpec.length) {
    if (columnIndex === columns.length ||
        (specIndex < columnSpec.length && columnSpec[specIndex].columnId < columns[columnIndex].columnId)) {
      const {columnId, columnName} = columnSpec[specIndex]
      decoders.push({columnId, columnName, decoder: decoderByColumnId(columnId, emptyBuf)})
      specIndex++
    } else if (specIndex === columnSpec.length || columns[columnIndex].columnId < columnSpec[specIndex].columnId) {
      const {columnId, buffer} = columns[columnIndex]
      decoders.push({columnId, decoder: decoderByColumnId(columnId, buffer)})
      columnIndex++
    } else { // columns[columnIndex].columnId === columnSpec[specIndex].columnId
      const {columnId, buffer} = columns[columnIndex], {columnName} = columnSpec[specIndex]
      decoders.push({columnId, columnName, decoder: decoderByColumnId(columnId, buffer)})
      columnIndex++
      specIndex++
    }
  }
  return decoders
}

function decodeColumns(columns, actorIds, columnSpec) {
  columns = makeDecoders(columns, columnSpec)
  let parsedRows = []
  while (columns.some(col => !col.decoder.done)) {
    let row = {}, col = 0
    while (col < columns.length) {
      const columnId = columns[col].columnId
      let groupId = columnId >> 4, groupCols = 1
      while (col + groupCols < columns.length && columns[col + groupCols].columnId >> 4 === groupId) {
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

function decodeColumnInfo(decoder) {
  // A number that is all 1 bits except for the bit that indicates whether a column is
  // deflate-compressed. We ignore this bit when checking whether columns are sorted by ID.
  const COLUMN_ID_MASK = (-1 ^ COLUMN_TYPE_DEFLATE) >>> 0

  let lastColumnId = -1, columns = [], numColumns = decoder.readUint53()
  for (let i = 0; i < numColumns; i++) {
    const columnId = decoder.readUint53(), bufferLen = decoder.readUint53()
    if ((columnId & COLUMN_ID_MASK) <= (lastColumnId & COLUMN_ID_MASK)) {
      throw new RangeError('Columns must be in ascending order')
    }
    lastColumnId = columnId
    columns.push({columnId, bufferLen})
  }
  return columns
}

function encodeColumnInfo(encoder, columns) {
  const nonEmptyColumns = columns.filter(column => column.encoder.buffer.byteLength > 0)
  encoder.appendUint53(nonEmptyColumns.length)
  for (let column of nonEmptyColumns) {
    encoder.appendUint53(column.columnId)
    encoder.appendUint53(column.encoder.buffer.byteLength)
  }
}

function decodeChangeHeader(decoder) {
  const numDeps = decoder.readUint53(), deps = []
  for (let i = 0; i < numDeps; i++) {
    deps.push(bytesToHexString(decoder.readRawBytes(32)))
  }
  let change = {
    actor:   decoder.readHexString(),
    seq:     decoder.readUint53(),
    startOp: decoder.readUint53(),
    time:    decoder.readInt53(),
    message: decoder.readPrefixedString(),
    deps
  }
  const actorIds = [change.actor], numActorIds = decoder.readUint53()
  for (let i = 0; i < numActorIds; i++) actorIds.push(decoder.readHexString())
  change.actorIds = actorIds
  return change
}

/**
 * Assembles a chunk of encoded data containing a checksum, headers, and a
 * series of encoded columns. Calls `encodeHeaderCallback` with an encoder that
 * should be used to add the headers. The columns should be given as `columns`.
 */
function encodeContainer(chunkType, encodeContentsCallback) {
  const CHECKSUM_SIZE = 4 // checksum is first 4 bytes of SHA-256 hash of the rest of the data
  const HEADER_SPACE = MAGIC_BYTES.byteLength + CHECKSUM_SIZE + 1 + 5 // 1 byte type + 5 bytes length
  const body = new Encoder()
  // Make space for the header at the beginning of the body buffer. We will
  // copy the header in here later. This is cheaper than copying the body since
  // the body is likely to be much larger than the header.
  body.appendRawBytes(new Uint8Array(HEADER_SPACE))
  encodeContentsCallback(body)

  const bodyBuf = body.buffer
  const header = new Encoder()
  header.appendByte(chunkType)
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
  return {hash, bytes: bodyBuf.subarray(HEADER_SPACE - headerBuf.byteLength - CHECKSUM_SIZE - MAGIC_BYTES.byteLength)}
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

  const { hash, bytes } = encodeContainer(CHUNK_TYPE_CHANGE, encoder => {
    if (!Array.isArray(change.deps)) throw new TypeError('deps is not an array')
    encoder.appendUint53(change.deps.length)
    for (let hash of change.deps.slice().sort()) {
      encoder.appendRawBytes(hexStringToBytes(hash))
    }
    encoder.appendHexString(change.actor)
    encoder.appendUint53(change.seq)
    encoder.appendUint53(change.startOp)
    encoder.appendInt53(change.time)
    encoder.appendPrefixedString(change.message || '')
    encoder.appendUint53(actorIds.length - 1)
    for (let actor of actorIds.slice(1)) encoder.appendHexString(actor)

    const columns = encodeOps(change.ops, false)
    encodeColumnInfo(encoder, columns)
    for (let column of columns) encoder.appendRawBytes(column.encoder.buffer)
    if (change.extraBytes) encoder.appendRawBytes(change.extraBytes)
  })

  const hexHash = bytesToHexString(hash)
  if (changeObj.hash && changeObj.hash !== hexHash) {
    throw new RangeError(`Change hash does not match encoding: ${changeObj.hash} != ${hexHash}`)
  }
  return (bytes.byteLength >= DEFLATE_MIN_SIZE) ? deflateChange(bytes) : bytes
}

function decodeChangeColumns(buffer) {
  if (buffer[8] === CHUNK_TYPE_DEFLATE) buffer = inflateChange(buffer)
  const decoder = new Decoder(buffer)
  const header = decodeContainerHeader(decoder, true)
  const chunkDecoder = new Decoder(header.chunkData)
  if (!decoder.done) throw new RangeError('Encoded change has trailing data')
  if (header.chunkType !== CHUNK_TYPE_CHANGE) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)

  const change = decodeChangeHeader(chunkDecoder)
  const columns = decodeColumnInfo(chunkDecoder)
  for (let i = 0; i < columns.length; i++) {
    if ((columns[i].columnId & COLUMN_TYPE_DEFLATE) !== 0) {
      throw new RangeError('change must not contain deflated columns')
    }
    columns[i].buffer = chunkDecoder.readRawBytes(columns[i].bufferLen)
  }
  if (!chunkDecoder.done) {
    const restLen = chunkDecoder.buf.byteLength - chunkDecoder.offset
    change.extraBytes = chunkDecoder.readRawBytes(restLen)
  }

  change.columns = columns
  change.hash = header.hash
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
  if (buffer[8] === CHUNK_TYPE_DEFLATE) buffer = inflateChange(buffer)
  const header = decodeContainerHeader(new Decoder(buffer), computeHash)
  if (header.chunkType !== CHUNK_TYPE_CHANGE) {
    throw new RangeError('Buffer chunk type is not a change')
  }
  const meta = decodeChangeHeader(new Decoder(header.chunkData))
  meta.change = buffer
  if (computeHash) meta.hash = header.hash
  return meta
}

/**
 * Compresses a binary change using DEFLATE.
 */
function deflateChange(buffer) {
  const header = decodeContainerHeader(new Decoder(buffer), false)
  if (header.chunkType !== CHUNK_TYPE_CHANGE) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)
  const compressed = pako.deflateRaw(header.chunkData)
  const encoder = new Encoder()
  encoder.appendRawBytes(buffer.subarray(0, 8)) // copy MAGIC_BYTES and checksum
  encoder.appendByte(CHUNK_TYPE_DEFLATE)
  encoder.appendUint53(compressed.byteLength)
  encoder.appendRawBytes(compressed)
  return encoder.buffer
}

/**
 * Decompresses a binary change that has been compressed with DEFLATE.
 */
function inflateChange(buffer) {
  const header = decodeContainerHeader(new Decoder(buffer), false)
  if (header.chunkType !== CHUNK_TYPE_DEFLATE) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)
  const decompressed = pako.inflateRaw(header.chunkData)
  const encoder = new Encoder()
  encoder.appendRawBytes(buffer.subarray(0, 8)) // copy MAGIC_BYTES and checksum
  encoder.appendByte(CHUNK_TYPE_CHANGE)
  encoder.appendUint53(decompressed.byteLength)
  encoder.appendRawBytes(decompressed)
  return encoder.buffer
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
      if (chunk[8] === CHUNK_TYPE_DOCUMENT) {
        decoded = decoded.concat(decodeDocument(chunk))
      } else if (chunk[8] === CHUNK_TYPE_CHANGE || chunk[8] === CHUNK_TYPE_DEFLATE) {
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
  if (a === '_root') return -1
  if (b === '_root') return +1
  const a_ = parseOpId(a), b_ = parseOpId(b)
  if (a_.counter < b_.counter) return -1
  if (a_.counter > b_.counter) return +1
  if (a_.actorId < b_.actorId) return -1
  if (a_.actorId > b_.actorId) return +1
  return 0
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
        if (op.elemId) {
          const elemId = op.insert ? op.id : op.elemId
          opsById[succ] = {id: succ, action: 'del', obj: op.obj, elemId, pred: []}
        } else {
          opsById[succ] = {id: succ, action: 'del', obj: op.obj, key: op.key, pred: []}
        }
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

    if (change.extraLen_datatype !== VALUE_TYPE.BYTES) {
      throw new RangeError(`Bad datatype for extra bytes: ${VALUE_TYPE.BYTES}`)
    }
    change.extraBytes = change.extraLen
    delete change.extraLen_datatype

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

function encodeDocumentHeader(doc) {
  const { changesColumns, opsColumns, actorIds, heads, headsIndexes, extraBytes } = doc
  for (let column of changesColumns) deflateColumn(column)
  for (let column of opsColumns) deflateColumn(column)

  return encodeContainer(CHUNK_TYPE_DOCUMENT, encoder => {
    encoder.appendUint53(actorIds.length)
    for (let actor of actorIds) {
      encoder.appendHexString(actor)
    }
    encoder.appendUint53(heads.length)
    for (let head of heads.sort()) {
      encoder.appendRawBytes(hexStringToBytes(head))
    }
    encodeColumnInfo(encoder, changesColumns)
    encodeColumnInfo(encoder, opsColumns)
    for (let column of changesColumns) encoder.appendRawBytes(column.encoder.buffer)
    for (let column of opsColumns) encoder.appendRawBytes(column.encoder.buffer)
    for (let index of headsIndexes) encoder.appendUint53(index)
    if (extraBytes) encoder.appendRawBytes(extraBytes)
  }).bytes
}

function decodeDocumentHeader(buffer) {
  const documentDecoder = new Decoder(buffer)
  const header = decodeContainerHeader(documentDecoder, true)
  const decoder = new Decoder(header.chunkData)
  if (!documentDecoder.done) throw new RangeError('Encoded document has trailing data')
  if (header.chunkType !== CHUNK_TYPE_DOCUMENT) throw new RangeError(`Unexpected chunk type: ${header.chunkType}`)

  const actorIds = [], numActors = decoder.readUint53()
  for (let i = 0; i < numActors; i++) {
    actorIds.push(decoder.readHexString())
  }
  const heads = [], headsIndexes = [], numHeads = decoder.readUint53()
  for (let i = 0; i < numHeads; i++) {
    heads.push(bytesToHexString(decoder.readRawBytes(32)))
  }

  const changesColumns = decodeColumnInfo(decoder)
  const opsColumns = decodeColumnInfo(decoder)
  for (let i = 0; i < changesColumns.length; i++) {
    changesColumns[i].buffer = decoder.readRawBytes(changesColumns[i].bufferLen)
    inflateColumn(changesColumns[i])
  }
  for (let i = 0; i < opsColumns.length; i++) {
    opsColumns[i].buffer = decoder.readRawBytes(opsColumns[i].bufferLen)
    inflateColumn(opsColumns[i])
  }
  if (!decoder.done) {
    for (let i = 0; i < numHeads; i++) headsIndexes.push(decoder.readUint53())
  }

  const extraBytes = decoder.readRawBytes(decoder.buf.byteLength - decoder.offset)
  return { changesColumns, opsColumns, actorIds, heads, headsIndexes, extraBytes }
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
 * DEFLATE-compresses the given column if it is large enough to make the compression worthwhile.
 */
function deflateColumn(column) {
  if (column.encoder.buffer.byteLength >= DEFLATE_MIN_SIZE) {
    column.encoder = {buffer: pako.deflateRaw(column.encoder.buffer)}
    column.columnId |= COLUMN_TYPE_DEFLATE
  }
}

/**
 * Decompresses the given column if it is DEFLATE-compressed.
 */
function inflateColumn(column) {
  if ((column.columnId & COLUMN_TYPE_DEFLATE) !== 0) {
    column.buffer = pako.inflateRaw(column.buffer)
    column.columnId ^= COLUMN_TYPE_DEFLATE
  }
}

module.exports = {
  COLUMN_TYPE, VALUE_TYPE, ACTIONS, OBJECT_TYPE, DOC_OPS_COLUMNS, CHANGE_COLUMNS, DOCUMENT_COLUMNS,
  encoderByColumnId, decoderByColumnId, makeDecoders, decodeValue,
  splitContainers, encodeChange, decodeChangeColumns, decodeChange, decodeChangeMeta, decodeChanges,
  encodeDocumentHeader, decodeDocumentHeader, decodeDocument
}
