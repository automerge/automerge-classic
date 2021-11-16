const { parseOpId, copyObject } = require('../src/common')
const { COLUMN_TYPE, VALUE_TYPE, ACTIONS, OBJECT_TYPE, DOC_OPS_COLUMNS, CHANGE_COLUMNS, DOCUMENT_COLUMNS,
  encoderByColumnId, decoderByColumnId, makeDecoders, decodeValue,
  encodeChange, decodeChangeColumns, decodeChangeMeta, decodeChanges, decodeDocumentHeader, encodeDocumentHeader } = require('./columnar')

const MAX_BLOCK_SIZE = 600 // operations
const BLOOM_BITS_PER_ENTRY = 10, BLOOM_NUM_PROBES = 7 // 1% false positive rate
const BLOOM_FILTER_SIZE = Math.floor(BLOOM_BITS_PER_ENTRY * MAX_BLOCK_SIZE / 8) // bytes

const objActorIdx = 0, objCtrIdx = 1, keyActorIdx = 2, keyCtrIdx = 3, keyStrIdx = 4,
  idActorIdx = 5, idCtrIdx = 6, insertIdx = 7, actionIdx = 8, valLenIdx = 9, valRawIdx = 10,
  predNumIdx = 13, predActorIdx = 14, predCtrIdx = 15, succNumIdx = 13, succActorIdx = 14, succCtrIdx = 15

const PRED_COLUMN_IDS = CHANGE_COLUMNS
  .filter(column => ['predNum', 'predActor', 'predCtr'].includes(column.columnName))
  .map(column => column.columnId)

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
 * Scans a block of document operations, encoded as columns `docCols`, to find the position at which
 * an operation (or sequence of operations) `ops` should be applied. `actorIds` is the array that
 * maps actor numbers to hexadecimal actor IDs. `resumeInsertion` is true if we're performing a list
 * insertion and we already found the reference element in a previous block, but we reached the end
 * of that previous block while scanning for the actual insertion position, and so we're continuing
 * the scan in a subsequent block.
 *
 * Returns an object with keys:
 * - `found`: false if we were scanning for a reference element in a list but couldn't find it;
 *    true otherwise.
 * - `skipCount`: the number of operations, counted from the start of the block, after which the
 *   new operations should be inserted or applied.
 * - `visibleCount`: if modifying a list object, the number of visible (i.e. non-deleted) list
 *   elements that precede the position where the new operations should be applied.
 */
function seekWithinBlock(ops, docCols, actorIds, resumeInsertion) {
  for (let col of docCols) col.decoder.reset()
  const { objActor, objCtr, keyActor, keyCtr, keyStr, idActor, idCtr, insert } = ops
  const [objActorD, objCtrD, /* keyActorD */, /* keyCtrD */, keyStrD, idActorD, idCtrD, insertD, actionD,
    /* valLenD */, /* valRawD */, /* chldActorD */, /* chldCtrD */, succNumD] = docCols.map(col => col.decoder)
  let skipCount = 0, visibleCount = 0, elemVisible = false, nextObjActor = null, nextObjCtr = null
  let nextIdActor = null, nextIdCtr = null, nextKeyStr = null, nextInsert = null, nextSuccNum = 0

  // Seek to the beginning of the object being updated
  if (objCtr !== null && !resumeInsertion) {
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
  if ((nextObjCtr !== objCtr || nextObjActor !== objActor) && !resumeInsertion) {
    return {found: true, skipCount, visibleCount}
  }

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
    return {found: true, skipCount, visibleCount}
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
    if (!resumeInsertion && keyCtr !== null && keyCtr > 0 && keyActor !== null) {
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
        return {found: false, skipCount, visibleCount}
      }
      if (nextInsert) elemVisible = false
      if (nextSuccNum === 0 && !elemVisible) {
        visibleCount += 1
        elemVisible = true
      }

      // Set up the next* variables to the operation following the reference element
      if (idCtrD.done || idActorD.done) return {found: true, skipCount, visibleCount}
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
      return {found: false, skipCount, visibleCount}
    }
  }
  return {found: true, skipCount, visibleCount}
}

/**
 * Returns the number of list elements that should be added to a list index when skipping over the
 * block with index `blockIndex` in the list object with object ID consisting of actor number
 * `objActorNum` and counter `objCtr`.
 */
function visibleListElements(docState, blockIndex, objActorNum, objCtr) {
  const thisBlock = docState.blocks[blockIndex]
  const nextBlock = docState.blocks[blockIndex + 1]

  if (thisBlock.lastObjectActor !== objActorNum || thisBlock.lastObjectCtr !== objCtr ||
      thisBlock.numVisible === undefined) {
    return 0

    // If a list element is split across the block boundary, don't double-count it
  } else if (thisBlock.lastVisibleActor === nextBlock.firstVisibleActor &&
             thisBlock.lastVisibleActor !== undefined &&
             thisBlock.lastVisibleCtr === nextBlock.firstVisibleCtr &&
             thisBlock.lastVisibleCtr !== undefined) {
    return thisBlock.numVisible - 1
  } else {
    return thisBlock.numVisible
  }
}

/**
 * Scans the blocks of document operations to find the position where a new operation should be
 * inserted. Returns an object with keys:
 * - `blockIndex`: the index of the block into which we should insert the new operation
 * - `skipCount`: the number of operations, counted from the start of the block, after which the
 *   new operations should be inserted or merged.
 * - `visibleCount`: if modifying a list object, the number of visible (i.e. non-deleted) list
 *   elements that precede the position where the new operations should be applied.
 */
function seekToOp(docState, ops) {
  const { objActor, objActorNum, objCtr, keyActor, keyCtr, keyStr } = ops
  let blockIndex = 0, totalVisible = 0

  // Skip any blocks that contain only objects with lower objectIds
  if (objCtr !== null) {
    while (blockIndex < docState.blocks.length - 1) {
      const blockActor = docState.blocks[blockIndex].lastObjectActor === undefined ? undefined
        : docState.actorIds[docState.blocks[blockIndex].lastObjectActor]
      const blockCtr = docState.blocks[blockIndex].lastObjectCtr
      if (blockCtr === null || blockCtr < objCtr || (blockCtr === objCtr && blockActor < objActor)) {
        blockIndex++
      } else {
        break
      }
    }
  }

  if (keyStr !== null) {
    // String key is used. First skip any blocks that contain only lower keys
    while (blockIndex < docState.blocks.length - 1) {
      const { lastObjectActor, lastObjectCtr, lastKey } = docState.blocks[blockIndex]
      if (objCtr === lastObjectCtr && objActorNum === lastObjectActor &&
          lastKey !== undefined && lastKey < keyStr) blockIndex++; else break
    }

    // When we have a candidate block, decode it to find the exact insertion position
    const {skipCount} = seekWithinBlock(ops, docState.blocks[blockIndex].columns, docState.actorIds, false)
    return {blockIndex, skipCount, visibleCount: 0}

  } else {
    // List operation
    const insertAtHead = keyCtr === null || keyCtr === 0 || keyActor === null
    const keyActorNum = keyActor === null ? null : docState.actorIds.indexOf(keyActor)
    let resumeInsertion = false

    while (true) {
      // Search for the reference element, skipping any blocks whose Bloom filter does not contain
      // the reference element. We only do this if not inserting at the head (in which case there is
      // no reference element), or if we already found the reference element in an earlier block (in
      // which case we have resumeInsertion === true). The latter case arises with concurrent
      // insertions at the same position, and so we have to scan beyond the reference element to
      // find the actual insertion position, and that further scan crosses a block boundary.
      if (!insertAtHead && !resumeInsertion) {
        while (blockIndex < docState.blocks.length - 1 &&
               docState.blocks[blockIndex].lastObjectActor === objActorNum &&
               docState.blocks[blockIndex].lastObjectCtr === objCtr &&
               !bloomFilterContains(docState.blocks[blockIndex].bloom, keyActorNum, keyCtr)) {
          // If we reach the end of the list object without a Bloom filter hit, the reference element
          // doesn't exist
          if (docState.blocks[blockIndex].lastObjectCtr > objCtr) {
            throw new RangeError(`Reference element not found: ${keyCtr}@${keyActor}`)
          }

          // Add up number of visible list elements in any blocks we skip, for list index computation
          totalVisible += visibleListElements(docState, blockIndex, objActorNum, objCtr)
          blockIndex++
        }
      }

      // We have a candidate block. Decode it to see whether it really contains the reference element
      const {found, skipCount, visibleCount} = seekWithinBlock(ops,
                                                               docState.blocks[blockIndex].columns,
                                                               docState.actorIds,
                                                               resumeInsertion)

      if (blockIndex === docState.blocks.length - 1 ||
          docState.blocks[blockIndex].lastObjectActor !== objActorNum ||
          docState.blocks[blockIndex].lastObjectCtr !== objCtr) {
        // Last block: if we haven't found the reference element by now, it's an error
        if (found) {
          return {blockIndex, skipCount, visibleCount: totalVisible + visibleCount}
        } else {
          throw new RangeError(`Reference element not found: ${keyCtr}@${keyActor}`)
        }

      } else if (found && skipCount < docState.blocks[blockIndex].numOps) {
        // The insertion position lies within the current block
        return {blockIndex, skipCount, visibleCount: totalVisible + visibleCount}
      }

      // Reference element not found and there are still blocks left ==> it was probably a false positive.
      // Reference element found, but we skipped all the way to the end of the block ==> we need to
      // continue scanning the next block to find the actual insertion position.
      // Either way, go back round the loop again to skip blocks until the next Bloom filter hit.
      resumeInsertion = found && ops.insert
      totalVisible += visibleListElements(docState, blockIndex, objActorNum, objCtr)
      blockIndex++
    }
  }
}

/**
 * Updates Bloom filter `bloom`, given as a Uint8Array, to contain the list element ID consisting of
 * counter `elemIdCtr` and actor number `elemIdActor`. We don't actually bother computing a hash
 * function, since those two integers serve perfectly fine as input. We turn the two integers into a
 * sequence of probe indexes using the triple hashing algorithm from the following paper:
 *
 * Peter C. Dillinger and Panagiotis Manolios. Bloom Filters in Probabilistic Verification.
 * 5th International Conference on Formal Methods in Computer-Aided Design (FMCAD), November 2004.
 * http://www.ccis.northeastern.edu/home/pete/pub/bloom-filters-verification.pdf
 */
function bloomFilterAdd(bloom, elemIdActor, elemIdCtr) {
  let modulo = 8 * bloom.byteLength, x = elemIdCtr % modulo, y = elemIdActor % modulo

  // Use one step of FNV-1a to compute a third value from the two inputs.
  // Taken from http://www.isthe.com/chongo/tech/comp/fnv/index.html
  // The prime is just over 2^24, so elemIdCtr can be up to about 2^29 = 500 million before the
  // result of the multiplication exceeds 2^53. And even if it does exceed 2^53 and loses precision,
  // that shouldn't be a problem as it should still be deterministic, and the Bloom filter
  // computation only needs to be internally consistent within this library.
  let z = ((elemIdCtr ^ elemIdActor) * 16777619 >>> 0) % modulo

  for (let i = 0; i < BLOOM_NUM_PROBES; i++) {
    bloom[x >>> 3] |= 1 << (x & 7)
    x = (x + y) % modulo
    y = (y + z) % modulo
  }
}

/**
 * Returns true if the list element ID consisting of counter `elemIdCtr` and actor number
 * `elemIdActor` is likely to be contained in the Bloom filter `bloom`.
 */
function bloomFilterContains(bloom, elemIdActor, elemIdCtr) {
  let modulo = 8 * bloom.byteLength, x = elemIdCtr % modulo, y = elemIdActor % modulo
  let z = ((elemIdCtr ^ elemIdActor) * 16777619 >>> 0) % modulo

  // See comments in the bloomFilterAdd function for an explanation
  for (let i = 0; i < BLOOM_NUM_PROBES; i++) {
    if ((bloom[x >>> 3] & (1 << (x & 7))) === 0) {
      return false
    }
    x = (x + y) % modulo
    y = (y + z) % modulo
  }
  return true
}

/**
 * Reads the relevant columns of a block of operations and updates that block to contain the
 * metadata we need to efficiently figure out where to insert new operations.
 */
function updateBlockMetadata(block) {
  block.bloom = new Uint8Array(BLOOM_FILTER_SIZE)
  block.numOps = 0
  block.lastKey = undefined
  block.numVisible = undefined
  block.lastObjectActor = undefined
  block.lastObjectCtr = undefined
  block.firstVisibleActor = undefined
  block.firstVisibleCtr = undefined
  block.lastVisibleActor = undefined
  block.lastVisibleCtr = undefined

  for (let col of block.columns) col.decoder.reset()
  const [objActorD, objCtrD, keyActorD, keyCtrD, keyStrD, idActorD, idCtrD, insertD, /* actionD */,
    /* valLenD */, /* valRawD */, /* chldActorD */, /* chldCtrD */, succNumD] = block.columns.map(col => col.decoder)

  while (!idCtrD.done) {
    block.numOps += 1
    const objActor = objActorD.readValue(), objCtr = objCtrD.readValue()
    const keyActor = keyActorD.readValue(), keyCtr = keyCtrD.readValue(), keyStr = keyStrD.readValue()
    const idActor = idActorD.readValue(), idCtr = idCtrD.readValue()
    const insert = insertD.readValue(), succNum = succNumD.readValue()

    if (block.lastObjectActor !== objActor || block.lastObjectCtr !== objCtr) {
      block.numVisible = 0
      block.lastObjectActor = objActor
      block.lastObjectCtr = objCtr
    }

    if (keyStr !== null) {
      // Map key: for each object, record the highest key contained in the block
      block.lastKey = keyStr
    } else if (insert || keyCtr !== null) {
      // List element
      block.lastKey = undefined
      const elemIdActor = insert ? idActor : keyActor
      const elemIdCtr = insert ? idCtr : keyCtr
      bloomFilterAdd(block.bloom, elemIdActor, elemIdCtr)

      // If the list element is visible, update the block metadata accordingly
      if (succNum === 0) {
        if (block.firstVisibleActor === undefined) block.firstVisibleActor = elemIdActor
        if (block.firstVisibleCtr === undefined) block.firstVisibleCtr = elemIdCtr
        if (block.lastVisibleActor !== elemIdActor || block.lastVisibleCtr !== elemIdCtr) {
          block.numVisible += 1
          block.lastVisibleActor = elemIdActor
          block.lastVisibleCtr = elemIdCtr
        }
      }
    }
  }
}

/**
 * Updates a block's metadata based on an operation being added to a block.
 */
function addBlockOperation(block, op, actorIds, isChangeOp) {
  if (op[keyStrIdx] !== null) {
    // TODO this comparison should use UTF-8 encoding, not JavaScript's UTF-16
    if (block.lastObjectCtr === op[objCtrIdx] && block.lastObjectActor === op[objActorIdx] &&
        (block.lastKey === undefined || block.lastKey < op[keyStrIdx])) {
      block.lastKey = op[keyStrIdx]
    }
  } else {
    // List element
    const elemIdActor = op[insertIdx] ? op[idActorIdx] : op[keyActorIdx]
    const elemIdCtr = op[insertIdx] ? op[idCtrIdx] : op[keyCtrIdx]
    bloomFilterAdd(block.bloom, elemIdActor, elemIdCtr)

    // Set lastVisible on the assumption that this is the last op in the block; if there are further
    // ops after this one in the block, lastVisible will be overwritten again later.
    if (op[succNumIdx] === 0 || isChangeOp) {
      if (block.firstVisibleActor === undefined) block.firstVisibleActor = elemIdActor
      if (block.firstVisibleCtr === undefined) block.firstVisibleCtr = elemIdCtr
      block.lastVisibleActor = elemIdActor
      block.lastVisibleCtr = elemIdCtr
    }
  }

  // Keep track of the largest objectId contained within a block
  if (block.lastObjectCtr === undefined ||
      op[objActorIdx] !== null && op[objCtrIdx] !== null &&
      (block.lastObjectCtr === null || block.lastObjectCtr < op[objCtrIdx] ||
       (block.lastObjectCtr === op[objCtrIdx] && actorIds[block.lastObjectActor] < actorIds[op[objActorIdx]]))) {
    block.lastObjectActor = op[objActorIdx]
    block.lastObjectCtr = op[objCtrIdx]
    block.lastKey = (op[keyStrIdx] !== null ? op[keyStrIdx] : undefined)
    block.numVisible = 0
  }
}

/**
 * Takes a block containing too many operations, and splits it into a sequence of adjacent blocks of
 * roughly equal size.
 */
function splitBlock(block) {
  for (let col of block.columns) col.decoder.reset()

  // Make each of the resulting blocks between 50% and 80% full (leaving a bit of space in each
  // block so that it doesn't get split again right away the next time an operation is added).
  // The upper bound cannot be lower than 75% since otherwise we would end up with a block less than
  // 50% full when going from two to three blocks.
  const numBlocks = Math.ceil(block.numOps / (0.8 * MAX_BLOCK_SIZE))
  let blocks = [], opsSoFar = 0

  for (let i = 1; i <= numBlocks; i++) {
    const opsToCopy = Math.ceil(i * block.numOps / numBlocks) - opsSoFar
    const encoders = block.columns.map(col => ({columnId: col.columnId, encoder: encoderByColumnId(col.columnId)}))
    copyColumns(encoders, block.columns, opsToCopy)
    const decoders = encoders.map(col => {
      const decoder = decoderByColumnId(col.columnId, col.encoder.buffer)
      return {columnId: col.columnId, decoder}
    })

    const newBlock = {columns: decoders}
    updateBlockMetadata(newBlock)
    blocks.push(newBlock)
    opsSoFar += opsToCopy
  }

  return blocks
}

/**
 * Takes an array of blocks and concatenates the corresponding columns across all of the blocks.
 */
function concatBlocks(blocks) {
  const encoders = blocks[0].columns.map(col => ({columnId: col.columnId, encoder: encoderByColumnId(col.columnId)}))

  for (let block of blocks) {
    for (let col of block.columns) col.decoder.reset()
    copyColumns(encoders, block.columns, block.numOps)
  }
  return encoders
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
        if (colValue) outCol.encoder.appendRawBytes(colValue)
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
 * Parses the next operation from block `blockIndex` of the document. Returns an object of the form
 * `{docOp, blockIndex}` where `docOp` is an operation in the form returned by `readOperation()`,
 * and `blockIndex` is the block number to use on the next call (it moves on to the next block when
 * we reach the end of the current block). `docOp` is null if there are no more operations.
 */
function readNextDocOp(docState, blockIndex) {
  let block = docState.blocks[blockIndex]
  if (!block.columns[actionIdx].decoder.done) {
    return {docOp: readOperation(block.columns), blockIndex}
  } else if (blockIndex === docState.blocks.length - 1) {
    return {docOp: null, blockIndex}
  } else {
    blockIndex += 1
    block = docState.blocks[blockIndex]
    for (let col of block.columns) col.decoder.reset()
    return {docOp: readOperation(block.columns), blockIndex}
  }
}

/**
 * Parses the next operation from a sequence of changes. `changeState` serves as the state of this
 * pseudo-iterator, and it is mutated to reflect the new operation. In particular,
 * `changeState.nextOp` is set to the operation that was read, and `changeState.done` is set to true
 * when we have finished reading the last operation in the last change.
 */
function readNextChangeOp(docState, changeState) {
  // If we've finished reading one change, move to the next change that contains at least one op
  while (changeState.changeIndex < changeState.changes.length - 1 &&
         (!changeState.columns || changeState.columns[actionIdx].decoder.done)) {
    changeState.changeIndex += 1
    const change = changeState.changes[changeState.changeIndex]
    changeState.columns = makeDecoders(change.columns, CHANGE_COLUMNS)
    changeState.opCtr = change.startOp

    // Update docState based on the information in the change
    updateBlockColumns(docState, changeState.columns)
    const {actorIds, actorTable} = getActorTable(docState.actorIds, change)
    docState.actorIds = actorIds
    changeState.actorTable = actorTable
    changeState.actorIndex = docState.actorIds.indexOf(change.actorIds[0])
  }

  // Reached the end of the last change?
  if (changeState.columns[actionIdx].decoder.done) {
    changeState.done = true
    changeState.nextOp = null
    return
  }

  changeState.nextOp = readOperation(changeState.columns, changeState.actorTable)
  changeState.nextOp[idActorIdx] = changeState.actorIndex
  changeState.nextOp[idCtrIdx] = changeState.opCtr
  changeState.changes[changeState.changeIndex].maxOp = changeState.opCtr
  if (changeState.opCtr > docState.maxOp) docState.maxOp = changeState.opCtr
  changeState.opCtr += 1

  const op = changeState.nextOp
  if ((op[objCtrIdx] === null && op[objActorIdx] !== null) ||
      (op[objCtrIdx] !== null && op[objActorIdx] === null)) {
    throw new RangeError(`Mismatched object reference: (${op[objCtrIdx]}, ${op[objActorIdx]})`)
  }
  if ((op[keyCtrIdx] === null && op[keyActorIdx] !== null) ||
      (op[keyCtrIdx] === 0    && op[keyActorIdx] !== null) ||
      (op[keyCtrIdx] >   0    && op[keyActorIdx] === null)) {
    throw new RangeError(`Mismatched operation key: (${op[keyCtrIdx]}, ${op[keyActorIdx]})`)
  }
}

function emptyObjectPatch(objectId, type) {
  if (type === 'list' || type === 'text') {
    return {objectId, type, edits: []}
  } else {
    return {objectId, type, props: {}}
  }
}

/**
 * Returns true if the two given operation IDs have the same actor ID, and the counter of `id2` is
 * exactly `delta` greater than the counter of `id1`.
 */
function opIdDelta(id1, id2, delta = 1) {
  const parsed1 = parseOpId(id1), parsed2 = parseOpId(id2)
  return parsed1.actorId === parsed2.actorId && parsed1.counter + delta === parsed2.counter
}

/**
 * Appends a list edit operation (insert, update, remove) to an array of existing operations. If the
 * last existing operation can be extended (as a multi-op), we do that.
 */
function appendEdit(existingEdits, nextEdit) {
  if (existingEdits.length === 0) {
    existingEdits.push(nextEdit)
    return
  }

  let lastEdit = existingEdits[existingEdits.length - 1]
  if (lastEdit.action === 'insert' && nextEdit.action === 'insert' &&
      lastEdit.index === nextEdit.index - 1 &&
      lastEdit.value.type === 'value' && nextEdit.value.type === 'value' &&
      lastEdit.elemId === lastEdit.opId && nextEdit.elemId === nextEdit.opId &&
      opIdDelta(lastEdit.elemId, nextEdit.elemId, 1) &&
      lastEdit.value.datatype === nextEdit.value.datatype &&
      typeof lastEdit.value.value === typeof nextEdit.value.value) {
    lastEdit.action = 'multi-insert'
    if (nextEdit.value.datatype) lastEdit.datatype = nextEdit.value.datatype
    lastEdit.values = [lastEdit.value.value, nextEdit.value.value]
    delete lastEdit.value
    delete lastEdit.opId

  } else if (lastEdit.action === 'multi-insert' && nextEdit.action === 'insert' &&
             lastEdit.index + lastEdit.values.length === nextEdit.index &&
             nextEdit.value.type === 'value' && nextEdit.elemId === nextEdit.opId &&
             opIdDelta(lastEdit.elemId, nextEdit.elemId, lastEdit.values.length) &&
             lastEdit.datatype === nextEdit.value.datatype &&
             typeof lastEdit.values[0] === typeof nextEdit.value.value) {
    lastEdit.values.push(nextEdit.value.value)

  } else if (lastEdit.action === 'remove' && nextEdit.action === 'remove' &&
             lastEdit.index === nextEdit.index) {
    lastEdit.count += nextEdit.count

  } else {
    existingEdits.push(nextEdit)
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
 * Can be called multiple times if there are multiple operations for the same property (e.g. due
 * to a conflict). `propState` is an object that carries over state between such successive
 * invocations for the same property. If the current object is a list, `listIndex` is the index
 * into that list (counting only visible elements). If the operation `op` was already previously
 * in the document, `oldSuccNum` is the value of `op[succNumIdx]` before the current change was
 * applied (allowing us to determine whether this operation was overwritten or deleted in the
 * current change). `oldSuccNum` must be undefined if the operation came from the current change.
 * If we are creating an incremental patch as a result of applying one or more changes, `newBlock`
 * is the block to which the operations are getting written; we will update the metadata on this
 * block. `newBlock` should be null if we are creating a patch for the whole document.
 */
function updatePatchProperty(patches, newBlock, objectId, op, docState, propState, listIndex, oldSuccNum) {
  const isWholeDoc = !newBlock
  const type = op[actionIdx] < ACTIONS.length ? OBJECT_TYPE[ACTIONS[op[actionIdx]]] : null
  const opId = `${op[idCtrIdx]}@${docState.actorIds[op[idActorIdx]]}`
  const elemIdActor = op[insertIdx] ? op[idActorIdx] : op[keyActorIdx]
  const elemIdCtr = op[insertIdx] ? op[idCtrIdx] : op[keyCtrIdx]
  const elemId = op[keyStrIdx] ? op[keyStrIdx] : `${elemIdCtr}@${docState.actorIds[elemIdActor]}`

  // When the change contains a new make* operation (i.e. with an even-numbered action), record the
  // new parent-child relationship in objectMeta. TODO: also handle link/move operations.
  if (op[actionIdx] % 2 === 0 && !docState.objectMeta[opId]) {
    docState.objectMeta[opId] = {parentObj: objectId, parentKey: elemId, opId, type, children: {}}
    deepCopyUpdate(docState.objectMeta, [objectId, 'children', elemId, opId], {objectId: opId, type, props: {}})
  }

  // firstOp is true if the current operation is the first of a sequence of ops for the same key
  const firstOp = !propState[elemId]
  if (!propState[elemId]) propState[elemId] = {visibleOps: [], hasChild: false}

  // An operation is overwritten if it is a document operation that has at least one successor
  const isOverwritten = (oldSuccNum !== undefined && op[succNumIdx] > 0)

  // Record all visible values for the property, and whether it has any child object
  if (!isOverwritten) {
    propState[elemId].visibleOps.push(op)
    propState[elemId].hasChild = propState[elemId].hasChild || (op[actionIdx] % 2) === 0 // even-numbered action == make* operation
  }

  // If one or more of the values of the property is a child object, we update objectMeta to store
  // all of the visible values of the property (even the non-child-object values). Then, when we
  // subsequently process an update within that child object, we can construct the patch to
  // contain the conflicting values.
  const prevChildren = docState.objectMeta[objectId].children[elemId]
  if (propState[elemId].hasChild || (prevChildren && Object.keys(prevChildren).length > 0)) {
    let values = {}
    for (let visible of propState[elemId].visibleOps) {
      const opId = `${visible[idCtrIdx]}@${docState.actorIds[visible[idActorIdx]]}`
      if (ACTIONS[visible[actionIdx]] === 'set') {
        values[opId] = Object.assign({type: 'value'}, decodeValue(visible[valLenIdx], visible[valRawIdx]))
      } else if (visible[actionIdx] % 2 === 0) {
        const objType = visible[actionIdx] < ACTIONS.length ? OBJECT_TYPE[ACTIONS[visible[actionIdx]]] : null
        values[opId] = emptyObjectPatch(opId, objType)
      }
    }

    // Copy so that objectMeta is not modified if an exception is thrown while applying change
    deepCopyUpdate(docState.objectMeta, [objectId, 'children', elemId], values)
  }

  let patchKey, patchValue

  // For counters, increment operations are succs to the set operation that created the counter,
  // but in this case we want to add the values rather than overwriting them.
  if (isOverwritten && ACTIONS[op[actionIdx]] === 'set' && (op[valLenIdx] & 0x0f) === VALUE_TYPE.COUNTER) {
    // This is the initial set operation that creates a counter. Initialise the counter state
    // to contain all successors of the set operation. Only if we later find that each of these
    // successor operations is an increment, we make the counter visible in the patch.
    if (!propState[elemId]) propState[elemId] = {visibleOps: [], hasChild: false}
    if (!propState[elemId].counterStates) propState[elemId].counterStates = {}
    let counterStates = propState[elemId].counterStates
    let counterState = {opId, value: decodeValue(op[valLenIdx], op[valRawIdx]).value, succs: {}}

    for (let i = 0; i < op[succNumIdx]; i++) {
      const succOp = `${op[succCtrIdx][i]}@${docState.actorIds[op[succActorIdx][i]]}`
      counterStates[succOp] = counterState
      counterState.succs[succOp] = true
    }

  } else if (ACTIONS[op[actionIdx]] === 'inc') {
    // Incrementing a previously created counter.
    if (!propState[elemId] || !propState[elemId].counterStates || !propState[elemId].counterStates[opId]) {
      throw new RangeError(`increment operation ${opId} for unknown counter`)
    }
    let counterState = propState[elemId].counterStates[opId]
    counterState.value += decodeValue(op[valLenIdx], op[valRawIdx]).value
    delete counterState.succs[opId]

    if (Object.keys(counterState.succs).length === 0) {
      patchKey = counterState.opId
      patchValue = {type: 'value', datatype: 'counter', value: counterState.value}
      // TODO if the counter is in a list element, we need to add a 'remove' action when deleted
    }

  } else if (!isOverwritten) {
    // Add the value to the patch if it is not overwritten (i.e. if it has no succs).
    if (ACTIONS[op[actionIdx]] === 'set') {
      patchKey = opId
      patchValue = Object.assign({type: 'value'}, decodeValue(op[valLenIdx], op[valRawIdx]))
    } else if (op[actionIdx] % 2 === 0) { // even-numbered action == make* operation
      if (!patches[opId]) patches[opId] = emptyObjectPatch(opId, type)
      patchKey = opId
      patchValue = patches[opId]
    }
  }

  if (!patches[objectId]) patches[objectId] = emptyObjectPatch(objectId, docState.objectMeta[objectId].type)
  const patch = patches[objectId]

  // Updating a list or text object (with elemId key)
  if (op[keyStrIdx] === null) {
    // If we come across any document op that was previously non-overwritten/non-deleted, that
    // means the current list element already had a value before this change was applied, and
    // therefore the current element cannot be an insert. If we already registered an insert, we
    // have to convert it into an update.
    if (oldSuccNum === 0 && !isWholeDoc && propState[elemId].action === 'insert') {
      propState[elemId].action = 'update'
      convertInsertToUpdate(patch.edits, listIndex, elemId)
      if (newBlock && newBlock.lastObjectActor === op[objActorIdx] && newBlock.lastObjectCtr === op[objCtrIdx]) {
        newBlock.numVisible -= 1
      }
    }

    if (patchValue) {
      // If the op has a non-overwritten value and it came from the change, it's an insert.
      // (It's not necessarily the case that op[insertIdx] is true: if a list element is concurrently
      // deleted and updated, the node that first processes the deletion and then the update will
      // observe the update as a re-insertion of the deleted list element.)
      if (!propState[elemId].action && (oldSuccNum === undefined || isWholeDoc)) {
        propState[elemId].action = 'insert'
        appendEdit(patch.edits, {action: 'insert', index: listIndex, elemId, opId: patchKey, value: patchValue})
        if (newBlock && newBlock.lastObjectActor === op[objActorIdx] && newBlock.lastObjectCtr === op[objCtrIdx]) {
          newBlock.numVisible += 1
        }

      // If the property has a value and it's not an insert, then it must be an update.
      // We might have previously registered it as a remove, in which case we convert it to update.
      } else if (propState[elemId].action === 'remove') {
        let lastEdit = patch.edits[patch.edits.length - 1]
        if (lastEdit.action !== 'remove') throw new RangeError('last edit has unexpected type')
        if (lastEdit.count > 1) lastEdit.count -= 1; else patch.edits.pop()
        propState[elemId].action = 'update'
        appendUpdate(patch.edits, listIndex, elemId, patchKey, patchValue, true)
        if (newBlock && newBlock.lastObjectActor === op[objActorIdx] && newBlock.lastObjectCtr === op[objCtrIdx]) {
          newBlock.numVisible += 1
        }

      } else {
        // A 'normal' update
        appendUpdate(patch.edits, listIndex, elemId, patchKey, patchValue, !propState[elemId].action)
        if (!propState[elemId].action) propState[elemId].action = 'update'
      }

    } else if (oldSuccNum === 0 && !propState[elemId].action) {
      // If the property used to have a non-overwritten/non-deleted value, but no longer, it's a remove
      propState[elemId].action = 'remove'
      appendEdit(patch.edits, {action: 'remove', index: listIndex, count: 1})
      if (newBlock && newBlock.lastObjectActor === op[objActorIdx] && newBlock.lastObjectCtr === op[objCtrIdx]) {
        newBlock.numVisible -= 1
      }
    }

  } else if (patchValue || !isWholeDoc) {
    // Updating a map or table (with string key)
    if (firstOp || !patch.props[op[keyStrIdx]]) patch.props[op[keyStrIdx]] = {}
    if (patchValue) patch.props[op[keyStrIdx]][patchKey] = patchValue
  }
}

/**
 * Applies operations (from one or more changes) to the document by merging the sequence of change
 * ops into the sequence of document ops. The two inputs are `changeState` and `docState`
 * respectively. Assumes that the decoders of both sets of columns are at the position where we want
 * to start merging. `patches` is mutated to reflect the effect of the change operations. `ops` is
 * the operation sequence to apply (as decoded by `groupRelatedOps()`). `docState` is as
 * documented in `applyOps()`. If the operations are updating a list or text object, `listIndex`
 * is the number of visible elements that precede the position at which we start merging.
 * `blockIndex` is the document block number from which we are currently reading.
 */
function mergeDocChangeOps(patches, newBlock, outCols, changeState, docState, listIndex, blockIndex) {
  const firstOp = changeState.nextOp, insert = firstOp[insertIdx]
  const objActor = firstOp[objActorIdx], objCtr = firstOp[objCtrIdx]
  const objectId = objActor === null ? '_root' : `${objCtr}@${docState.actorIds[objActor]}`
  const idActorIndex = changeState.actorIndex, idActor = docState.actorIds[idActorIndex]
  let foundListElem = false, elemVisible = false, propState = {}, docOp
  ;({ docOp, blockIndex } = readNextDocOp(docState, blockIndex))
  let docOpsConsumed = (docOp === null ? 0 : 1)
  let docOpOldSuccNum = (docOp === null ? 0 : docOp[succNumIdx])
  let changeOp = null, changeOps = [], changeCols = [], predSeen = [], lastChangeKey = null
  changeState.objectIds.add(objectId)

  // Merge the two inputs: the sequence of ops in the doc, and the sequence of ops in the change.
  // At each iteration, we either output the doc's op (possibly updated based on the change's ops)
  // or output an op from the change.
  while (true) {
    // The array `changeOps` contains operations from the change(s) we're applying. When the array
    // is empty, we load changes from the change. Typically we load only a single operation at a
    // time, with two exceptions: 1. all operations that update the same key or list element in the
    // same object are put into changeOps at the same time (this is needed so that we can update the
    // succ columns of the document ops correctly); 2. a run of consecutive insertions is also
    // placed into changeOps in one go.
    //
    // When we have processed all the ops in changeOps we try to see whether there are further
    // operations that we can also process while we're at it. Those operations must be for the same
    // object, they must be for a key or list element that appears later in the document, they must
    // either all be insertions or all be non-insertions, and if insertions, they must be
    // consecutive. If these conditions are satisfied, that means the operations can be processed in
    // the same pass. If we encounter an operation that does not meet these conditions, we leave
    // changeOps empty, and this function returns after having processed any remaining document ops.
    //
    // Any operations that could not be processed in a single pass remain in changeState; applyOps
    // will seek to the appropriate position and then call mergeDocChangeOps again.
    if (changeOps.length === 0) {
      foundListElem = false

      let nextOp = changeState.nextOp
      while (!changeState.done && nextOp[idActorIdx] === idActorIndex && nextOp[insertIdx] === insert &&
             nextOp[objActorIdx] === firstOp[objActorIdx] && nextOp[objCtrIdx] === firstOp[objCtrIdx]) {

        // Check if the operation's pred references a previous operation in changeOps
        const lastOp = (changeOps.length > 0) ? changeOps[changeOps.length - 1] : null
        let isOverwrite = false
        for (let i = 0; i < nextOp[predNumIdx]; i++) {
          for (let prevOp of changeOps) {
            if (nextOp[predActorIdx][i] === prevOp[idActorIdx] && nextOp[predCtrIdx][i] === prevOp[idCtrIdx]) {
              isOverwrite = true
            }
          }
        }

        // If any of the following `if` statements is true, we add `nextOp` to `changeOps`. If they
        // are all false, we break out of the loop and stop adding to `changeOps`.
        if (nextOp === firstOp) {
          // First change operation in a mergeDocChangeOps call is always used
        } else if (insert && lastOp !== null && nextOp[keyStrIdx] === null &&
                   nextOp[keyActorIdx] === lastOp[idActorIdx] &&
                   nextOp[keyCtrIdx] === lastOp[idCtrIdx]) {
          // Collect consecutive insertions
        } else if (!insert && lastOp !== null && nextOp[keyStrIdx] !== null &&
                   nextOp[keyStrIdx] === lastOp[keyStrIdx] && !isOverwrite) {
          // Collect several updates to the same key
        } else if (!insert && lastOp !== null &&
                   nextOp[keyStrIdx] === null && lastOp[keyStrIdx] === null &&
                   nextOp[keyActorIdx] === lastOp[keyActorIdx] &&
                   nextOp[keyCtrIdx] === lastOp[keyCtrIdx] && !isOverwrite) {
          // Collect several updates to the same list element
        } else if (!insert && lastOp === null && nextOp[keyStrIdx] === null &&
                   docOp && docOp[insertIdx] && docOp[keyStrIdx] === null &&
                   docOp[idActorIdx] === nextOp[keyActorIdx] &&
                   docOp[idCtrIdx] === nextOp[keyCtrIdx]) {
          // When updating/deleting list elements, keep going if the next elemId in the change
          // equals the next elemId in the doc (i.e. we're updating several consecutive elements)
        } else if (!insert && lastOp === null && nextOp[keyStrIdx] !== null &&
                   lastChangeKey !== null && lastChangeKey < nextOp[keyStrIdx]) {
          // Allow a single mergeDocChangeOps call to process changes to several keys in the same
          // object, provided that they appear in ascending order
        } else break

        lastChangeKey = (nextOp !== null) ? nextOp[keyStrIdx] : null
        changeOps.push(changeState.nextOp)
        changeCols.push(changeState.columns)
        predSeen.push(new Array(changeState.nextOp[predNumIdx]))
        readNextChangeOp(docState, changeState)
        nextOp = changeState.nextOp
      }
    }

    if (changeOps.length > 0) changeOp = changeOps[0]
    const inCorrectObject = docOp && docOp[objActorIdx] === changeOp[objActorIdx] && docOp[objCtrIdx] === changeOp[objCtrIdx]
    const keyMatches      = docOp && docOp[keyStrIdx] !== null && docOp[keyStrIdx] === changeOp[keyStrIdx]
    const listElemMatches = docOp && docOp[keyStrIdx] === null && changeOp[keyStrIdx] === null &&
      ((!docOp[insertIdx] && docOp[keyActorIdx] === changeOp[keyActorIdx] && docOp[keyCtrIdx] === changeOp[keyCtrIdx]) ||
        (docOp[insertIdx] && docOp[idActorIdx]  === changeOp[keyActorIdx] && docOp[idCtrIdx]  === changeOp[keyCtrIdx]))

    // We keep going until we run out of ops in the change, except that even when we run out, we
    // keep going until we have processed all doc ops for the current key/list element.
    if (changeOps.length === 0 && !(inCorrectObject && (keyMatches || listElemMatches))) break

    let takeDocOp = false, takeChangeOps = 0

    // The change operations come first if we are inserting list elements (seekToOp already
    // determines the correct insertion position), if there is no document operation, if the next
    // document operation is for a different object, or if the change op's string key is
    // lexicographically first (TODO check ordering of keys beyond the basic multilingual plane).
    if (insert || !inCorrectObject ||
        (docOp[keyStrIdx] === null && changeOp[keyStrIdx] !== null) ||
        (docOp[keyStrIdx] !== null && changeOp[keyStrIdx] !== null && changeOp[keyStrIdx] < docOp[keyStrIdx])) {
      // Take the operations from the change
      takeChangeOps = changeOps.length
      if (!inCorrectObject && !foundListElem && changeOp[keyStrIdx] === null && !changeOp[insertIdx]) {
        // This can happen if we first update one list element, then another one earlier in the
        // list. That is not allowed: list element updates must occur in ascending order.
        throw new RangeError("could not find list element with ID: " +
                             `${changeOp[keyCtrIdx]}@${docState.actorIds[changeOp[keyActorIdx]]}`)
      }

    } else if (keyMatches || listElemMatches || foundListElem) {
      // The doc operation is for the same key or list element in the same object as the change
      // ops, so we merge them. First, if any of the change ops' `pred` matches the opId of the
      // document operation, we update the document operation's `succ` accordingly.
      for (let opIndex = 0; opIndex < changeOps.length; opIndex++) {
        const op = changeOps[opIndex]
        for (let i = 0; i < op[predNumIdx]; i++) {
          if (op[predActorIdx][i] === docOp[idActorIdx] && op[predCtrIdx][i] === docOp[idCtrIdx]) {
            // Insert into the doc op's succ list such that the lists remains sorted
            let j = 0
            while (j < docOp[succNumIdx] && (docOp[succCtrIdx][j] < op[idCtrIdx] ||
                   docOp[succCtrIdx][j] === op[idCtrIdx] && docState.actorIds[docOp[succActorIdx][j]] < idActor)) j++
            docOp[succCtrIdx].splice(j, 0, op[idCtrIdx])
            docOp[succActorIdx].splice(j, 0, idActorIndex)
            docOp[succNumIdx]++
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

      } else if (changeOps.length === 0 || docOp[idCtrIdx] < changeOp[idCtrIdx] ||
          (docOp[idCtrIdx] === changeOp[idCtrIdx] && docState.actorIds[docOp[idActorIdx]] < idActor)) {
        // When we have several operations for the same object and the same key, we want to keep
        // them sorted in ascending order by opId. Here we have docOp with a lower opId, so we
        // output it first.
        takeDocOp = true
        updatePatchProperty(patches, newBlock, objectId, docOp, docState, propState, listIndex, docOpOldSuccNum)

        // A deletion op in the change is represented in the document only by its entries in the
        // succ list of the operations it overwrites; it has no separate row in the set of ops.
        for (let i = changeOps.length - 1; i >= 0; i--) {
          let deleted = true
          for (let j = 0; j < changeOps[i][predNumIdx]; j++) {
            if (!predSeen[i][j]) deleted = false
          }
          if (ACTIONS[changeOps[i][actionIdx]] === 'del' && deleted) {
            changeOps.splice(i, 1)
            changeCols.splice(i, 1)
            predSeen.splice(i, 1)
          }
        }

      } else if (docOp[idCtrIdx] === changeOp[idCtrIdx] && docState.actorIds[docOp[idActorIdx]] === idActor) {
        throw new RangeError(`duplicate operation ID: ${changeOp[idCtrIdx]}@${idActor}`)
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
      appendOperation(outCols, docState.blocks[blockIndex].columns, docOp)
      addBlockOperation(newBlock, docOp, docState.actorIds, false)

      if (docOp[insertIdx] && elemVisible) {
        elemVisible = false
        listIndex++
      }
      if (docOp[succNumIdx] === 0) elemVisible = true
      newBlock.numOps++
      ;({ docOp, blockIndex } = readNextDocOp(docState, blockIndex))
      if (docOp !== null) {
        docOpsConsumed++
        docOpOldSuccNum = docOp[succNumIdx]
      }
    }

    if (takeChangeOps > 0) {
      for (let i = 0; i < takeChangeOps; i++) {
        let op = changeOps[i]
        // Check that we've seen all ops mentioned in `pred` (they must all have lower opIds than
        // the change op's own opId, so we must have seen them already)
        for (let j = 0; j < op[predNumIdx]; j++) {
          if (!predSeen[i][j]) {
            throw new RangeError(`no matching operation for pred: ${op[predCtrIdx][j]}@${docState.actorIds[op[predActorIdx][j]]}`)
          }
        }
        appendOperation(outCols, changeCols[i], op)
        addBlockOperation(newBlock, op, docState.actorIds, true)
        updatePatchProperty(patches, newBlock, objectId, op, docState, propState, listIndex)

        if (op[insertIdx]) {
          elemVisible = false
          listIndex++
        } else {
          elemVisible = true
        }
      }

      if (takeChangeOps === changeOps.length) {
        changeOps.length = 0
        changeCols.length = 0
        predSeen.length = 0
      } else {
        changeOps.splice(0, takeChangeOps)
        changeCols.splice(0, takeChangeOps)
        predSeen.splice(0, takeChangeOps)
      }
      newBlock.numOps += takeChangeOps
    }
  }

  if (docOp) {
    appendOperation(outCols, docState.blocks[blockIndex].columns, docOp)
    newBlock.numOps++
    addBlockOperation(newBlock, docOp, docState.actorIds, false)
  }
  return {docOpsConsumed, blockIndex}
}

/**
 * Applies operations from the change (or series of changes) in `changeState` to the document
 * `docState`. Passing `changeState` to `readNextChangeOp` allows iterating over the change ops.
 * `docState` is an object with keys:
 *   - `actorIds` is an array of actorIds (as hex strings) occurring in the document (values in
 *     the document's objActor/keyActor/idActor/... columns are indexes into this array).
 *   - `blocks` is an array of all the blocks of operations in the document.
 *   - `objectMeta` is a map from objectId to metadata about that object.
 *
 * `docState` is mutated to contain the updated document state.
 * `patches` is a patch object that is mutated to reflect the operations applied by this function.
 */
function applyOps(patches, changeState, docState) {
  const [objActorNum, objCtr, keyActorNum, keyCtr, keyStr, idActorNum, idCtr, insert] = changeState.nextOp
  const objActor = objActorNum === null ? null : docState.actorIds[objActorNum]
  const keyActor = keyActorNum === null ? null : docState.actorIds[keyActorNum]
  const ops = {
    objActor, objActorNum, objCtr, keyActor, keyActorNum, keyCtr, keyStr,
    idActor: docState.actorIds[idActorNum], idCtr, insert,
    objId: objActor === null ? '_root' : `${objCtr}@${objActor}`
  }

  const {blockIndex, skipCount, visibleCount} = seekToOp(docState, ops)
  const block = docState.blocks[blockIndex]
  for (let col of block.columns) col.decoder.reset()

  const resetFirstVisible = (skipCount === 0) || (block.firstVisibleActor === undefined) ||
    (!insert && block.firstVisibleActor === keyActorNum && block.firstVisibleCtr === keyCtr)
  const newBlock = {
    columns: undefined,
    bloom: new Uint8Array(block.bloom),
    numOps: skipCount,
    lastKey: block.lastKey,
    numVisible: block.numVisible,
    lastObjectActor: block.lastObjectActor,
    lastObjectCtr: block.lastObjectCtr,
    firstVisibleActor: resetFirstVisible ? undefined : block.firstVisibleActor,
    firstVisibleCtr: resetFirstVisible ? undefined : block.firstVisibleCtr,
    lastVisibleActor: undefined,
    lastVisibleCtr: undefined
  }

  // Copy the operations up to the insertion position (the first skipCount operations)
  const outCols = block.columns.map(col => ({columnId: col.columnId, encoder: encoderByColumnId(col.columnId)}))
  copyColumns(outCols, block.columns, skipCount)

  // Apply the operations from the change. This may cause blockIndex to move forwards if the
  // property being updated straddles a block boundary.
  const {blockIndex: lastBlockIndex, docOpsConsumed} =
    mergeDocChangeOps(patches, newBlock, outCols, changeState, docState, visibleCount, blockIndex)

  // Copy the remaining operations after the insertion position
  const lastBlock = docState.blocks[lastBlockIndex]
  let copyAfterMerge = -skipCount - docOpsConsumed
  for (let i = blockIndex; i <= lastBlockIndex; i++) copyAfterMerge += docState.blocks[i].numOps
  copyColumns(outCols, lastBlock.columns, copyAfterMerge)
  newBlock.numOps += copyAfterMerge

  for (let col of lastBlock.columns) {
    if (!col.decoder.done) throw new RangeError(`excess ops in column ${col.columnId}`)
  }

  newBlock.columns = outCols.map(col => {
    const decoder = decoderByColumnId(col.columnId, col.encoder.buffer)
    return {columnId: col.columnId, decoder}
  })

  if (blockIndex === lastBlockIndex && newBlock.numOps <= MAX_BLOCK_SIZE) {
    // The result is just one output block
    if (copyAfterMerge > 0 && block.lastVisibleActor !== undefined && block.lastVisibleCtr !== undefined) {
      // It's possible that none of the ops after the merge point are visible, in which case the
      // lastVisible may not be strictly correct, because it may refer to an operation before the
      // merge point rather than a list element inserted by the current change. However, this doesn't
      // matter, because the only purpose for which we need it is to check whether one block ends with
      // the same visible element as the next block starts with (to avoid double-counting its index);
      // if the last list element of a block is invisible, the exact value of lastVisible doesn't
      // matter since it will be different from the next block's firstVisible in any case.
      newBlock.lastVisibleActor = block.lastVisibleActor
      newBlock.lastVisibleCtr = block.lastVisibleCtr
    }

    docState.blocks[blockIndex] = newBlock

  } else {
    // Oversized output block must be split into smaller blocks
    const newBlocks = splitBlock(newBlock)
    docState.blocks.splice(blockIndex, lastBlockIndex - blockIndex + 1, ...newBlocks)
  }
}

/**
 * Updates the columns in a document's operation blocks to contain all the columns in a change
 * (including any column types we don't recognise, which have been generated by a future version
 * of Automerge).
 */
function updateBlockColumns(docState, changeCols) {
  // Check that the columns of a change appear at the index at which we expect them to be
  if (changeCols[objActorIdx ].columnId !== CHANGE_COLUMNS[objActorIdx ].columnId || CHANGE_COLUMNS[objActorIdx ].columnName !== 'objActor'  ||
      changeCols[objCtrIdx   ].columnId !== CHANGE_COLUMNS[objCtrIdx   ].columnId || CHANGE_COLUMNS[objCtrIdx   ].columnName !== 'objCtr'    ||
      changeCols[keyActorIdx ].columnId !== CHANGE_COLUMNS[keyActorIdx ].columnId || CHANGE_COLUMNS[keyActorIdx ].columnName !== 'keyActor'  ||
      changeCols[keyCtrIdx   ].columnId !== CHANGE_COLUMNS[keyCtrIdx   ].columnId || CHANGE_COLUMNS[keyCtrIdx   ].columnName !== 'keyCtr'    ||
      changeCols[keyStrIdx   ].columnId !== CHANGE_COLUMNS[keyStrIdx   ].columnId || CHANGE_COLUMNS[keyStrIdx   ].columnName !== 'keyStr'    ||
      changeCols[idActorIdx  ].columnId !== CHANGE_COLUMNS[idActorIdx  ].columnId || CHANGE_COLUMNS[idActorIdx  ].columnName !== 'idActor'   ||
      changeCols[idCtrIdx    ].columnId !== CHANGE_COLUMNS[idCtrIdx    ].columnId || CHANGE_COLUMNS[idCtrIdx    ].columnName !== 'idCtr'     ||
      changeCols[insertIdx   ].columnId !== CHANGE_COLUMNS[insertIdx   ].columnId || CHANGE_COLUMNS[insertIdx   ].columnName !== 'insert'    ||
      changeCols[actionIdx   ].columnId !== CHANGE_COLUMNS[actionIdx   ].columnId || CHANGE_COLUMNS[actionIdx   ].columnName !== 'action'    ||
      changeCols[valLenIdx   ].columnId !== CHANGE_COLUMNS[valLenIdx   ].columnId || CHANGE_COLUMNS[valLenIdx   ].columnName !== 'valLen'    ||
      changeCols[valRawIdx   ].columnId !== CHANGE_COLUMNS[valRawIdx   ].columnId || CHANGE_COLUMNS[valRawIdx   ].columnName !== 'valRaw'    ||
      changeCols[predNumIdx  ].columnId !== CHANGE_COLUMNS[predNumIdx  ].columnId || CHANGE_COLUMNS[predNumIdx  ].columnName !== 'predNum'   ||
      changeCols[predActorIdx].columnId !== CHANGE_COLUMNS[predActorIdx].columnId || CHANGE_COLUMNS[predActorIdx].columnName !== 'predActor' ||
      changeCols[predCtrIdx  ].columnId !== CHANGE_COLUMNS[predCtrIdx  ].columnId || CHANGE_COLUMNS[predCtrIdx  ].columnName !== 'predCtr') {
    throw new RangeError('unexpected columnId')
  }

  // Check if there any columns in the change that are not in the document, apart from pred*
  const docCols = docState.blocks[0].columns
  if (!changeCols.every(changeCol => PRED_COLUMN_IDS.includes(changeCol.columnId) ||
                                     docCols.find(docCol => docCol.columnId === changeCol.columnId))) {
    let allCols = docCols.map(docCol => ({columnId: docCol.columnId}))
    for (let changeCol of changeCols) {
      const { columnId } = changeCol
      if (!PRED_COLUMN_IDS.includes(columnId) && !docCols.find(docCol => docCol.columnId === columnId)) {
        allCols.push({columnId})
      }
    }
    allCols.sort((a, b) => a.columnId - b.columnId)

    for (let blockIndex = 0; blockIndex < docState.blocks.length; blockIndex++) {
      let block = copyObject(docState.blocks[blockIndex])
      block.columns = makeDecoders(block.columns.map(col => ({columnId: col.columnId, buffer: col.decoder.buf})), allCols)
      docState.blocks[blockIndex] = block
    }
  }
}

/**
 * Takes a decoded change header, including an array of actorIds. Returns an object of the form
 * `{actorIds, actorTable}`, where `actorIds` is an updated array of actorIds appearing in the
 * document (including the new change's actorId). `actorTable` is an array of integers where
 * `actorTable[i]` contains the document's actor index for the actor that has index `i` in the
 * change (`i == 0` is the author of the change).
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
              objActorNum: docState.actorIds.indexOf(obj.actorId),
              keyActorNum: docState.actorIds.indexOf(elem.actorId),
              keyStr:   null,         insert: false,
              objId:    objectId
            }
            const { visibleCount } = seekToOp(docState, seekPos)

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
 * Takes an array of decoded changes and applies them to a document. `docState` contains a bunch of
 * fields describing the document state. This function mutates `docState` to contain the updated
 * document state, and mutates `patches` to contain a patch to return to the frontend. Only the
 * top-level `docState` object is mutated; all nested objects within it are treated as immutable.
 * `objectIds` is mutated to contain the IDs of objects that are updated in any of the changes.
 *
 * The function detects duplicate changes that we've already applied by looking up each change's
 * hash in `docState.changeIndexByHash`. If we deferred the hash graph computation, that structure
 * will be incomplete, and we run the risk of applying the same change twice. However, we still have
 * the sequence numbers for detecting duplicates. If `throwExceptions` is true, we assume that the
 * set of change hashes is complete, and therefore a duplicate sequence number indicates illegal
 * behaviour. If `throwExceptions` is false, and we detect a possible sequence number reuse, we
 * don't throw an exception but instead enqueue all of the changes. This gives us a chance to
 * recompute the hash graph and eliminate duplicates before raising an error to the application.
 *
 * Returns a two-element array `[applied, enqueued]`, where `applied` is an array of changes that
 * have been applied to the document, and `enqueued` is an array of changes that have not yet been
 * applied because they are missing a dependency.
 */
function applyChanges(patches, decodedChanges, docState, objectIds, throwExceptions) {
  let heads = new Set(docState.heads), changeHashes = new Set()
  let clock = copyObject(docState.clock)
  let applied = [], enqueued = []

  for (let change of decodedChanges) {
    // Skip any duplicate changes that we have already seen
    if (docState.changeIndexByHash[change.hash] !== undefined || changeHashes.has(change.hash)) continue

    const expectedSeq = (clock[change.actor] || 0) + 1
    let causallyReady = true

    for (let dep of change.deps) {
      const depIndex = docState.changeIndexByHash[dep]
      if ((depIndex === undefined || depIndex === -1) && !changeHashes.has(dep)) {
        causallyReady = false
      }
    }

    if (!causallyReady) {
      enqueued.push(change)
    } else if (change.seq < expectedSeq) {
      if (throwExceptions) {
        throw new RangeError(`Reuse of sequence number ${change.seq} for actor ${change.actor}`)
      } else {
        return [[], decodedChanges]
      }
    } else if (change.seq > expectedSeq) {
      throw new RangeError(`Skipped sequence number ${expectedSeq} for actor ${change.actor}`)
    } else {
      clock[change.actor] = change.seq
      changeHashes.add(change.hash)
      for (let dep of change.deps) heads.delete(dep)
      heads.add(change.hash)
      applied.push(change)
    }
  }

  if (applied.length > 0) {
    let changeState = {changes: applied, changeIndex: -1, objectIds}
    readNextChangeOp(docState, changeState)
    while (!changeState.done) applyOps(patches, changeState, docState)

    docState.heads = [...heads].sort()
    docState.clock = clock
  }
  return [applied, enqueued]
}

/**
 * Scans the operations in a document and generates a patch that can be sent to the frontend to
 * instantiate the current state of the document. `objectMeta` is mutated to contain information
 * about the parent and children of each object in the document.
 */
function documentPatch(docState) {
  for (let col of docState.blocks[0].columns) col.decoder.reset()
  let propState = {}, docOp = null, blockIndex = 0
  let patches = {_root: {objectId: '_root', type: 'map', props: {}}}
  let lastObjActor = null, lastObjCtr = null, objectId = '_root', elemVisible = false, listIndex = 0

  while (true) {
    ({ docOp, blockIndex } = readNextDocOp(docState, blockIndex))
    if (docOp === null) break
    if (docOp[objActorIdx] !== lastObjActor || docOp[objCtrIdx] !== lastObjCtr) {
      objectId = `${docOp[objCtrIdx]}@${docState.actorIds[docOp[objActorIdx]]}`
      lastObjActor = docOp[objActorIdx]
      lastObjCtr = docOp[objCtrIdx]
      propState = {}
      listIndex = 0
      elemVisible = false
    }

    if (docOp[insertIdx] && elemVisible) {
      elemVisible = false
      listIndex++
    }
    if (docOp[succNumIdx] === 0) elemVisible = true
    if (docOp[idCtrIdx] > docState.maxOp) docState.maxOp = docOp[idCtrIdx]
    for (let i = 0; i < docOp[succNumIdx]; i++) {
      if (docOp[succCtrIdx][i] > docState.maxOp) docState.maxOp = docOp[succCtrIdx][i]
    }

    updatePatchProperty(patches, null, objectId, docOp, docState, propState, listIndex, docOp[succNumIdx])
  }
  return patches._root
}

/**
 * Takes an encoded document whose headers have been parsed using `decodeDocumentHeader()` and reads
 * from it the list of changes. Returns the document's current vector clock, i.e. an object mapping
 * each actor ID (as a hex string) to the number of changes seen from that actor. Also returns an
 * array of the actorIds whose most recent change has no dependents (i.e. the actors that
 * contributed the current heads of the document), and an array of encoders that has been
 * initialised to contain the columns of the changes list.
 */
function readDocumentChanges(doc) {
  const columns = makeDecoders(doc.changesColumns, DOCUMENT_COLUMNS)
  const actorD = columns[0].decoder, seqD = columns[1].decoder
  const depsNumD = columns[5].decoder, depsIndexD = columns[6].decoder
  if (columns[0].columnId !== DOCUMENT_COLUMNS[0].columnId || DOCUMENT_COLUMNS[0].columnName !== 'actor' ||
      columns[1].columnId !== DOCUMENT_COLUMNS[1].columnId || DOCUMENT_COLUMNS[1].columnName !== 'seq' ||
      columns[5].columnId !== DOCUMENT_COLUMNS[5].columnId || DOCUMENT_COLUMNS[5].columnName !== 'depsNum' ||
      columns[6].columnId !== DOCUMENT_COLUMNS[6].columnId || DOCUMENT_COLUMNS[6].columnName !== 'depsIndex') {
    throw new RangeError('unexpected columnId')
  }

  let numChanges = 0, clock = {}, actorNums = [], headIndexes = new Set()
  while (!actorD.done) {
    const actorNum = actorD.readValue(), seq = seqD.readValue(), depsNum = depsNumD.readValue()
    const actorId = doc.actorIds[actorNum]
    if (seq !== 1 && seq !== clock[actorId] + 1) {
      throw new RangeError(`Expected seq ${clock[actorId] + 1}, got ${seq} for actor ${actorId}`)
    }
    actorNums.push(actorNum)
    clock[actorId] = seq
    headIndexes.add(numChanges)
    for (let j = 0; j < depsNum; j++) headIndexes.delete(depsIndexD.readValue())
    numChanges++
  }
  const headActors = [...headIndexes].map(index => doc.actorIds[actorNums[index]]).sort()

  for (let col of columns) col.decoder.reset()
  const encoders = columns.map(col => ({columnId: col.columnId, encoder: encoderByColumnId(col.columnId)}))
  copyColumns(encoders, columns, numChanges)
  return {clock, headActors, encoders, numChanges}
}

/**
 * Records the metadata about a change in the appropriate columns.
 */
function appendChange(columns, change, actorIds, changeIndexByHash) {
  appendOperation(columns, DOCUMENT_COLUMNS, [
    actorIds.indexOf(change.actor), // actor
    change.seq, // seq
    change.maxOp, // maxOp
    change.time, // time
    change.message, // message
    change.deps.length, // depsNum
    change.deps.map(dep => changeIndexByHash[dep]), // depsIndex
    change.extraBytes ? (change.extraBytes.byteLength << 4 | VALUE_TYPE.BYTES) : VALUE_TYPE.BYTES, // extraLen
    change.extraBytes // extraRaw
  ])
}

class BackendDoc {
  constructor(buffer) {
    this.maxOp = 0
    this.haveHashGraph = false
    this.changes = []
    this.changeIndexByHash = {}
    this.dependenciesByHash = {}
    this.dependentsByHash = {}
    this.hashesByActor = {}
    this.actorIds = []
    this.heads = []
    this.clock = {}
    this.queue = []
    this.objectMeta = {_root: {parentObj: null, parentKey: null, opId: null, type: 'map', children: {}}}

    if (buffer) {
      const doc = decodeDocumentHeader(buffer)
      const {clock, headActors, encoders, numChanges} = readDocumentChanges(doc)
      this.binaryDoc = buffer
      this.changes = new Array(numChanges)
      this.actorIds = doc.actorIds
      this.heads = doc.heads
      this.clock = clock
      this.changesEncoders = encoders
      this.extraBytes = doc.extraBytes

      // If there is a single head, we can unambiguously point at the actorId and sequence number of
      // the head hash without having to reconstruct the hash graph
      if (doc.heads.length === 1 && headActors.length === 1) {
        this.hashesByActor[headActors[0]] = []
        this.hashesByActor[headActors[0]][clock[headActors[0]] - 1] = doc.heads[0]
      }

      // The encoded document gives each change an index, and expresses dependencies in terms of
      // those indexes. Initialise the translation table from hash to index.
      if (doc.heads.length === doc.headsIndexes.length) {
        for (let i = 0; i < doc.heads.length; i++) {
          this.changeIndexByHash[doc.heads[i]] = doc.headsIndexes[i]
        }
      } else if (doc.heads.length === 1) {
        // If there is only one head, it must be the last change
        this.changeIndexByHash[doc.heads[0]] = numChanges - 1
      } else {
        // We know the heads hashes, but not their indexes
        for (let head of doc.heads) this.changeIndexByHash[head] = -1
      }

      this.blocks = [{columns: makeDecoders(doc.opsColumns, DOC_OPS_COLUMNS)}]
      updateBlockMetadata(this.blocks[0])
      if (this.blocks[0].numOps > MAX_BLOCK_SIZE) {
        this.blocks = splitBlock(this.blocks[0])
      }

      let docState = {blocks: this.blocks, actorIds: this.actorIds, objectMeta: this.objectMeta, maxOp: 0}
      this.initPatch = documentPatch(docState)
      this.maxOp = docState.maxOp

    } else {
      this.haveHashGraph = true
      this.changesEncoders = DOCUMENT_COLUMNS.map(col => ({columnId: col.columnId, encoder: encoderByColumnId(col.columnId)}))
      this.blocks = [{
        columns: makeDecoders([], DOC_OPS_COLUMNS),
        bloom: new Uint8Array(BLOOM_FILTER_SIZE),
        numOps: 0,
        lastKey: undefined,
        numVisible: undefined,
        lastObjectActor: undefined,
        lastObjectCtr: undefined,
        firstVisibleActor: undefined,
        firstVisibleCtr: undefined,
        lastVisibleActor: undefined,
        lastVisibleCtr: undefined
      }]
    }
  }

  /**
   * Makes a copy of this BackendDoc that can be independently modified.
   */
  clone() {
    let copy = new BackendDoc()
    copy.maxOp = this.maxOp
    copy.haveHashGraph = this.haveHashGraph
    copy.changes = this.changes.slice()
    copy.changeIndexByHash = copyObject(this.changeIndexByHash)
    copy.dependenciesByHash = copyObject(this.dependenciesByHash)
    copy.dependentsByHash = Object.entries(this.dependentsByHash).reduce((acc, [k, v]) => { acc[k] = v.slice(); return acc }, {})
    copy.hashesByActor = Object.entries(this.hashesByActor).reduce((acc, [k, v]) => { acc[k] = v.slice(); return acc }, {})
    copy.actorIds = this.actorIds // immutable, no copying needed
    copy.heads = this.heads // immutable, no copying needed
    copy.clock = this.clock // immutable, no copying needed
    copy.blocks = this.blocks // immutable, no copying needed
    copy.objectMeta = this.objectMeta // immutable, no copying needed
    copy.queue = this.queue // immutable, no copying needed
    return copy
  }

  /**
   * Parses the changes given as Uint8Arrays in `changeBuffers`, and applies them to the current
   * document. Returns a patch to apply to the frontend. If an exception is thrown, the document
   * object is not modified.
   */
  applyChanges(changeBuffers, isLocal = false) {
    // decoded change has the form { actor, seq, startOp, time, message, deps, actorIds, hash, columns, buffer }
    let decodedChanges = changeBuffers.map(buffer => {
      const decoded = decodeChangeColumns(buffer)
      decoded.buffer = buffer
      return decoded
    })

    let patches = {_root: {objectId: '_root', type: 'map', props: {}}}
    let docState = {
      maxOp: this.maxOp,
      changeIndexByHash: this.changeIndexByHash,
      actorIds: this.actorIds,
      heads: this.heads,
      clock: this.clock,
      blocks: this.blocks.slice(),
      objectMeta: Object.assign({}, this.objectMeta)
    }
    let queue = (this.queue.length === 0) ? decodedChanges : decodedChanges.concat(this.queue)
    let allApplied = [], objectIds = new Set()

    while (true) {
      const [applied, enqueued] = applyChanges(patches, queue, docState, objectIds, this.haveHashGraph)
      queue = enqueued
      if (applied.length > 0) allApplied = allApplied.concat(applied)
      if (queue.length === 0) break

      // If we are missing a dependency, and we haven't computed the hash graph yet, first compute
      // the hashes to see if we actually have it already
      if (applied.length === 0) {
        if (this.haveHashGraph) break
        this.computeHashGraph()
        docState.changeIndexByHash = this.changeIndexByHash
      }
    }

    setupPatches(patches, objectIds, docState)

    // Update the document state only if `applyChanges` does not throw an exception
    for (let change of allApplied) {
      this.changes.push(change.buffer)
      if (!this.hashesByActor[change.actor]) this.hashesByActor[change.actor] = []
      this.hashesByActor[change.actor][change.seq - 1] = change.hash
      this.changeIndexByHash[change.hash] = this.changes.length - 1
      this.dependenciesByHash[change.hash] = change.deps
      this.dependentsByHash[change.hash] = []
      for (let dep of change.deps) {
        if (!this.dependentsByHash[dep]) this.dependentsByHash[dep] = []
        this.dependentsByHash[dep].push(change.hash)
      }
      appendChange(this.changesEncoders, change, docState.actorIds, this.changeIndexByHash)
    }

    this.maxOp        = docState.maxOp
    this.actorIds     = docState.actorIds
    this.heads        = docState.heads
    this.clock        = docState.clock
    this.blocks       = docState.blocks
    this.objectMeta   = docState.objectMeta
    this.queue        = queue
    this.binaryDoc    = null
    this.initPatch    = null

    let patch = {
      maxOp: this.maxOp, clock: this.clock, deps: this.heads,
      pendingChanges: this.queue.length, diffs: patches._root
    }
    if (isLocal && decodedChanges.length === 1) {
      patch.actor = decodedChanges[0].actor
      patch.seq = decodedChanges[0].seq
    }
    return patch
  }

  /**
   * Reconstructs the full change history of a document, and initialises the variables that allow us
   * to traverse the hash graph of changes and their dependencies. When a compressed document is
   * loaded we defer the computation of this hash graph to make loading faster, but if the hash
   * graph is later needed (e.g. for the sync protocol), this function fills it in.
   */
  computeHashGraph() {
    const binaryDoc = this.save()
    this.haveHashGraph = true
    this.changes = []
    this.changeIndexByHash = {}
    this.dependenciesByHash = {}
    this.dependentsByHash = {}
    this.hashesByActor = {}
    this.clock = {}

    for (let change of decodeChanges([binaryDoc])) {
      const binaryChange = encodeChange(change) // TODO: avoid decoding and re-encoding again
      this.changes.push(binaryChange)
      this.changeIndexByHash[change.hash] = this.changes.length - 1
      this.dependenciesByHash[change.hash] = change.deps
      this.dependentsByHash[change.hash] = []
      for (let dep of change.deps) this.dependentsByHash[dep].push(change.hash)
      if (change.seq === 1) this.hashesByActor[change.actor] = []
      this.hashesByActor[change.actor].push(change.hash)
      const expectedSeq = (this.clock[change.actor] || 0) + 1
      if (change.seq !== expectedSeq) {
        throw new RangeError(`Expected seq ${expectedSeq}, got seq ${change.seq} from actor ${change.actor}`)
      }
      this.clock[change.actor] = change.seq
    }
  }

  /**
   * Returns all the changes that need to be sent to another replica. `haveDeps` is a list of change
   * hashes (as hex strings) of the heads that the other replica has. The changes in `haveDeps` and
   * any of their transitive dependencies will not be returned; any changes later than or concurrent
   * to the hashes in `haveDeps` will be returned. If `haveDeps` is an empty array, all changes are
   * returned. Throws an exception if any of the given hashes are not known to this replica.
   */
  getChanges(haveDeps) {
    if (!this.haveHashGraph) this.computeHashGraph()

    // If the other replica has nothing, return all changes in history order
    if (haveDeps.length === 0) {
      return this.changes.slice()
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
      return toReturn.map(hash => this.changes[this.changeIndexByHash[hash]])
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
    if (!this.haveHashGraph) this.computeHashGraph()

    // Depth-first traversal from the heads through the dependency graph,
    // until we reach a change that is already present in opSet1
    let stack = this.heads.slice(), seenHashes = {}, toReturn = []
    while (stack.length > 0) {
      const hash = stack.pop()
      if (!seenHashes[hash] && other.changeIndexByHash[hash] === undefined) {
        seenHashes[hash] = true
        toReturn.push(hash)
        stack.push(...this.dependenciesByHash[hash])
      }
    }

    // Return those changes in the reverse of the order in which the depth-first search
    // found them. This is not necessarily a topological sort, but should usually be close.
    return toReturn.reverse().map(hash => this.changes[this.changeIndexByHash[hash]])
  }

  getChangeByHash(hash) {
    if (!this.haveHashGraph) this.computeHashGraph()
    return this.changes[this.changeIndexByHash[hash]]
  }

  /**
   * Returns the hashes of any missing dependencies, i.e. where we have tried to apply a change that
   * has a dependency on a change we have not seen.
   *
   * If the argument `heads` is given (an array of hexadecimal strings representing hashes as
   * returned by `getHeads()`), this function also ensures that all of those hashes resolve to
   * either a change that has been applied to the document, or that has been enqueued for later
   * application once missing dependencies have arrived. Any missing heads hashes are included in
   * the returned array.
   */
  getMissingDeps(heads = []) {
    if (!this.haveHashGraph) this.computeHashGraph()

    let allDeps = new Set(heads), inQueue = new Set()
    for (let change of this.queue) {
      inQueue.add(change.hash)
      for (let dep of change.deps) allDeps.add(dep)
    }

    let missing = []
    for (let hash of allDeps) {
      if (this.changeIndexByHash[hash] === undefined && !inQueue.has(hash)) missing.push(hash)
    }
    return missing.sort()
  }

  /**
   * Serialises the current document state into a single byte array.
   */
  save() {
    if (this.binaryDoc) return this.binaryDoc

    // Getting the byte array for the changes columns finalises their encoders, after which we can
    // no longer append values to them. We therefore copy their data over to fresh encoders.
    const newEncoders = this.changesEncoders.map(col => ({columnId: col.columnId, encoder: encoderByColumnId(col.columnId)}))
    const decoders = this.changesEncoders.map(col => {
      const decoder = decoderByColumnId(col.columnId, col.encoder.buffer)
      return {columnId: col.columnId, decoder}
    })
    copyColumns(newEncoders, decoders, this.changes.length)

    this.binaryDoc = encodeDocumentHeader({
      changesColumns: this.changesEncoders,
      opsColumns: concatBlocks(this.blocks),
      actorIds: this.actorIds, // TODO: sort actorIds (requires transforming all actorId columns in opsColumns)
      heads: this.heads,
      headsIndexes: this.heads.map(hash => this.changeIndexByHash[hash]),
      extraBytes: this.extraBytes
    })
    this.changesEncoders = newEncoders
    return this.binaryDoc
  }

  /**
   * Returns a patch from which we can initialise the current state of the backend.
   */
  getPatch() {
    const objectMeta = {_root: {parentObj: null, parentKey: null, opId: null, type: 'map', children: {}}}
    const docState = {blocks: this.blocks, actorIds: this.actorIds, objectMeta, maxOp: 0}
    const diffs = this.initPatch ? this.initPatch : documentPatch(docState)
    return {
      maxOp: this.maxOp, clock: this.clock, deps: this.heads,
      pendingChanges: this.queue.length, diffs
    }
  }
}

module.exports = { MAX_BLOCK_SIZE, BackendDoc, bloomFilterContains }
