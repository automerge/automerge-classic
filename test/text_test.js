const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { assertEqualsOneOf } = require('./helpers')

function AutomergeTextToDeltaDoc(text) {
  let ops = []
  let currentAttributes = {}
  text.toSpans().forEach((span) => {
    if (typeof span === 'string') {
      let attributes = {}
      Object.entries(currentAttributes).forEach(([key, values]) => {
        if (values.length) {
          attributes[key] = values[0]
        }
      })
      let op = { insert: span }
      if (Object.keys(attributes).length > 0) {
        op.attributes = attributes
      }
      ops.push(op)
    } else {
      Object.entries(span).forEach(([key, value]) => {
        if (!currentAttributes[key]) {
          currentAttributes[key] = []
        }
        if (value === null) {
          currentAttributes[key].shift()
        } else {
          currentAttributes[key].unshift(value)
        }
      })
    }
  })
  let deltaDoc = { ops }
  return deltaDoc
}

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
    assert.strictEqual(s1.text.toString(), 'a')
  })

  it('should support deletion', () => {
    s1 = Automerge.change(s1, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
    s1 = Automerge.change(s1, doc => doc.text.deleteAt(1, 1))
    assert.strictEqual(s1.text.length, 2)
    assert.strictEqual(s1.text.get(0), 'a')
    assert.strictEqual(s1.text.get(1), 'c')
    assert.strictEqual(s1.text.toString(), 'ac')
  })

  it('should handle concurrent insertion', () => {
    s1 = Automerge.change(s1, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
    s2 = Automerge.change(s2, doc => doc.text.insertAt(0, 'x', 'y', 'z'))
    s1 = Automerge.merge(s1, s2)
    assert.strictEqual(s1.text.length, 6)
    assertEqualsOneOf(s1.text.toString(), 'abcxyz', 'xyzabc')
    assertEqualsOneOf(s1.text.join(''), 'abcxyz', 'xyzabc')
  })

  it('should handle text and other ops in the same change', () => {
    s1 = Automerge.change(s1, doc => {
      doc.foo = 'bar'
      doc.text.insertAt(0, 'a')
    })
    assert.strictEqual(s1.foo, 'bar')
    assert.strictEqual(s1.text.toString(), 'a')
    assert.strictEqual(s1.text.join(''), 'a')
  })

  it('should serialize to JSON as a simple string', () => {
    s1 = Automerge.change(s1, doc => doc.text.insertAt(0, 'a', '"', 'b'))
    assert.strictEqual(JSON.stringify(s1), '{"text":"a\\"b"}')
  })

  it('should allow modification before an object is assigned to a document', () => {
    s1 = Automerge.change(Automerge.init(), doc => {
      const text = new Automerge.Text()
      text.insertAt(0, 'a', 'b', 'c', 'd')
      text.deleteAt(2)
      doc.text = text
      assert.strictEqual(doc.text.toString(), 'abd')
      assert.strictEqual(doc.text.join(''), 'abd')
    })
    assert.strictEqual(s1.text.toString(), 'abd')
    assert.strictEqual(s1.text.join(''), 'abd')
  })

  it('should allow modification after an object is assigned to a document', () => {
    s1 = Automerge.change(Automerge.init(), doc => {
      const text = new Automerge.Text()
      doc.text = text
      text.insertAt(0, 'a', 'b', 'c', 'd')
      text.deleteAt(2)
      assert.strictEqual(doc.text.toString(), 'abd')
      assert.strictEqual(doc.text.join(''), 'abd')
    })
    assert.strictEqual(s1.text.join(''), 'abd')
  })

  it('should not allow modification outside of a change callback', () => {
    assert.throws(() => s1.text.insertAt(0, 'a'), /Text object cannot be modified outside of a change block/)
  })

  describe('with initial value', () => {
    it('should accept a string as initial value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.text = new Automerge.Text('init'))
      assert.strictEqual(s1.text.length, 4)
      assert.strictEqual(s1.text.get(0), 'i')
      assert.strictEqual(s1.text.get(1), 'n')
      assert.strictEqual(s1.text.get(2), 'i')
      assert.strictEqual(s1.text.get(3), 't')
      assert.strictEqual(s1.text.toString(), 'init')
    })

    it('should accept an array as initial value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => doc.text = new Automerge.Text(['i', 'n', 'i', 't']))
      assert.strictEqual(s1.text.length, 4)
      assert.strictEqual(s1.text.get(0), 'i')
      assert.strictEqual(s1.text.get(1), 'n')
      assert.strictEqual(s1.text.get(2), 'i')
      assert.strictEqual(s1.text.get(3), 't')
      assert.strictEqual(s1.text.toString(), 'init')
    })

    it('should initialize text in Automerge.from()', () => {
      let s1 = Automerge.from({text: new Automerge.Text('init')})
      assert.strictEqual(s1.text.length, 4)
      assert.strictEqual(s1.text.get(0), 'i')
      assert.strictEqual(s1.text.get(1), 'n')
      assert.strictEqual(s1.text.get(2), 'i')
      assert.strictEqual(s1.text.get(3), 't')
      assert.strictEqual(s1.text.toString(), 'init')
    })

    it('should encode the initial value as a change', () => {
      const s1 = Automerge.from({text: new Automerge.Text('init')})
      const changes = Automerge.getChanges(Automerge.init(), s1)
      assert.strictEqual(changes.length, 1)
      const s2 = Automerge.applyChanges(Automerge.init(), changes)
      assert.strictEqual(s2.text instanceof Automerge.Text, true)
      assert.strictEqual(s2.text.toString(), 'init')
      assert.strictEqual(s2.text.join(''), 'init')
    })

    it('should allow immediate access to the value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => {
        const text = new Automerge.Text('init')
        assert.strictEqual(text.length, 4)
        assert.strictEqual(text.get(0), 'i')
        assert.strictEqual(text.toString(), 'init')
        doc.text = text
        assert.strictEqual(doc.text.length, 4)
        assert.strictEqual(doc.text.get(0), 'i')
        assert.strictEqual(doc.text.toString(), 'init')
      })
    })

    it('should allow pre-assignment modification of the initial value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => {
        const text = new Automerge.Text('init')
        text.deleteAt(3)
        assert.strictEqual(text.join(''), 'ini')
        doc.text = text
        assert.strictEqual(doc.text.join(''), 'ini')
        assert.strictEqual(doc.text.toString(), 'ini')
      })
      assert.strictEqual(s1.text.toString(), 'ini')
      assert.strictEqual(s1.text.join(''), 'ini')
    })

    it('should allow post-assignment modification of the initial value', () => {
      let s1 = Automerge.change(Automerge.init(), doc => {
        const text = new Automerge.Text('init')
        doc.text = text
        text.deleteAt(0)
        doc.text.insertAt(0, 'I')
        assert.strictEqual(text.join(''), 'Init')
        assert.strictEqual(text.toString(), 'Init')
        assert.strictEqual(doc.text.join(''), 'Init')
        assert.strictEqual(doc.text.toString(), 'Init')
      })
      assert.strictEqual(s1.text.join(''), 'Init')
      assert.strictEqual(s1.text.toString(), 'Init')
    })
  })

  describe('non-textual control characters', () => {
    let s1
    beforeEach(() => {
      s1 = Automerge.change(Automerge.init(), doc => {
        doc.text = new Automerge.Text()
        doc.text.insertAt(0, 'a')
        doc.text.insertAt(1, { attribute: 'bold' })
      })
    })

    it('should allow fetching non-textual characters', () => {
      assert.deepEqual(s1.text.get(1), { attribute: 'bold' })
    })

    it('should include control characters in string length', () => {
      assert.strictEqual(s1.text.length, 2)
      assert.strictEqual(s1.text.get(0), 'a')
    })

    it('should exclude control characters from toString()', () => {
      assert.strictEqual(s1.text.toString(), 'a')
    })

    describe('spans interface to Text', () => {
      it('should return a simple string as a single span', () =>{
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('hello world')
        })
        assert.deepEqual(s1.text.toSpans(), ['hello world'])
      })
      it('should return an empty string as an empty array', () =>{
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text()
        })
        assert.deepEqual(s1.text.toSpans(), [])
      })
      it('should split a span at a control character', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('hello world')
          doc.text.insertAt(5, {attribute: 'bold'})
        })
        assert.deepEqual(s1.text.toSpans(), 
          ['hello', {attribute: 'bold'}, ' world'])
      })
      it('should allow consecutive control characters', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('hello world')
          doc.text.insertAt(5, {attribute: 'bold'})
          doc.text.insertAt(6, {attribute: 'italic'})
        })
        assert.deepEqual(s1.text.toSpans(), 
          ['hello', 
           { attribute: 'bold' }, 
           { attribute: 'italic' },
           ' world'
          ])
      })
      it('should allow non-consecutive control characters', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('hello world')
          doc.text.insertAt(5, {attribute: 'bold'})
          doc.text.insertAt(12, {attribute: 'italic'})
        })
        assert.deepEqual(s1.text.toSpans(), 
          ['hello', 
           { attribute: 'bold' }, 
           ' world',
           { attribute: 'italic' },
          ])
      })

      it('should be convertable into a Quill delta', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('Gandalf the Grey')
          doc.text.insertAt(0,  { bold: true })
          doc.text.insertAt(7+1, { bold: null })
          doc.text.insertAt(12+2, { color: '#cccccc' })
        })

        let deltaDoc = AutomergeTextToDeltaDoc(s1.text)
        
        // From https://quilljs.com/docs/delta/
        let expectedDoc = {
          ops: [
            { insert: 'Gandalf', attributes: { bold: true } },
            { insert: ' the ' },
            { insert: 'Grey', attributes: { color: '#cccccc' } }
          ]
        }        

        assert.deepEqual(deltaDoc, expectedDoc)
        
      })
    })
  })
})
