const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { assertEqualsOneOf } = require('./helpers')

function attributeStateToAttributes(accumulatedAttributes) {
  const attributes = {}
  Object.entries(accumulatedAttributes).forEach(([key, values]) => {
    if (values.length && values[0] !== null) {
      attributes[key] = values[0]
    }
  })
  return attributes
}

function isEquivalent(a, b) {
  const aProps = Object.getOwnPropertyNames(a)
  const bProps = Object.getOwnPropertyNames(b)

  if (aProps.length != bProps.length) {
      return false
  }

  for (let i = 0; i < aProps.length; i++) {
    const propName = aProps[i]
      if (a[propName] !== b[propName]) {
          return false
      }
  }

  return true
}

function isControlMarker(pseudoCharacter) {
  return typeof pseudoCharacter === 'object' && pseudoCharacter.attributes
}

function opFrom(text, attributes) {
  let op = { insert: text }
  if (Object.keys(attributes).length > 0) {
      op.attributes = attributes
  }
  return op
}

function accumulateAttributes(span, accumulatedAttributes) {
  Object.entries(span).forEach(([key, value]) => {
    if (!accumulatedAttributes[key]) {
      accumulatedAttributes[key] = []
    }
    if (value === null) {
      if (accumulatedAttributes[key].length === 0 || accumulatedAttributes[key] === null) {
        accumulatedAttributes[key].unshift(null)
      } else {
        accumulatedAttributes[key].shift()
      }
    } else {
      if (accumulatedAttributes[key][0] === null) {
        accumulatedAttributes[key].shift()
      } else {
        accumulatedAttributes[key].unshift(value)
      }
    }
  })
  return accumulatedAttributes
}

function automergeTextToDeltaDoc(text) {
  let ops = []
  let controlState = {}
  let currentString = ""
  let attributes = {}
  text.toSpans().forEach((span) => {
    if (isControlMarker(span)) {
      controlState = accumulateAttributes(span.attributes, controlState)
    } else {
      let next = attributeStateToAttributes(controlState)

      // if the next span has the same calculated attributes as the current span
      // don't bother outputting it as a separate span, just let it ride
      if (typeof span === 'string' && isEquivalent(next, attributes)) {
          currentString = currentString + span
          return
      }

      if (currentString) {
        ops.push(opFrom(currentString, attributes))
      }

      // If we've got a string, we might be able to concatenate it to another
      // same-attributed-string, so remember it and go to the next iteration.
      if (typeof span === 'string') {
        currentString = span
        attributes = next
      } else {
        // otherwise we have an embed "character" and should output it immediately.
        // embeds are always one-"character" in length.
        ops.push(opFrom(span, next))
        currentString = ''
        attributes = {}
      }
    }
  })

  // at the end, flush any accumulated string out
  if (currentString) {
    ops.push(opFrom(currentString, attributes))
  }

  return ops
}

function inverseAttributes(attributes) {
  let invertedAttributes = {}
  Object.keys(attributes).forEach((key) => {
    invertedAttributes[key] = null
  })
  return invertedAttributes
}

function applyDeleteOp(text, offset, op) {
  let length = op.delete
  while (length > 0) {
    if (isControlMarker(text.get(offset))) {
      offset += 1
    } else {
      // we need to not delete control characters, but we do delete embed characters
      text.deleteAt(offset, 1)
      length -= 1
    }
  }
  return [text, offset]
}

function applyRetainOp(text, offset, op) {
  let length = op.retain

  if (op.attributes) {
    text.insertAt(offset, { attributes: op.attributes })
    offset += 1
  }

  while (length > 0) {
    const char = text.get(offset)
    offset += 1
    if (!isControlMarker(char)) {
      length -= 1
    }
  }

  if (op.attributes) {
    text.insertAt(offset, { attributes: inverseAttributes(op.attributes) })
    offset += 1
  }

  return [text, offset]
}


function applyInsertOp(text, offset, op) {
  let originalOffset = offset

  if (typeof op.insert === 'string') {
    text.insertAt(offset, ...op.insert.split(''))
    offset += op.insert.length
  } else {
    // we have an embed or something similar
    text.insertAt(offset, op.insert)
    offset += 1
  }

  if (op.attributes) {
    text.insertAt(originalOffset, { attributes: op.attributes })
    offset += 1
  }
  if (op.attributes) {
    text.insertAt(offset, { attributes: inverseAttributes(op.attributes) })
    offset += 1
  }
  return [text, offset]
}

// XXX: uhhhhh, why can't I pass in text?
function applyDeltaDocToAutomergeText(delta, doc) {
  let offset = 0

  delta.forEach(op => {
    if (op.retain) {
      [, offset] = applyRetainOp(doc.text, offset, op)
    } else if (op.delete) {
      [, offset] = applyDeleteOp(doc.text, offset, op)
    } else if (op.insert) {
      [, offset] = applyInsertOp(doc.text, offset, op)
    }
  })
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
    assert.strictEqual(s1.text.getElemId(0), `2@${Automerge.getActorId(s1)}`)
  })

  it('should support deletion', () => {
    s1 = Automerge.change(s1, doc => doc.text.insertAt(0, 'a', 'b', 'c'))
    s1 = Automerge.change(s1, doc => doc.text.deleteAt(1, 1))
    assert.strictEqual(s1.text.length, 2)
    assert.strictEqual(s1.text.get(0), 'a')
    assert.strictEqual(s1.text.get(1), 'c')
    assert.strictEqual(s1.text.toString(), 'ac')
  })

  it("should support implicit and explicit deletion", () => {
    s1 = Automerge.change(s1, doc => doc.text.insertAt(0, "a", "b", "c"))
    s1 = Automerge.change(s1, doc => doc.text.deleteAt(1))
    s1 = Automerge.change(s1, doc => doc.text.deleteAt(1, 0))
    assert.strictEqual(s1.text.length, 2)
    assert.strictEqual(s1.text.get(0), "a")
    assert.strictEqual(s1.text.get(1), "c")
    assert.strictEqual(s1.text.toString(), "ac")
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
      doc.text.insertAt(0, 'a', 'b', 'c', 'd')
      doc.text.deleteAt(2)
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
      const changes = Automerge.getAllChanges(s1)
      assert.strictEqual(changes.length, 1)
      const [s2] = Automerge.applyChanges(Automerge.init(), changes)
      assert.strictEqual(s2.text instanceof Automerge.Text, true)
      assert.strictEqual(s2.text.toString(), 'init')
      assert.strictEqual(s2.text.join(''), 'init')
    })

    it('should allow immediate access to the value', () => {
      Automerge.change(Automerge.init(), doc => {
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
        doc.text.deleteAt(0)
        doc.text.insertAt(0, 'I')
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
      assert.strictEqual(s1.text.getElemId(1), `3@${Automerge.getActorId(s1)}`)
    })

    it('should include control characters in string length', () => {
      assert.strictEqual(s1.text.length, 2)
      assert.strictEqual(s1.text.get(0), 'a')
    })

    it('should exclude control characters from toString()', () => {
      assert.strictEqual(s1.text.toString(), 'a')
    })

    it('should allow control characters to be updated', () => {
      const s2 = Automerge.change(s1, doc => doc.text.get(1).attribute = 'italic')
      const s3 = Automerge.load(Automerge.save(s2))
      assert.strictEqual(s1.text.get(1).attribute, 'bold')
      assert.strictEqual(s2.text.get(1).attribute, 'italic')
      assert.strictEqual(s3.text.get(1).attribute, 'italic')
    })

    describe('spans interface to Text', () => {
      it('should return a simple string as a single span', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('hello world')
        })
        assert.deepEqual(s1.text.toSpans(), ['hello world'])
      })
      it('should return an empty string as an empty array', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text()
        })
        assert.deepEqual(s1.text.toSpans(), [])
      })
      it('should split a span at a control character', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('hello world')
          doc.text.insertAt(5, { attributes: { bold: true } })
        })
        assert.deepEqual(s1.text.toSpans(),
          ['hello', { attributes: { bold: true } }, ' world'])
      })
      it('should allow consecutive control characters', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('hello world')
          doc.text.insertAt(5, { attributes: { bold: true } })
          doc.text.insertAt(6, { attributes: { italic: true } })
        })
        assert.deepEqual(s1.text.toSpans(),
          ['hello',
           { attributes: { bold: true } },
           { attributes: { italic: true } },
           ' world'
          ])
      })
      it('should allow non-consecutive control characters', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('hello world')
          doc.text.insertAt(5, { attributes: { bold: true } })
          doc.text.insertAt(12, { attributes: { italic: true } })
        })
        assert.deepEqual(s1.text.toSpans(),
          ['hello',
           { attributes: { bold: true } },
           ' world',
           { attributes: { italic: true } }
          ])
      })

      it('should be convertable into a Quill delta', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('Gandalf the Grey')
          doc.text.insertAt(0,  { attributes: { bold: true } })
          doc.text.insertAt(7 + 1, { attributes: { bold: null } })
          doc.text.insertAt(12 + 2, { attributes: { color: '#cccccc' } })
        })

        let deltaDoc = automergeTextToDeltaDoc(s1.text)

        // From https://quilljs.com/docs/delta/
        let expectedDoc = [
          { insert: 'Gandalf', attributes: { bold: true } },
          { insert: ' the ' },
          { insert: 'Grey', attributes: { color: '#cccccc' } }
        ]

        assert.deepEqual(deltaDoc, expectedDoc)
      })

      it('should support embeds', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('')
          doc.text.insertAt(0, { attributes: { link: 'https://quilljs.com' } })
          doc.text.insertAt(1, {
            image: 'https://quilljs.com/assets/images/icon.png'
          })
          doc.text.insertAt(2, { attributes: { link: null } })
        })

        let deltaDoc = automergeTextToDeltaDoc(s1.text)

        // From https://quilljs.com/docs/delta/
        let expectedDoc = [{
          // An image link
          insert: {
            image: 'https://quilljs.com/assets/images/icon.png'
          },
          attributes: {
            link: 'https://quilljs.com'
          }
        }]

        assert.deepEqual(deltaDoc, expectedDoc)
      })

      it('should handle concurrent overlapping spans', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('Gandalf the Grey')
        })

        let s2 = Automerge.merge(Automerge.init(), s1)

        let s3 = Automerge.change(s1, doc => {
          doc.text.insertAt(8,  { attributes: { bold: true } })
          doc.text.insertAt(16 + 1, { attributes: { bold: null } })
        })

        let s4 = Automerge.change(s2, doc => {
          doc.text.insertAt(0,  { attributes: { bold: true } })
          doc.text.insertAt(11 + 1, { attributes: { bold: null } })
        })

        let merged = Automerge.merge(s3, s4)

        let deltaDoc = automergeTextToDeltaDoc(merged.text)

        // From https://quilljs.com/docs/delta/
        let expectedDoc = [
          { insert: 'Gandalf the Grey', attributes: { bold: true } },
        ]

        assert.deepEqual(deltaDoc, expectedDoc)
      })

      it('should handle debolding spans', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('Gandalf the Grey')
        })

        let s2 = Automerge.merge(Automerge.init(), s1)

        let s3 = Automerge.change(s1, doc => {
          doc.text.insertAt(0,  { attributes: { bold: true } })
          doc.text.insertAt(16 + 1, { attributes: { bold: null } })
        })

        let s4 = Automerge.change(s2, doc => {
          doc.text.insertAt(8,  { attributes: { bold: null } })
          doc.text.insertAt(11 + 1, { attributes: { bold: true } })
        })


        let merged = Automerge.merge(s3, s4)

        let deltaDoc = automergeTextToDeltaDoc(merged.text)

        // From https://quilljs.com/docs/delta/
        let expectedDoc = [
          { insert: 'Gandalf ', attributes: { bold: true } },
          { insert: 'the' },
          { insert: ' Grey', attributes: { bold: true } },
        ]

        assert.deepEqual(deltaDoc, expectedDoc)
      })

      // xxx: how would this work for colors?
      it('should handle destyling across destyled spans', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('Gandalf the Grey')
        })

        let s2 = Automerge.merge(Automerge.init(), s1)

        let s3 = Automerge.change(s1, doc => {
          doc.text.insertAt(0,  { attributes: { bold: true } })
          doc.text.insertAt(16 + 1, { attributes: { bold: null } })
        })

        let s4 = Automerge.change(s2, doc => {
          doc.text.insertAt(8,  { attributes: { bold: null } })
          doc.text.insertAt(11 + 1, { attributes: { bold: true } })
        })

        let merged = Automerge.merge(s3, s4)

        let final = Automerge.change(merged, doc => {
          doc.text.insertAt(3 + 1, { attributes: { bold: null } })
          doc.text.insertAt(doc.text.length, { attributes: { bold: true } })
        })

        let deltaDoc = automergeTextToDeltaDoc(final.text)

        // From https://quilljs.com/docs/delta/
        let expectedDoc = [
          { insert: 'Gan', attributes: { bold: true } },
          { insert: 'dalf the Grey' },
        ]

        assert.deepEqual(deltaDoc, expectedDoc)
      })

      it('should apply an insert', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('Hello world')
        })

        const delta = [
          { retain: 6 },
          { insert: 'reader' },
          { delete: 5 }
        ]

        let s2 = Automerge.change(s1, doc => {
          applyDeltaDocToAutomergeText(delta, doc)
        })

        assert.strictEqual(s2.text.join(''), 'Hello reader')
      })

      it('should apply an insert with control characters', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('Hello world')
        })

        const delta = [
          { retain: 6 },
          { insert: 'reader', attributes: { bold: true } },
          { delete: 5 },
          { insert: '!' }
        ]

        let s2 = Automerge.change(s1, doc => {
          applyDeltaDocToAutomergeText(delta, doc)
        })

        assert.strictEqual(s2.text.toString(), 'Hello reader!')
        assert.deepEqual(s2.text.toSpans(), [
          "Hello ",
          { attributes: { bold: true } },
          "reader",
          { attributes: { bold: null } },
          "!"
        ])
      })

      it('should account for control characters in retain/delete lengths', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('Hello world')
          doc.text.insertAt(4, { attributes: { color: '#ccc' } })
          doc.text.insertAt(10, { attributes: { color: '#f00' } })
        })

        const delta = [
          { retain: 6 },
          { insert: 'reader', attributes: { bold: true } },
          { delete: 5 },
          { insert: '!' }
        ]

        let s2 = Automerge.change(s1, doc => {
          applyDeltaDocToAutomergeText(delta, doc)
        })

        assert.strictEqual(s2.text.toString(), 'Hello reader!')
        assert.deepEqual(s2.text.toSpans(), [
          "Hell",
          { attributes: { color: '#ccc'} },
          "o ",
          { attributes: { bold: true } },
          "reader",
          { attributes: { bold: null } },
          { attributes: { color: '#f00'} },
          "!"
        ])
      })

      it('should support embeds', () => {
        let s1 = Automerge.change(Automerge.init(), doc => {
          doc.text = new Automerge.Text('')
        })

        let deltaDoc = [{
          // An image link
          insert: {
            image: 'https://quilljs.com/assets/images/icon.png'
          },
          attributes: {
            link: 'https://quilljs.com'
          }
        }]

        let s2 = Automerge.change(s1, doc => {
          applyDeltaDocToAutomergeText(deltaDoc, doc)
        })

        assert.deepEqual(s2.text.toSpans(), [
          { attributes: { link: 'https://quilljs.com' } },
          { image: 'https://quilljs.com/assets/images/icon.png'},
          { attributes: { link: null } },
        ])
      })
    })
  })

  it('should support unicode when creating text', () => {
    s1 = Automerge.from({
      text: new Automerge.Frontend.Text('🐦')
    })
    assert.strictEqual(s1.text.get(0), '🐦')
  })
})
