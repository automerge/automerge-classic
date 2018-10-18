const { OBJECT_ID, CONFLICTS } = require('./constants')
const { isObject } = require('../src/common')

/**
 * A relational-style collection of records. A table has an ordered list of
 * columns, and an unordered set of rows. Each row is an object that maps
 * column names to values. The set of rows is represented by a map from
 * object ID to row object.
 */
class Table {
  /**
   * This constructor is used by application code when creating a new Table
   * object within a change callback.
   */
  constructor(columns) {
    if (!Array.isArray(columns)) {
      throw new TypeError('When creating a table you must supply a list of columns')
    }
    this.columns = columns
    this.entries = Object.freeze({})
    Object.freeze(this)
  }

  /**
   * Returns an array containing the unique IDs of all rows in the table, in no
   * particular order.
   */
  get ids() {
    return Object.keys(this.entries).filter(key => {
      const entry = this.entries[key]
      return isObject(entry) && entry[OBJECT_ID] === key
    })
  }

  /**
   * Returns the number of rows in the table.
   */
  get count() {
    return this.ids.length
  }

  /**
   * Looks up a row in the table by its unique ID.
   */
  byId(id) {
    return this.entries[id]
  }

  /**
   * When iterating over a table, you get all rows in the table, in no
   * particular order.
   */
  [Symbol.iterator] () {
    let ids = this.ids, that = this, index = -1
    return {
      next () {
        index += 1
        if (index < ids.length) {
          return {done: false, value: that.byId(ids[index])}
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
    return instantiateTable(this[OBJECT_ID], Object.assign({}, this.entries))
  }

  /**
   * Sets the entry with key `id` to `value`.
   */
  set(id, value) {
    if (Object.isFrozen(this.entries)) {
      throw new Error('A table can only be modified in a change function')
    }
    this.entries[id] = value
    if (id === 'columns') this.columns = value
  }

  /**
   * Removes the row with unique ID `id` from the table.
   */
  remove(id) {
    if (Object.isFrozen(this.entries)) {
      throw new Error('A table can only be modified in a change function')
    }
    delete this.entries[id]
  }

  /**
   * Makes this object immutable. This is called after a change has been made.
   */
  _freeze() {
    Object.freeze(this.entries)
    Object.freeze(this)
  }

  /**
   * Returns a writeable instance of this table. This instance is returned when
   * the table is accessed within a change callback. `context` is the proxy
   * context that keeps track of the mutations.
   */
  getWriteable(context) {
    if (!this[OBJECT_ID]) {
      throw new RangeError('getWriteable() requires the objectId to be set')
    }

    const instance = Object.create(WriteableTable.prototype)
    instance[OBJECT_ID] = this[OBJECT_ID]
    instance.context = context
    instance.entries = this.entries
    return instance
  }
}

/**
 * An instance of this class is used when a table is accessed within a change
 * callback.
 */
class WriteableTable extends Table {
  /**
   * Returns a proxied version of the columns list. This list can be modified
   * within a change callback.
   */
  get columns() {
    return this.context.getObjectField(this[OBJECT_ID], 'columns')
  }

  /**
   * Returns a proxied version of the row with ID `id`. This row object can be
   * modified within a change callback.
   */
  byId(id) {
    if (isObject(this.entries[id]) && this.entries[id][OBJECT_ID] === id) {
      return this.context.instantiateObject(id)
    }
  }

  /**
   * Adds a new row to the table. The row can be given either as a map from
   * column name to value, or as a list of values. If given as a list of
   * values, it is translated into a map using the table's column list.
   * Returns the objectId of the new row.
   */
  add(row) {
    if (Array.isArray(row)) {
      const columns = this.columns, rowObj = {}
      for (let i = 0; i < columns.length; i++) {
        rowObj[columns[i]] = row[i]
      }
      row = rowObj
    }
    return this.context.addTableRow(this[OBJECT_ID], row)
  }

  /**
   * Removes the row with ID `id` from the table. Throws an exception if the row
   * does not exist in the table.
   */
  remove(id) {
    if (isObject(this.entries[id]) && this.entries[id][OBJECT_ID] === id) {
      this.context.deleteTableRow(this[OBJECT_ID], id)
    } else {
      throw new RangeError(`There is no row with ID ${id} in this table`)
    }
  }
}

/**
 * This function is used to instantiate a Table object in the context of
 * applying a patch (see apply_patch.js).
 */
function instantiateTable(objectId, entries) {
  const instance = Object.create(Table.prototype)
  instance[OBJECT_ID] = objectId
  instance[CONFLICTS] = Object.freeze({})
  instance.entries = entries || {}
  return instance
}

module.exports = { Table, instantiateTable }
