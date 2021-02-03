const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')

describe('Automerge.Cursor', () => {
  it('should allow a cursor on a list element', () => {
    let s1 = Automerge.change(Automerge.init(), doc => {
      doc.list = [1,2,3]
      doc.cursor = new Automerge.Cursor(doc.list, 2)
      assert.ok(doc.cursor instanceof Automerge.Cursor)
      assert.strictEqual(doc.cursor.elemId, `4@${Automerge.getActorId(doc)}`)
      assert.strictEqual(doc.cursor.index, 2)
    })
    assert.ok(s1.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s1.cursor.elemId, `4@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s1.cursor.index, 2)

    let s2 = Automerge.applyChanges(Automerge.init(), Automerge.getAllChanges(s1))
    assert.ok(s2.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s2.cursor.elemId, `4@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s2.cursor.index, 2)
  })

  it('should allow a cursor on a text character', () => {
    let s1 = Automerge.change(Automerge.init(), doc => {
      doc.text = new Automerge.Text(['a', 'b', 'c'])
      doc.cursor = doc.text.getCursorAt(2)
      assert.ok(doc.cursor instanceof Automerge.Cursor)
      assert.strictEqual(doc.cursor.elemId, `4@${Automerge.getActorId(doc)}`)
      assert.strictEqual(doc.cursor.index, 2)
    })
    assert.ok(s1.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s1.cursor.elemId, `4@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s1.cursor.index, 2)

    let s2 = Automerge.applyChanges(Automerge.init(), Automerge.getAllChanges(s1))
    assert.ok(s2.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s2.cursor.elemId, `4@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s2.cursor.index, 2)
  })

  it('should ensure that the referenced object is part of the document', () => {
    assert.throws(() => {
      Automerge.change(Automerge.init(), doc => {
        doc.cursor = new Automerge.Text(['a', 'b', 'c']).getCursorAt(2)
      })
    }, /must be part of a document/)
    assert.throws(() => {
      Automerge.change(Automerge.init(), doc => {
        doc.cursor = new Automerge.Cursor([1, 2, 3], 2)
      })
    }, /must be part of a document/)
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

  it('should allow a cursor to be updated', () => {
    const s1 = Automerge.change(Automerge.init(), doc => {
      doc.text = new Automerge.Text(['a', 'b', 'c'])
      doc.cursor = doc.text.getCursorAt(1)
    })
    assert.strictEqual(s1.cursor.elemId, `3@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s1.cursor.index, 1)
    const s2 = Automerge.change(s1, doc => {
      doc.cursor = doc.text.getCursorAt(2)
    })
    assert.strictEqual(s2.cursor.elemId, `4@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s2.cursor.index, 2)
  })

  it('should update a cursor when its index changes', () => {
    const s1 = Automerge.change(Automerge.init(), doc => {
      doc.text = new Automerge.Text(['b', 'c'])
      doc.cursor = doc.text.getCursorAt(1)
    })
    assert.strictEqual(s1.cursor.elemId, `3@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s1.cursor.index, 1)
    const s2 = Automerge.change(s1, doc => {
      doc.text.insertAt(0, 'a')
    })
    assert.strictEqual(s2.cursor.elemId, `3@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s2.cursor.index, 2)
  })

  it('should support cursors in deeply nested objects', () => {
    const s1 = Automerge.change(Automerge.init(), doc => {
      doc.paragraphs = [{text: new Automerge.Text(['b', 'c']), style: []}]
      doc.paragraphs[0].style.push({
        format: 'bold',
        from: doc.paragraphs[0].text.getCursorAt(0),
        to: doc.paragraphs[0].text.getCursorAt(1)
      })
    })
    assert.strictEqual(s1.paragraphs[0].style[0].from.elemId, `5@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s1.paragraphs[0].style[0].from.index, 0)
    const s2 = Automerge.change(s1, doc => {
      doc.paragraphs[0].text.insertAt(0, 'a')
    })
    assert.strictEqual(s2.paragraphs[0].style[0].from.elemId, `5@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s2.paragraphs[0].style[0].from.index, 1)
  })

  it.skip('should restore cursors on load', () => {
    let s1 = Automerge.change(Automerge.init(), doc => {
      doc.text = new Automerge.Text(['a', 'b', 'c'])
      doc.cursor = doc.text.getCursorAt(1)
    })
    let s2 = Automerge.load(Automerge.save(s1))
    assert.ok(s2.cursor instanceof Automerge.Cursor)
    assert.strictEqual(s2.cursor.elemId, `4@${Automerge.getActorId(s1)}`)
    assert.strictEqual(s2.cursor.index, 1)
  })
})
