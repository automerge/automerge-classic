const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const Frontend = Automerge.Frontend
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
      assert.deepStrictEqual(req, {
        requestType: 'change', actor, seq: 1, time: req.time, message: '', version: 0, ops: [
          {obj: ROOT_ID, action: 'makeTable', key: 'books', child: books}
        ]
      })
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
      assert.deepStrictEqual(req2, {
        requestType: 'change', actor, seq: 2, time: req2.time, message: '', version: 0, ops: [
          {obj: books, action: 'makeMap', key: rowId, child: rowId},
          {obj: rowId, action: 'set', key: 'authors', value: 'Kleppmann, Martin'},
          {obj: rowId, action: 'set', key: 'title', value: 'Designing Data-Intensive Applications'}
        ]
      })
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
      assert.deepStrictEqual(row, rowWithId)
    })

    it('should return the row count', () => {
      assert.strictEqual(s1.books.count, 1)
    })

    it('should return a list of row IDs', () => {
      assert.deepStrictEqual(s1.books.ids, [rowId])
    })

    it('should allow iterating over rows', () => {
      assert.deepStrictEqual([...s1.books], [rowWithId])
    })

    it('should support standard array methods', () => {
      assert.deepStrictEqual(s1.books.filter(book => book.isbn === '1449373321'), [rowWithId])
      assert.deepStrictEqual(s1.books.filter(book => book.isbn === '9781449373320'), [])
      assert.deepStrictEqual(s1.books.find(book => book.isbn === '1449373321'), rowWithId)
      assert.strictEqual(s1.books.find(book => book.isbn === '9781449373320'), undefined)
      assert.deepStrictEqual(s1.books.map(book => book.title), ['Designing Data-Intensive Applications'])
    })

    it('should be immutable', () => {
      assert.strictEqual(s1.books.add, undefined)
      assert.throws(() => s1.books.remove(rowId), /can only be modified in a change function/)
    })

    it('should save and reload', () => {
      const s2 = Automerge.load(Automerge.save(s1))
      assert.deepStrictEqual(s2.books.byId(rowId), rowWithId)
    })

    it('should allow a row to be updated', () => {
      const s2 = Automerge.change(s1, doc => {
        doc.books.byId(rowId).isbn = '9781449373320'
      })
      assert.deepStrictEqual(s2.books.byId(rowId), {
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
      assert.deepStrictEqual([...s2.books], [])
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
    assert.deepStrictEqual(a2.books.byId(ddia), Object.assign({id: ddia}, DDIA))
    assert.deepStrictEqual(a2.books.byId(rsdp), Object.assign({id: rsdp}, RSDP))
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
    assert.deepStrictEqual(s.books.sort('title'), [ddiaWithId, rsdpWithId])
    assert.deepStrictEqual(s.books.sort(['authors', 'title']), [rsdpWithId, ddiaWithId])
    assert.deepStrictEqual(s.books.sort((row1, row2) => {
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
    assert.deepStrictEqual(JSON.parse(JSON.stringify(s)), {books: {[ddia]: ddiaWithId}})
  })
})
