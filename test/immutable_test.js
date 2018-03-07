const assert = require('assert')
const { Map, Set, List, is } = require('immutable')
const { assertIs } = require('./helpers')
const Automerge = require('../src/automerge')
const ImmutableAPI = require('../src/immutable_api')

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

    describe('._materialize', () => {
      it('returns underlying map data', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('foo', 1)
          doc = doc.set('bar', false)
          const materialized = doc._materialize()
          assert(materialized instanceof Map)
          assertIs(materialized, new Map().set('foo', 1).set('bar', false))
          return doc
        })
      })

      it('has wrapped collections as values', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('outer', new Map().set('inner', 'foo'))
          const materialized = doc._materialize()
          assert(materialized.get('outer') instanceof ImmutableAPI.WriteMap)
          assertIs(materialized.get('outer').get('inner'), 'foo')
          return doc
        })
      })
    })

    describe('.toString', () => {
      it('renders a string', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('foo', 1)
          doc = doc.set('bar', false)
          assertIs(doc.toString(), `WriteMap(${ROOT_ID}) { "foo": 1, "bar": false }`)
          return doc
        })
      })
    })

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

      it('returns from nested lists after update', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', new List(['foo']))
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.setIn(['outer', 0], 'bar')
        })
        assertIs(doc3.getIn(['outer', 0]), 'bar')
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
          return doc.set('first', 'one')
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
        assertIs(doc2.get('outer'), new Map())
      })

      it('records writes of an empty list', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', List())
        })
        assertIs(doc2.get('outer'), new List())
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

    describe('._materialize', () => {
      it('returns underlying list data', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('list', new List(['a', 'b', 'c']))
          const materialized = doc.get('list')._materialize()
          assert(materialized instanceof List)
          assertIs(materialized, new List(['a', 'b', 'c']))
          return doc
        })
      })
    })

    describe('.toString', () => {
      it('renders a string', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('list', new List(['a', 'b', 'c']))
          const list = doc.get('list')
          assertIs(list.toString(), `WriteList(${list._objectId}) [ "a", "b", "c" ]`)
          return doc
        })
      })
    })

    describe('.set', () => {
      it('updates indexed values in different block as creation', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('list', List(['a', 'b', 'c']))
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('list', l => l.set(1, 'd'))
        })
        assertIs(doc3.get('list'), List(['a', 'd', 'c']))
      })

      it('updates indexed values in same block as creation', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          doc = doc.set('list', List(['a', 'b', 'c']))
          doc = doc.update('list', l => l.set(1, 'd'))
          return doc
        })
        assertIs(doc2.get('list'), List(['a', 'd', 'c']))
      })

      it('updates indexed values from the back for negative numbers', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('list', List(['a', 'b', 'c']))
        })
        const doc3 = Automerge.change(doc2, doc => {
          return doc.update('list', l => l.set(-2, 'd'))
        })
        assertIs(doc3.get('list'), List(['a', 'd', 'c']))
      })
    })

    describe('.setIn and .getIn', () => {
      it('updates and reads in nested lists', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('pixels', List([
            List(['00', '01']),
            List(['10', '11'])
          ]))
        })
        const doc3 = Automerge.change(doc2, doc => {
          doc = doc.update('pixels', p => p.setIn([0, 1], 'foo'))
          assertIs(doc.get('pixels').getIn([0, 1]), 'foo')
          return doc
        })
        assertIs(doc3.get('pixels').getIn([0, 1]), 'foo')
      })

      it('updates and reads in nested maps', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('maps', List([
            Map({'foo': 'bar'}),
            Map({'foo': 'bat'})
          ]))
        })
        const doc3 = Automerge.change(doc2, doc => {
          doc = doc.update('maps', m => m.setIn([0, 'foo'], 'biz'))
          assertIs(doc.get('maps').getIn([0, 'foo']), 'biz')
          return doc
        })
        assertIs(doc3.get('maps').getIn([0, 'foo']), 'biz')
      })
    })

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

    describe('.forEach', () => {
      it('iterates with just values', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', new List(['a', 'b', 'c'])))
        let iterated = new List()
        const doc3 = Automerge.change(doc2, doc => {
          doc.get('list').forEach(elem => iterated = iterated.push(elem))
          return doc
        })
        assertIs(iterated, new List(['a', 'b', 'c']))
      })

      it('iterates with values and indicies while making changes to the list', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('list', List(['a', 'b', 'c'])))
        const doc3 = Automerge.change(doc2, doc => {
          let list = doc.get('list')
          list.forEach((elem, i) => list = list.set(i, elem+'!'))
          return doc.set('list', list)
        })
        assertIs(doc3.get('list'), new List(['a!', 'b!', 'c!']))
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

    // TODO: Do we actually want to support writing objects from read state within change blocks? Currently a subtle error.
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


describe('ImmutableAPI reads', () => {

  describe('for maps', () => {

    describe('types', () => {
      it('uses ImmutableAPI.ReadMap for outer document', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', 'foo')
        })
        assert(doc2 instanceof ImmutableAPI.ReadMap)
      })

      it('uses ImmutableAPI.ReadMap for inner maps', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', new Map().set('foo', 'bar'))
        })
        assert(doc2.get('outer') instanceof ImmutableAPI.ReadMap)
      })
    })

    describe('.toString', () => {
      it('returns a string', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('foo', 'bar'))
        assertIs(doc2.toString(), `ReadMap(${ROOT_ID}) { "foo": "bar" }`)
      })
    })

  })

  describe('for lists', () => {

    describe('types', () => {
      it('uses Immutable.ReadList for inner lists', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => {
          return doc.set('outer', new List().set(0, 'foo'))
        })
        assert(doc2.get('outer') instanceof ImmutableAPI.ReadList)
      })
    })

    describe('.toString', () => {
      it('returns a string', () => {
        const doc1 = Automerge.initImmutable()
        const doc2 = Automerge.change(doc1, doc => doc.set('outer', new List(['a', 'b', 'c'])))
        const list = doc2.get('outer')
        assertIs(list.toString(), `ReadList(${list._objectId}) [ "a", "b", "c" ]`)
      })
    })

  })

  describe('applying changes', () => {
    it('applies changes', () => {
      const initDoc = Automerge.initImmutable()
      const beforeDoc = Automerge.change(initDoc, doc => doc.set('foo', 'watch me now'))
      const afterDoc = Automerge.change(beforeDoc, doc => doc.set('foo', 'i can mash potato'))
      const changes = Automerge.getChanges(beforeDoc, afterDoc)
      const appliedDoc = Automerge.applyChanges(beforeDoc, changes)
      const appliedDoc2 = Automerge.applyChanges(appliedDoc, changes)
      assert.equal(Automerge.save(appliedDoc), Automerge.save(afterDoc))
      assert.equal(Automerge.save(appliedDoc2), Automerge.save(afterDoc))
    })
  })

  describe('fetching changes', () => {
    it('supports conflicts on lists', () => {
      let s1 = Automerge.change(Automerge.initImmutable(), doc => doc.set('pixels', new List(['red'])))
      let s2 = Automerge.merge(Automerge.initImmutable(), s1)
      s1 = Automerge.change(s1, doc => doc.setIn(['pixels', 0], 'green'))
      s2 = Automerge.change(s2, doc => doc.setIn(['pixels', 0], 'blue'))
      s1 = Automerge.merge(s1, s2)
      const conflicts = Automerge.getConflicts(s1, s1.get('pixels'))
      const losingValue = conflicts.first().valueSeq().first()
      if (is(s1.get('pixels'), List.of('green'))) {
        assertIs(losingValue, 'blue')
      } else if (is(s1.get('pixels'), List.of('blue'))) {
        assertIs(losingValue, 'green')
      } else {
        throw new Error('Unexpected merge: ' + s1.get('pixels').toString())
      }
    })
  })
})
