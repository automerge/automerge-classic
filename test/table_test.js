const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const Frontend = Automerge.Frontend
const Backend = Automerge.Backend
const ROOT_ID = '00000000-0000-0000-0000-000000000000'
const uuid = require('../src/uuid')
const { assertEqualsOneOf } = require('./helpers')

// Example data
const DDIA = {
  authors: ['Kleppmann, Martin'],
  title: 'Designing Data-Intensive Applications',
  isbn: '1449373321'
}
const RSDP = {
  authors: ['Cachin, Christian', 'Guerraoui, Rachid', 'Rodrigues, Luís'],
  title: 'Introduction to Reliable and Secure Distributed Programming',
  isbn: '3-642-15259-7'
}

describe('Automerge.Table', () => {
  describe('Frontend', () => {
    it('should generate ops to create a table', () => {
      const actor = uuid()
      const [doc, req] = Frontend.change(Frontend.init(actor), doc => {
        doc.books = new Automerge.Table()
      })
      const books = Frontend.getObjectId(doc.books)
      assert.deepEqual(req, {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {obj: books, action: 'makeTable'},
        {obj: ROOT_ID, action: 'link', key: 'books', value: books}
      ]})
    })

    it('should generate ops to insert a row', () => {
      const actor = uuid()
      const [doc1, req1] = Frontend.change(Frontend.init(actor), doc => {
        doc.books = new Automerge.Table()
      })
      let rowId
      const [doc2, req2] = Frontend.change(doc1, doc => {
        rowId = doc.books.add({authors: 'Kleppmann, Martin', title: 'Designing Data-Intensive Applications'})
      })
      const books = Frontend.getObjectId(doc2.books)
      assert.deepEqual(req2, {requestType: 'change', actor, seq: 2, deps: {}, ops: [
        {obj: rowId, action: 'makeMap'},
        {obj: rowId, action: 'set', key: 'authors', value: 'Kleppmann, Martin'},
        {obj: rowId, action: 'set', key: 'title', value: 'Designing Data-Intensive Applications'},
        {obj: books, action: 'link', key: rowId, value: rowId}
      ]})
    })
  })

  describe('with one row', () => {
    let s1, rowId, rowWithId

    beforeEach(() => {
      s1 = Automerge.change(Automerge.init({freeze: true}), doc => {
        doc.books = new Automerge.Table()
        rowId = doc.books.add(DDIA)
      })
      rowWithId = Object.assign({id: rowId}, DDIA)
    })

    it('should look up a row by ID', () => {
      const row = s1.books.byId(rowId)
      assert.deepEqual(row, rowWithId)
      assert.strictEqual(Frontend.getObjectId(row), rowId)
    })

    it('should return the row count', () => {
      assert.strictEqual(s1.books.count, 1)
    })

    it('should return a list of row IDs', () => {
      assert.deepEqual(s1.books.ids, [rowId])
    })

    it('should allow iterating over rows', () => {
      assert.deepEqual([...s1.books], [rowWithId])
    })

    it('should support standard array methods', () => {
      assert.deepEqual(s1.books.filter(book => book.isbn === '1449373321'), [rowWithId])
      assert.deepEqual(s1.books.filter(book => book.isbn === '9781449373320'), [])
      assert.deepEqual(s1.books.find(book => book.isbn === '1449373321'), rowWithId)
      assert.strictEqual(s1.books.find(book => book.isbn === '9781449373320'), undefined)
      assert.deepEqual(s1.books.map(book => book.title), ['Designing Data-Intensive Applications'])
    })

    it('should be immutable', () => {
      assert.strictEqual(s1.books.add, undefined)
      assert.throws(() => s1.books.remove(rowId), /can only be modified in a change function/)
    })

    it('should save and reload', () => {
      const s2 = Automerge.load(Automerge.save(s1))
      assert.deepEqual(s2.books.byId(rowId), rowWithId)
    })

    it('should allow a row to be updated', () => {
      const s2 = Automerge.change(s1, doc => {
        doc.books.byId(rowId).isbn = '9781449373320'
      })
      assert.deepEqual(s2.books.byId(rowId), {
        id: rowId,
        authors: ['Kleppmann, Martin'],
        title: 'Designing Data-Intensive Applications',
        isbn: '9781449373320'
      })
    })

    it('should allow a row to be removed', () => {
      const s2 = Automerge.change(s1, doc => {
        doc.books.remove(rowId)
      })
      assert.strictEqual(s2.books.count, 0)
      assert.deepEqual([...s2.books], [])
    })

    it('should not allow a row ID to be specified', () => {
      assert.throws(() => {
        Automerge.change(s1, doc => {
          doc.books.add(Object.assign({id: 'beafbfde-8e44-4a5f-b679-786e2ebba03f'}, RSDP))
        })
      }, /A table row must not have an "id" property/)
    })

    it('should not allow a row ID to be modified', () => {
      assert.throws(() => {
        Automerge.change(s1, doc => {
          doc.books.byId(rowId).id = 'beafbfde-8e44-4a5f-b679-786e2ebba03f'
        })
      }, /Object property "id" cannot be modified/)
    })
  })

  it('should allow concurrent row insertion', () => {
    const a0 = Automerge.change(Automerge.init(), doc => {
      doc.books = new Automerge.Table()
    })
    const b0 = Automerge.merge(Automerge.init(), a0)

    let ddia, rsdp
    const a1 = Automerge.change(a0, doc => { ddia = doc.books.add(DDIA) })
    const b1 = Automerge.change(b0, doc => { rsdp = doc.books.add(RSDP) })
    const a2 = Automerge.merge(a1, b1)
    assert.deepEqual(a2.books.byId(ddia), Object.assign({id: ddia}, DDIA))
    assert.deepEqual(a2.books.byId(rsdp), Object.assign({id: rsdp}, RSDP))
    assert.strictEqual(a2.books.count, 2)
    assertEqualsOneOf(a2.books.ids, [ddia, rsdp], [rsdp, ddia])
  })

  it('should allow rows to be sorted in various ways', () => {
    let ddia, rsdp
    const s = Automerge.change(Automerge.init(), doc => {
      doc.books = new Automerge.Table()
      ddia = doc.books.add(DDIA)
      rsdp = doc.books.add(RSDP)
    })
    const ddiaWithId = Object.assign({id: ddia}, DDIA)
    const rsdpWithId = Object.assign({id: rsdp}, RSDP)
    assert.deepEqual(s.books.sort('title'), [ddiaWithId, rsdpWithId])
    assert.deepEqual(s.books.sort(['authors', 'title']), [rsdpWithId, ddiaWithId])
    assert.deepEqual(s.books.sort((row1, row2) => {
      return (row1.isbn === '1449373321') ? -1 : +1
    }), [ddiaWithId, rsdpWithId])
  })

  it('should allow serialization to JSON', () => {
    let ddia
    const s = Automerge.change(Automerge.init(), doc => {
      doc.books = new Automerge.Table()
      ddia = doc.books.add(DDIA)
    })
    const ddiaWithId = Object.assign({id: ddia}, DDIA)
    assert.deepEqual(JSON.parse(JSON.stringify(s)), {books: {[ddia]: ddiaWithId}})
  })
})
