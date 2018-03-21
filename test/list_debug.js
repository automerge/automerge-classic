const assert = require('assert')
const Automerge = require('../src/automerge')

describe('Write debug', () => {
  it('mutable updates indexed values in 2 steps', () => {
    const doc1 = Automerge.init()
    const doc2 = Automerge.change(doc1, doc => {
      doc.letters = ['a', 'b', 'c']
    })
    const doc3 = Automerge.change(doc2, doc => {
      doc.letters[1] = 'd'
    })
    assert.strictEqual(doc3.letters[1], 'd')
  })

  it('mutable updates indexed values', () => {
    const doc1 = Automerge.init()
    const doc2 = Automerge.change(doc1, doc => {
      doc.letters = ['a', 'b', 'c']
      doc.letters[1] = 'd'
    })
    assert.strictEqual(doc3.letters[1], 'd')
  })
})
