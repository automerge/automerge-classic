const { OBJECT_ID, CONFLICTS } = require('./constants')
const { isObject, copyObject } = require('../src/common')

function compareRows(properties, row1, row2) {
  for (let prop of properties) {
    if (row1[prop] === row2[prop]) continue

    if (typeof row1[prop] === 'number' && typeof row2[prop] === 'number') {
      return row1[prop] - row2[prop]
    } else {
      const prop1 = '' + row1[prop], prop2 = '' + row2[prop]
      if (prop1 === prop2) continue
      if (prop1 < prop2) return -1; else return +1
    }
  }
  return 0
}


/**
 * A relational-style unordered collection of records (rows). Each row is an
 * object that maps column names to values. The set of rows is represented by
 * a map from UUID to row object.
 */
class Table {
  /**
   * This constructor is used by application code when creating a new Table
   * object within a change callback.
   */
  constructor() {
    this.entries = Object.freeze({})
    this.opIds = Object.freeze({})
    Object.freeze(this)
  }

  /**
   * Looks up a row in the table by its unique ID.
   */
  byId(id) {
    return this.entries[id]
  }

  /**
   * Returns an array containing the unique IDs of all rows in the table, in no
   * particular order.
   */
  get ids() {
    return Object.keys(this.entries).filter(key => {
      const entry = this.entries[key]
      return isObject(entry) && entry.id === key
    })
  }

  /**
   * Returns the number of rows in the table.
   */
  get count() {
    return this.ids.length
  }

  /**
   * Returns an array containing all of the rows in the table, in no particular
   * order.
   */
  get rows() {
    return this.ids.map(id => this.byId(id))
  }

  /**
   * The standard JavaScript `filter()` method, which passes each row to the
   * callback function and returns all rows for which the it returns true.
   */
  filter(callback, thisArg) {
    return this.rows.filter(callback, thisArg)
  }

  /**
   * The standard JavaScript `find()` method, which passes each row to the
   * callback function and returns the first row for which it returns true.
   */
  find(callback, thisArg) {
    return this.rows.find(callback, thisArg)
  }

  /**
   * The standard JavaScript `map()` method, which passes each row to the
   * callback function and returns a list of its return values.
   */
  map(callback, thisArg) {
    return this.rows.map(callback, thisArg)
  }

  /**
  * Returns the list of rows, sorted by one of the following:
  * - If a function argument is given, it compares rows as per
  *   https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort#Description
  * - If a string argument is given, it is interpreted as a column name and
  *   rows are sorted according to that column.
  * - If an array of strings is given, it is interpreted as a list of column
  *   names, and rows are sorted lexicographically by those columns.
  * - If no argument is given, it sorts by row ID by default.
  */
  sort(arg) {
    if (typeof arg === 'function') {
      return this.rows.sort(arg)
    } else if (typeof arg === 'string') {
      return this.rows.sort((row1, row2) => compareRows([arg], row1, row2))
    } else if (Array.isArray(arg)) {
      return this.rows.sort((row1, row2) => compareRows(arg, row1, row2))
    } else if (arg === undefined) {
      return this.rows.sort((row1, row2) => compareRows(['id'], row1, row2))
    } else {
      throw new TypeError(`Unsupported sorting argument: ${arg}`)
    }
  }

  /**
   * When iterating over a table, you get all rows in the table, in no
   * particular order.
   */
  [Symbol.iterator] () {
    let rows = this.rows, index = -1
    return {
      next () {
        index += 1
        if (index < rows.length) {
          return {done: false, value: rows[index]}
        } else {
          return {done: true}
        }
      }
    }
  }

  /**
   * Returns a shallow clone of this object. This clone is used while applying
   * a patch to the table, and `freeze()` is called on it when we have finished
   * applying the patch.
   */
  _clone() {
    if (!this[OBJECT_ID]) {
      throw new RangeError('clone() requires the objectId to be set')
    }
    return instantiateTable(this[OBJECT_ID], copyObject(this.entries), copyObject(this.opIds))
  }

  /**
   * Sets the entry with key `id` to `value`. `opId` is the ID of the operation
   * performing this assignment. This method is for internal use only; it is
   * not part of the public API of Automerge.Table.
   */
  _set(id, value, opId) {
    if (Object.isFrozen(this.entries)) {
      throw new Error('A table can only be modified in a change function')
    }
    if (isObject(value) && !Array.isArray(value)) {
      Object.defineProperty(value, 'id', {value: id, enumerable: true})
    }
    this.entries[id] = value
    this.opIds[id] = opId
  }

  /**
   * Removes the row with unique ID `id` from the table.
   */
  remove(id) {
    if (Object.isFrozen(this.entries)) {
      throw new Error('A table can only be modified in a change function')
    }
    delete this.entries[id]
    delete this.opIds[id]
  }

  /**
   * Makes this object immutable. This is called after a change has been made.
   */
  _freeze() {
    Object.freeze(this.entries)
    Object.freeze(this.opIds)
    Object.freeze(this)
  }

  /**
   * Returns a writeable instance of this table. This instance is returned when
   * the table is accessed within a change callback. `context` is the proxy
   * context that keeps track of the mutations.
   */
  getWriteable(context, path) {
    if (!this[OBJECT_ID]) {
      throw new RangeError('getWriteable() requires the objectId to be set')
    }

    const instance = Object.create(WriteableTable.prototype)
    instance[OBJECT_ID] = this[OBJECT_ID]
    instance.context = context
    instance.entries = this.entries
    instance.opIds = this.opIds
    instance.path = path
    return instance
  }

  /**
   * Returns an object containing the table entries, indexed by objectID,
   * for serializing an Automerge document to JSON.
   */
  toJSON() {
    const rows = {}
    for (let id of this.ids) rows[id] = this.byId(id)
    return rows
  }
}

/**
 * An instance of this class is used when a table is accessed within a change
 * callback.
 */
class WriteableTable extends Table {
  /**
   * Returns a proxied version of the row with ID `id`. This row object can be
   * modified within a change callback.
   */
  byId(id) {
    if (isObject(this.entries[id]) && this.entries[id].id === id) {
      const objectId = this.entries[id][OBJECT_ID]
      const path = this.path.concat([{key: id, objectId}])
      return this.context.instantiateObject(path, objectId, ['id'])
    }
  }

  /**
   * Adds a new row to the table. The row is given as a map from
   * column name to value. Returns the objectId of the new row.
   */
  add(row) {
    return this.context.addTableRow(this.path, row)
  }

  /**
   * Removes the row with ID `id` from the table. Throws an exception if the row
   * does not exist in the table.
   */
  remove(id) {
    if (isObject(this.entries[id]) && this.entries[id].id === id) {
      this.context.deleteTableRow(this.path, id, this.opIds[id])
    } else {
      throw new RangeError(`There is no row with ID ${id} in this table`)
    }
  }
}

/**
 * This function is used to instantiate a Table object in the context of
 * applying a patch (see apply_patch.js).
 */
function instantiateTable(objectId, entries, opIds) {
  const instance = Object.create(Table.prototype)
  if (!objectId) {
    throw new RangeError('instantiateTable requires an objectId to be given')
  }
  instance[OBJECT_ID] = objectId
  instance[CONFLICTS] = Object.freeze({})
  instance.entries = entries || {}
  instance.opIds = opIds || {}
  return instance
}

module.exports = { Table, instantiateTable }
