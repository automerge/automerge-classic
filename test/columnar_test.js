const assert = require('assert')
const { checkEncoded } = require('./helpers')
const { encodeChange, decodeChange, applyChange } = require('../backend/columnar')
const Automerge = require('../src/automerge')
const { ROOT_ID } = require('../src/common')

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
      0x43, 0x18, 0xa5, 0xde, // checksum
      1, 89, 2, 0xaa, 0xaa, // chunkType: change, length, actor 'aaaa'
      1, 1, 9, 0, 0, 0, // seq, startOp, time, message, actor list, deps
      1, 4, 0, 1, 4, 0, // objActor column: null, 0, 0, 0, 0
      2, 4, 0, 1, 4, 1, // objCtr column: null, 1, 1, 1, 1
      9, 4, 0, 1, 4, 0, // keyActor column: null, 0, 0, 0, 0
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

  it('should apply a change to a document', () => {
    let state1 = Automerge.change(Automerge.init(), doc => {
      doc.authors = ['me', 'someone else']
      doc.text = new Automerge.Text()
      doc.title = 'Hello'
    })
    const doc1 = Automerge.save(state1)
    state1 = Automerge.change(state1, doc => doc.text.insertAt(0, 'a', 'b', 'e'))
    const doc2 = Automerge.save(state1)
    let state2 = Automerge.merge(Automerge.init(), state1)
    state2 = Automerge.change(state2, doc => { doc.foo = 'bar'; doc.text.insertAt(2, 'C', 'D') })
    const doc3 = Automerge.save(state2)
    state1 = Automerge.change(state1, doc => doc.text.insertAt(2, 'c', 'd'))
    state2 = Automerge.merge(state2, state1)
    assert.strictEqual(state2.text.join(''), 'abCDcde')
    const [change0, change1, change2, change3] = Automerge.getAllChanges(state2)
    assert.strictEqual(applyChange(doc1, change1), 5)
    assert.strictEqual(applyChange(doc2, change2), 7)
    assert.strictEqual(applyChange(doc3, change3), 10)
  })
})
