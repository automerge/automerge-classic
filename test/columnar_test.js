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
      0x34, 0x6d, 0xc2, 0x85, 0xcb, 0x7a, 0xd1, 0xad, 0x67, 0xfd, 0xe7, 0x19, 0xe3, 0x96, 0xa1, 0x89, // sha-256
      0xfa, 0x16, 0x75, 0x17, 0x84, 0x46, 0x1c, 0x4b, 0x74, 0xf1, 0x23, 0x70, 0x05, 0x07, 0xcd, 0x22, // hash
      1, 98, 3, 0x61, 0x61, 0x61, // chunkType: change, length, actor 'aaa'
      1, 1, 9, 0, 0, 0, // seq, startOp, time, message, actor list, deps
      1, 4, 0, 1, 4, 0, // objActor column: null, 0, 0, 0, 0
      2, 4, 0, 1, 4, 1, // objCtr column: null, 1, 1, 1, 1
      9, 4, 0, 1, 4, 0, // keyActor column: null, 0, 0, 0, 0
      11, 7, 0, 1, 0x7c, 0, 2, 0x7e, 4, // keyCtr column: null, 0, 2, 0, 4
      13, 8, 0x7f, 4, 0x74, 0x65, 0x78, 0x74, 0, 4, // keyStr column: 'text', null, null, null, null
      28, 4, 1, 1, 1, 2, // insert column: false, true, false, true, true
      34, 6, 0x7d, 6, 0, 1, 2, 0, // action column: makeText, set, del, set, set
      46, 6, 0x7d, 0, 0x16, 0, 2, 0x16, // valLen column: 0, 0x16, 0, 0x16, 0x16
      47, 3, 0x68, 0x48, 0x69, // valRaw column: 'h', 'H', 'i'
      49, 2, 0, 5, // chldActor column: null, null, null, null, null
      50, 2, 0, 5, // clldCtr column: null, null, null, null, null
      56, 6, 2, 0, 0x7f, 1, 2, 0, // predNum column: 0, 0, 1, 0, 0
      57, 2, 0x7f, 0, // predActor column: 0
      58, 2, 0x7f, 2 // predCtr column: 2
    ])
    assert.deepStrictEqual(decodeChange(encodeChange(change1)), [change1])
  })
})
