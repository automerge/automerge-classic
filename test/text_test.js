const assert = require('assert')
const Automerge = require('../src/automerge')
const { equalsOneOf } = require('./helpers')

describe('Automerge.Text', () => {
  let s1, s2
  beforeEach(() => {
    s1 = Automerge.change(Automerge.init(), doc => doc.text = new Automerge.Text())
    s2 = Automerge.merge(Automerge.init(), s1)
  })

  it('should support insertion', () => {
    s1 = Automerge.change(s1, doc => doc.text.insertAt(0, 'a'))
    assert.strictEqual(s1.text.length, 1)
    assert.strictEqual(s1.text.get(0), 'a')
  })

  it('should support deletion', () => {
    s1 = Automerge.change(s1, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
    s1 = Automerge.change(s1, doc => doc.text.deleteAt(1, 1))
    assert.strictEqual(s1.text.length, 2)
    assert.strictEqual(s1.text.get(0), 'a')
    assert.strictEqual(s1.text.get(1), 'c')
  })

  it('should handle concurrent insertion', () => {
    s1 = Automerge.change(s1, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
    s2 = Automerge.change(s2, doc => doc.text.insertAt(0, 'x', 'y', 'z'))
    s1 = Automerge.merge(s1, s2)
    assert.strictEqual(s1.text.length, 6)
    equalsOneOf(s1.text.join(''), 'abcxyz', 'xyzabc')
  })
})
