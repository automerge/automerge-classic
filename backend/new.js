const { parseOpId, copyObject } = require('../src/common')
const { COLUMN_TYPE, VALUE_TYPE, ACTIONS, OBJECT_TYPE, DOC_OPS_COLUMNS, CHANGE_COLUMNS,
  encoderByColumnId, decoderByColumnId, makeDecoders, decodeValue,
  encodeChange, decodeChangeColumns, decodeChangeMeta, decodeChanges, decodeDocumentHeader, encodeDocument,
  appendEdit } = require('./columnar')

const DOC_OPS_COLUMNS_REV = Object.entries(DOC_OPS_COLUMNS)
  .reduce((acc, [k, v]) => { acc[v] = k; return acc }, [])

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
 * Scans a chunk of document operations, encoded as columns `docCols`, to find the position at which
 * an operation (or sequence of operations) `ops` should be applied. Returns an object with keys:
 *   - `skipCount`: the number of operations, counted from the start of the chunk, after which the
 *     new operations should be inserted or applied.
 *   - `visibleCount`: if modifying a list object, the number of visible (i.e. non-deleted) list
 *     elements that precede the position where the new operations should be applied.
 */
function seekToOp(ops, docCols, actorIds) {
  const { objActor, objCtr, keyActor, keyCtr, keyStr, idActor, idCtr, insert } = ops
  const [objActorD, objCtrD, /* keyActorD */, /* keyCtrD */, keyStrD, idActorD, idCtrD, insertD, actionD,
    /* valLenD */, /* valRawD */, /* chldActorD */, /* chldCtrD */, succNumD] = docCols.map(col => col.decoder)
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
    const colCount = (outCol.columnId >> 4 === lastGroup) ? lastCardinality : count

    if (outCol.columnId % 8 === COLUMN_TYPE.GROUP_CARD) {
      lastGroup = outCol.columnId >> 4
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
      lastGroup = col.columnId >> 4
      lastCardinality = col.decoder.readValue() || 0
      colValue = lastCardinality
    } else if (col.columnId >> 4 === lastGroup) {
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
        lastGroup = outCol.columnId >> 4
        lastCardinality = colValue
        outCol.encoder.appendValue(colValue)
      } else if (outCol.columnId >> 4 === lastGroup) {
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
      lastGroup = outCol.columnId >> 4
      lastCardinality = 0
      outCol.encoder.appendValue(0)
    } else if (outCol.columnId % 8 !== COLUMN_TYPE.VALUE_RAW) {
      const count = (outCol.columnId >> 4 === lastGroup) ? lastCardinality : 1
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
  const [objActorD, objCtrD, keyActorD, keyCtrD, keyStrD, /* idActorD */, /* idCtrD */, insertD, actionD] =
    changeCols.map(col => col.decoder)
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
    thisOp.objId = thisOp.objCtr === null ? '_root' : `${thisOp.objCtr}@${thisOp.objActor}`
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

function emptyObjectPatch(objectId, type) {
  if (type === 'list' || type === 'text') {
    return {objectId, type, edits: []}
  } else {
    return {objectId, type, props: {}}
  }
}

/**
 * `edits` is an array of (SingleInsertEdit | MultiInsertEdit | UpdateEdit | RemoveEdit) list edits
 * for a patch. This function appends an UpdateEdit to this array. A conflict is represented by
 * having several consecutive edits with the same index, and this can be realised by calling
 * `appendUpdate` several times for the same list element. On the first such call, `firstUpdate`
 * must be true.
 *
 * It is possible that coincidentally the previous edit (potentially arising from a different
 * change) is for the same index. If this is the case, to avoid accidentally treating consecutive
 * updates for the same index as a conflict, we remove the previous edit for the same index. This is
 * safe because the previous edit is overwritten by the new edit being appended, and we know that
 * it's for the same list elements because there are no intervening insertions/deletions that could
 * have changed the indexes.
 */
function appendUpdate(edits, index, elemId, opId, value, firstUpdate) {
  let insert = false
  if (firstUpdate) {
    // Pop all edits for the same index off the end of the edits array. This sequence may begin with
    // either an insert or an update. If it's an insert, we remember that fact, and use it below.
    while (!insert && edits.length > 0) {
      const lastEdit = edits[edits.length - 1]
      if ((lastEdit.action === 'insert' || lastEdit.action === 'update') && lastEdit.index === index) {
        edits.pop()
        insert = (lastEdit.action === 'insert')
      } else if (lastEdit.action === 'multi-insert' && lastEdit.index + lastEdit.values.length - 1 === index) {
        lastEdit.values.pop()
        insert = true
      } else {
        break
      }
    }
  }

  // If we popped an insert edit off the edits array, we need to turn the new update into an insert
  // in order to ensure the list element still gets inserted (just with a new value).
  if (insert) {
    appendEdit(edits, {action: 'insert', index, elemId, opId, value})
  } else {
    appendEdit(edits, {action: 'update', index, opId, value})
  }
}

/**
 * `edits` is an array of (SingleInsertEdit | MultiInsertEdit | UpdateEdit | RemoveEdit) list edits
 * for a patch. We assume that there is a suffix of this array that consists of an insertion at
 * position `index`, followed by zero or more UpdateEdits at the same index. This function rewrites
 * that suffix to be all updates instead. This is needed because sometimes when generating a patch
 * we think we are performing a list insertion, but then it later turns out that there was already
 * an existing value at that list element, and so we actually need to do an update, not an insert.
 *
 * If the suffix is preceded by one or more updates at the same index, those earlier updates are
 * removed by `appendUpdate()` to ensure we don't inadvertently treat them as part of the same
 * conflict.
 */
function convertInsertToUpdate(edits, index, elemId) {
  let updates = []
  while (edits.length > 0) {
    let lastEdit = edits[edits.length - 1]
    if (lastEdit.action === 'insert') {
      if (lastEdit.index !== index) throw new RangeError('last edit has unexpected index')
      updates.unshift(edits.pop())
      break
    } else if (lastEdit.action === 'update') {
      if (lastEdit.index !== index) throw new RangeError('last edit has unexpected index')
      updates.unshift(edits.pop())
    } else {
      // It's impossible to encounter a remove edit here because the state machine in
      // updatePatchProperty() ensures that a property can have either an insert or a remove edit,
      // but not both. It's impossible to encounter a multi-insert here because multi-inserts always
      // have equal elemId and opId (i.e. they can only be used for the operation that first inserts
      // an element, but not for any subsequent assignments to that list element); moreover,
      // convertInsertToUpdate is only called if an insert action is followed by a non-overwritten
      // document op. The fact that there is a non-overwritten document op after another op on the
      // same list element implies that the original insertion op for that list element must be
      // overwritten, and thus the original insertion op cannot have given rise to a multi-insert.
      throw new RangeError('last edit has unexpected action')
    }
  }

  // Now take the edits we popped off and push them back onto the list again
  let firstUpdate = true
  for (let update of updates) {
    appendUpdate(edits, index, elemId, update.opId, update.value, firstUpdate)
    firstUpdate = false
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
function updatePatchProperty(patches, ops, op, docState, propState, listIndex, oldSuccNum) {
  // FIXME: these constants duplicate those at the beginning of mergeDocChangeOps()
  const objActor = 0, objCtr = 1, keyActor = 2, keyCtr = 3, keyStr = 4, idActor = 5, idCtr = 6, insert = 7, action = 8, // eslint-disable-line
    valLen = 9, valRaw = 10, predNum = 13, predActor = 14, predCtr = 15, succNum = 13, succActor = 14, succCtr = 15 // eslint-disable-line

  const objectId = ops.objId
  const elemId = op[keyStr] ? op[keyStr]
                            : op[insert] ? `${op[idCtr]}@${docState.actorIds[op[idActor]]}`
                                         : `${op[keyCtr]}@${docState.actorIds[op[keyActor]]}`

  // firstOp is true if the current operation is the first of a sequence of ops for the same key
  const firstOp = !propState[elemId]
  if (!propState[elemId]) propState[elemId] = {visibleOps: [], hasChild: false}

  // An operation is overwritten if it is a document operation that has at least one successor
  const isOverwritten = (oldSuccNum !== undefined && op[succNum] > 0)

  // Record all visible values for the property, and whether it has any child object
  if (!isOverwritten) {
    propState[elemId].visibleOps.push(op)
    propState[elemId].hasChild = propState[elemId].hasChild || (op[action] % 2) === 0 // even-numbered action == make* operation
  }

  // If one or more of the values of the property is a child object, we update objectMeta to store
  // all of the visible values of the property (even the non-child-object values). Then, when we
  // subsequently process an update within that child object, we can construct the patch to
  // contain the conflicting values.
  const prevChildren = docState.objectMeta[objectId].children[elemId]
  if (propState[elemId].hasChild || (prevChildren && Object.keys(prevChildren).length > 0)) {
    let values = {}
    for (let visible of propState[elemId].visibleOps) {
      const opId = `${visible[idCtr]}@${docState.actorIds[visible[idActor]]}`
      if (ACTIONS[visible[action]] === 'set') {
        values[opId] = Object.assign({type: 'value'}, decodeValue(visible[valLen], visible[valRaw]))
      } else if (visible[action] % 2 === 0) {
        const type = visible[action] < ACTIONS.length ? OBJECT_TYPE[ACTIONS[visible[action]]] : null
        values[opId] = emptyObjectPatch(opId, type)
      }
    }

    // Copy so that objectMeta is not modified if an exception is thrown while applying change
    deepCopyUpdate(docState.objectMeta, [objectId, 'children', elemId], values)
  }

  const opId = `${op[idCtr]}@${docState.actorIds[op[idActor]]}`
  let patchKey, patchValue

  // For counters, increment operations are succs to the set operation that created the counter,
  // but in this case we want to add the values rather than overwriting them.
  if (isOverwritten && ACTIONS[op[action]] === 'set' && (op[valLen] & 0x0f) === VALUE_TYPE.COUNTER) {
    // This is the initial set operation that creates a counter. Initialise the counter state
    // to contain all successors of the set operation. Only if we later find that each of these
    // successor operations is an increment, we make the counter visible in the patch.
    if (!propState[elemId]) propState[elemId] = {visibleOps: [], hasChild: false}
    if (!propState[elemId].counterStates) propState[elemId].counterStates = {}
    let counterStates = propState[elemId].counterStates
    let counterState = {opId, value: decodeValue(op[valLen], op[valRaw]).value, succs: {}}

    for (let i = 0; i < op[succNum]; i++) {
      const succOp = `${op[succCtr][i]}@${docState.actorIds[op[succActor][i]]}`
      counterStates[succOp] = counterState
      counterState.succs[succOp] = true
    }

  } else if (ACTIONS[op[action]] === 'inc') {
    // Incrementing a previously created counter.
    if (!propState[elemId] || !propState[elemId].counterStates || !propState[elemId].counterStates[opId]) {
      throw new RangeError(`increment operation ${opId} for unknown counter`)
    }
    let counterState = propState[elemId].counterStates[opId]
    counterState.value += decodeValue(op[valLen], op[valRaw]).value
    delete counterState.succs[opId]

    if (Object.keys(counterState.succs).length === 0) {
      patchKey = counterState.opId
      patchValue = {type: 'value', datatype: 'counter', value: counterState.value}
      // TODO if the counter is in a list element, we need to add a 'remove' action when deleted
    }

  } else if (!isOverwritten) {
    // Add the value to the patch if it is not overwritten (i.e. if it has no succs).
    if (ACTIONS[op[action]] === 'set') {
      patchKey = opId
      patchValue = Object.assign({type: 'value'}, decodeValue(op[valLen], op[valRaw]))
    } else if (op[action] % 2 === 0) { // even-numbered action == make* operation
      if (!patches[opId]) {
        const type = op[action] < ACTIONS.length ? OBJECT_TYPE[ACTIONS[op[action]]] : null
        patches[opId] = emptyObjectPatch(opId, type)
      }
      patchKey = opId
      patchValue = patches[opId]
    }
  }

  if (!patches[objectId]) patches[objectId] = emptyObjectPatch(objectId, docState.objectMeta[objectId].type)
  const patch = patches[objectId]

  // Updating a list or text object (with elemId key)
  if (op[keyStr] === null) {
    // If we come across any document op that was previously non-overwritten/non-deleted, that
    // means the current list element already had a value before this change was applied, and
    // therefore the current element cannot be an insert. If we already registered an insert, we
    // have to convert it into an update.
    if (oldSuccNum === 0 && propState[elemId].action === 'insert') {
      propState[elemId].action = 'update'
      convertInsertToUpdate(patch.edits, listIndex, elemId)
    }

    if (patchValue) {
      // If the op has a non-overwritten value and it came from the change, it's an insert.
      // (It's not necessarily the case that op[insert] is true: if a list element is concurrently
      // deleted and updated, the node that first processes the deletion and then the update will
      // observe the update as a re-insertion of the deleted list element.)
      if (oldSuccNum === undefined && !propState[elemId].action) {
        propState[elemId].action = 'insert'
        appendEdit(patch.edits, {action: 'insert', index: listIndex, elemId, opId: patchKey, value: patchValue})

      // If the property has a value and it's not an insert, then it must be an update.
      // We might have previously registered it as a remove, in which case we convert it to update.
      } else if (propState[elemId].action === 'remove') {
        let lastEdit = patch.edits[patch.edits.length - 1]
        if (lastEdit.action !== 'remove') throw new RangeError('last edit has unexpected type')
        if (lastEdit.count > 1) lastEdit.count -= 1; else patch.edits.pop()
        propState[elemId].action = 'update'
        appendUpdate(patch.edits, listIndex, elemId, patchKey, patchValue, true)

      } else {
        // A 'normal' update
        appendUpdate(patch.edits, listIndex, elemId, patchKey, patchValue, !propState[elemId].action)
        if (!propState[elemId].action) propState[elemId].action = 'update'
      }

    } else if (oldSuccNum === 0 && !propState[elemId].action) {
      // If the property used to have a non-overwritten/non-deleted value, but no longer, it's a remove
      propState[elemId].action = 'remove'
      appendEdit(patch.edits, {action: 'remove', index: listIndex, count: 1})
    }

  } else {
    // Updating a map or table (with string key)
    if (firstOp || !patch.props[op[keyStr]]) patch.props[op[keyStr]] = {}
    if (patchValue) patch.props[op[keyStr]][patchKey] = patchValue
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
function mergeDocChangeOps(patches, outCols, ops, changeCols, docState, listIndex) {
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
  let changeOp = null, nextChangeOp = null, changeOps = [], predSeen = []

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
          predSeen.push(new Array(nextChangeOp[predNum]))
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
        (docOp[insert] && docOp[idActor]  === changeOp[keyActor] && docOp[idCtr]  === changeOp[keyCtr]))

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
      for (let opIndex = 0; opIndex < changeOps.length; opIndex++) {
        const op = changeOps[opIndex]
        for (let i = 0; i < op[predNum]; i++) {
          if (op[predActor][i] === docOp[idActor] && op[predCtr][i] === docOp[idCtr]) {
            // Insert into the doc op's succ list such that the lists remains sorted
            let j = 0
            while (j < docOp[succNum] && (docOp[succCtr][j] < op[idCtr] ||
                   docOp[succCtr][j] === op[idCtr] && docState.actorIds[docOp[succActor][j]] < ops.idActor)) j++
            docOp[succCtr].splice(j, 0, op[idCtr])
            docOp[succActor].splice(j, 0, ops.idActorIndex)
            docOp[succNum]++
            predSeen[opIndex][i] = true
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
        updatePatchProperty(patches, ops, docOp, docState, propState, listIndex, docOpOldSuccNum)

        // A deletion op in the change is represented in the document only by its entries in the
        // succ list of the operations it overwrites; it has no separate row in the set of ops.
        for (let i = changeOps.length - 1; i >= 0; i--) {
          let deleted = true
          for (let j = 0; j < changeOps[i][predNum]; j++) {
            if (!predSeen[i][j]) deleted = false
          }
          if (ACTIONS[changeOps[i][action]] === 'del' && deleted) {
            changeOps.splice(i, 1)
            predSeen.splice(i, 1)
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
        let op = changeOps[i]
        // Check that we've seen all ops mentioned in `pred` (they must all have lower opIds than
        // the change op's own opId, so we must have seen them already)
        for (let j = 0; j < op[predNum]; j++) {
          if (!predSeen[i][j]) {
            throw new RangeError(`no matching operation for pred: ${op[predCtr][j]}@${docState.actorIds[op[predActor][j]]}`)
          }
        }
        updatePatchProperty(patches, ops, op, docState, propState, listIndex)
        appendOperation(outCols, changeCols, op)
        if (op[insert]) {
          elemVisible = false
          listIndex++
        } else {
          elemVisible = true
        }
      }

      if (takeChangeOps === changeOps.length) {
        changeOps.length = 0
        predSeen.length = 0
      } else {
        changeOps.splice(0, takeChangeOps)
        predSeen.splice(0, takeChangeOps)
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
function applyOps(patches, ops, changeCols, docState) {
  for (let col of docState.opsCols) col.decoder.reset()
  const {skipCount, visibleCount} = seekToOp(ops, docState.opsCols, docState.actorIds)
  if (docState.lastIndex[ops.objId] && visibleCount < docState.lastIndex[ops.objId]) {
    throw new RangeError('list element accesses must occur in ascending order')
  }
  docState.lastIndex[ops.objId] = visibleCount
  for (let col of docState.opsCols) col.decoder.reset()

  let outCols = docState.allCols.map(columnId => ({columnId, encoder: encoderByColumnId(columnId)}))
  copyColumns(outCols, docState.opsCols, skipCount)
  const {opsAppended, docOpsConsumed} = mergeDocChangeOps(patches, outCols, ops, changeCols, docState, visibleCount)
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
function getAllColumns(changeCols) {
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
  for (let columnId of Object.values(DOC_OPS_COLUMNS)) allCols[columnId] = true

  // Final document should contain any columns in either the document or the change, except for
  // pred, since the document encoding uses succ instead of pred
  delete allCols[CHANGE_COLUMNS.predNum]
  delete allCols[CHANGE_COLUMNS.predActor]
  delete allCols[CHANGE_COLUMNS.predCtr]
  return Object.keys(allCols).map(id => parseInt(id, 10)).sort((a, b) => a - b)
}

/**
 * Takes a decoded change header, including an array of actorIds. Returns an object of the form
 * `{actorIds, actorTable}`, where `actorIds` is an updated array of actorIds appearing in the
 * document (including the new change's actorId), and `actorTable` is an array for translating
 * the change's actor indexes into the document's actor indexes.
 */
function getActorTable(actorIds, change) {
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
 * `objectMeta`, a map from objectIds to metadata about that object (such as its parent in the
 * document tree). Mutates `patches` such that child objects are linked into their parent object,
 * all the way to the root object.
 */
function setupPatches(patches, objectIds, docState) {
  for (let objectId of objectIds) {
    let meta = docState.objectMeta[objectId], childMeta = null, patchExists = false
    while (true) {
      const hasChildren = childMeta && Object.keys(meta.children[childMeta.parentKey]).length > 0
      if (!patches[objectId]) patches[objectId] = emptyObjectPatch(objectId, meta.type)

      if (childMeta && hasChildren) {
        if (meta.type === 'list' || meta.type === 'text') {
          // In list/text objects, parentKey is an elemID. First see if it already appears in an edit
          for (let edit of patches[objectId].edits) {
            if (edit.opId && meta.children[childMeta.parentKey][edit.opId]) {
              patchExists = true
            }
          }

          // If we need to add an edit, we first have to translate the elemId into an index
          if (!patchExists) {
            const obj = parseOpId(objectId), elem = parseOpId(childMeta.parentKey)
            const seekPos = {
              objActor: obj.actorId,  objCtr: obj.counter,
              keyActor: elem.actorId, keyCtr: elem.counter,
              keyStr:   null,         insert: false
            }
            const { visibleCount } = seekToOp(seekPos, docState.opsCols, docState.actorIds)

            for (let [opId, value] of Object.entries(meta.children[childMeta.parentKey])) {
              let patchValue = value
              if (value.objectId) {
                if (!patches[value.objectId]) patches[value.objectId] = emptyObjectPatch(value.objectId, value.type)
                patchValue = patches[value.objectId]
              }
              const edit = {action: 'update', index: visibleCount, opId, value: patchValue}
              appendEdit(patches[objectId].edits, edit)
            }
          }

        } else {
          // Non-list object: parentKey is the name of the property being updated (a string)
          if (!patches[objectId].props[childMeta.parentKey]) {
            patches[objectId].props[childMeta.parentKey] = {}
          }
          let values = patches[objectId].props[childMeta.parentKey]

          for (let [opId, value] of Object.entries(meta.children[childMeta.parentKey])) {
            if (values[opId]) {
              patchExists = true
            } else if (value.objectId) {
              if (!patches[value.objectId]) patches[value.objectId] = emptyObjectPatch(value.objectId, value.type)
              values[opId] = patches[value.objectId]
            } else {
              values[opId] = value
            }
          }
        }
      }

      if (patchExists || !meta.parentObj || (childMeta && !hasChildren)) break
      childMeta = meta
      objectId = meta.parentObj
      meta = docState.objectMeta[objectId]
    }
  }
  return patches
}

/**
 * Takes an array of binary-encoded changes (`changeBuffers`) and applies them to a document.
 * `docState` contains a bunch of fields describing the document state. This function returns an
 * array of decoded change headers, mutates `docState` to contain the updated document state, and
 * mutates `patches` to contain a patch to return to the frontend. Only the top-level `docState`
 * object is mutated; all nested objects within it are treated as immutable.
 */
function applyChanges(patches, changeBuffers, docState) {
  let allObjectIds = {}, heads = {}, clock = copyObject(docState.clock)
  for (let head of docState.heads) heads[head] = true

  let decodedChanges = [], changeHashes = {}
  for (let changeBuffer of changeBuffers) {
    const change = decodeChangeColumns(changeBuffer) // { actor, seq, startOp, time, message, deps, actorIds, hash, columns }
    decodedChanges.push(change)
    changeHashes[change.hash] = true

    for (let dep of change.deps) {
      // TODO enqueue changes that are not yet causally ready rather than throwing an exception
      if (!docState.changeByHash[dep] && !changeHashes[dep]) {
        throw new RangeError(`missing dependency ${dep}`)
      }
      delete heads[dep]
    }
    heads[change.hash] = true

    const expectedSeq = (clock[change.actor] || 0) + 1
    if (change.seq !== expectedSeq) {
      throw new RangeError(`Expected seq ${expectedSeq}, got seq ${change.seq} from actor ${change.actor}`)
    }
    clock[change.actor] = change.seq

    const changeCols = makeDecoders(change.columns, CHANGE_COLUMNS)
    docState.allCols = getAllColumns(changeCols)
    const {actorIds, actorTable} = getActorTable(docState.actorIds, change)
    docState.actorIds = actorIds
    docState.actorTable = actorTable
    const actorIndex = docState.actorIds.indexOf(change.actorIds[0])

    const {opSequences, objectIds} = groupRelatedOps(change, changeCols, docState.objectMeta)
    for (let id of objectIds) allObjectIds[id] = true
    const lastOps = opSequences[opSequences.length - 1]
    if (lastOps) docState.maxOp = Math.max(docState.maxOp, lastOps.idCtr + lastOps.consecutiveOps - 1)

    for (let col of changeCols) col.decoder.reset()
    for (let op of opSequences) {
      op.idActorIndex = actorIndex
      applyOps(patches, op, changeCols, docState)
    }
  }

  setupPatches(patches, Object.keys(allObjectIds), docState)

  docState.heads = Object.keys(heads).sort()
  docState.clock = clock
  return decodedChanges
}


class BackendDoc {
  constructor(buffer) {
    this.maxOp = 0
    this.pendingChanges = 0
    this.changes = []
    this.changeByHash = {}
    this.dependenciesByHash = {}
    this.dependentsByHash = {}
    this.hashesByActor = {}
    this.actorIds = []
    this.heads = []
    this.clock = {}

    if (buffer) {
      const doc = decodeDocumentHeader(buffer)
      for (let change of decodeChanges([buffer])) {
        const binaryChange = encodeChange(change) // decoding and re-encoding, argh!
        this.changes.push(binaryChange)
        this.changeByHash[change.hash] = binaryChange
        this.clock[change.actor] = Math.max(change.seq, this.clock[change.actor] || 0)
      }
      this.actorIds = doc.actorIds
      this.heads = doc.heads
      this.docColumns = makeDecoders(doc.opsColumns, DOC_OPS_COLUMNS)
      this.numOps = 0 // TODO count actual number of ops in the document
      this.objectMeta = {} // TODO fill this in
    } else {
      this.docColumns = makeDecoders([], DOC_OPS_COLUMNS)
      this.numOps = 0
      this.objectMeta = {_root: {parentObj: null, parentKey: null, opId: null, type: 'map', children: {}}}
    }
  }

  /**
   * Makes a copy of this BackendDoc that can be independently modified.
   */
  clone() {
    let copy = new BackendDoc()
    copy.maxOp = this.maxOp
    copy.changes = this.changes.slice()
    copy.changeByHash = copyObject(this.changeByHash)
    copy.dependenciesByHash = copyObject(this.dependenciesByHash)
    copy.dependentsByHash = Object.entries(this.dependentsByHash).reduce((acc, [k, v]) => { acc[k] = v.slice(); return acc })
    copy.actorIds = this.actorIds // immutable, no copying needed
    copy.heads = this.heads // immutable, no copying needed
    copy.clock = this.clock // immutable, no copying needed
    copy.docColumns = this.docColumns // immutable, no copying needed
    copy.numOps = this.numOps
    copy.objectMeta = this.objectMeta // immutable, no copying needed
    return copy
  }

  /**
   * Parses the changes given as Uint8Arrays in `changeBuffers`, and applies them to the current
   * document. Returns a patch to apply to the frontend. If an exception is thrown, the document
   * object is not modified.
   */
  applyChanges(changeBuffers, isLocal = false) {
    let patches = {_root: {objectId: '_root', type: 'map', props: {}}}
    let docState = {
      maxOp: this.maxOp,
      changeByHash: this.changeByHash,
      actorIds: this.actorIds,
      heads: this.heads,
      clock: this.clock,
      opsCols: this.docColumns,
      numOps: this.numOps,
      objectMeta: Object.assign({}, this.objectMeta),
      lastIndex: {}
    }

    const decodedChanges = applyChanges(patches, changeBuffers, docState)

    // Update the document state only if `applyChanges` does not throw an exception
    for (let i = 0; i < decodedChanges.length; i++) {
      const change = decodedChanges[i]
      if (change.seq === 1) this.hashesByActor[change.actor] = []
      this.hashesByActor[change.actor].push(change.hash)
      this.changeByHash[change.hash] = changeBuffers[i]
      this.dependenciesByHash[change.hash] = change.deps
      this.dependentsByHash[change.hash] = []
      for (let dep of change.deps) this.dependentsByHash[dep].push(change.hash)
    }

    this.changes.push(...changeBuffers)
    this.maxOp        = docState.maxOp
    this.actorIds     = docState.actorIds
    this.heads        = docState.heads
    this.clock        = docState.clock
    this.docColumns   = docState.opsCols
    this.numOps       = docState.numOps
    this.objectMeta   = docState.objectMeta

    let patch = {
      maxOp: this.maxOp, clock: this.clock, deps: this.heads,
      pendingChanges: this.pendingChanges, diffs: patches._root
    }
    if (isLocal && decodedChanges.length === 1) {
      patch.actor = decodedChanges[0].actor
      patch.seq = decodedChanges[0].seq
    }
    return patch
  }

  /**
   * Returns all the changes that need to be sent to another replica. `haveDeps` is a list of change
   * hashes (as hex strings) of the heads that the other replica has. The changes in `haveDeps` and
   * any of their transitive dependencies will not be returned; any changes later than or concurrent
   * to the hashes in `haveDeps` will be returned. If `haveDeps` is an empty array, all changes are
   * returned. Throws an exception if any of the given hashes are not known to this replica.
   */
  getChanges(haveDeps) {
    // If the other replica has nothing, return all changes in history order
    if (haveDeps.length === 0) {
      return this.changes
    }

    // Fast path for the common case where all new changes depend only on haveDeps
    let stack = [], seenHashes = {}, toReturn = []
    for (let hash of haveDeps) {
      seenHashes[hash] = true
      const successors = this.dependentsByHash[hash]
      if (!successors) throw new RangeError(`hash not found: ${hash}`)
      stack.push(...successors)
    }

    // Depth-first traversal of the hash graph to find all changes that depend on `haveDeps`
    while (stack.length > 0) {
      const hash = stack.pop()
      seenHashes[hash] = true
      toReturn.push(hash)
      if (!this.dependenciesByHash[hash].every(dep => seenHashes[dep])) {
        // If a change depends on a hash we have not seen, abort the traversal and fall back to the
        // slower algorithm. This will sometimes abort even if all new changes depend on `haveDeps`,
        // because our depth-first traversal is not necessarily a topological sort of the graph.
        break
      }
      stack.push(...this.dependentsByHash[hash])
    }

    // If the traversal above has encountered all the heads, and was not aborted early due to
    // a missing dependency, then the set of changes it has found is complete, so we can return it
    if (stack.length === 0 && this.heads.every(head => seenHashes[head])) {
      return toReturn.map(hash => this.changeByHash[hash])
    }

    // If we haven't encountered all of the heads, we have to search harder. This will happen if
    // changes were added that are concurrent to `haveDeps`
    stack = haveDeps.slice()
    seenHashes = {}
    while (stack.length > 0) {
      const hash = stack.pop()
      if (!seenHashes[hash]) {
        const deps = this.dependenciesByHash[hash]
        if (!deps) throw new RangeError(`hash not found: ${hash}`)
        stack.push(...deps)
        seenHashes[hash] = true
      }
    }

    return this.changes.filter(change => !seenHashes[decodeChangeMeta(change, true).hash])
  }

  /**
   * Returns all changes that are present in this BackendDoc, but not present in the `other`
   * BackendDoc.
   */
  getChangesAdded(other) {
    // Depth-first traversal from the heads through the dependency graph,
    // until we reach a change that is already present in opSet1
    let stack = this.heads.slice(), seenHashes = {}, toReturn = []
    while (stack.length > 0) {
      const hash = stack.pop()
      if (!seenHashes[hash] && !other.changeByHash[hash]) {
        seenHashes[hash] = true
        toReturn.push(hash)
        stack.push(...this.dependenciesByHash[hash])
      }
    }

    // Return those changes in the reverse of the order in which the depth-first search
    // found them. This is not necessarily a topological sort, but should usually be close.
    return toReturn.reverse().map(hash => this.changeByHash[hash])
  }

  /**
   * When you attempt to apply a change whose dependencies are not satisfied, it is queued up and
   * the missing dependency's hash is returned from this method.
   */
  getMissingDeps() {
    return [] // TODO implement this
  }

  /**
   * Serialises the current document state into a single byte array.
   */
  save() {
    return encodeDocument(this.changes)
  }
}

module.exports = { BackendDoc }
