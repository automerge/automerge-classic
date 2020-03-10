const assert = require('assert')
const { checkEncoded } = require('./helpers')
const { encodeChange, decodeChange } = require('../backend/columnar')
const { ROOT_ID } = require('../src/common')

describe('change encoding', () => {
  it('should encode text edits', () => {
    const change1 = {actor: 'aaa', seq: 1, startOp: 1, time: 9, message: '', deps: {}, ops: [
      {action: 'makeText', obj: ROOT_ID, key: 'text', pred: []},
      {action: 'set', obj: '1@aaa', key: '_head', insert: true, value: 'h', pred: []},
      {action: 'del', obj: '1@aaa', key: '2@aaa', pred: ['2@aaa']},
      {action: 'set', obj: '1@aaa', key: '_head', insert: true, value: 'H', pred: []},
      {action: 'set', obj: '1@aaa', key: '4@aaa', insert: true, value: 'i', pred: []}
    ]}
    checkEncoded(encodeChange(change1), [
      0x85, 0x6f, 0x4a, 0x83, // magic bytes
      0x54, 0x31, 0x82, 0x56, 0x8e, 0xb7, 0x74, 0x74, 0xa3, 0xa2, 0x68, 0xec, 0x0d, 0xd1, 0x52, 0x12, // sha-256
      0x09, 0xdc, 0xdd, 0xf2, 0x95, 0x1d, 0xba, 0xe6, 0x68, 0xc6, 0x9b, 0xa8, 0x79, 0x31, 0xa4, 0x44, // hash
      1, 92, 3, 0x61, 0x61, 0x61, // chunkType: change, length, actor 'aaa'
      1, 1, 9, 0, 0, 0, // seq, startOp, time, message, actor list, deps
      0, 6, 0x7d, 6, 0, 1, 2, 0, // action column: makeText, set, del, set, set
      1, 4, 0, 1, 4, 1, // obj_ctr column: null, 1, 1, 1, 1
      2, 4, 0, 1, 4, 0, // obj_actor column: null, 0, 0, 0, 0
      3, 7, 0, 1, 0x7c, 0, 2, 0, 4, // key_ctr column: null, 0, 2, 0, 4
      4, 4, 0, 1, 4, 0, // key_actor column: null, 0, 0, 0, 0
      5, 8, 0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4, // key_str column: 'text', null, null, null, null
      6, 6, 0x7d, 0, 1, 0, 2, 1, // insert column: false, true, false, true, true
      7, 6, 0x7d, 0, 1, 0, 2, 1, // val_bytes column: 0, 1, 0, 1, 1
      8, 3, 0x68, 0x48, 0x69, // val_str column: 'h', 'H', 'i'
      9, 6, 2, 0, 0x7f, 1, 2, 0, // pred_num column: 0, 0, 1, 0, 0
      10, 2, 0x7f, 2, // pred_ctr column: 2
      11, 2, 0x7f, 0 // pred_actor column: 0
    ])
    assert.deepStrictEqual(decodeChange(encodeChange(change1)), [change1])
  })
})
