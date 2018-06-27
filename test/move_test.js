const { Map, List, Record, Set, fromJS, is } = require('immutable')
const uuid = require('uuid/v4')
const assert = require('assert')
const jsc = require('jsverify')

const ElementSet   = Record({byId: new Map(), byObj: new Map(), byRef: new Map()})
const ChildElement = Record({id: null, obj: null, key: null, ref: null})
const ValueElement = Record({id: null, obj: null, key: null, val: null})

const AssignOp    = Record({action: 'assign',    id: null, obj: null, key: null, val: null, prev: new Set()})
const MakeChildOp = Record({action: 'makeChild', id: null, obj: null, key: null,            prev: new Set()})
const MoveOp      = Record({action: 'move',      id: null, obj: null, key: null, ref: null, prev: new Set()})
const RemoveOp    = Record({action: 'remove',    id: null,                                  prev: new Set()})


class LamportTS extends Record({counter: 0, actorId: ''}) {
  toString () {
    return this.counter + '@' + this.actorId
  }

  compareTo (other) {
    if (!(other instanceof LamportTS)) {
      throw new TypeError('Cannot compare LamportTS to value: ' + other)
    }
    if (this.counter < other.counter) return -1
    if (this.counter > other.counter) return 1
    if (this.actorId < other.actorId) return -1
    if (this.actorId > other.actorId) return 1
    return 0
  }
}

LamportTS.parse = function (str) {
  let [match, counter, actorId] = /^([0-9]+)@(.*)$/.exec(str)
  if (!match) {
    throw new RangeError('Cannot parse into LamportTS: ' + str)
  }
  return new LamportTS({counter: parseInt(counter), actorId})
}


function materialize(elems, rootId) {
  const obj = {}
  elems.getIn(['byObj', rootId || null], new Map()).forEach((values, key) => {
    if (values && !values.isEmpty()) {
      obj[key] = {}
      values.forEach((elem, id) => {
        if (elem.ref) {
          obj[key][id] = materialize(elems, elem.ref)
        } else {
          obj[key][id] = elem.val
        }
      })
    }
  })
  return obj
}

function addElement(elems, elem) {
  if (elems.hasIn(['byId', elem.id])) {
    throw new RangeError(`Element with ID ${elem.id} already exists`)
  }
  if (elem.ref && elem.hasIn(['byRef', elem.ref])) {
    throw new RangeError(`Element with ID ${elem.ref} already has a parent`)
  }

  return elems.withMutations(elems => {
    elems.setIn(['byId', elem.id], elem)
    elems.setIn(['byObj', elem.obj, elem.key, elem.id], elem)
    if (elem.ref) elems.setIn(['byRef', elem.ref], elem)
  })
}

function removeElementsByIds(elems, ids) {
  if (!ids) return elems

  return elems.withMutations(elems => {
    for (const id of ids) {
      const elem = elems.getIn(['byId', id])
      elems.deleteIn(['byId', id])
      elems.deleteIn(['byObj', elem.obj, elem.key, elem.id])
      if (elem.ref) elems = elems.deleteIn(['byRef', elem.ref])
    }
  })
}

function removeElementByRef(elems, ref) {
  const elem = elems.getIn(['byRef', ref])
  if (!elem) return elems

  return elems.withMutations(elems => {
    elems.deleteIn(['byId', elem.id])
    elems.deleteIn(['byObj', elem.obj, elem.key, elem.id])
    elems.deleteIn(['byRef', ref])
  })
}

function isAncestor(elems, anc, desc) {
  let id = desc
  while (id) {
    if (id === anc) return true
    id = elems.getIn(['byRef', id, 'obj'])
  }
  return false
}

function applySequential(elems, oper) {
  const { action, id, obj, key, val, ref, prev } = oper

  if (action === 'move' && isAncestor(elems, ref, obj)) {
    return elems
  }

  elems = removeElementsByIds(elems, prev)

  switch (action) {
    case 'assign':
      return addElement(elems, new ValueElement({id, obj, key, val}))
    case 'makeChild':
      return addElement(elems, new ChildElement({id, obj, key, ref: id}))
    case 'move':
      elems = removeElementByRef(elems, ref)
      return addElement(elems, new ChildElement({id, obj, key, ref}))
    case 'remove':
      return elems
    default:
      throw new RangeError(`Unknown operation type: ${action}`)
  }
}

function interpSequential(opers) {
  return opers.reduce(applySequential, new ElementSet())
}

describe('sequential interpretation', () => {
  it('should be empty if there are no ops', () => {
    assert.deepEqual(materialize(interpSequential([])), {})
  })

  it('should assign a field to the root object', () => {
    const actorId = uuid()
    const ops = [
      new AssignOp({id: new LamportTS({actorId, counter: 0}), obj: null, key: 'a', val: 42})
    ]
    assert.deepEqual(materialize(interpSequential(ops)), {a: {[ops[0].id]: 42}})
  })

  it('should create a nested object', () => {
    const actorId = uuid()
    const childId  = new LamportTS({actorId, counter: 0})
    const assignId = new LamportTS({actorId, counter: 1})
    const ops = [
      new MakeChildOp({id: childId, obj: null, key: 'foo'}),
      new AssignOp({id: assignId, obj: childId, key: 'bar', val: 42}),
    ]
    assert.deepEqual(materialize(interpSequential(ops)), {
      foo: {[childId]: {
        bar: {[assignId]: 42}
      }}
    })
  })

  it('should allow a move operation to overwrite a field value', () => {
    const actorId = uuid()
    const childId  = new LamportTS({actorId, counter: 0})
    const assignId = new LamportTS({actorId, counter: 1})
    const moveId   = new LamportTS({actorId, counter: 2})
    const ops = [
      new MakeChildOp({id: childId, obj: null, key: 'foo'}),
      new AssignOp({id: assignId, obj: null, key: 'bar', val: 42}),
      new MoveOp({id: moveId, obj: null, key: 'bar', ref: childId, prev: Set.of(assignId)})
    ]
    assert.deepEqual(materialize(interpSequential(ops)), {bar: {[moveId]: {}}})
  })

  it('should arbitrate between conflicting move operations', () => {
    const childA  = new LamportTS({actorId: 'actor1', counter: 0})
    const childB  = new LamportTS({actorId: 'actor1', counter: 1})
    const assignC = new LamportTS({actorId: 'actor1', counter: 2})
    const moveA   = new LamportTS({actorId: 'actor1', counter: 3})
    const moveB   = new LamportTS({actorId: 'actor2', counter: 3})
    const ops = [
      new MakeChildOp({id: childA, obj: null, key: 'A'}),
      new MakeChildOp({id: childB, obj: null, key: 'B'}),
      new AssignOp({id: assignC, obj: childA, key: 'C', val: 42}),
      new MoveOp({id: moveA, obj: childB, key: 'A', ref: childA}),
      new MoveOp({id: moveB, obj: childA, key: 'B', ref: childB})
    ]
    assert.deepEqual(materialize(interpSequential(ops)), {
      'B': {[childB]: {
        'A': {[moveA]: {
          'C': {[assignC]: 42}
        }}
      }}
    })
  })
})
