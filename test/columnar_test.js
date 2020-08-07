const assert = require('assert')
const { checkEncoded } = require('./helpers')
const { DOC_OPS_COLUMNS, encodeChange, decodeChange, BackendDoc } = require('../backend/columnar')
const { ROOT_ID } = require('../src/common')
const uuid = require('../src/uuid')

function checkColumns(actualCols, expectedCols) {
  for (let actual of actualCols) {
    const [colName, colId] = Object.entries(DOC_OPS_COLUMNS).find(([name, id]) => id === actual.columnId)
    if (expectedCols[colName]) {
      checkEncoded(actual.decoder.buf, expectedCols[colName], `${colName} column`)
    }
  }
}

function hash(change) {
  return decodeChange(encodeChange(change)).hash
}

describe('change encoding', () => {
  it('should encode text edits', () => {
    const change1 = {actor: 'aaaa', seq: 1, startOp: 1, time: 9, message: '', deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID, key: 'text', insert: false, pred: []},
      {action: 'set', obj: '1@aaaa', key: '_head', insert: true, value: 'h', pred: []},
      {action: 'del', obj: '1@aaaa', key: '2@aaaa', insert: false, pred: ['2@aaaa']},
      {action: 'set', obj: '1@aaaa', key: '_head', insert: true, value: 'H', pred: []},
      {action: 'set', obj: '1@aaaa', key: '4@aaaa', insert: true, value: 'i', pred: []}
    ]}
    checkEncoded(encodeChange(change1), [
      0x85, 0x6f, 0x4a, 0x83, // magic bytes
      0x4f, 0x5f, 0x3a, 0xa5, // checksum
      1, 93, 2, 0xaa, 0xaa, // chunkType: change, length, actor 'aaaa'
      1, 1, 9, 0, 0, 0, // seq, startOp, time, message, actor list, deps
      1, 4, 0, 1, 4, 0, // objActor column: null, 0, 0, 0, 0
      2, 4, 0, 1, 4, 1, // objCtr column: null, 1, 1, 1, 1
      9, 8, 0, 2, 0x7f, 0, 0, 1, 0x7f, 0, // keyActor column: null, null, 0, null, 0
      11, 7, 0, 1, 0x7c, 0, 2, 0x7e, 4, // keyCtr column: null, 0, 2, 0, 4
      13, 8, 0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4, // keyStr column: 'text', null, null, null, null
      28, 4, 1, 1, 1, 2, // insert column: false, true, false, true, true
      34, 6, 0x7d, 4, 1, 3, 2, 1, // action column: makeText, set, del, set, set
      46, 6, 0x7d, 0, 0x16, 0, 2, 0x16, // valLen column: 0, 0x16, 0, 0x16, 0x16
      47, 3, 0x68, 0x48, 0x69, // valRaw column: 'h', 'H', 'i'
      56, 6, 2, 0, 0x7f, 1, 2, 0, // predNum column: 0, 0, 1, 0, 0
      57, 2, 0x7f, 0, // predActor column: 0
      59, 2, 0x7f, 2 // predCtr column: 2
    ])
    const decoded = decodeChange(encodeChange(change1))
    assert.deepStrictEqual(decoded, Object.assign({hash: decoded.hash}, change1))
  })
})

describe('BackendDoc applying changes', () => {
  it('should overwrite root object properties (1)', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: ROOT_ID, key: 'x', value: 3, pred: []},
      {action: 'set', obj: ROOT_ID, key: 'y', value: 4, pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: ROOT_ID, key: 'x', value: 5, pred: [`1@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {objectId: ROOT_ID, type: 'map', props: {
      x: {[`1@${actor}`]: {value: 3}},
      y: {[`2@${actor}`]: {value: 4}}
    }})
    assert.deepStrictEqual(backend.applyChange(encodeChange(change2)), {objectId: ROOT_ID, type: 'map', props: {
      x: {[`3@${actor}`]: {value: 5}}
    }})
    checkColumns(backend.docColumns, {
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
  })

  it('should overwrite root object properties (2)', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'set', obj: ROOT_ID, key: 'x', value: 3, pred: []},
      {action: 'set', obj: ROOT_ID, key: 'y', value: 4, pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set', obj: ROOT_ID, key: 'y', value: 5, pred: [`2@${actor}`]},
      {action: 'set', obj: ROOT_ID, key: 'z', value: 6, pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {objectId: ROOT_ID, type: 'map', props: {
      x: {[`1@${actor}`]: {value: 3}},
      y: {[`2@${actor}`]: {value: 4}}
    }})
    assert.deepStrictEqual(backend.applyChange(encodeChange(change2)), {objectId: ROOT_ID, type: 'map', props: {
      y: {[`3@${actor}`]: {value: 5}},
      z: {[`4@${actor}`]: {value: 6}}
    }})
    checkColumns(backend.docColumns, {
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
  })

  it('should create and update nested maps', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: ROOT_ID,      key: 'map',             pred: []},
      {action: 'set',     obj: `1@${actor}`, key: 'x',   value: 'a', pred: []},
      {action: 'set',     obj: `1@${actor}`, key: 'y',   value: 'b', pred: []},
      {action: 'set',     obj: `1@${actor}`, key: 'z',   value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',     obj: `1@${actor}`, key: 'y',    value: 'B', pred: [`3@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {map: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {
          x: {[`2@${actor}`]: {value: 'a'}},
          y: {[`3@${actor}`]: {value: 'b'}},
          z: {[`4@${actor}`]: {value: 'c'}}
        }
      }}}
    })
    assert.deepStrictEqual(backend.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {map: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {y: {[`5@${actor}`]: {value: 'B'}}}
      }}}
    })
    checkColumns(backend.docColumns, {
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
  })

  it('should create nested maps several levels deep', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: ROOT_ID,      key: 'a',           pred: []},
      {action: 'makeMap', obj: `1@${actor}`, key: 'b',           pred: []},
      {action: 'makeMap', obj: `2@${actor}`, key: 'c',           pred: []},
      {action: 'set',     obj: `3@${actor}`, key: 'd', value: 1, pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [], ops: [
      {action: 'set',     obj: `3@${actor}`, key: 'd', value: 2, pred: [`4@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {a: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {b: {[`2@${actor}`]: {
          objectId: `2@${actor}`, type: 'map', props: {c: {[`3@${actor}`]: {
            objectId: `3@${actor}`, type: 'map', props: {d: {[`4@${actor}`]: {value: 1}}}
          }}}
        }}}
      }}}
    })
    assert.deepStrictEqual(backend.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {a: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'map', props: {b: {[`2@${actor}`]: {
          objectId: `2@${actor}`, type: 'map', props: {c: {[`3@${actor}`]: {
            objectId: `3@${actor}`, type: 'map', props: {d: {[`5@${actor}`]: {value: 2}}}
          }}}
        }}}
      }}}
    })
    checkColumns(backend.docColumns, {
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
  })

  it('should create a text object', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID,      key: 'text',  insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, key: '_head', insert: true,  value: 'a', pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text',
        edits: [{action: 'insert', index: 0}],
        props: {0: {[`2@${actor}`]: {value: 'a'}}}
      }}}
    })
    checkColumns(backend.docColumns, {
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
      succNum:  [2, 0]
    })
  })

  it('should insert text characters', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID,      key: 'text',       insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, key: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, key: `2@${actor}`, insert: true,  value: 'b', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [], ops: [
      {action: 'set',      obj: `1@${actor}`, key: `3@${actor}`, insert: true,  value: 'c', pred: []},
      {action: 'set',      obj: `1@${actor}`, key: `4@${actor}`, insert: true,  value: 'd', pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text',
        edits: [{action: 'insert', index: 0}, {action: 'insert', index: 1}],
        props: {0: {[`2@${actor}`]: {value: 'a'}}, 1: {[`3@${actor}`]: {value: 'b'}}}
      }}}
    })
    assert.deepStrictEqual(backend.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text',
        edits: [{action: 'insert', index: 2}, {action: 'insert', index: 3}],
        props: {2: {[`4@${actor}`]: {value: 'c'}}, 3: {[`5@${actor}`]: {value: 'd'}}}
      }}}
    })
    checkColumns(backend.docColumns, {
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
      succNum:  [5, 0]
    })
  })

  it('should raise an error if the reference element of an insertion does not exist', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID,      key: 'text',       insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, key: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, key: `2@${actor}`, insert: true,  value: 'b', pred: []},
      {action: 'makeMap',  obj: ROOT_ID,      key: 'map',        insert: false,             pred: []},
      {action: 'set',      obj: `4@${actor}`, key: 'foo',        insert: false, value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 6, time: 0, deps: [], ops: [
      {action: 'set',      obj: `1@${actor}`, key: `4@${actor}`, insert: true,  value: 'd', pred: []}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {
        text: {[`1@${actor}`]: {objectId: `1@${actor}`, type: 'text',
          edits: [{action: 'insert', index: 0}, {action: 'insert', index: 1}],
          props: {0: {[`2@${actor}`]: {value: 'a'}}, 1: {[`3@${actor}`]: {value: 'b'}}}
        }},
        map: {[`4@${actor}`]: {objectId: `4@${actor}`, type: 'map', props: {
          foo: {[`5@${actor}`]: {value: 'c'}}
        }}}
      }
    })
    assert.throws(() => { backend.applyChange(encodeChange(change2)) }, /Reference element not found/)
  })

  it('should delete the first character', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID,      key: 'text',  insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, key: '_head', insert: true,  value: 'a', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'del',      obj: `1@${actor}`, key: `2@${actor}`, pred: [`2@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text',
        edits: [{action: 'insert', index: 0}],
        props: {0: {[`2@${actor}`]: {value: 'a'}}}
      }}}
    })
    assert.deepStrictEqual(backend.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [{action: 'remove', index: 0}], props: {}
      }}}
    })
    checkColumns(backend.docColumns, {
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
  })

  it('should delete a character in the middle', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID,      key: 'text',       insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, key: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, key: `2@${actor}`, insert: true,  value: 'b', pred: []},
      {action: 'set',      obj: `1@${actor}`, key: `3@${actor}`, insert: true,  value: 'c', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 5, time: 0, deps: [hash(change1)], ops: [
      {action: 'del',      obj: `1@${actor}`, key: `3@${actor}`, insert: false, pred: [`3@${actor}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text',
        edits: [{action: 'insert', index: 0}, {action: 'insert', index: 1}, {action: 'insert', index: 2}],
        props: {
          0: {[`2@${actor}`]: {value: 'a'}},
          1: {[`3@${actor}`]: {value: 'b'}},
          2: {[`4@${actor}`]: {value: 'c'}}
        }
      }}}
    })
    assert.deepStrictEqual(backend.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor}`]: {
        objectId: `1@${actor}`, type: 'text', edits: [{action: 'remove', index: 1}], props: {}
      }}}
    })
    checkColumns(backend.docColumns, {
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
  })

  it('should raise an error if a deleted element does not exist', () => {
    const actor = uuid()
    const change1 = {actor, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID,      key: 'text',       insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor}`, key: '_head',      insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor}`, key: `2@${actor}`, insert: true,  value: 'b', pred: []}
    ]}
    const change2 = {actor, seq: 2, startOp: 4, time: 0, deps: [], ops: [
      {action: 'del',      obj: `1@${actor}`, key: `1@${actor}`, insert: false, pred: [`1@${actor}`]}
    ]}
    const backend = new BackendDoc()
    backend.applyChange(encodeChange(change1))
    assert.throws(() => { backend.applyChange(encodeChange(change2)) }, /Element not found for update/)
  })

  it('should apply concurrent insertions at the same position', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID,       key: 'text',        insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor1}`, key: '_head',       insert: true,  value: 'a', pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, key: `2@${actor1}`, insert: true,  value: 'c', pred: []}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, key: `2@${actor1}`, insert: true,  value: 'b', pred: []}
    ]}
    const backend1 = new BackendDoc(), backend2 = new BackendDoc()
    assert.deepStrictEqual(backend1.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 0}],
        props: {0: {[`2@${actor1}`]: {value: 'a'}}}
      }}}
    })
    assert.deepStrictEqual(backend1.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 1}],
        props: {1: {[`3@${actor1}`]: {value: 'c'}}}
      }}}
    })
    assert.deepStrictEqual(backend1.applyChange(encodeChange(change3)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 1}],
        props: {1: {[`3@${actor2}`]: {value: 'b'}}}
      }}}
    })
    assert.deepStrictEqual(backend2.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 0}],
        props: {0: {[`2@${actor1}`]: {value: 'a'}}}
      }}}
    })
    assert.deepStrictEqual(backend2.applyChange(encodeChange(change3)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 1}],
        props: {1: {[`3@${actor2}`]: {value: 'b'}}}
      }}}
    })
    assert.deepStrictEqual(backend2.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 2}],
        props: {2: {[`3@${actor1}`]: {value: 'c'}}}
      }}}
    })
    for (let backend of [backend1, backend2]) {
      checkColumns(backend.docColumns, {
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
        succNum:  [4, 0]
      })
    }
  })

  it('should apply concurrent insertions at the head', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeText', obj: ROOT_ID,       key: 'text',        insert: false,             pred: []},
      {action: 'set',      obj: `1@${actor1}`, key: '_head',       insert: true,  value: 'd', pred: []}
    ]}
    const change2 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, key: '_head',       insert: true,  value: 'c', pred: []}
    ]}
    const change3 = {actor: actor2, seq: 1, startOp: 3, time: 0, deps: [hash(change1)], ops: [
      {action: 'set',      obj: `1@${actor1}`, key: '_head',       insert: true,  value: 'a', pred: []},
      {action: 'set',      obj: `1@${actor1}`, key: `3@${actor2}`, insert: true,  value: 'b', pred: []}
    ]}
    const backend1 = new BackendDoc(), backend2 = new BackendDoc()
    assert.deepStrictEqual(backend1.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 0}],
        props: {0: {[`2@${actor1}`]: {value: 'd'}}}
      }}}
    })
    assert.deepStrictEqual(backend1.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 0}],
        props: {0: {[`3@${actor1}`]: {value: 'c'}}}
      }}}
    })
    assert.deepStrictEqual(backend1.applyChange(encodeChange(change3)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 0}, {action: 'insert', index: 1}],
        props: {0: {[`3@${actor2}`]: {value: 'a'}}, 1: {[`4@${actor2}`]: {value: 'b'}}}
      }}}
    })
    assert.deepStrictEqual(backend2.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 0}],
        props: {0: {[`2@${actor1}`]: {value: 'd'}}}
      }}}
    })
    assert.deepStrictEqual(backend2.applyChange(encodeChange(change3)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 0}, {action: 'insert', index: 1}],
        props: {0: {[`3@${actor2}`]: {value: 'a'}}, 1: {[`4@${actor2}`]: {value: 'b'}}}
      }}}
    })
    assert.deepStrictEqual(backend2.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {text: {[`1@${actor1}`]: {
        objectId: `1@${actor1}`, type: 'text',
        edits: [{action: 'insert', index: 2}],
        props: {2: {[`3@${actor1}`]: {value: 'c'}}}
      }}}
    })
    for (let backend of [backend1, backend2]) {
      checkColumns(backend.docColumns, {
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
        succNum:  [5, 0]
      })
    }
  })

  it('should handle updates inside conflicted properties', () => {
    const actor1 = '01234567', actor2 = '89abcdef'
    const change1 = {actor: actor1, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: ROOT_ID,       key: 'map',         pred: []},
      {action: 'set',     obj: `1@${actor1}`, key: 'x', value: 1, pred: []}
    ]}
    const change2 = {actor: actor2, seq: 1, startOp: 1, time: 0, deps: [], ops: [
      {action: 'makeMap', obj: ROOT_ID,       key: 'map',         pred: []},
      {action: 'set',     obj: `1@${actor2}`, key: 'y', value: 2, pred: []}
    ]}
    const change3 = {actor: actor1, seq: 2, startOp: 3, time: 0, deps: [hash(change1), hash(change2)], ops: [
      {action: 'set',     obj: `1@${actor1}`, key: 'x', value: 3, pred: [`2@${actor1}`]}
    ]}
    const backend = new BackendDoc()
    assert.deepStrictEqual(backend.applyChange(encodeChange(change1)), {
      objectId: ROOT_ID, type: 'map', props: {map: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {x: {[`2@${actor1}`]: {value: 1}}}}
      }}
    })
    assert.deepStrictEqual(backend.applyChange(encodeChange(change2)), {
      objectId: ROOT_ID, type: 'map', props: {map: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {}},
        [`1@${actor2}`]: {objectId: `1@${actor2}`, type: 'map', props: {y: {[`2@${actor2}`]: {value: 2}}}}
      }}
    })
    assert.deepStrictEqual(backend.applyChange(encodeChange(change3)), {
      objectId: ROOT_ID, type: 'map', props: {map: {
        [`1@${actor1}`]: {objectId: `1@${actor1}`, type: 'map', props: {x: {[`3@${actor1}`]: {value: 3}}}},
        [`1@${actor2}`]: {objectId: `1@${actor2}`, type: 'map', props: {}}
      }}
    })
    checkColumns(backend.docColumns, {
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
  })
})
