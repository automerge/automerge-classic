const assert = require('assert')
const { checkEncoded } = require('./helpers')
const { DOC_OPS_COLUMNS, encodeChange, decodeChange } = require('../backend/columnar')
const { MAX_BLOCK_SIZE, BackendDoc, bloomFilterContains } = require('../backend/new')
const uuid = require('../src/uuid')

function checkColumns(block, expectedCols) {
  for (let actual of block.columns) {
    const {columnName} = DOC_OPS_COLUMNS.find(({columnId}) => columnId === actual.columnId) || {columnName: actual.columnId.toString()}
    if (expectedCols[columnName]) {
      checkEncoded(actual.decoder.buf, expectedCols[columnName], `${columnName} column`)
    } else if (columnName !== 'chldActor' && columnName !== 'chldCtr') {
      throw new Error(`Unexpected column ${columnName}`)
    }
  }
  for (let expectedName of Object.keys(expectedCols)) {
    const {columnId} = DOC_OPS_COLUMNS.find(({columnName}) => columnName === expectedName) || {columnId: parseInt(expectedName, 10)}
    if (!block.columns.find(actual => actual.columnId === columnId)) {
      throw new Error(`Missing column ${expectedName}`)
    }
  }
}

function hash(change) {
  return decodeChange(encodeChange(change)).hash
}


describe('BackendDoc applying changes', () => {
  it('should overwrite root object properties (1)', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 3, pred: []},
      {action: 'set', obj: '_root', key: 'y', datatype: 'uint', value: 4, pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 5, pred: [`1@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        x: {[`1@${actor}`]: {type: 'value', value: 3, datatype: 'uint'}},
        y: {[`2@${actor}`]: {type: 'value', value: 4, datatype: 'uint'}}
      }}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        x: {[`3@${actor}`]: {type: 'value', value: 5, datatype: 'uint'}}
      }}
    })
    checkColumns(backend.blocks[0], {
      objActor: [],
      objCtr:   [],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [2, 1, 0x78, 0x7f, 1, 0x79], // 'x', 'x', 'y'
      idActor:  [3, 0],
      idCtr:    [0x7d, 1, 2, 0x7f], // 1, 3, 2
      insert:   [3],
      action:   [3, 1],
      valLen:   [3, 0x13],
      valRaw:   [3, 5, 4],
      succNum:  [0x7f, 1, 2, 0],
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 3]
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'y')
    assert.strictEqual(backend.blocks[0].numOps, 3)
    assert.strictEqual(backend.blocks[0].lastObjectActor, null)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, null)
  })

  it('should overwrite root object properties (2)', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 3, pred: []},
      {action: 'set', obj: '_root', key: 'y', datatype: 'uint', value: 4, pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: '_root', key: 'y', datatype: 'uint', value: 5, pred: [`2@${actor}`]},
      {action: 'set', obj: '_root', key: 'z', datatype: 'uint', value: 6, pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        x: {[`1@${actor}`]: {type: 'value', value: 3, datatype: 'uint'}},
        y: {[`2@${actor}`]: {type: 'value', value: 4, datatype: 'uint'}}
      }}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 4, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        y: {[`3@${actor}`]: {type: 'value', value: 5, datatype: 'uint'}},
        z: {[`4@${actor}`]: {type: 'value', value: 6, datatype: 'uint'}}
      }}
    })
    checkColumns(backend.blocks[0], {
      objActor: [],
      objCtr:   [],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [0x7f, 1, 0x78, 2, 1, 0x79, 0x7f, 1, 0x7a], // 'x', 'y', 'y', 'z'
      idActor:  [4, 0],
      idCtr:    [4, 1],
      insert:   [4],
      action:   [4, 1],
      valLen:   [4, 0x13],
      valRaw:   [3, 4, 5, 6],
      succNum:  [0x7e, 0, 1, 2, 0],
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 3]
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'z')
    assert.strictEqual(backend.blocks[0].numOps, 4)
    assert.strictEqual(backend.blocks[0].lastObjectActor, null)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, null)
  })

  it('should allow concurrent overwrites of the same value', () => {
    const actor1 = '01234567', actor2 = '89abcdef', actor3 = 'fedcba98'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 1, pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 2, pred: [`1@${actor1}`]}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 2, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 3, pred: [`1@${actor1}`]}
    ]}
    const change4 = {actor: actor3, seq: 1, startOp: 2, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 4, pred: [`1@${actor1}`]}
    ]}
    const backend1 = new BackendDoc(), backend2 = new BackendDoc()
    backend1.applyChanges([encodeChange(change1)])
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change2)]), {
      maxOp: 2, clock: {[actor1]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`2@${actor1}`]: {type: 'value', value: 2, datatype: 'uint'}
      }}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change3)]), {
      maxOp: 2, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: { x: {
        [`2@${actor1}`]: {type: 'value', value: 2, datatype: 'uint'},
        [`2@${actor2}`]: {type: 'value', value: 3, datatype: 'uint'}
      }}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change4)]), {
      maxOp: 2, clock: {[actor1]: 2, [actor2]: 1, [actor3]: 1}, pendingChanges: 0,
      deps: [hash(change2), hash(change3), hash(change4)].sort(),
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`2@${actor1}`]: {type: 'value', value: 2, datatype: 'uint'},
        [`2@${actor2}`]: {type: 'value', value: 3, datatype: 'uint'},
        [`2@${actor3}`]: {type: 'value', value: 4, datatype: 'uint'}
      }}}
    })
    backend2.applyChanges([encodeChange(change1)])
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change4)]), {
      maxOp: 2, clock: {[actor1]: 1, [actor3]: 1}, deps: [hash(change4)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`2@${actor3}`]: {type: 'value', value: 4, datatype: 'uint'}
      }}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change3)]), {
      maxOp: 2, clock: {[actor1]: 1, [actor2]: 1, [actor3]: 1}, pendingChanges: 0,
      deps: [hash(change3), hash(change4)].sort(),
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`2@${actor2}`]: {type: 'value', value: 3, datatype: 'uint'},
        [`2@${actor3}`]: {type: 'value', value: 4, datatype: 'uint'}
      }}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change2)]), {
      maxOp: 2, clock: {[actor1]: 2, [actor2]: 1, [actor3]: 1}, pendingChanges: 0,
      deps: [hash(change2), hash(change3), hash(change4)].sort(),
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`2@${actor1}`]: {type: 'value', value: 2, datatype: 'uint'},
        [`2@${actor2}`]: {type: 'value', value: 3, datatype: 'uint'},
        [`2@${actor3}`]: {type: 'value', value: 4, datatype: 'uint'}
      }}}
    })
    checkColumns(backend1.blocks[0], {
      objActor: [],
      objCtr:   [],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [4, 1, 0x78], // 4x 'x'
      idActor:  [2, 0, 0x7e, 1, 2], // 0, 0, 1, 2
      idCtr:    [2, 1, 2, 0], // 1, 2, 2, 2
      insert:   [4],
      action:   [4, 1],
      valLen:   [4, 0x13],
      valRaw:   [1, 2, 3, 4],
      succNum:  [0x7f, 3, 3, 0], // 3, 0, 0, 0
      succActor: [0x7d, 0, 1, 2], // 0, 1, 2
      succCtr:   [0x7f, 2, 2, 0] // 2, 2, 2
    })
    assert.strictEqual(backend1.blocks[0].lastKey, 'x')
    assert.strictEqual(backend1.blocks[0].numOps, 4)
    assert.strictEqual(backend1.blocks[0].lastObjectActor, null)
    assert.strictEqual(backend1.blocks[0].lastObjectCtr, null)
    // The two backends are not identical because actors appear in a different order
    checkColumns(backend2.blocks[0], {
      objActor: [],
      objCtr:   [],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [4, 1, 0x78], // 4x 'x'
      idActor:  [2, 0, 0x7e, 2, 1], // 0, 0, 2, 1 <-- different from backend1
      idCtr:    [2, 1, 2, 0], // 1, 2, 2, 2
      insert:   [4],
      action:   [4, 1],
      valLen:   [4, 0x13],
      valRaw:   [1, 2, 3, 4],
      succNum:  [0x7f, 3, 3, 0], // 3, 0, 0, 0
      succActor: [0x7d, 0, 2, 1], // 0, 2, 1 <-- different from backend1
      succCtr:   [0x7f, 2, 2, 0] // 2, 2, 2
    })
    assert.strictEqual(backend2.blocks[0].lastKey, 'x')
    assert.strictEqual(backend2.blocks[0].numOps, 4)
  })

  it('should allow a conflict to be resolved', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 1, pred: []}
    ]}
    const change2 = {actor: actor2, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 2, pred: []}
    ]}
    const change3 = {actor: actor1, seq: 2, startOp: 2, time: 0, deps: [hash(change1), hash(change2)], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 3, pred: [`1@${actor1}`, `1@${actor2}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 1, clock: {[actor1]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`1@${actor1}`]: {type: 'value', value: 1, datatype: 'uint'}
      }}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 1, clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change1), hash(change2)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`1@${actor1}`]: {type: 'value', value: 1, datatype: 'uint'},
        [`1@${actor2}`]: {type: 'value', value: 2, datatype: 'uint'}
      }}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change3)]), {
      maxOp: 2, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`2@${actor1}`]: {type: 'value', value: 3, datatype: 'uint'}
      }}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [],
      objCtr:   [],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [3, 1, 0x78], // 3x 'x'
      idActor:  [0x7d, 0, 1, 0], // 0, 1, 0
      idCtr:    [0x7d, 1, 0, 1], // 1, 1, 2
      insert:   [3],
      action:   [3, 1],
      valLen:   [3, 0x13],
      valRaw:   [1, 2, 3],
      succNum:  [2, 1, 0x7f, 0], // 1, 1, 0
      succActor: [2, 0],
      succCtr:   [0x7e, 2, 0] // 2, 2
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'x')
    assert.strictEqual(backend.blocks[0].numOps, 3)
  })

  it('should throw an error if the predecessor operation does not exist (1)', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 1, pred: []},
      {action: 'set', obj: '_root', key: 'y', datatype: 'uint', value: 2, pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 3, pred: [`2@${actor}`]}
    ]}
    const backend = new BackendDoc()
    backend.applyChanges([encodeChange(change1)])
    assert.throws(() => { backend.applyChanges([encodeChange(change2)]) }, /no matching operation for pred/)
  })

  it('should throw an error if the predecessor operation does not exist (2)', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 1, pred: []}
    ]}
    const change2 = {actor: actor2, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'w', datatype: 'uint', value: 2, pred: []},
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 2, pred: []}
    ]}
    const change3 = {actor: actor1, seq: 2, startOp: 2, time: 0, deps: [hash(change1), hash(change2)], ops: [
      {action: 'set', obj: '_root', key: 'x', datatype: 'uint', value: 3, pred: [`1@${actor2}`]}
    ]}
    const backend = new BackendDoc()
    backend.applyChanges([encodeChange(change1)])
    backend.applyChanges([encodeChange(change2)])
    assert.throws(() => { backend.applyChanges([encodeChange(change3)]) }, /no matching operation for pred/)
  })

  it('should create and update nested maps', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: '_root',      key: 'map',             pred: []},
      {action: 'set',     obj: `1@${actor}`, key: 'x',   value: 'a', pred: []},
      {action: 'set',     obj: `1@${actor}`, key: 'y',   value: 'b', pred: []},
      {action: 'set',     obj: `1@${actor}`, key: 'z',   value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',     obj: `1@${actor}`, key: 'y',    value: 'B', pred: [`3@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 4, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {map: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {
          x: {[`2@${actor}`]: {type: 'value', value: 'a'}},
          y: {[`3@${actor}`]: {type: 'value', value: 'b'}},
          z: {[`4@${actor}`]: {type: 'value', value: 'c'}}
        }
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {map: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {y: {[`5@${actor}`]: {type: 'value', value: 'B'}}}
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 4, 0],
      objCtr:   [0, 1, 4, 1],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [0x7e, 3, 0x6d, 0x61, 0x70, 1, 0x78, 2, 1, 0x79, 0x7f, 1, 0x7a], // 'map', 'x', 'y', 'y', 'z'
      idActor:  [5, 0],
      idCtr:    [3, 1, 0x7e, 2, 0x7f], // 1, 2, 3, 5, 4
      insert:   [5],
      action:   [0x7f, 0, 4, 1], // makeMap, 4x set
      valLen:   [0x7f, 0, 4, 0x16], // null, 4x 1-byte string
      valRaw:   [0x61, 0x62, 0x42, 0x63], // 'a', 'b', 'B', 'c'
      succNum:  [2, 0, 0x7f, 1, 2, 0],
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 5]
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'z')
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
  })

  it('should create nested maps several levels deep', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: '_root',      key: 'a',           pred: []},
      {action: 'makeMap', obj: `1@${actor}`, key: 'b',           pred: []},
      {action: 'makeMap', obj: `2@${actor}`, key: 'c',           pred: []},
      {action: 'set',     obj: `3@${actor}`, key: 'd', datatype: 'uint', value: 1, pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',     obj: `3@${actor}`, key: 'd', datatype: 'uint', value: 2, pred: [`4@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 4, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {a: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {b: {[`2@${actor}`]: {
          objectId: `2@${actor}`, type: 'map', props: {c: {[`3@${actor}`]: {
            objectId: `3@${actor}`, type: 'map', props: {d: {[`4@${actor}`]: {
              type: 'value', value: 1, datatype: 'uint'
            }}}
          }}}
        }}}
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {a: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {b: {[`2@${actor}`]: {
          objectId: `2@${actor}`, type: 'map', props: {c: {[`3@${actor}`]: {
            objectId: `3@${actor}`, type: 'map', props: {d: {[`5@${actor}`]: {
              type: 'value', value: 2, datatype: 'uint'
            }}}
          }}}
        }}}
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 4, 0],
      objCtr:   [0, 1, 0x7e, 1, 2, 2, 3], // null, 1, 2, 3, 3
      keyActor: [],
      keyCtr:   [],
      keyStr:   [0x7d, 1, 0x61, 1, 0x62, 1, 0x63, 2, 1, 0x64], // 'a', 'b', 'c', 'd', 'd'
      idActor:  [5, 0],
      idCtr:    [5, 1], // 1, 2, 3, 4, 5
      insert:   [5],
      action:   [3, 0, 2, 1], // 3x makeMap, 2x set
      valLen:   [3, 0, 2, 0x13], // 3x null, 2x uint
      valRaw:   [1, 2],
      succNum:  [3, 0, 0x7e, 1, 0], // 0, 0, 0, 1, 0
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 5]
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'd')
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 3)
  })

  it('should create a text object', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',     insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head', insert: true,  value: 'a', pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {type: 'value', value: 'a'}}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 0x7f, 0],
      objCtr:   [0, 1, 0x7f, 1],
      keyActor: [],
      keyCtr:   [0, 1, 0x7f, 0],
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 1], // 'text', null
      idActor:  [2, 0],
      idCtr:    [2, 1],
      insert:   [1, 1],
      action:   [0x7e, 4, 1],
      valLen:   [0x7e, 0, 0x16],
      valRaw:   [0x61],
      succNum:  [2, 0],
      succActor: [],
      succCtr:   []
    })
    assert.strictEqual(backend.blocks[0].numOps, 2)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 1)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 2)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 2), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 3), false)
  })

  it('should insert text characters', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: true,  value: 'c', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `4@${actor}`, insert: true,  value: 'd', pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 3, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'b']}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 2, elemId: `4@${actor}`, values: ['c', 'd']}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 4, 0],
      objCtr:   [0, 1, 4, 1],
      keyActor: [0, 2, 3, 0],
      keyCtr:   [0, 1, 0x7e, 0, 2, 2, 1], // null, 0, 2, 3, 4
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4], // 'text', 4x null
      idActor:  [5, 0],
      idCtr:    [5, 1],
      insert:   [1, 4],
      action:   [0x7f, 4, 4, 1], // makeText, 4x set
      valLen:   [0x7f, 0, 4, 0x16], // null, 4x 1-byte string
      valRaw:   [0x61, 0x62, 0x63, 0x64], // 'a', 'b', 'c', 'd'
      succNum:  [5, 0],
      succActor: [],
      succCtr:   []
    })
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 4)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 5)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 2), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 3), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 4), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 5), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 1, 2), false)
  })

  it('should throw an error if the reference element of an insertion does not exist', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []},
      {action: 'makeMap',  obj: '_root',      key: 'map',           insert: false,             pred: []},
      {action: 'set',      obj: `4@${actor}`, key: 'foo',           insert: false, value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 6, time: 0, deps: [], ops: [
      {action: 'set',      obj: `1@${actor}`, elemId: `4@${actor}`, insert: true,  value: 'd', pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 5, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        text: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'text', edits: [
            {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'b']}
          ]
        }},
        map: {[`4@${actor}`]: {objectId: `4@${actor}`, type: 'map', props: {
          foo: {[`5@${actor}`]: {type: 'value', value: 'c'}}
        }}}
      }}
    })
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 4)
    assert.throws(() => { backend.applyChanges([encodeChange(change2)]) }, /Reference element not found/)
  })

  it('should handle non-consecutive insertions', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: true,  value: 'd', pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 3, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'c']}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'insert', index: 1, elemId: `4@${actor}`, opId: `4@${actor}`, value: {type: 'value', value: 'b'}},
          {action: 'insert', index: 3, elemId: `5@${actor}`, opId: `5@${actor}`, value: {type: 'value', value: 'd'}}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 4, 0],
      objCtr:   [0, 1, 4, 1],
      keyActor: [0, 2, 3, 0],
      keyCtr:   [0, 1, 0x7c, 0, 2, 0, 1], // null, 0, 2, 2, 3
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4], // 'text', 4x null
      idActor:  [5, 0],
      idCtr:    [2, 1, 0x7d, 2, 0x7f, 2], // 1, 2, 4, 3, 5
      insert:   [1, 4],
      action:   [0x7f, 4, 4, 1], // makeText, 4x set
      valLen:   [0x7f, 0, 4, 0x16], // null, 4x 1-byte string
      valRaw:   [0x61, 0x62, 0x63, 0x64], // 'a', 'b', 'c', 'd'
      succNum:  [5, 0],
      succActor: [],
      succCtr:   []
    })
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 4)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 5)
  })

  it('should delete the first character', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',     insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head', insert: true,  value: 'a', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'del',      obj: `1@${actor}`, elemId: `2@${actor}`, pred: [`2@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {type: 'value', value: 'a'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [{action: 'remove', index: 0, count: 1}]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 0x7f, 0],
      objCtr:   [0, 1, 0x7f, 1],
      keyActor: [],
      keyCtr:   [0, 1, 0x7f, 0],
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 1], // 'text', null
      idActor:  [2, 0],
      idCtr:    [2, 1],
      insert:   [1, 1],
      action:   [0x7e, 4, 1],
      valLen:   [0x7e, 0, 0x16],
      valRaw:   [0x61],
      succNum:  [0x7e, 0, 1],
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 3]
    })
    assert.strictEqual(backend.blocks[0].numOps, 2)
    assert.strictEqual(backend.blocks[0].numVisible, 0)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, undefined)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, undefined)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, undefined)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, undefined)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 2), true)
  })

  it('should delete a character in the middle', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: true,  value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
      {action: 'del',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: false, pred: [`3@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 4, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'b', 'c']}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [{action: 'remove', index: 1, count: 1}]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 3, 0],
      objCtr:   [0, 1, 3, 1],
      keyActor: [0, 2, 2, 0],
      keyCtr:   [0, 1, 0x7d, 0, 2, 1], // null, 0, 2, 3
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 3], // 'text', 3x null
      idActor:  [4, 0],
      idCtr:    [4, 1],
      insert:   [1, 3],
      action:   [0x7f, 4, 3, 1], // makeText, set, set, set
      valLen:   [0x7f, 0, 3, 0x16], // null, 3x 1-byte string
      valRaw:   [0x61, 0x62, 0x63], // 'a', 'b', 'c'
      succNum:  [2, 0, 0x7e, 1, 0],
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 5]
    })
    assert.strictEqual(backend.blocks[0].numOps, 4)
    assert.strictEqual(backend.blocks[0].numVisible, 2)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 4)
  })

  it('should throw an error if a deleted element does not exist', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [], ops: [
      {action: 'del',      obj: `1@${actor}`, elemId: `1@${actor}`, insert: false, pred: [`1@${actor}`]}
    ]}
    const backend = new BackendDoc()
    backend.applyChanges([encodeChange(change1)])
    assert.throws(() => { backend.applyChanges([encodeChange(change2)]) }, /Reference element not found/)
  })

  it('should apply concurrent insertions at the same position', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',       key: 'text',           insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'a', pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: true,  value: 'c', pred: []}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: true,  value: 'b', pred: []}
    ]}
    const backend1 = new BackendDoc(), backend2 = new BackendDoc()
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor1]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {type: 'value', value: 'a'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor1]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 1, elemId: `3@${actor1}`, opId: `3@${actor1}`, value: {type: 'value', value: 'c'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 1, elemId: `3@${actor2}`, opId: `3@${actor2}`, value: {type: 'value', value: 'b'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor1]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {type: 'value', value: 'a'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 1, elemId: `3@${actor2}`, opId: `3@${actor2}`, value: {type: 'value', value: 'b'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 2, elemId: `3@${actor1}`, opId: `3@${actor1}`, value: {type: 'value', value: 'c'}}
        ]
      }}}}
    })
    for (let backend of [backend1, backend2]) {
      checkColumns(backend.blocks[0], {
        objActor: [0, 1, 3, 0],
        objCtr:   [0, 1, 3, 1],
        keyActor: [0, 2, 2, 0],
        keyCtr:   [0, 1, 0x7d, 0, 2, 0], // null, 0, 2, 2
        keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 3], // 'text', 3x null
        idActor:  [2, 0, 0x7e, 1, 0], // 0, 0, 1, 0
        idCtr:    [3, 1, 0x7f, 0], // 1, 2, 3, 3
        insert:   [1, 3], // false, true, true, true
        action:   [0x7f, 4, 3, 1], // makeText, set, set, set
        valLen:   [0x7f, 0, 3, 0x16], // null, 3x 1-byte string
        valRaw:   [0x61, 0x62, 0x63], // 'a', 'b', 'c'
        succNum:  [4, 0],
        succActor: [],
        succCtr:   []
      })
      assert.strictEqual(backend.blocks[0].numOps, 4)
      assert.strictEqual(backend.blocks[0].numVisible, 3)
      assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
      assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
      assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
      assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
      assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
      assert.strictEqual(backend.blocks[0].lastVisibleCtr, 3)
    }
  })

  it('should apply concurrent insertions at the head', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',       key: 'text',           insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'd', pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'c', pred: []}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: `3@${actor2}`, insert: true,  value: 'b', pred: []}
    ]}
    const backend1 = new BackendDoc(), backend2 = new BackendDoc()
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor1]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {type: 'value', value: 'd'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor1]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `3@${actor1}`, opId: `3@${actor1}`, value: {type: 'value', value: 'c'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change3)]), {
      maxOp: 4, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `3@${actor2}`, values: ['a', 'b']}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor1]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {type: 'value', value: 'd'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change3)]), {
      maxOp: 4, clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `3@${actor2}`, values: ['a', 'b']}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change2)]), {
      maxOp: 4, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 2, elemId: `3@${actor1}`, opId: `3@${actor1}`, value: {type: 'value', value: 'c'}}
        ]
      }}}}
    })
    for (let backend of [backend1, backend2]) {
      checkColumns(backend.blocks[0], {
        objActor: [0, 1, 4, 0],
        objCtr:   [0, 1, 4, 1],
        keyActor: [0, 2, 0x7f, 1, 0, 2], // null, null, 1, null, null
        keyCtr:   [0, 1, 0x7c, 0, 3, 0x7d, 0], // null, 0, 3, 0, 0
        keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4], // 'text', 4x null
        idActor:  [0x7f, 0, 2, 1, 2, 0], // 0, 1, 1, 0, 0
        idCtr:    [0x7d, 1, 2, 1, 2, 0x7f], // 1, 3, 4, 3, 2
        insert:   [1, 4], // false, true, true, true, true
        action:   [0x7f, 4, 4, 1], // makeText, set, set, set, set
        valLen:   [0x7f, 0, 4, 0x16], // null, 4x 1-byte string
        valRaw:   [0x61, 0x62, 0x63, 0x64], // 'a', 'b', 'c', 'd'
        succNum:  [5, 0],
        succActor: [],
        succCtr:   []
      })
      assert.strictEqual(backend.blocks[0].numOps, 5)
      assert.strictEqual(backend.blocks[0].numVisible, 4)
      assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
      assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
      // firstVisible is incorrect -- it should strictly be (1,3) rather than (0,2) -- but that
      // doesn't matter since in any case it'll be different from the previous block's lastVisible
      assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
      assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
      assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
      assert.strictEqual(backend.blocks[0].lastVisibleCtr, 2)
      assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 2), true)
      assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 3), true)
      assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 1, 3), true)
      assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 1, 4), true)
      // The chance of a false positive is extremely low since the filter only contains 4 elements
      for (let i = 5; i < 100; i++) assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 1, i), false)
    }
  })

  it('should perform multiple list element updates', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: true,  value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: false, value: 'A', pred: [`2@${actor}`]},
      {action: 'set',      obj: `1@${actor}`, elemId: `4@${actor}`, insert: false, value: 'C', pred: [`4@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 4, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'b', 'c']}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 6, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'update', index: 0, opId: `5@${actor}`, value: {type: 'value', value: 'A'}},
          {action: 'update', index: 2, opId: `6@${actor}`, value: {type: 'value', value: 'C'}}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 5, 0],
      objCtr:   [0, 1, 5, 1],
      keyActor: [0, 2, 4, 0],
      keyCtr:   [0, 1, 0x7d, 0, 2, 0, 2, 1], // null, 0, 2, 2, 3, 4
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 5], // 'text', 5x null
      idActor:  [6, 0],
      idCtr:    [2, 1, 0x7c, 3, 0x7e, 1, 2], // 1, 2, 5, 3, 4, 6
      insert:   [1, 1, 1, 2, 1], // false, true, false, true, true, false
      action:   [0x7f, 4, 5, 1], // makeText, 5x set
      valLen:   [0x7f, 0, 5, 0x16], // null, 5x 1-byte string
      valRaw:   [0x61, 0x41, 0x62, 0x63, 0x43], // 'a', 'A', 'b', 'c', 'C'
      succNum:  [0x7e, 0, 1, 2, 0, 0x7e, 1, 0], // 0, 1, 0, 0, 1, 0
      succActor: [2, 0],
      succCtr:   [0x7e, 5, 1] // 5, 6
    })
    assert.strictEqual(backend.blocks[0].numOps, 6)
    assert.strictEqual(backend.blocks[0].numVisible, 3)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 4)
  })

  it('should allow list element updates in reverse order', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: true,  value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor}`, elemId: `4@${actor}`, insert: false, value: 'C', pred: [`4@${actor}`]},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: false, value: 'A', pred: [`2@${actor}`]}
    ]}
    const backend = new BackendDoc()
    backend.applyChanges([encodeChange(change1)])
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 6, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'update', index: 2, opId: `5@${actor}`, value: {type: 'value', value: 'C'}},
          {action: 'update', index: 0, opId: `6@${actor}`, value: {type: 'value', value: 'A'}}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 5, 0],
      objCtr:   [0, 1, 5, 1],
      keyActor: [0, 2, 4, 0], // null, null, 0, 0, 0, 0
      keyCtr:   [0, 1, 0x7d, 0, 2, 0, 2, 1], // null, 0, 2, 2, 3, 4
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 5], // 'text', 5x null
      idActor:  [6, 0],
      idCtr:    [2, 1, 0x7e, 4, 0x7d, 2, 1], // 1, 2, 6, 3, 4, 5
      insert:   [1, 1, 1, 2, 1], // false, true, false, true, true, false
      action:   [0x7f, 4, 5, 1], // makeText, 5x set
      valLen:   [0x7f, 0, 5, 0x16], // null, 5x 1-byte string
      valRaw:   [0x61, 0x41, 0x62, 0x63, 0x43], // 'a', 'A', 'b', 'c', 'C'
      succNum:  [0x7e, 0, 1, 2, 0, 0x7e, 1, 0], // 0, 1, 0, 0, 1, 0
      succActor: [2, 0],
      succCtr:   [0x7e, 6, 0x7f] // 6, 5
    })
    assert.strictEqual(backend.blocks[0].numOps, 6)
    assert.strictEqual(backend.blocks[0].numVisible, 3)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 4)
  })

  it('should handle nested objects inside list elements', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeList', obj: '_root',      key: 'list',          insert: false,           pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true, datatype: 'uint', value: 1, pred: []},
      {action: 'makeMap',  obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,            pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `3@${actor}`, key: 'x',          insert: false, datatype: 'uint', value: 2, pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 3, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {
            type: 'value', value: 1, datatype: 'uint'
          }},
          {action: 'insert', index: 1, elemId: `3@${actor}`, opId: `3@${actor}`, value: {
            objectId: `3@${actor}`, type: 'map', props: {}
          }}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 4, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'list', edits: [
          {action: 'update', index: 1, opId: `3@${actor}`, value: {
            objectId: `3@${actor}`, type: 'map', props: {x: {[`4@${actor}`]: {
              type: 'value', value: 2, datatype: 'uint'
            }}}
          }}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 3, 0],
      objCtr:   [0, 1, 2, 1, 0x7f, 3], // null, 1, 1, 3
      keyActor: [0, 2, 0x7f, 0, 0, 1], // null, null, 0, null
      keyCtr:   [0, 1, 0x7e, 0, 2, 0, 1], // null, 0, 2, null
      keyStr:   [0x7f, 4, 0x6c, 0x69, 0x73, 0x74, 0, 2, 0x7f, 1, 0x78], // 'list', null, null, 'x'
      idActor:  [4, 0],
      idCtr:    [4, 1],
      insert:   [1, 2, 1], // false, true, true, false
      action:   [0x7c, 2, 1, 0, 1], // makeList, set, makeMap, set
      valLen:   [0x7c, 0, 0x13, 0, 0x13], // null, uint, null, uint
      valRaw:   [1, 2],
      succNum:  [4, 0],
      succActor: [],
      succCtr:   []
    })
    assert.strictEqual(backend.blocks[0].numOps, 4)
    assert.strictEqual(backend.blocks[0].lastKey, 'x')
    assert.strictEqual(backend.blocks[0].numVisible, 0)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 3)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, undefined)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, undefined)
  })

  it('should handle multiple list objects', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeList', obj: '_root',      key: 'list1',         insert: false,           pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true, datatype: 'uint', value: 1, pred: []},
      {action: 'makeList', obj: '_root',      key: 'list2',         insert: false,           pred: []},
      {action: 'set',      obj: `3@${actor}`, elemId: '_head',      insert: true, datatype: 'uint', value: 2, pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true, datatype: 'uint', value: 3, pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 4, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        list1: {[`1@${actor}`]: {objectId: `1@${actor}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {
            type: 'value', value: 1, datatype: 'uint'
          }}
        ]}},
        list2: {[`3@${actor}`]: {objectId: `3@${actor}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `4@${actor}`, opId: `4@${actor}`, value: {
            type: 'value', value: 2, datatype: 'uint'
          }}
        ]}}
      }}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        list1: {[`1@${actor}`]: {objectId: `1@${actor}`, type: 'list', edits: [
          {action: 'insert', index: 1, elemId: `5@${actor}`, opId: `5@${actor}`, value: {
            type: 'value', value: 3, datatype: 'uint'
          }}
        ]}}
      }}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 2, 3, 0],
      objCtr:   [0, 2, 2, 1, 0x7f, 3], // null, null, 1, 1, 3
      keyActor: [0, 3, 0x7f, 0, 0, 1], // null, null, null, 0, null
      keyCtr:   [0, 2, 0x7d, 0, 2, 0x7e], // null, null, 0, 2, 0
      keyStr:   [0x7e, 5, 0x6c, 0x69, 0x73, 0x74, 0x31, 5, 0x6c, 0x69, 0x73, 0x74, 0x32, 0, 3], // 'list1', 'list2', null, null, null
      idActor:  [5, 0],
      idCtr:    [0x7b, 1, 2, 0x7f, 3, 0x7f], // 1, 3, 2, 5, 4
      insert:   [2, 3], // false, false, true, true, true
      action:   [2, 2, 3, 1], // 2x makeList, 3x set
      valLen:   [2, 0, 3, 0x13], // 2x null, 3x uint
      valRaw:   [1, 3, 2],
      succNum:  [5, 0],
      succActor: [],
      succCtr:   []
    })
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 1)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 3)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 4)
  })

  it('should handle a counter inside a map', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'counter', value: 1, datatype: 'counter', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
      {action: 'inc', obj: '_root', key: 'counter', datatype: 'uint', value: 2, pred: [`1@${actor}`]}
    ]}
    const change3 = {actor, seq: 3, startOp: 3, time: 0, deps: [hash(change2)], ops: [
      {action: 'inc', obj: '_root', key: 'counter', datatype: 'uint', value: 3, pred: [`1@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 1, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        counter: {[`1@${actor}`]: {type: 'value', value: 1, datatype: 'counter'}}
      }}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 2, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        counter: {[`1@${actor}`]: {type: 'value', value: 3, datatype: 'counter'}}
      }}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor]: 3}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        counter: {[`1@${actor}`]: {type: 'value', value: 6, datatype: 'counter'}}
      }}
    })
    checkColumns(backend.blocks[0], {
      objActor: [],
      objCtr:   [],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [3, 7, 0x63, 0x6f, 0x75, 0x6e, 0x74, 0x65, 0x72], // 3x 'counter'
      idActor:  [3, 0],
      idCtr:    [3, 1],
      insert:   [3],
      action:   [0x7f, 1, 2, 5], // set, inc, inc
      valLen:   [0x7f, 0x18, 2, 0x13], // counter, uint, uint
      valRaw:   [1, 2, 3],
      succNum:  [0x7f, 2, 2, 0], // 2, 0, 0
      succActor: [2, 0],
      succCtr:   [0x7e, 2, 1] // 2, 3
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'counter')
    assert.strictEqual(backend.blocks[0].numOps, 3)
    assert.strictEqual(backend.blocks[0].lastObjectActor, null)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, null)
  })

  it('should handle a counter inside a list element', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeList', obj: '_root',      key: 'list',          insert: false, pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  pred: [], value: 1, datatype: 'counter'}
    ]}
    const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'inc',      obj: `1@${actor}`, elemId: `2@${actor}`, datatype: 'uint', value: 2, pred: [`2@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor}`, opId: `2@${actor}`, value: {
            type: 'value', value: 1, datatype: 'counter'
          }}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'list', edits: [
          {action: 'update', index: 0, opId: `2@${actor}`, value: {
            type: 'value', value: 3, datatype: 'counter'
          }}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 2, 0],
      objCtr:   [0, 1, 2, 1],
      keyActor: [0, 2, 0x7f, 0], // null, null, 0
      keyCtr:   [0, 1, 0x7e, 0, 2], // null, 0, 2
      keyStr:   [0x7f, 4, 0x6c, 0x69, 0x73, 0x74, 0, 2], // 'list', null, null
      idActor:  [3, 0],
      idCtr:    [3, 1], // 1, 2, 3
      insert:   [1, 1, 1], // false, true, false
      action:   [0x7d, 2, 1, 5], // makeList, set, inc
      valLen:   [0x7d, 0, 0x18, 0x13], // null, counter, uint
      valRaw:   [1, 2],
      succNum:  [0x7d, 0, 1, 0],
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 3]
    })
    assert.strictEqual(backend.blocks[0].numOps, 3)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 1)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 2)
  })

  it('should delete a counter from a map', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: '_root', key: 'counter', value: 1, datatype: 'counter', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 2, time: 0, deps: [hash(change1)], ops: [
      {action: 'inc', obj: '_root', key: 'counter', value: 2, datatype: 'uint', pred: [`1@${actor}`]}
    ]}
    const change3 = {actor, seq: 3, startOp: 3, time: 0, deps: [hash(change2)], ops: [
      {action: 'del', obj: '_root', key: 'counter', pred: [`1@${actor}`]}
    ]}
    const backend = new BackendDoc()
    backend.applyChanges([encodeChange(change1)])
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 2, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {
        counter: {[`1@${actor}`]: {type: 'value', value: 3, datatype: 'counter'}}
      }}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor]: 3}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {counter: {}}}
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'counter')
    assert.strictEqual(backend.blocks[0].numOps, 2)
    assert.strictEqual(backend.blocks[0].lastObjectActor, null)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, null)
  })

  it('should handle conflicts inside list elements', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeList', obj: '_root',       key: 'list',           insert: false,           pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  datatype: 'uint', value: 1, pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, datatype: 'uint', value: 2, pred: [`2@${actor1}`]}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, datatype: 'uint', value: 3, pred: [`2@${actor1}`]}
    ]}
    const backend1 = new BackendDoc(), backend2 = new BackendDoc()
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor1]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {
            type: 'value', value: 1, datatype: 'uint'
          }}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor1]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'update', index: 0, opId: `3@${actor1}`, value: {type: 'value', value: 2, datatype: 'uint'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'update', index: 0, opId: `3@${actor1}`, value: {type: 'value', value: 2, datatype: 'uint'}},
          {action: 'update', index: 0, opId: `3@${actor2}`, value: {type: 'value', value: 3, datatype: 'uint'}}
        ]
      }}}}
    })
    backend2.applyChanges([encodeChange(change1)])
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'update', index: 0, opId: `3@${actor2}`, value: {type: 'value', value: 3, datatype: 'uint'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'update', index: 0, opId: `3@${actor1}`, value: {type: 'value', value: 2, datatype: 'uint'}},
          {action: 'update', index: 0, opId: `3@${actor2}`, value: {type: 'value', value: 3, datatype: 'uint'}}
        ]
      }}}}
    })
    for (let backend of [backend1, backend2]) {
      checkColumns(backend.blocks[0], {
        objActor: [0, 1, 3, 0],
        objCtr:   [0, 1, 3, 1],
        keyActor: [0, 2, 2, 0],
        keyCtr:   [0, 1, 0x7d, 0, 2, 0], // null, 0, 2, 2
        keyStr:   [0x7f, 4, 0x6c, 0x69, 0x73, 0x74, 0, 3], // 'list', 3x null
        idActor:  [3, 0, 0x7f, 1],
        idCtr:    [3, 1, 0x7f, 0], // 1, 2, 3, 3
        insert:   [1, 1, 2], // false, true, false, false
        action:   [0x7f, 2, 3, 1], // makeList, 3x set
        valLen:   [0x7f, 0, 3, 0x13], // null, 3x uint
        valRaw:   [1, 2, 3],
        succNum:  [0x7e, 0, 2, 2, 0], // 0, 1, 0, 0
        succActor: [0x7e, 0, 1],
        succCtr:   [0x7e, 3, 0] // 3, 3
      })
      assert.strictEqual(backend.blocks[0].numOps, 4)
      assert.strictEqual(backend.blocks[0].lastKey, undefined)
      assert.strictEqual(backend.blocks[0].numVisible, 1)
      assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
      assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
      assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
      assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
      assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
      assert.strictEqual(backend.blocks[0].lastVisibleCtr, 2)
    }
  })

  it('should allow conflicts to be introduced by a single change', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: false, value: 'x', pred: [`2@${actor}`]},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: false, value: 'y', pred: [`2@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 3, clock: {[actor]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'b']}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'update', index: 0, opId: `4@${actor}`, value: {type: 'value', value: 'x'}},
          {action: 'update', index: 0, opId: `5@${actor}`, value: {type: 'value', value: 'y'}}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 4, 0],
      objCtr:   [0, 1, 4, 1],
      keyActor: [0, 2, 3, 0],
      keyCtr:   [0, 1, 0x7e, 0, 2, 2, 0], // null, 0, 2, 2, 2
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4], // 'text', 4x null
      idActor:  [5, 0],
      idCtr:    [2, 1, 0x7d, 2, 1, 0x7e], // 1, 2, 4, 5, 3
      insert:   [1, 1, 2, 1], // false, true, false, false, true
      action:   [0x7f, 4, 4, 1], // makeText, 4x set
      valLen:   [0x7f, 0, 4, 0x16], // null, 4x 1-byte string
      valRaw:   [0x61, 0x78, 0x79, 0x62], // 'a', 'x', 'y', 'b'
      succNum:  [0x7e, 0, 2, 3, 0], // 0, 2, 0, 0, 0
      succActor: [2, 0],
      succCtr:   [0x7e, 4, 1] // 4, 5
    })
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 2)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 3)
  })

  it('should allow conflicts to arise on a multi-inserted element', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: false, value: 'x', pred: [`3@${actor}`]},
      {action: 'set',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: false, value: 'y', pred: [`3@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1), encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a']},
          {action: 'insert', index: 1, elemId: `3@${actor}`, opId: `4@${actor}`, value: {type: 'value', value: 'x'}},
          {action: 'update', index: 1, opId: `5@${actor}`, value: {type: 'value', value: 'y'}}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 4, 0],
      objCtr:   [0, 1, 4, 1],
      keyActor: [0, 2, 3, 0],
      keyCtr:   [0, 1, 0x7c, 0, 2, 1, 0], // null, 0, 2, 3, 3
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4], // 'text', 4x null
      idActor:  [5, 0],
      idCtr:    [5, 1], // 1, 2, 3, 4, 5
      insert:   [1, 2, 2], // false, true, true, false, false
      action:   [0x7f, 4, 4, 1], // makeText, 4x set
      valLen:   [0x7f, 0, 4, 0x16], // null, 4x 1-byte string
      valRaw:   [0x61, 0x62, 0x78, 0x79], // 'a', 'b', 'x', 'y'
      succNum:  [2, 0, 0x7f, 2, 2, 0], // 0, 0, 2, 0, 0
      succActor: [2, 0],
      succCtr:   [0x7e, 4, 1] // 4, 5
    })
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 2)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 3)
  })

  it('should convert inserts to updates when needed', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',       key: 'text',           insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'c', pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: `3@${actor1}`, insert: true,  value: 'b', pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'C', pred: [`2@${actor1}`]}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'x', pred: [`2@${actor1}`]},
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'y', pred: [`2@${actor1}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1), encodeChange(change2)]), {
      maxOp: 5, clock: {[actor1]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {type: 'value', value: 'c'}},
          {action: 'multi-insert', index: 0, elemId: `3@${actor1}`, values: ['a', 'b']},
          {action: 'update', index: 2, opId: `5@${actor1}`, value: {type: 'value', value: 'C'}}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change3)]), {
      maxOp: 5, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'update', index: 2, opId: `3@${actor2}`, value: {type: 'value', value: 'x'}},
          {action: 'update', index: 2, opId: `4@${actor2}`, value: {type: 'value', value: 'y'}},
          {action: 'update', index: 2, opId: `5@${actor1}`, value: {type: 'value', value: 'C'}}
        ]
      }}}}
    })
    // Order of operations in the document:
    // {action: 'makeText', id: `1@${actor1}`, obj: '_root',       key: 'text',           insert: false,             succ: []},
    // {action: 'set',      id: `3@${actor1}`, obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'a', succ: []},
    // {action: 'set',      id: `4@${actor1}`, obj: `1@${actor1}`, elemId: `3@${actor1}`, insert: true,  value: 'b', succ: []},
    // {action: 'set',      id: `2@${actor1}`, obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'c', succ: [`3@${actor2}`, `4@${actor2}`, `5@${actor1}`]},
    // {action: 'set',      id: `3@${actor2}`, obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'x', succ: []},
    // {action: 'set',      id: `4@${actor2}`, obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'y', succ: []},
    // {action: 'set',      id: `5@${actor1}`, obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'C', succ: []}
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 6, 0],
      objCtr:   [0, 1, 6, 1],
      keyActor: [0, 2, 0x7f, 0, 0, 1, 3, 0], // null, null, 0, null, 0, 0, 0
      keyCtr:   [0, 1, 0x7c, 0, 3, 0x7d, 2, 2, 0], // null, 0, 3, 0, 2, 2, 2
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 6], // 'text', 6x null
      idActor:  [4, 0, 2, 1, 0x7f, 0], // 4x actor1, 2x actor2, 1x actor1
      idCtr:    [0x7c, 1, 2, 1, 0x7e, 3, 1], // 1, 3, 4, 2, 3, 4, 5
      insert:   [1, 3, 3], // 1x false, 3x true, 3x false
      action:   [0x7f, 4, 6, 1], // makeText, 6x set
      valLen:   [0x7f, 0, 6, 0x16], // null, 6x 1-byte string
      valRaw:   [0x61, 0x62, 0x63, 0x78, 0x79, 0x43], // 'a', 'b', 'c', 'x', 'y', 'C'
      succNum:  [3, 0, 0x7f, 3, 3, 0], // 0, 0, 0, 3, 0, 0, 0
      succActor: [2, 1, 0x7f, 0], // actor2, actor2, actor1
      succCtr:   [0x7f, 3, 2, 1] // 3, 4, 5
    })
    assert.strictEqual(backend.blocks[0].numOps, 7)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 3)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    // firstVisible is incorrect -- it should strictly be (0,3) rather than (0,2) -- but that
    // doesn't matter since in any case it'll be different from the previous block's lastVisible
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 2)
  })

  it('should allow a further conflict to be added to an existing conflict', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',       key: 'text',           insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'a', pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'b', pred: [`2@${actor1}`]},
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'c', pred: [`2@${actor1}`]}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'x', pred: [`2@${actor1}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([change1, change2, change3].map(encodeChange)), {
      maxOp: 4, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `3@${actor1}`, value: {type: 'value', value: 'b'}},
          {action: 'update', index: 0, opId: `3@${actor2}`, value: {type: 'value', value: 'x'}},
          {action: 'update', index: 0, opId: `4@${actor1}`, value: {type: 'value', value: 'c'}}
        ]
      }}}}
    })
    // Order of operations in the document:
    // {action: 'makeText', id: `1@${actor1}`, obj: '_root',       key: 'text',           insert: false,             succ: []},
    // {action: 'set',      id: `2@${actor1}`, obj: `1@${actor1}`, elemId: '_head',       insert: true,  value: 'a', succ: [`3@${actor1}`, `3@${actor2}`, `4@${actor1}`]},
    // {action: 'set',      id: `3@${actor1}`, obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'b', succ: []},
    // {action: 'set',      id: `3@${actor2}`, obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'x', succ: []},
    // {action: 'set',      id: `4@${actor1}`, obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, value: 'c', succ: []}
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 4, 0],
      objCtr:   [0, 1, 4, 1],
      keyActor: [0, 2, 3, 0],
      keyCtr:   [0, 1, 0x7e, 0, 2, 2, 0], // null, 0, 2, 2, 2
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4], // 'text', 4x null
      idActor:  [3, 0, 0x7e, 1, 0], // 3x actor1, 1x actor2, 1x actor1
      idCtr:    [3, 1, 0x7e, 0, 1], // 1, 2, 3, 3, 4
      insert:   [1, 1, 3], // false, true, false, false, false
      action:   [0x7f, 4, 4, 1], // makeText, 4x set
      valLen:   [0x7f, 0, 4, 0x16], // null, 4x 1-byte string
      valRaw:   [0x61, 0x62, 0x78, 0x63], // 'a', 'b', 'x', 'c'
      succNum:  [0x7e, 0, 3, 3, 0], // 0, 3, 0, 0, 0
      succActor: [0x7d, 0, 1, 0], // actor1, actor2, actor1
      succCtr:   [0x7d, 3, 0, 1] // 3, 3, 4
    })
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 1)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 2)
  })

  it('should allow element deletes and overwrites in the same change', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',          insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: true,  value: 'b', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [hash(change1)], ops: [
      {action: 'del',      obj: `1@${actor}`, elemId: `2@${actor}`, insert: false,             pred: [`2@${actor}`]},
      {action: 'set',      obj: `1@${actor}`, elemId: `3@${actor}`, insert: false, value: 'x', pred: [`3@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1), encodeChange(change2)]), {
      maxOp: 5, clock: {[actor]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [
          {action: 'multi-insert', index: 0, elemId: `2@${actor}`, values: ['a', 'b']},
          {action: 'remove', index: 0, count: 1},
          {action: 'update', index: 0, opId: `5@${actor}`, value: {type: 'value', value: 'x'}}
        ]
      }}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, 3, 0],
      objCtr:   [0, 1, 3, 1],
      keyActor: [0, 2, 2, 0],
      keyCtr:   [0, 1, 0x7d, 0, 2, 1], // null, 0, 2, 3
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 3], // 'text', 3x null
      idActor:  [4, 0],
      idCtr:    [3, 1, 0x7f, 2], // 1, 2, 3, 5
      insert:   [1, 2, 1], // false, true, true, false
      action:   [0x7f, 4, 3, 1], // makeText, 3x set
      valLen:   [0x7f, 0, 3, 0x16], // null, 3x 1-byte string
      valRaw:   [0x61, 0x62, 0x78], // 'a', 'b', 'x'
      succNum:  [0x7f, 0, 2, 1, 0x7f, 0], // 0, 1, 1, 0
      succActor: [2, 0],
      succCtr:   [0x7e, 4, 1] // 4, 5
    })
    assert.strictEqual(backend.blocks[0].numOps, 4)
    assert.strictEqual(backend.blocks[0].lastKey, undefined)
    assert.strictEqual(backend.blocks[0].numVisible, 1)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
    assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].firstVisibleCtr, 3)
    assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
    assert.strictEqual(backend.blocks[0].lastVisibleCtr, 3)
  })

  it('should allow concurrent deletion and assignment of the same list element', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeList', obj: '_root',       key: 'list',           insert: false,           pred: []},
      {action: 'set',      obj: `1@${actor1}`, elemId: '_head',       insert: true,  datatype: 'uint', value: 1, pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'del',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false,           pred: [`2@${actor1}`]}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, elemId: `2@${actor1}`, insert: false, datatype: 'uint', value: 2, pred: [`2@${actor1}`]}
    ]}
    const backend1 = new BackendDoc(), backend2 = new BackendDoc()
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change1), encodeChange(change2)]), {
      maxOp: 3, clock: {[actor1]: 2}, deps: [hash(change2)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `2@${actor1}`, value: {
            type: 'value', value: 1, datatype: 'uint'
          }},
          {action: 'remove', index: 0, count: 1}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend1.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `3@${actor2}`, value: {
            type: 'value', value: 2, datatype: 'uint'
          }}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change1), encodeChange(change3)]), {
      maxOp: 3, clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'insert', index: 0, elemId: `2@${actor1}`, opId: `3@${actor2}`, value: {
            type: 'value', value: 2, datatype: 'uint'
          }}
        ]
      }}}}
    })
    assert.deepStrictEqual(backend2.applyChanges([encodeChange(change2)]), {
      maxOp: 3, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change2), hash(change3)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {list: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'list', edits: [
          {action: 'update', index: 0, opId: `3@${actor2}`, value: {
            type: 'value', value: 2, datatype: 'uint'
          }}
        ]
      }}}}
    })
    for (let backend of [backend1, backend2]) {
      checkColumns(backend.blocks[0], {
        objActor: [0, 1, 2, 0], // null, actor1, actor1
        objCtr:   [0, 1, 2, 1], // null, 1, 1
        keyActor: [0, 2, 0x7f, 0], // null, null, actor1
        keyCtr:   [0, 1, 0x7e, 0, 2], // null, 0, 2
        keyStr:   [0x7f, 4, 0x6c, 0x69, 0x73, 0x74, 0, 2], // 'list', null, null
        idActor:  [2, 0, 0x7f, 1], // actor1, actor1, actor2
        idCtr:    [3, 1], // 1, 2, 3
        insert:   [1, 1, 1], // false, true, false
        action:   [0x7f, 2, 2, 1], // makeList, 2x set
        valLen:   [0x7f, 0, 2, 0x13], // null, 2x 1-byte uint
        valRaw:   [1, 2],
        succNum:  [0x7d, 0, 2, 0], // 0, 2, 0
        succActor: [0x7e, 0, 1], // 0, 1
        succCtr:   [0x7e, 3, 0] // 3, 3
      })
      assert.strictEqual(backend.blocks[0].numOps, 3)
      assert.strictEqual(backend.blocks[0].lastKey, undefined)
      assert.strictEqual(backend.blocks[0].numVisible, 1)
      assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
      assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
      assert.strictEqual(backend.blocks[0].firstVisibleActor, 0)
      assert.strictEqual(backend.blocks[0].firstVisibleCtr, 2)
      assert.strictEqual(backend.blocks[0].lastVisibleActor, 0)
      assert.strictEqual(backend.blocks[0].lastVisibleCtr, 2)
    }
  })

  it('should handle updates inside conflicted properties', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: '_root',       key: 'map',         pred: []},
      {action: 'set',     obj: `1@${actor1}`, key: 'x', datatype: 'uint', value: 1, pred: []}
    ]}
    const change2 = {actor: actor2, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: '_root',       key: 'map',         pred: []},
      {action: 'set',     obj: `1@${actor2}`, key: 'y', datatype: 'uint', value: 2, pred: []}
    ]}
    const change3 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1), hash(change2)], ops: [
      {action: 'set',     obj: `1@${actor1}`, key: 'x', datatype: 'uint', value: 3, pred: [`2@${actor1}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor1]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {map: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {x: {[`2@${actor1}`]: {
          type: 'value', value: 1, datatype: 'uint'
        }}}}
      }}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 2, clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change1), hash(change2)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {map: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {}},
        [`1@${actor2}`]: {objectId: `1@${actor2}`, type: 'map', props: {y: {[`2@${actor2}`]: {
          type: 'value', value: 2, datatype: 'uint'
        }}}}
      }}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {map: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {x: {[`3@${actor1}`]: {
          type: 'value', value: 3, datatype: 'uint'
        }}}},
        [`1@${actor2}`]: {objectId: `1@${actor2}`, type: 'map', props: {}}
      }}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 2, 2, 0, 0x7f, 1],
      objCtr:   [0, 2, 3, 1],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [2, 3, 0x6d, 0x61, 0x70, 2, 1, 0x78, 0x7f, 1, 0x79], // 'map', 'map', 'x', 'x', 'y'
      idActor:  [0x7e, 0, 1, 2, 0, 0x7f, 1], // 0, 1, 0, 0, 1
      idCtr:    [0x7e, 1, 0, 2, 1, 0x7f, 0x7f], // 1, 1, 2, 3, 2
      insert:   [5],
      action:   [2, 0, 3, 1], // 2x makeMap, 3x set
      valLen:   [2, 0, 3, 0x13], // 2x null, 3x uint
      valRaw:   [1, 3, 2],
      succNum:  [2, 0, 0x7f, 1, 2, 0], // 0, 0, 1, 0, 0
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 3]
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'y')
    assert.strictEqual(backend.blocks[0].numOps, 5)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 1)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
  })

  it('should allow a conflict consisting of a nested object and a value', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: '_root',       key: 'x',           pred: []},
      {action: 'set',     obj: `1@${actor1}`, key: 'y', datatype: 'uint', value: 2, pred: []}
    ]}
    const change2 = {actor: actor2, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set',     obj: '_root',       key: 'x', datatype: 'uint', value: 1, pred: []}
    ]}
    const change3 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1), hash(change2)], ops: [
      {action: 'set',     obj: `1@${actor1}`, key: 'y', datatype: 'uint', value: 3, pred: [`2@${actor1}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change1)]), {
      maxOp: 2, clock: {[actor1]: 1}, deps: [hash(change1)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {y: {[`2@${actor1}`]: {
          type: 'value', value: 2, datatype: 'uint'
        }}}}
      }}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
      maxOp: 2, clock: {[actor1]: 1, [actor2]: 1}, deps: [hash(change1), hash(change2)].sort(), pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {}},
        [`1@${actor2}`]: {type: 'value', value: 1, datatype: 'uint'}
      }}}
    })
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change3)]), {
      maxOp: 3, clock: {[actor1]: 2, [actor2]: 1}, deps: [hash(change3)], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {y: {[`3@${actor1}`]: {
          type: 'value', value: 3, datatype: 'uint'
        }}}},
        [`1@${actor2}`]: {type: 'value', value: 1, datatype: 'uint'}
      }}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [0, 2, 2, 0],
      objCtr:   [0, 2, 2, 1],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [2, 1, 0x78, 2, 1, 0x79], // 'x', 'x', 'y', 'y'
      idActor:  [0x7e, 0, 1, 2, 0], // 0, 1, 0, 0
      idCtr:    [0x7e, 1, 0, 2, 1], // 1, 1, 2, 3
      insert:   [4],
      action:   [0x7f, 0, 3, 1], // makeMap, 3x set
      valLen:   [0x7f, 0, 3, 0x13], // null, 3x uint
      valRaw:   [1, 2, 3],
      succNum:  [2, 0, 0x7e, 1, 0], // 0, 0, 1, 0
      succActor: [0x7f, 0],
      succCtr:   [0x7f, 3]
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'y')
    assert.strictEqual(backend.blocks[0].numOps, 4)
    assert.strictEqual(backend.blocks[0].lastObjectActor, 0)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, 1)
  })

  it('should allow changes containing unknown columns, actions, and datatypes', () => {
    const change = new Uint8Array([
      0x85, 0x6f, 0x4a, 0x83, // magic bytes
      0xad, 0xfb, 0x1a, 0x69, // checksum
      1, 51, 0, 2, 0x12, 0x34, // chunkType: change, length, deps, actor '1234'
      1, 1, 0, 0, // seq, startOp, time, message
      0, 9, // actor list, column count
      0x15, 3, 0x34, 1, 0x42, 2, // keyStr, insert, action
      0x56, 2, 0x57, 4, 0x70, 2, // valLen, valRaw, predNum
      0xf0, 1, 2, 0xf1, 1, 2, 0xf3, 1, 2, // unknown column group (3 columns of type GROUP_CARD, ACTOR_ID, INT_DELTA)
      0x7f, 1, 0x78, // keyStr: 'x'
      1, // insert: false
      0x7f, 17, // unknown action type: 17
      0x7f, 0x4e, // valLen: 4 bytes of unknown type 14
      1, 2, 3, 4, // valRaw: 4 bytes
      0x7f, 0, // predNum: 0
      0x7f, 2, // unknown cardinality column: 2 values
      2, 0, // unknown actor column: 0, 0
      2, 1 // unknown delta column: 1, 2
    ])
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChanges([change]), {
      maxOp: 1, clock: {'1234': 1}, deps: [decodeChange(change).hash], pendingChanges: 0,
      diffs: {objectId: '_root', type: 'map', props: {x: {}}}
    })
    checkColumns(backend.blocks[0], {
      objActor: [],
      objCtr:   [],
      keyActor: [],
      keyCtr:   [],
      keyStr:   [0x7f, 1, 0x78],
      idActor:  [0x7f, 0],
      idCtr:    [0x7f, 1],
      insert:   [1],
      action:   [0x7f, 17],
      valLen:   [0x7f, 0x4e],
      valRaw:   [1, 2, 3, 4],
      succNum:  [0x7f, 0],
      succActor: [],
      succCtr:   [],
      240:      [0x7f, 2],
      241:      [2, 0],
      243:      [2, 1]
    })
    assert.strictEqual(backend.blocks[0].lastKey, 'x')
    assert.strictEqual(backend.blocks[0].numOps, 1)
    assert.strictEqual(backend.blocks[0].lastObjectActor, null)
    assert.strictEqual(backend.blocks[0].lastObjectCtr, null)
  })

  it('should split a long insertion into multiple blocks', () => {
    const actor = uuid()
    const change = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',     insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head', insert: true,  value: 'a', pred: []}
    ]}
    for (let i = 2; i <= MAX_BLOCK_SIZE; i++) {
      change.ops.push({action: 'set', obj: `1@${actor}`, elemId: `${i}@${actor}`, insert: true, value: 'a', pred: []})
    }
    const backend = new BackendDoc()
    const patch = backend.applyChanges([encodeChange(change)])
    const edits = patch.diffs.props.text[`1@${actor}`].edits
    assert.strictEqual(edits.length, 1)
    assert.strictEqual(edits[0].action, 'multi-insert')
    assert.strictEqual(edits[0].values.length, MAX_BLOCK_SIZE)
    assert.strictEqual(backend.blocks.length, 2)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 2), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, MAX_BLOCK_SIZE / 2 + 1), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, MAX_BLOCK_SIZE / 2 + 2), false)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, MAX_BLOCK_SIZE + 1), false)
    assert.strictEqual(bloomFilterContains(backend.blocks[1].bloom, 0, 2), false)
    assert.strictEqual(bloomFilterContains(backend.blocks[1].bloom, 0, MAX_BLOCK_SIZE / 2 + 1), false)
    assert.strictEqual(bloomFilterContains(backend.blocks[1].bloom, 0, MAX_BLOCK_SIZE / 2 + 2), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[1].bloom, 0, MAX_BLOCK_SIZE + 1), true)
    const sizeByte1 = 0x80 | 0x7f & (MAX_BLOCK_SIZE / 2), sizeByte2 = (MAX_BLOCK_SIZE / 2) >>> 7
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, sizeByte1, sizeByte2, 0],
      objCtr:   [0, 1, sizeByte1, sizeByte2, 1],
      keyActor: [0, 2, sizeByte1 - 1, sizeByte2, 0],
      keyCtr:   [0, 1, 0x7e, 0, 2, sizeByte1 - 2, sizeByte2, 1], // null, 0, 2, 3, 4, ...
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, sizeByte1, sizeByte2], // 'text', nulls
      idActor:  [sizeByte1 + 1, sizeByte2, 0],
      idCtr:    [sizeByte1 + 1, sizeByte2, 1],
      insert:   [1, sizeByte1, sizeByte2],
      action:   [0x7f, 4, sizeByte1, sizeByte2, 1],
      valLen:   [0x7f, 0, sizeByte1, sizeByte2, 0x16],
      valRaw:   new Array(MAX_BLOCK_SIZE / 2).fill(0x61),
      succNum:  [sizeByte1 + 1, sizeByte2, 0],
      succActor: [],
      succCtr:   []
    })
    checkColumns(backend.blocks[1], {
      objActor: [sizeByte1, sizeByte2, 0],
      objCtr:   [sizeByte1, sizeByte2, 1],
      keyActor: [sizeByte1, sizeByte2, 0],
      keyCtr:   [0x7f, sizeByte1 + 1, sizeByte2, sizeByte1 - 1, sizeByte2, 1],
      keyStr:   [],
      idActor:  [sizeByte1, sizeByte2, 0],
      idCtr:    [0x7f, sizeByte1 + 2, sizeByte2, sizeByte1 - 1, sizeByte2, 1],
      insert:   [0, sizeByte1, sizeByte2],
      action:   [sizeByte1, sizeByte2, 1],
      valLen:   [sizeByte1, sizeByte2, 0x16],
      valRaw:   new Array(MAX_BLOCK_SIZE / 2).fill(0x61),
      succNum:  [sizeByte1, sizeByte2, 0],
      succActor: [],
      succCtr:   []
    })
  })

  it('should split a sequence of short insertions into multiple blocks', () => {
    const actor = uuid(), backend = new BackendDoc()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',     insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head', insert: true,  value: 'a', pred: []}
    ]}
    backend.applyChanges([encodeChange(change1)])
    for (let i = 2; i <= MAX_BLOCK_SIZE; i++) {
      const change2 = {actor, seq: i, startOp: i + 1, time: 0, deps: backend.heads, ops: [
        {action: 'set', obj: `1@${actor}`, elemId: `${i}@${actor}`, insert: true, value: 'a', pred: []}
      ]}
      assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]), {
        maxOp: i + 1, clock: {[actor]: i}, deps: [hash(change2)], pendingChanges: 0,
        diffs: {objectId: '_root', type: 'map', props: {text: {[`1@${actor}`]: {
          objectId: `1@${actor}`, type: 'text', edits: [
            {action: 'insert', index: i - 1, elemId: `${i + 1}@${actor}`, opId: `${i + 1}@${actor}`, value: {type: 'value', value: 'a'}}
          ]
        }}}}
      })
    }
    assert.strictEqual(backend.blocks.length, 2)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, 2), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, MAX_BLOCK_SIZE / 2 + 1), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, MAX_BLOCK_SIZE / 2 + 2), false)
    assert.strictEqual(bloomFilterContains(backend.blocks[0].bloom, 0, MAX_BLOCK_SIZE + 1), false)
    assert.strictEqual(bloomFilterContains(backend.blocks[1].bloom, 0, 2), false)
    assert.strictEqual(bloomFilterContains(backend.blocks[1].bloom, 0, MAX_BLOCK_SIZE / 2 + 1), false)
    assert.strictEqual(bloomFilterContains(backend.blocks[1].bloom, 0, MAX_BLOCK_SIZE / 2 + 2), true)
    assert.strictEqual(bloomFilterContains(backend.blocks[1].bloom, 0, MAX_BLOCK_SIZE + 1), true)
    const sizeByte1 = 0x80 | 0x7f & (MAX_BLOCK_SIZE / 2), sizeByte2 = (MAX_BLOCK_SIZE / 2) >>> 7
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, sizeByte1, sizeByte2, 0],
      objCtr:   [0, 1, sizeByte1, sizeByte2, 1],
      keyActor: [0, 2, sizeByte1 - 1, sizeByte2, 0],
      keyCtr:   [0, 1, 0x7e, 0, 2, sizeByte1 - 2, sizeByte2, 1], // null, 0, 2, 3, 4, ...
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, sizeByte1, sizeByte2], // 'text', nulls
      idActor:  [sizeByte1 + 1, sizeByte2, 0],
      idCtr:    [sizeByte1 + 1, sizeByte2, 1],
      insert:   [1, sizeByte1, sizeByte2],
      action:   [0x7f, 4, sizeByte1, sizeByte2, 1],
      valLen:   [0x7f, 0, sizeByte1, sizeByte2, 0x16],
      valRaw:   new Array(MAX_BLOCK_SIZE / 2).fill(0x61),
      succNum:  [sizeByte1 + 1, sizeByte2, 0],
      succActor: [],
      succCtr:   []
    })
    checkColumns(backend.blocks[1], {
      objActor: [sizeByte1, sizeByte2, 0],
      objCtr:   [sizeByte1, sizeByte2, 1],
      keyActor: [sizeByte1, sizeByte2, 0],
      keyCtr:   [0x7f, sizeByte1 + 1, sizeByte2, sizeByte1 - 1, sizeByte2, 1],
      keyStr:   [],
      idActor:  [sizeByte1, sizeByte2, 0],
      idCtr:    [0x7f, sizeByte1 + 2, sizeByte2, sizeByte1 - 1, sizeByte2, 1],
      insert:   [0, sizeByte1, sizeByte2],
      action:   [sizeByte1, sizeByte2, 1],
      valLen:   [sizeByte1, sizeByte2, 0x16],
      valRaw:   new Array(MAX_BLOCK_SIZE / 2).fill(0x61),
      succNum:  [sizeByte1, sizeByte2, 0],
      succActor: [],
      succCtr:   []
    })
  })

  it('should handle insertions with Bloom filter false positives', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',     insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head', insert: true,  value: 'a', pred: []}
    ]}
    for (let i = 2; i <= 2 * MAX_BLOCK_SIZE; i++) {
      change1.ops.push({action: 'set', obj: `1@${actor}`, elemId: `${i}@${actor}`, insert: true, value: 'a', pred: []})
    }
    const backend = new BackendDoc(), startOp = 2 * MAX_BLOCK_SIZE + 2
    backend.applyChanges([encodeChange(change1)])
    assert.strictEqual(backend.blocks.length, 3)
    let keyCtr = backend.blocks[1].firstVisibleCtr
    while (keyCtr <= backend.blocks[backend.blocks.length - 1].lastVisibleCtr) {
      if (bloomFilterContains(backend.blocks[0].bloom, 0, keyCtr)) break
      keyCtr++
    }
    if (keyCtr > backend.blocks[backend.blocks.length - 1].lastVisibleCtr) {
      throw new Error('no false positive found')
    }
    const change2 = {actor, seq: 2, startOp, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: `1@${actor}`, elemId: `${keyCtr}@${actor}`, insert: true,  value: 'a', pred: []}
    ]}
    const patch = backend.applyChanges([encodeChange(change2)])
    assert.deepStrictEqual(patch.diffs.props.text[`1@${actor}`].edits, [{
      action: 'insert',
      index: keyCtr - 1,
      elemId: `${startOp}@${actor}`,
      opId: `${startOp}@${actor}`,
      value: {type: 'value', value: 'a'}
    }])
  })

  it('should delete many consecutive characters', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',     insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head', insert: true,  value: 'a', pred: []}
    ]}
    for (let i = 2; i <= MAX_BLOCK_SIZE; i++) {
      change1.ops.push({action: 'set', obj: `1@${actor}`, elemId: `${i}@${actor}`, insert: true, value: 'a', pred: []})
    }
    const change2 = {actor, seq: 2, startOp: MAX_BLOCK_SIZE + 3, time: 0, deps: [], ops: []}
    for (let i = 2; i <= MAX_BLOCK_SIZE + 1; i++) {
      change2.ops.push({action: 'del', obj: `1@${actor}`, elemId: `${i}@${actor}`, insert: false, pred: [`${i}@${actor}`]})
    }
    const backend = new BackendDoc()
    backend.applyChanges([encodeChange(change1)])
    const patch = backend.applyChanges([encodeChange(change2)])
    assert.deepStrictEqual(patch.diffs.props.text[`1@${actor}`].edits, [{action: 'remove', index: 0, count: MAX_BLOCK_SIZE}])
    assert.strictEqual(backend.blocks.length, 2)
    const sizeByte1 = 0x80 | 0x7f & (MAX_BLOCK_SIZE / 2), sizeByte2 = (MAX_BLOCK_SIZE / 2) >>> 7
    const firstSucc = MAX_BLOCK_SIZE + 3, secondSucc = MAX_BLOCK_SIZE + 3 + MAX_BLOCK_SIZE / 2
    checkColumns(backend.blocks[0], {
      objActor: [0, 1, sizeByte1, sizeByte2, 0],
      objCtr:   [0, 1, sizeByte1, sizeByte2, 1],
      keyActor: [0, 2, sizeByte1 - 1, sizeByte2, 0],
      keyCtr:   [0, 1, 0x7e, 0, 2, sizeByte1 - 2, sizeByte2, 1], // null, 0, 2, 3, 4, ...
      keyStr:   [0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, sizeByte1, sizeByte2], // 'text', nulls
      idActor:  [sizeByte1 + 1, sizeByte2, 0],
      idCtr:    [sizeByte1 + 1, sizeByte2, 1],
      insert:   [1, sizeByte1, sizeByte2],
      action:   [0x7f, 4, sizeByte1, sizeByte2, 1],
      valLen:   [0x7f, 0, sizeByte1, sizeByte2, 0x16],
      valRaw:   new Array(MAX_BLOCK_SIZE / 2).fill(0x61),
      succNum:  [0x7f, 0, sizeByte1, sizeByte2, 1],
      succActor: [sizeByte1, sizeByte2, 0],
      succCtr:   [0x7f, 0x80 | (0x7f & firstSucc), firstSucc >>> 7, sizeByte1 - 1, sizeByte2, 1]
    })
    checkColumns(backend.blocks[1], {
      objActor: [sizeByte1, sizeByte2, 0],
      objCtr:   [sizeByte1, sizeByte2, 1],
      keyActor: [sizeByte1, sizeByte2, 0],
      keyCtr:   [0x7f, sizeByte1 + 1, sizeByte2, sizeByte1 - 1, sizeByte2, 1],
      keyStr:   [],
      idActor:  [sizeByte1, sizeByte2, 0],
      idCtr:    [0x7f, sizeByte1 + 2, sizeByte2, sizeByte1 - 1, sizeByte2, 1],
      insert:   [0, sizeByte1, sizeByte2],
      action:   [sizeByte1, sizeByte2, 1],
      valLen:   [sizeByte1, sizeByte2, 0x16],
      valRaw:   new Array(MAX_BLOCK_SIZE / 2).fill(0x61),
      succNum:  [sizeByte1, sizeByte2, 1],
      succActor: [sizeByte1, sizeByte2, 0],
      succCtr:   [0x7f, 0x80 | (0x7f & secondSucc), secondSucc >>> 7, sizeByte1 - 1, sizeByte2, 1]
    })
  })

  it('should update an object that appears after a long text object', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text1',    insert: false,             pred: []},
      {action: 'makeText', obj: '_root',      key: 'text2',    insert: false,             pred: []},
      {action: 'set',      obj: `2@${actor}`, elemId: '_head', insert: true,  value: 'x', pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head', insert: true,  value: 'a', pred: []}
    ]}
    for (let i = 4; i <= MAX_BLOCK_SIZE; i++) {
      change1.ops.push({action: 'set', obj: `1@${actor}`, elemId: `${i}@${actor}`, insert: true, value: 'a', pred: []})
    }
    const change2 = {actor, seq: 2, startOp: MAX_BLOCK_SIZE + 3, time: 0, deps: [], ops: [
      {action: 'set',      obj: `2@${actor}`, elemId: `3@${actor}`, insert: true, value: 'x', pred: []}
    ]}
    const backend = new BackendDoc()
    backend.applyChanges([encodeChange(change1)])
    assert.deepStrictEqual(backend.applyChanges([encodeChange(change2)]).diffs.props, {text2: {[`2@${actor}`]: {
      objectId: `2@${actor}`, type: 'text', edits: [{
        action: 'insert',
        index: 1,
        opId: `${MAX_BLOCK_SIZE + 3}@${actor}`,
        elemId: `${MAX_BLOCK_SIZE + 3}@${actor}`,
        value: {type: 'value', value: 'x'}
      }]
    }}})
  })

  it('should place root object operations before a long text object', () => {
    const actor = uuid()
    const change = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: '_root',      key: 'text',     insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, elemId: '_head', insert: true,  value: 'a', pred: []}
    ]}
    for (let i = 2; i <= MAX_BLOCK_SIZE; i++) {
      change.ops.push({action: 'set', obj: `1@${actor}`, elemId: `${i}@${actor}`, insert: true, value: 'a', pred: []})
    }
    change.ops.push({action: 'set', obj: '_root', key: 'z', insert: false, value: 'zzz', pred: []})
    const backend = new BackendDoc()
    backend.applyChanges([encodeChange(change)])
    const sizeByte1 = 0x80 | 0x7f & (MAX_BLOCK_SIZE / 2), sizeByte2 = (MAX_BLOCK_SIZE / 2) >>> 7
    checkColumns(backend.blocks[0], {
      objActor: [0, 2, sizeByte1, sizeByte2, 0],
      objCtr:   [0, 2, sizeByte1, sizeByte2, 1],
      keyActor: [0, 3, sizeByte1 - 1, sizeByte2, 0],
      keyCtr:   [0, 2, 0x7e, 0, 2, sizeByte1 - 2, sizeByte2, 1], // null, null, 0, 2, 3, 4, ...
      keyStr:   [0x7e, 4, 0x74, 0x65, 0x78, 0x74, 1, 0x7a, 0, sizeByte1, sizeByte2], // 'text', 'z', nulls
      idActor:  [sizeByte1 + 2, sizeByte2, 0],
      idCtr:    [0x7d, 1,
                 0x80 | 0x7f & (MAX_BLOCK_SIZE + 1), 0x7f & (MAX_BLOCK_SIZE + 1) >>> 7,
                 0x80 | 0x7f & -MAX_BLOCK_SIZE,      0x7f & -MAX_BLOCK_SIZE      >>> 7,
                 sizeByte1 - 1, sizeByte2, 1],
      insert:   [2, sizeByte1, sizeByte2],
      action:   [0x7f, 4, sizeByte1 + 1, sizeByte2, 1],
      valLen:   [0x7e, 0, 0x36, sizeByte1, sizeByte2, 0x16],
      valRaw:   [0x7a, 0x7a, 0x7a].concat(new Array(MAX_BLOCK_SIZE / 2).fill(0x61)),
      succNum:  [sizeByte1 + 2, sizeByte2, 0],
      succActor: [],
      succCtr:   []
    })
    checkColumns(backend.blocks[1], {
      objActor: [sizeByte1, sizeByte2, 0],
      objCtr:   [sizeByte1, sizeByte2, 1],
      keyActor: [sizeByte1, sizeByte2, 0],
      keyCtr:   [0x7f, sizeByte1 + 1, sizeByte2, sizeByte1 - 1, sizeByte2, 1],
      keyStr:   [],
      idActor:  [sizeByte1, sizeByte2, 0],
      idCtr:    [0x7f, sizeByte1 + 2, sizeByte2, sizeByte1 - 1, sizeByte2, 1],
      insert:   [0, sizeByte1, sizeByte2],
      action:   [sizeByte1, sizeByte2, 1],
      valLen:   [sizeByte1, sizeByte2, 0x16],
      valRaw:   new Array(MAX_BLOCK_SIZE / 2).fill(0x61),
      succNum:  [sizeByte1, sizeByte2, 0],
      succActor: [],
      succCtr:   []
    })
  })
})
