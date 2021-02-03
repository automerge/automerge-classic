const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('Automerge.Cursor', () => {
  it('should allow a cursor on a list element', () => {
    let s1 = Automerge.change(Automerge.init(), doc => {
      doc.list = [1,2,3]
      doc.cursor = new Automerge.Cursor(doc.list, 2)
      assert.ok(doc.cursor instanceof Automerge.Cursor)
      assert.strictEqual(doc.cursor.elemId, `4@${Automerge.getActorId(doc)}`)
    })
    assert.ok(s1.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s1.cursor.elemId, `4@${Automerge.getActorId(s1)}`)

    let s2 = Automerge.applyChanges(Automerge.init(), Automerge.getAllChanges(s1))
    assert.ok(s2.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s2.cursor.elemId, `4@${Automerge.getActorId(s1)}`)

    let s3 = Automerge.load(Automerge.save(s1))
    assert.ok(s3.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s3.cursor.elemId, `4@${Automerge.getActorId(s1)}`)
  })

  it('should allow a cursor on a text character', () => {
    let s1 = Automerge.change(Automerge.init(), doc => {
      doc.text = new Automerge.Text(['a', 'b', 'c'])
      doc.cursor = doc.text.getCursorAt(2)
      assert.ok(doc.cursor instanceof Automerge.Cursor)
      assert.strictEqual(doc.cursor.elemId, `4@${Automerge.getActorId(doc)}`)
    })
    assert.ok(s1.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s1.cursor.elemId, `4@${Automerge.getActorId(s1)}`)

    let s2 = Automerge.applyChanges(Automerge.init(), Automerge.getAllChanges(s1))
    assert.ok(s2.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s2.cursor.elemId, `4@${Automerge.getActorId(s1)}`)

    let s3 = Automerge.load(Automerge.save(s1))
    assert.ok(s3.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s3.cursor.elemId, `4@${Automerge.getActorId(s1)}`)
  })

  it('should not allow an index beyond the length of the list', () => {
    assert.throws(() => {
      Automerge.change(Automerge.init(), doc => {
        doc.list = [1]
        doc.cursor = new Automerge.Cursor(doc.list, 1)
      })
    }, /index out of bounds/)
    assert.throws(() => {
      Automerge.change(Automerge.init(), doc => {
        doc.text = new Automerge.Text('a')
        doc.cursor = doc.text.getCursorAt(1)
      })
    }, /index out of bounds/)
  })
})
