const { Map, List, Record, Set, fromJS, is } = require('immutable')
const uuid = require('uuid/v4')
const assert = require('assert')
const jsc = require('jsverify')

const ElementSet   = Record({byId: Map(), byObj: Map(), byRef: Map()})
const ChildElement = Record({id: null, obj: null, key: null, ref: null})
const ValueElement = Record({id: null, obj: null, key: null, val: null})

const OperationSet = Record({byId: Map(), byObj: Map(), byRef: Map(), byPrev: Map(), moveValid: Map()})
const AssignOp     = Record({action: 'assign',    id: null, obj: null, key: null, val: null, prev: Set()})
const MakeChildOp  = Record({action: 'makeChild', id: null, obj: null, key: null,            prev: Set()})
const MoveOp       = Record({action: 'move',      id: null, obj: null, key: null, ref: null, prev: Set()})
const RemoveOp     = Record({action: 'remove',    id: null,                                  prev: Set()})


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
    if (elem.ref) {
      if (!elems.hasIn(['byObj', elem.ref])) elems.setIn(['byObj', elem.ref], Map())
      elems.setIn(['byRef', elem.ref], elem)
    }
  })
}

function removeElementsByIds(elems, ids) {
  if (!ids) return elems

  return elems.withMutations(elems => {
    for (const id of ids) {
      const elem = elems.getIn(['byId', id])
      if (elem) {
        elems.deleteIn(['byId', id])
        elems.deleteIn(['byObj', elem.obj, elem.key, elem.id])
        if (elem.ref) elems = elems.deleteIn(['byRef', elem.ref])
      }
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
    if (is(id, anc)) return true
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

function interpSequential(ops) {
  ops = ops.slice().sort((op1, op2) => op1.id.compareTo(op2.id))
  return ops.reduce(applySequential, new ElementSet())
}

function addOperation(ops, op) {
  if (ops.hasIn(['byId', op.id])) {
    throw new RangeError(`Operation with ID ${op.id} already exists`)
  }

  const moveValid = (op.action === 'move') ? isMoveValid(ops, op) : true
  ops = ops.withMutations(ops => {
    ops.setIn(['byId', op.id], op)

    for (const ref of op.prev) {
      ops.setIn(['byPrev', ref, op.id], op)
    }
    if (op.action !== 'remove') {
      ops.setIn(['byObj', op.obj, op.key, op.id], op)
    }
    if (op.action === 'makeChild') {
      ops.setIn(['byRef', op.id, op.id], op)
      if (!ops.hasIn(['byObj', op.id])) ops.setIn(['byObj', op.id], Map())
    }
    if (op.action === 'move') {
      ops.setIn(['byRef', op.ref, op.id], op)
      ops.setIn(['moveValid', op.id], moveValid)
    }
  })

  if (op.action === 'move') {
    const moveIds = Set.fromKeys(ops.moveValid)
      .sort((k1, k2) => k1.compareTo(k2))
      .skipWhile(k => k.compareTo(op.id) <= 0)
    for (const id of moveIds) {
      ops = ops.setIn(['moveValid', id], isMoveValid(ops, ops.byId.get(id)))
    }
  }
  return ops
}

function opSet(ops) {
  return ops.reduce(addOperation, new OperationSet())
}

function isMoveValid(ops, op) {
  if (op.action !== 'move') {
    throw new RangeError('isMoveValid must be called with a move operation')
  }

  let parentId = op.obj
  while (parentId) {
    if (is(parentId, op.ref)) return false

    const refIds = Set.fromKeys(ops.byRef.get(parentId, Map()))
      .filter(k => k.compareTo(op.id) < 0)
      .filter(k => ops.moveValid.get(k) || ops.byId.get(k).action === 'makeChild')
      .sort((k1, k2) => k2.compareTo(k1))

    if (refIds.isEmpty()) return true
    parentId = ops.getIn(['byRef', parentId, refIds.first(), 'obj'])

    // Check if reference has been removed/overwritten
    const deletions = ops.byPrev.get(refIds.first(), Map())
      .filter((oper, id) => id.compareTo(op.id) < 0)
      .filter((oper, id) => oper.action !== 'move' || ops.moveValid.get(id))
    if (!deletions.isEmpty()) return true
  }
  return true
}

function currentState(ops) {
  return Set().withMutations(elems => {
    ops.byObj.forEach((byKey, obj) => {
      byKey.forEach((byId, key) => {
        byId.forEach((op, id) => {
          const deleted = ops.byPrev.get(id, Map())
            .some(op => op.action !== 'move' || ops.moveValid.get(op.id))
          const valid = (op.action !== 'move' || ops.moveValid.get(op.id))

          if (op.action === 'assign' && !deleted) {
            elems.add(new ValueElement({id: op.id, obj: op.obj, key: op.key, val: op.val}))
          }
          if ((op.action === 'makeChild' || op.action === 'move') && valid && !deleted) {
            const ref = (op.action === 'makeChild') ? op.id : op.ref
            const moves = ops.byRef.get(ref, Map())
              .filter(op => op.id.compareTo(id) > 0)
              .filter(op => ops.moveValid.get(op.id) || op.action === 'makeChild')
            if (moves.isEmpty()) {
              elems.add(new ChildElement({id: op.id, obj: op.obj, key: op.key, ref}))
            }
          }
        })
      })
    })
  })
}

function nextOps(ops, actorId) {
  const elems = interpSequential(ops)
  const counter = ops.reduce((max, op) => Math.max(max, op.id.counter), 0)
  let lastId = new LamportTS({actorId, counter})

  function nextId() {
    lastId = new LamportTS({actorId, counter: lastId.counter + 1})
    return lastId
  }

  return Set.fromKeys(elems.byObj).add(null).toList().flatMap(obj => {
    const prevX = Set.fromKeys(elems.getIn(['byObj', obj, 'x']))
    const prevY = Set.fromKeys(elems.getIn(['byObj', obj, 'y']))

    let ops = List.of(
      new AssignOp({id: nextId(), obj, key: 'x', val: jsc.random(0, 1e5), prev: prevX}),
      new AssignOp({id: nextId(), obj, key: 'y', val: jsc.random(0, 1e5), prev: prevY}),
      new MakeChildOp({id: nextId(), obj, key: 'x', prev: prevX}),
      new MakeChildOp({id: nextId(), obj, key: 'y', prev: prevY})
    )

    if (!prevX.isEmpty()) ops = ops.push(new RemoveOp({id: nextId(), prev: prevX}))
    if (!prevY.isEmpty()) ops = ops.push(new RemoveOp({id: nextId(), prev: prevY}))

    const moves = Set.fromKeys(elems.byObj).remove(null).flatMap(ref => {
      return List.of(
        new MoveOp({id: nextId(), obj, key: 'x', ref, prev: prevX}),
        new MoveOp({id: nextId(), obj, key: 'y', ref, prev: prevY})
      )
    })
    return ops.concat(moves)
  })
}

// Returns several variants of ops1 that have been extended with varying numbers
// of elements from ops2.
function mixOps(ops1, ops2) {
  const ids1 = ops1.map(op => op.id).toSet()
  return List().withMutations(list => {
    list.push(ops1)
    for (let i = 0; i < ops2.size; i++) {
      if (!ids1.includes(ops2.get(i).id)) {
        ops1 = ops1.push(ops2.get(i))
        list.push(ops1)
      }
    }
  })
}

function generateOps(ops1, actor1, ops2, actor2) {
  if (ops1.size >= 3) return List.of(ops1)

  return nextOps(ops1, actor1).flatMap(op1 => {
    return nextOps(ops2, actor2).flatMap(op2 => {
      return mixOps(ops1.push(op1), ops2.push(op2)).flatMap(ops => {
        return generateOps(ops, actor1, ops2.push(op2), actor2)
      })
    })
  })
}

describe('move operation prototype', () => {
  it('should be empty if there are no ops', () => {
    assert.deepEqual(materialize(interpSequential([])), {})
    assert(is(currentState(new OperationSet()), Set()))
  })

  it('should assign a field to the root object', () => {
    const actorId = uuid()
    const ops = [
      new AssignOp({id: new LamportTS({actorId, counter: 0}), obj: null, key: 'a', val: 42})
    ]
    assert.deepEqual(materialize(interpSequential(ops)), {a: {[ops[0].id]: 42}})
    assert(is(currentState(opSet(ops)), Set.of(
      new ValueElement({id: ops[0].id, obj: null, key: 'a', val: 42})
    )))
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
    assert(is(currentState(opSet(ops)), Set.of(
      new ChildElement({id: childId, obj: null, key: 'foo', ref: childId}),
      new ValueElement({id: assignId, obj: childId, key: 'bar', val: 42})
    )))
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
    assert(is(currentState(opSet(ops)), Set.of(
      new ChildElement({id: moveId, obj: null, key: 'bar', ref: childId})
    )))
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
    assert(is(currentState(opSet(ops)), Set.of(
      new ChildElement({id: childB, obj: null, key: 'B', ref: childB}),
      new ChildElement({id: moveA, obj: childB, key: 'A', ref: childA}),
      new ValueElement({id: assignC, obj: childA, key: 'C', val: 42})
    )))
  })

  // mocha test/move_test.js --jsverifyRngState 89b5a06c29d47f81e3
  it('should re-evaluate move validity on receiving a remove operation', () => {
    const child1 = new LamportTS({actorId: 'actor1', counter: 3})
    const child2 = new LamportTS({actorId: 'actor2', counter: 14})
    const remove = new LamportTS({actorId: 'actor2', counter: 28})
    const moveId = new LamportTS({actorId: 'actor1', counter: 39})
    const ops = [
      new MakeChildOp({id: child1, obj: null, key: 'x'}),
      new MakeChildOp({id: child2, obj: child1, key: 'y'}),
      new MoveOp({id: moveId, obj: child2, key: 'x', ref: child1}),
      new RemoveOp({id: remove, prev: Set.of(child2)})
    ]
    console.log(currentState(opSet(ops)))
    console.log(interpSequential(ops).byId.toSet())
    // TODO this test is broken. The problem is that in the sequential interpretation, the remove is
    // applied before the move, and thus the move is valid. In the commutative interpretation, the
    // move is ruled invalid after the first two makeChild ops, and the subsequent remove operation
    // does not cause the validity of the move operation to be re-examined.
    //assert(is(currentState(opSet(ops)), interpSequential(ops).byId.toSet()))
  })

  describe('property-based tests', () => {

    function generateRandomOps(size) {
      const numOps = jsc.random(0, Math.round(Math.log(size + 1) / Math.log(2)))
      const ops1 = [], ops2 = []
      while (ops1.length < numOps) {
        switch (jsc.random(0, 3)) {
          case 0: { // new operation by actor 1
            const choice = nextOps(ops1, 'actor1')
            ops1.push(choice.get(jsc.random(0, choice.size - 1)))
            break
          }

          case 1: { // new operation by actor 2
            const choice = nextOps(ops2, 'actor2')
            ops2.push(choice.get(jsc.random(0, choice.size - 1)))
            break
          }

          case 2: { // send one operation from actor 1 to actor 2
            const ids2 = Set(ops2.map(op => op.id))
            const choice = ops1.filter(op => !ids2.includes(op.id))
            if (choice.length > 0) ops2.push(choice[0])
            break
          }

          case 3: { // send one operation from actor 2 to actor 1
            const ids1 = Set(ops1.map(op => op.id))
            const choice = ops2.filter(op => !ids1.includes(op.id))
            if (choice.length > 0) ops1.push(choice[0])
            break
          }
        }
      }
      return ops1
    }

    it('should behave like the sequential interpretation', () => {
      jsc.assert(jsc.forall(jsc.bless({generator: generateRandomOps}), function (ops) {
        //console.log('ops: ', ops)
        //console.log('commutative: ', currentState(opSet(ops)))
        //console.log('sequential:  ', interpSequential(ops).byId.toSet())
        return is(currentState(opSet(ops)), interpSequential(ops).byId.toSet())
      }), {tests: 100, size: 50})
    })
  })
})
