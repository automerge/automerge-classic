const assert = require('assert')
const { assertIs } = require('./helpers')
const Automerge = require('../src/automerge')
const { Map, Set, List, is } = require('immutable')

const ROOT_ID = '00000000-0000-0000-0000-000000000000'

describe('Immutable write interface', () => {
  describe('change blocks', () => {

    it('has a fixed object ID at the root', () => {
      Automerge.change(Automerge.initImmutable(), doc => {
        assert.strictEqual(doc._objectId, ROOT_ID)
        return doc
      })
    })

    it('accepts a no-op block', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => doc)
    })

    it('throws if you return nothing from a change block', () => {
      const doc1 = Automerge.initImmutable()
      assert.throws(() => {
        const doc2 = Automerge.change(doc1, doc => {})
      }, /return a document from the change block/)
    })

    it('throws if you return a scalar value a change block', () => {
      const doc1 = Automerge.initImmutable()
      assert.throws(() => {
        const doc2 = Automerge.change(doc1, doc => 42)
      }, /return a document from the change block/)
    })

    it('throws if you return a mutable map from a change block', () => {
      const doc1 = Automerge.initImmutable()
      assert.throws(() => {
        const doc2 = Automerge.change(doc1, doc => { return {foo: 'bar'} })
      }, /return a document from the change block/)
    })

    it('throws if you return a mutable array from a change block', () => {
      const doc1 = Automerge.initImmutable()
      assert.throws(() => {
        const doc2 = Automerge.change(doc1, doc => { return ['foo', 'bar'] })
      }, /return a document from the change block/)
    })

    it('throws if you return an immutable list from a change block', () => {
      const doc1 = Automerge.initImmutable()
      assert.throws(() => {
        const doc2 = Automerge.change(doc1, doc => { return new List(['foo', 'bar']) })
      }, /return a document from the change block/)
    })

    it('throws if you return an immutable set from a change block', () => {
      const doc1 = Automerge.initImmutable()
      assert.throws(() => {
        const doc2 = Automerge.change(doc1, doc => { return new Set('foo', 'bar') })
      }, /return a document from the change block/)
    })

    it('throws if you return a non-root object from a change block', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => {
        return doc.set('outer', new Map())
      })
      assert.throws(() => {
        const doc3 = Automerge.change(doc2, doc => {
          return doc.get('outer')
        })
      }, /new document root from the change block/)
    })

  })

  describe('for maps', () => {

    describe('.getIn', () => {
      it('returns from nested maps', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.setIn(['outer', 'inner'], 'foo')
          assert.strictEqual(doc.getIn(['outer', 'inner']), 'foo')
          return doc
        })
      })

      it('returns from nested lists', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new List(['foo']))
          assert.strictEqual(doc.getIn(['outer', 0]), 'foo')
          return doc
        })
      })

      it('returns undefined if a map is missing', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new Map())
          assert.strictEqual(doc.getIn(['outer', 'inner', 'leaf']), undefined)
          return doc
        })
      })

      it('returns undefined if a list index is out of bounds', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new List())
          assert.strictEqual(doc.getIn(['outer', 0, 'leaf']), undefined)
          return doc
        })
      })
    })

    describe('.set', () => {
      it('records single writes', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('first','one')
        })
        assert.strictEqual(doc2.get('first'), 'one')
      })

      it('records multiple writes', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('first','one')
          doc = doc.set('second','two')
          return doc
        })
        assert.strictEqual(doc2.get('first'), 'one')
        assert.strictEqual(doc2.get('second'), 'two')
      })

      it('records writes of an empty map', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', new Map())
        })
        assertIs(doc2.get('outer').delete("_objectId"), new Map())
      })

      it('records writes of an empty list', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', List())
        })
        assert.strictEqual(doc2.get('outer'), new List())
      })

      it('records writes of a populated map', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', new Map().set('inner', 'foo'))
        })
        assert.strictEqual(doc2.get('outer').get('inner'), 'foo')
      })

      it('records writes of a populated list', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', new List().set(0, 'foo'))
        })
        assertIs(doc2.get('outer'), new List(['foo']))
      })
    })

    describe('.setIn', () => {
      it('throws when called with no keys', () => {
        const doc1 = Automerge.initImmutable()
        assert.throws(() => {
          const doc2 = Automerge.change(doc1, doc => {
            return doc.setIn([], 'foo')
          })
        }, /at least one key to setIn/)
      })

      it('records un-nested writes', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.setIn(['first'],'one')
        })
        assert.strictEqual(doc2.get('first'), 'one')
      })

      it('records nested writes', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new Map())
          doc = doc.setIn(['outer', 'inner'], 'bar')
          return doc
        })
        assert.strictEqual(doc2.get('outer').get('inner'), 'bar')
      })

      it('records nested writes into lists', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new List())
          doc = doc.setIn(['outer', 0], 'bar')
          return doc
        })
        assert.strictEqual(doc2.get('outer').get(0), 'bar')
      })

      it('records nested writes with implicit new maps', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new Map())
          doc = doc.setIn(['outer', 'middle', 'inner'], 'bar')
          return doc
        })
        assert.strictEqual(doc2.get('outer').get('middle').get('inner'), 'bar')
      })

      it('records overwrites in maps', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('first', new Map().set('foo', 'bar'))
          doc = doc.setIn(['first', 'foo'], 'bat')
          return doc
        })
        assert.strictEqual(doc2.get('first').get('foo'), 'bat')
      })

      it('records overwrites in lists', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('first', new List().set(0, 'bar'))
          doc = doc.setIn(['first', 0], 'bat')
          return doc
        })
        assert.strictEqual(doc2.get('first').get(0), 'bat')
      })
    })

    describe('.update', () => {
      it('throws when called with something other than 2 args', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('foo', 1)
        })
        assert.throws(() => {
          const doc3 = Automerge.change(doc2, doc => {
            return doc.update('foo', 0, i => i+1)
          })
        }, /2-ary form/)
      })

      it('records single simple changes', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('foo', 1)
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('foo', i => i+1)
        })
        assert.strictEqual(doc3.get('foo'), 2)
      })

      it('records changes to multiple values', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('foo', 1)
          doc = doc.set('bar', 7)
          return doc
        })
        const doc3 = Automerge.change(doc2, doc => {
          doc = doc.update('foo', i => i+1)
          doc = doc.update('bar', i => i-1)
          return doc
        })
        assert.strictEqual(doc3.get('foo'), 2)
        assert.strictEqual(doc3.get('bar'), 6)
      })

      it('records multiple changes to a single value', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('foo', 1)
        })
        const doc3 = Automerge.change(doc2, doc => {
          doc = doc.update('foo', i => i+1)
          doc = doc.update('foo', i => i+2)
          return doc
        })
        assert.strictEqual(doc3.get('foo'), 4)
      })
    })

    describe('.updateIn', () => {
      it('throws when called with no keys', () => {
        const doc1 = Automerge.initImmutable()
        assert.throws(() => {
          const doc2 = Automerge.change(doc1, doc => {
            return doc.updateIn([], i => i+1)
          })
        }, /at least one key to updateIn/)
      })

      it('records un-nested updates', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('foo', 1)
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.updateIn(['foo'], i => i+1)
        })
        assert.strictEqual(doc3.get('foo'), 2)
      })

      it('records nested updates', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', new Map().set('foo', 1))
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.updateIn(['outer', 'foo'], i => i+1)
        })
        assert.strictEqual(doc3.getIn(['outer', 'foo']), 2)
      })
    })

    describe('.delete', () => {
      it('records deletes of values', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('first','one')
          doc = doc.set('second','two')
          return doc
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.delete('second')
        })
        assert.strictEqual(doc3.get('first'), 'one')
        assert.strictEqual(doc3.get('second'), undefined)
      })

      it('records deletes of maps', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new Map())
          doc = doc.setIn(['outer', 'inner'], 'foo')
          return doc
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.delete('outer')
        })
        assert.strictEqual(doc3.get('outer'), undefined)
      })

      it('records deletes of lists', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new List())
          doc = doc.setIn(['outer', 0], 'foo')
          return doc
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.delete('outer')
        })
        assert.strictEqual(doc3.get('outer'), undefined)
      })

      // TODO: allow deletes of missing map keys? currently an error.
      // makes sense in mutable case. immutable api allows it. may
      // need to disallow for compatability across apis?
    })

    describe('.deleteIn', () => {
      it('does not make changes if any keys are missing', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.setIn(['outer', 'inner'], 'foo')
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.deleteIn(['outer', 'wat'])
        })
        assert.strictEqual(doc3.get('outer').get('inner'), 'foo')
        assert.strictEqual(doc3.get('outer').get('wat'), undefined)
      })

      it('deletes nested values in maps', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.setIn(['outer', 'inner'], 'foo')
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.deleteIn(['outer', 'inner'])
        })
        assert.strictEqual(doc3.get('outer').get('inner'), undefined)
        assert.strictEqual(!!doc3.get('outer'), true)
      })

      it('deletes nested values in lists', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', new List().set(0, 'foo'))
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.deleteIn(['outer', 0])
        })
        assert.strictEqual(doc3.get('outer').get(0), undefined)
        assert.strictEqual(!!doc3.get('outer'), true)
      })

      it('deletes un-nested values', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.setIn(['outer', 'inner'], 'foo')
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.deleteIn(['outer'])
        })
        assert.strictEqual(doc3.get('outer'), undefined)
      })
    })

  })

  describe('for lists', () => {

    describe('.set', () => {
      it('updates indexed values', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('list', List(['a', 'b', 'c']))
          doc = doc.update('list', l => l.set(1, 'd'))
          return doc
        })
        assertIs(doc.getIn(['list', 1]), 'd')
      })

      // TODO: allow list .set by negative index? currently an error.
      // it('updates indexed values from the back for negative numbers', () => {
      //   const doc1 = Automerge.initImmutable()
      //   const doc2 = Automerge.change(doc1, doc => {
      //     doc = doc.set('list', List(['a', 'b', 'c']))
      //     doc = doc.update('list', l => l.set(-1, 'd'))
      //     return doc
      //   })
      //   assertIs(doc.getIn(['list', 2], 'd'))
      // })

      // TODO: allow list .set beyond size? currently an error.
      // it('extends the list for indexes beyond the current size', () => {
      //   const doc1 = Automerge.initImmutable()
      //   const doc2 = Automerge.change(doc1, doc => {
      //     doc = doc.set('list', List(['a', 'b', 'c']))
      //     doc = doc.update('list', l => l.set(4, 'e'))
      //     return doc
      //   })
      //   assertIs(doc.get('list'), List(['a', 'b', 'c', undefined, 'e']))
      // })
    })

    // TODO: test list setIn

    describe('.get', () => {
      it('returns indexed values', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('list', List(['a', 'b', 'c']))
          assertIs(doc.get('list').get(1), 'b')
          return doc
        })
      })

      it('returns indexed values from the back for negative numbers', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('list', List(['a', 'b', 'c']))
          assertIs(doc.get('list').get(-1), 'c')
          return doc
        })
      })

      it('returns undefined if the index is out of bounds', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('list', List(['a', 'b', 'c']))
          assertIs(doc.get('list').get(3), undefined)
          return doc
        })
      })
    })

    // TODO: test list getIn

    describe('.delete', () => {
      it('removes the value at the given index', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c'])))
        const doc3 = Automerge.change(doc2, doc => doc.update('list', l => l.delete(1)))
        assertIs(doc3.get('list'), List(['a', 'c']))
      })

      it('removes the value counting from the end if negative index given', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c'])))
        const doc3 = Automerge.change(doc2, doc => doc.update('list', l => l.delete(-1)))
        assertIs(doc3.get('list'), List(['a', 'b']))
      })
    })

    describe('.splice', () => {
      it('removes the tail if only one arg given', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c'])))
        const doc3 = Automerge.change(doc2, doc => doc.update('list', l => l.splice(1)))
        assertIs(doc3.get('list'), List(['a']))
      })

      it('removes a slice if a count is given', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c', 'd', 'e'])))
        const doc3 = Automerge.change(doc2, doc => doc.update('list', l => l.splice(1, 2)))
        assertIs(doc3.get('list'), List(['a', 'd', 'e']))
      })

      it('also adds in values if given', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c', 'd', 'e'])))
        const doc3 = Automerge.change(doc2, doc => doc.update('list', l => l.splice(1, 2, 'n', 'e', 'w')))
        assertIs(doc3.get('list'), List(['a', 'n', 'e', 'w', 'd', 'e']))
      })
    })

    describe('.insert', () => {
      it('returns a list with an elem inserted', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c'])))
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('list', l => l.insert(1, 'd'))
        })
        assertIs(doc3.get('list'), List(['a', 'd', 'b', 'c']))
      })
    })

    describe('.push', () => {
      it('returns a list with elems added', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a'])))
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('list', l => l.push('b', 'c'))
        })
        assertIs(doc3.get('list'), List(['a', 'b', 'c']))
      })
    })

    describe('.pop', () => {
      it('returns a list with the last elem removed', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c'])))
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('list', l => l.pop())
        })
        assertIs(doc3.get('list'), List(['a', 'b']))
      })

      it('noops on empty lists', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          const l = List()
          doc = doc.set('list', l)
          return doc
        })
        const doc3 = Automerge.change(doc2, doc => {
          doc.get('list')
          doc = doc.update('list', l => l.pop())
          return doc
        })
        assertIs(doc3.get('list'), List())
      })
    })

    describe('.unshift', () => {
      it('returns a list with an elem added to the beginning', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b'])))
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('list', l => l.unshift('c'))
        })
        assertIs(doc3.get('list'), List(['c', 'a', 'b']))
      })
    })

    describe('.shift', () => {
      it('returns a list with an elem removed from the beginning', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c'])))
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('list', l => l.shift())
        })
        assertIs(doc3.get('list'), List(['b', 'c']))
      })

      it('returns an empty list when the list is already empty', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List()))
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('list', l => l.shift())
        })
        assertIs(doc3.get('list'), List())
      })
    })

  })

  describe('for compound writes', () => {

    it('records single map op within .update', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => doc.set('foo', Map()))
      const doc3 = Automerge.change(doc2, doc => {
        return doc.update('foo', m => {
          return m.set('bar', 'bat')
        })
      })
      assert.strictEqual(doc3.getIn(['foo', 'bar']), 'bat')
    })

    it('records multiple map ops within .update', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => doc.set('foo', Map()))
      const doc3 = Automerge.change(doc2, doc => {
        return doc.update('foo', m => {
          doc = m.set('bar', 'bat')
          doc = m.set('bar', 'biz')
          return doc
        })
      })
      assert.strictEqual(doc3.getIn(['foo', 'bar']), 'biz')
    })

    it('records map ops within multiple .updates', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => {
        doc = doc.set('foo', Map())
        doc = doc.set('bar', Map())
        return doc
      })
      const doc3 = Automerge.change(doc2, doc => {
        doc = doc.update('foo', m => {
          return m.set('a', 1)
        })
        doc = doc.update('bar', m => {
          return m.set('b', 2)
        })
        return doc
      })
      assert.strictEqual(doc3.getIn(['foo', 'a']), 1)
      assert.strictEqual(doc3.getIn(['bar', 'b']), 2)
    })

    it('records single list update within .update', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => doc.set('foo', List(['a'])))
      const doc3 = Automerge.change(doc2, doc => {
        return doc.update('foo', l => {
          return l.push('b', 'c')
        })
      })
      assertIs(doc3.get('foo'), List(['a', 'b', 'c']))
    })

    it('records nested ops within .updates', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => doc.setIn(['foo', 'bar'], 1))
      const doc3 = Automerge.change(doc2, doc => {
        return doc.update('foo', f => {
          return f.update('bar', b => {
            return b + 1
          })
        })
      })
      assertIs(doc3.getIn(['foo', 'bar']), 2)
    })

    it('records nested changes made through intermediate values', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => doc.setIn(['foo', 'bar'], 1))
      const doc3 = Automerge.change(doc2, doc => {
        const oldFoo = doc.get('foo')
        const newFoo = oldFoo.update('bar', i => i+1)
        const newDoc = doc.set('foo', newFoo)
        return newDoc
      })
      assertIs(doc3.getIn(['foo', 'bar']), 2)
    })

    // TODO: do we actually want to support writing objects from read state within change blocks? currently a subtle error.
    // it('records updates based on old read state', () => {
    //   const doc1 = Automerge.initImmutable()
    //   const doc2 = Automerge.change(doc1, doc => doc.setIn(['foo', 'bar'], 1))
    //   const fooAt2 = doc2.get('foo')
    //   const doc3 = Automerge.change(doc2, doc => doc.set('bat', 2))
    //   const doc4 = Automerge.change(doc2, doc => doc.set('foo', fooAt2.set('biz', 3)))
    //   assertIs(doc4.get('bat'), 2)
    //   assertIs(doc4.getIn(['foo', 'bar']), 1)
    //   assertIs(doc4.getIn(['foo', 'biz']), 3)
    // })

    it('records braided updates', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => {
        doc = doc.setIn(['foo', 'bar'], 1)
        doc = doc.setIn(['biz', 'bat'], 2)
        return doc
      })
      const doc3 = Automerge.change(doc2, doc => {
        const oldFoo = doc.get('foo')
        const oldBiz = doc.get('biz')
        const newFoo = oldFoo.set('bar', 3)
        const newBiz = oldBiz.set('bat', 4)
        doc = doc.set('foo', newFoo)
        doc = doc.set('biz', newBiz)
        return doc
      })
      // TODO: the below assertion currently fails for braided updates. would need to merge states.
      assertIs(doc3.getIn(['foo', 'bar']), 3)
      assertIs(doc3.getIn(['biz', 'bat']), 4)
    })

  })

  describe('history', () => {

    it('preserves value .sets and .deletes', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => {
        doc = doc.set('first', 'one')
        doc = doc.set('register', 1)
        return doc
      })
      const doc3 = Automerge.change(doc2, doc => {
        doc = doc.set('second', 'two')
        doc = doc.set('register', 2)
        return doc
      })
      const doc4 = Automerge.change(doc3, doc => {
        doc = doc.delete('first')
        return doc
      })

      assert.strictEqual(doc2.get('first'), 'one')
      assert.strictEqual(doc2.get('second'), undefined)
      assert.strictEqual(doc2.get('register'), 1)

      assert.strictEqual(doc3.get('first'), 'one')
      assert.strictEqual(doc3.get('second'), 'two')
      assert.strictEqual(doc3.get('register'), 2)

      assert.strictEqual(doc4.get('first'), undefined)
      assert.strictEqual(doc4.get('second'), 'two')
      assert.strictEqual(doc4.get('register'), 2)
    })

    it('preserves map .sets and .deletes', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => {
        return doc.set('outer', new Map().set('inner', 'foo'))
      })
      const doc3 = Automerge.change(doc2, doc => {
        return doc.delete('outer')
      })
      assert.strictEqual(doc2.get('outer').get('inner'), 'foo')
      assert.strictEqual(doc3.get('outer'), undefined)
    })

    it('preserves list .sets and .deletes', () => {
      const doc1 = Automerge.initImmutable()
      const doc2 = Automerge.change(doc1, doc => {
        return doc.set('outer', new List().set(0, 'foo'))
      })
      const doc3 = Automerge.change(doc2, doc => {
        return doc.delete('outer')
      })
      assert.strictEqual(doc2.get('outer').get(0), 'foo')
      assert.strictEqual(doc3.get('outer'), undefined)
    })

  })

})


describe('Immutable read interface', () => {

  it('uses Immutable.Map for outer document', () => {
    const doc1 = Automerge.initImmutable()
    const doc2 = Automerge.change(doc1, doc => {
      return doc.set('outer', 'foo')
    })
    assert(doc2 instanceof Map)
  })

  it('uses Immutable.Map for inner maps', () => {
    const doc1 = Automerge.initImmutable()
    const doc2 = Automerge.change(doc1, doc => {
      return doc.set('outer', new Map().set('foo', 'bar'))
    })
    assert(doc2 instanceof Map)
    assert(doc2.get('outer') instanceof Map)
  })

  it('uses Immutable.List for inner lists', () => {
    const doc1 = Automerge.initImmutable()
    const doc2 = Automerge.change(doc1, doc => {
      return doc.set('outer', new List().set(0, 'foo'))
    })
    assert(doc2 instanceof Map)
    assert(doc2.get('outer') instanceof List)
  })

  // TODO: do we actually want this?
  // TODO: is an empty _conflicts expected?
  it('includes Automerge-provided keys in maps', () => {
    const doc1 = Automerge.initImmutable()
    const doc2 = Automerge.change(doc1, doc => {
      return doc.set('outer', new Map().set('inner', 'foo'))
    })
    assert(doc2.keySeq().toSet().equals(new Set(['_objectId', '_conflicts', 'outer'])))
    assert(doc2.get('outer').keySeq().toSet().equals(new Set(['_objectId', 'inner'])))
  })

})


// TODO: what is Automerge.assign meant to do?
// TODO: Tests for objectId, conflicts, actorId?
// TODO: other read APIs like .keys() and .keySeq()?
// TODO: support JSON.stringify?
