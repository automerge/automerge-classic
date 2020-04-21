const assert = require('assert')
const { checkEncoded } = require('./helpers')
const { encodeChange, decodeChanges } = require('../backend/columnar')
const { ROOT_ID } = require('../src/common')

describe('change encoding', () => {
  it('should encode text edits', () => {
    const change1 = {actor: 'aaaa', seq: 1, startOp: 1, time: 9, message: '', deps: {}, ops: [
      {action: 'makeText', obj: ROOT_ID, key: 'text', pred: []},
      {action: 'set', obj: '1@aaaa', key: '_head', insert: true, value: 'h', pred: []},
      {action: 'del', obj: '1@aaaa', key: '2@aaaa', pred: ['2@aaaa']},
      {action: 'set', obj: '1@aaaa', key: '_head', insert: true, value: 'H', pred: []},
      {action: 'set', obj: '1@aaaa', key: '4@aaaa', insert: true, value: 'i', pred: []}
    ]}
    checkEncoded(encodeChange(change1), [
      0x85, 0x6f, 0x4a, 0x83, // magic bytes
      0xb9, 0x96, 0xef, 0x4c, 0x65, 0xf5, 0x22, 0x05, 0x3c, 0x9c, 0x29, 0x85, 0x79, 0x67, 0xeb, 0x52, // sha-256
      0x2e, 0x91, 0xd4, 0x8f, 0x91, 0x35, 0x2f, 0x01, 0x61, 0xd2, 0x2f, 0xa0, 0x7d, 0x2e, 0xf8, 0x43, // hash
      1, 89, 2, 0xaa, 0xaa, // chunkType: change, length, actor 'aaaa'
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
      56, 6, 2, 0, 0x7f, 1, 2, 0, // predNum column: 0, 0, 1, 0, 0
      57, 2, 0x7f, 0, // predActor column: 0
      59, 2, 0x7f, 2 // predCtr column: 2
    ])
    assert.deepStrictEqual(decodeChanges([encodeChange(change1)]), [change1])
  })
})
