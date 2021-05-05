/**
 * Miniature implementation of a subset of Automerge, which is used below as definition of the
 * expected behaviour during fuzz testing. Supports the following:
 *  - only map, list, and primitive datatypes (no table, text, counter, or date objects)
 *  - no undo/redo
 *  - no conflicts on concurrent updates to the same field (uses last-writer-wins instead)
 *  - no API for creating new changes (you need to create change objects yourself)
 *  - no buffering of changes that are missing their causal dependencies
 *  - no saving or loading in serialised form
 *  - relies on object mutation (no immutability)
 */
class Micromerge {
  constructor() {
    this.byActor = {} // map from actorId to array of changes
    this.byObjId = {_root: {}} // objects, keyed by the ID of the operation that created the object
    this.metadata = {_root: {}} // map from objID to object with CRDT metadata for each object field
  }

  get root() {
    return this.byObjId._root
  }

  /**
   * Updates the document state by applying the change object `change`, in the format documented here:
   * https://github.com/automerge/automerge/blob/performance/BINARY_FORMAT.md#json-representation-of-changes
   */
  applyChange(change) {
    // Check that the change's dependencies are met
    const lastSeq = this.byActor[change.actor] ? this.byActor[change.actor].length : 0
    if (change.seq !== lastSeq + 1) {
      throw new RangeError(`Expected sequence number ${lastSeq + 1}, got ${change.seq}`)
    }
    for (let [actor, dep] of Object.entries(change.deps || {})) {
      if (!this.byActor[actor] || this.byActor[actor].length < dep) {
        throw new RangeError(`Missing dependency: change ${dep} by actor ${actor}`)
      }
    }

    if (!this.byActor[change.actor]) this.byActor[change.actor] = []
    this.byActor[change.actor].push(change)

    change.ops.forEach((op, index) => {
      this.applyOp(Object.assign({opId: `${change.startOp + index}@${change.actor}`}, op))
    })
  }

  /**
   * Updates the document state with one of the operations from a change.
   */
  applyOp(op) {
    if (!this.metadata[op.obj]) throw new RangeError(`Object does not exist: ${op.obj}`)
    if (op.action === 'makeMap') {
      this.byObjId[op.opId] = {}
      this.metadata[op.opId] = {}
    } else if (op.action === 'makeList') {
      this.byObjId[op.opId] = []
      this.metadata[op.opId] = []
    } else if (op.action !== 'set' && op.action !== 'del') {
      throw new RangeError(`Unsupported operation type: ${op.action}`)
    }

    if (Array.isArray(this.metadata[op.obj])) {
      if (op.insert) this.applyListInsert(op); else this.applyListUpdate(op)
    } else if (!this.metadata[op.obj][op.key] || this.compareOpIds(this.metadata[op.obj][op.key], op.opId)) {
      this.metadata[op.obj][op.key] = op.opId
      if (op.action === 'del') {
        delete this.byObjId[op.obj][op.key]
      } else if (op.action.startsWith('make')) {
        this.byObjId[op.obj][op.key] = this.byObjId[op.opId]
      } else {
        this.byObjId[op.obj][op.key] = op.value
      }
    }
  }

  /**
   * Applies a list insertion operation.
   */
  applyListInsert(op) {
    const meta = this.metadata[op.obj]
    const value = op.action.startsWith('make') ? this.byObjId[op.opId] : op.value
    let {index, visible} =
      (op.key === '_head') ? {index: -1, visible: 0} : this.findListElement(op.obj, op.key)
    if (index >= 0 && !meta[index].deleted) visible++
    index++
    while (index < meta.length && this.compareOpIds(op.opId, meta[index].elemId)) {
      if (!meta[index].deleted) visible++
      index++
    }
    meta.splice(index, 0, {elemId: op.opId, valueId: op.opId, deleted: false})
    this.byObjId[op.obj].splice(visible, 0, value)
  }

  /**
   * Applies a list element update (setting the value of a list element, or deleting a list element).
   */
  applyListUpdate(op) {
    const {index, visible} = this.findListElement(op.obj, op.key)
    const meta = this.metadata[op.obj][index]
    if (op.action === 'del') {
      if (!meta.deleted) this.byObjId[op.obj].splice(visible, 1)
      meta.deleted = true
    } else if (this.compareOpIds(meta.valueId, op.opId)) {
      if (!meta.deleted) {
        this.byObjId[op.obj][visible] = op.action.startsWith('make') ? this.byObjId[op.opId] : op.value
      }
      meta.valueId = op.opId
    }
  }

  /**
   * Searches for the list element with ID `elemId` in the object with ID `objId`. Returns an object
   * `{index, visible}` where `index` is the index of the element in the metadata array, and
   * `visible` is the number of non-deleted elements that precede the specified element.
   */
  findListElement(objectId, elemId) {
    let index = 0, visible = 0, meta = this.metadata[objectId]
    while (index < meta.length && meta[index].elemId !== elemId) {
      if (!meta[index].deleted) visible++
      index++
    }
    if (index === meta.length) throw new RangeError(`List element not found: ${elemId}`)
    return {index, visible}
  }

  /**
   * Compares two operation IDs in the form `counter@actor`. Returns true if `id1` has a lower counter
   * than `id2`, or if the counter values are the same and `id1` has an actorId that sorts
   * lexicographically before the actorId of `id2`.
   */
  compareOpIds(id1, id2) {
    const regex = /^([0-9]+)@(.*)$/
    const match1 = regex.exec(id1), match2 = regex.exec(id2)
    const counter1 = parseInt(match1[1], 10), counter2 = parseInt(match2[1], 10)
    return (counter1 < counter2) || (counter1 === counter2 && match1[2] < match2[2])
  }
}


/* TESTS */

const assert = require('assert')

const change1 = {actor: '1234', seq: 1, deps: {}, startOp: 1, ops: [
  {action: 'set',      obj: '_root',  key: 'title',  insert: false, value: 'Hello'},
  {action: 'makeList', obj: '_root',  key: 'tags',   insert: false},
  {action: 'set',      obj: '2@1234', key: '_head',  insert: true,  value: 'foo'}
]}

const change2 = {actor: '1234', seq: 2, deps: {}, startOp: 4, ops: [
  {action: 'set',      obj: '_root',  key: 'title',  insert: false, value: 'Hello 1'},
  {action: 'set',      obj: '2@1234', key: '3@1234', insert: true,  value: 'bar'},
  {action: 'del',      obj: '2@1234', key: '3@1234', insert: false}
]}

const change3 = {actor: 'abcd', seq: 1, deps: {'1234': 1}, startOp: 4, ops: [
  {action: 'set',      obj: '_root',  key: 'title',  insert: false, value: 'Hello 2'},
  {action: 'set',      obj: '2@1234', key: '3@1234', insert: true,  value: 'baz'}
]}

let doc1 = new Micromerge(), doc2 = new Micromerge()
for (let c of [change1, change2, change3]) doc1.applyChange(c)
for (let c of [change1, change3, change2]) doc2.applyChange(c)
assert.deepStrictEqual(doc1.root, {title: 'Hello 2', tags: ['baz', 'bar']})
assert.deepStrictEqual(doc2.root, {title: 'Hello 2', tags: ['baz', 'bar']})

const change4 = {actor: '2345', seq: 1, deps: {}, startOp: 1, ops: [
  {action: 'makeList', obj: '_root',  key: 'todos',  insert: false},
  {action: 'set',      obj: '1@2345', key: '_head',  insert: true,  value: 'Task 1'},
  {action: 'set',      obj: '1@2345', key: '2@2345', insert: true,  value: 'Task 2'}
]}

let doc3 = new Micromerge()
doc3.applyChange(change4)
assert.deepStrictEqual(doc3.root, {todos: ['Task 1', 'Task 2']})

const change5 = {actor: '2345', seq: 2, deps: {}, startOp: 4, ops: [
  {action: 'del',      obj: '1@2345', key: '2@2345', insert: false},
  {action: 'set',      obj: '1@2345', key: '3@2345', insert: true,  value: 'Task 3'}
]}
doc3.applyChange(change5)
assert.deepStrictEqual(doc3.root, {todos: ['Task 2', 'Task 3']})

const change6 = {actor: '2345', seq: 3, deps: {}, startOp: 6, ops: [
  {action: 'del',      obj: '1@2345', key: '3@2345', insert: false},
  {action: 'set',      obj: '1@2345', key: '5@2345', insert: false, value: 'Task 3b'},
  {action: 'set',      obj: '1@2345', key: '5@2345', insert: true,  value: 'Task 4'}
]}
doc3.applyChange(change6)
assert.deepStrictEqual(doc3.root, {todos: ['Task 3b', 'Task 4']})
