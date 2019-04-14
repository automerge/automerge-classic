import * as assert from 'assert'
import { Frontend, UUID } from 'automerge'
import * as Automerge from 'automerge'
import uuid from 'uuid'

import { assertEqualsOneOf } from './helpers'

const ROOT_ID = '00000000-0000-0000-0000-000000000000'

interface Book {
  authors: string | string[]
  title: string
  isbn?: string
}

type BookDb = {
  books: Automerge.Table<Book>
}

// Example data
const DDIA: Book = {
  authors: ['Kleppmann, Martin'],
  title: 'Designing Data-Intensive Applications',
  isbn: '1449373321'
}
const RSDP: Book = {
  authors: ['Cachin, Christian', 'Guerraoui, Rachid', 'Rodrigues, Luís'],
  title: 'Introduction to Reliable and Secure Distributed Programming',
  isbn: '3-642-15259-7'
}

describe('Automerge.Table', () => {
  describe('Frontend', () => {
    it('should generate ops to create a table', () => {
      const actor = uuid()
      const [doc, req] = Frontend.change(Frontend.init<BookDb>(actor), doc => {
        doc.books = new Automerge.Table<Book>(['authors', 'title'])
      })
      const books = Frontend.getObjectId(doc.books)
      const cols = Frontend.getObjectId(doc.books.columns)
      assert.deepEqual(req, {requestType: 'change', actor, seq: 1, deps: {}, ops: [
        {obj: books, action: 'makeTable'},
        {obj: cols, action: 'makeList'},
        {obj: cols, action: 'ins', elem: 1, key: '_head'},
        {obj: cols, action: 'set', key: `${actor}:1`, value: 'authors'},
        {obj: cols, action: 'ins', elem: 2, key: `${actor}:1`},
        {obj: cols, action: 'set', key: `${actor}:2`, value: 'title'},
        {obj: books, action: 'link', key: 'columns', value: cols},
        {obj: ROOT_ID, action: 'link', key: 'books', value: books}
      ]})
    })

    it('should generate ops to insert a row', () => {
      const actor = uuid()
      const [doc1, req1] = Frontend.change(Frontend.init<BookDb>(actor), doc => {
        doc.books = new Automerge.Table<Book>(['authors', 'title'])
      })
      let rowId
      const [doc2, req2] = Frontend.change(doc1, doc => {
        rowId = doc.books.add({ authors: 'Kleppmann, Martin', title: 'Designing Data-Intensive Applications' })
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
    let s1: BookDb
    let rowId: UUID

    beforeEach(() => {
      s1 = Automerge.change(Automerge.init<BookDb>(), doc => {
        doc.books = new Automerge.Table<Book>(['authors', 'title', 'isbn'])
        rowId = doc.books.add(DDIA)
      })
    })

    it('should look up a row by ID', () => {
      const row = s1.books.byId(rowId)
      assert.deepEqual(row, DDIA)
      assert.strictEqual(Frontend.getObjectId(row), rowId)
    })

    it('should return the row count', () => {
      assert.strictEqual(s1.books.count, 1)
    })

    it('should return a list of row IDs', () => {
      assert.deepEqual(s1.books.ids, [rowId])
    })

    it('should allow iterating over rows', () => {
      assert.deepEqual([...s1.books], [DDIA])
    })

    it('should support standard array methods', () => {
      assert.deepEqual(s1.books.filter((book: Book) => book.isbn === '1449373321'), [DDIA])
      assert.deepEqual(s1.books.filter((book: Book) => book.isbn === '9781449373320'), [])
      assert.deepEqual(s1.books.find((book: Book) => book.isbn === '1449373321'), DDIA)
      assert.strictEqual(s1.books.find((book: Book) => book.isbn === '9781449373320'), undefined)
      assert.deepEqual(s1.books.map<string>((book: Book) => book.title), ['Designing Data-Intensive Applications'])
    })

    it('should be immutable', () => {
      assert.strictEqual(s1.books.add, undefined)
      assert.throws(() => s1.books.set('id', DDIA), /can only be modified in a change function/)
      assert.throws(() => s1.books.remove('id'), /can only be modified in a change function/)
    })

    it('should save and reload', () => {
      const s2 = Automerge.load(Automerge.save(s1))
      assert.deepEqual(s2.books.columns, ['authors', 'title', 'isbn'])
      assert.deepEqual(s2.books.byId(rowId), DDIA)
    })

    it('should allow a row to be updated', () => {
      const s2 = Automerge.change(s1, doc => {
        doc.books.byId(rowId).isbn = '9781449373320'
      })
      assert.deepEqual(s2.books.byId(rowId), {
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

    it('should allow the column list to be changed', () => {
      const s2 = Automerge.change(s1, doc => {
        doc.books.columns.push('publisher')
      })
      assert.deepEqual(s2.books.columns, ['authors', 'title', 'isbn', 'publisher'])
      assert.deepEqual(s2.books.byId(rowId), DDIA)
    })

    it('should translate an array row into a map', () => {
      let rsdp, lovelace
      const s2 = Automerge.change(s1, doc => {
        rsdp = doc.books.add([
          ['Cachin, Christian', 'Guerraoui, Rachid', 'Rodrigues, Luís'],
          'Introduction to Reliable and Secure Distributed Programming',
          '3-642-15259-7'
        ])
        lovelace = doc.books.add([
          ['Padua, Sydney'],
          'The Thrilling Adventures of Lovelace and Babbage',
          '9780141981536'
        ])
      })
      assert.deepEqual(s2.books.byId(rsdp), RSDP)
      assert.deepEqual(s2.books.byId(lovelace), {
        authors: ['Padua, Sydney'],
        title: 'The Thrilling Adventures of Lovelace and Babbage',
        isbn: '9780141981536'
      })
    })
  })

  it('should allow concurrent row insertion', () => {
    const a0 = Automerge.change(Automerge.init<BookDb>(), doc => {
      doc.books = new Automerge.Table<Book>(['authors', 'title', 'isbn'])
    })
    const b0 = Automerge.merge(Automerge.init<BookDb>(), a0)

    let ddia: UUID
    let rsdp: UUID
    const a1 = Automerge.change(a0, doc => { ddia = doc.books.add(DDIA) })
    const b1 = Automerge.change(b0, doc => { rsdp = doc.books.add(RSDP) })
    const a2 = Automerge.merge(a1, b1)
    assert.deepEqual(a2.books.byId(ddia), DDIA)
    assert.deepEqual(a2.books.byId(rsdp), RSDP)
    assert.strictEqual(a2.books.count, 2)
    assertEqualsOneOf(a2.books.ids, [ddia, rsdp], [rsdp, ddia])
  })

  it('should allow rows to be sorted in various ways', () => {
    const s = Automerge.change(Automerge.init<BookDb>(), doc => {
      doc.books = new Automerge.Table<Book>(['authors', 'title', 'isbn'])
      doc.books.add(DDIA)
      doc.books.add(RSDP)
    })
    assert.deepEqual(s.books.sort('title'), [DDIA, RSDP])
    assert.deepEqual(s.books.sort(['authors', 'title']), [RSDP, DDIA])
    assert.deepEqual(
      s.books.sort((row1: Book, row2: Book) => {
        return (row1.isbn === '1449373321') ? -1 : +1
      }), [DDIA, RSDP])
  })
})
