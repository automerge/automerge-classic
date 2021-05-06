import { List, Map } from "immutable"
import * as immutable from "immutable"
import { inspect } from "util"
import * as Backend from "../backend"
import { deepStrictEqual, strictEqual } from "assert"

let uuid = require("../src/uuid")

// TODO - critical
//
// applyPatch
// request queueing
// inc
//
// TODO - important
//
// text
// table
// cursors
//
// TODO - less important
//
// set (nested values)
// duplicate the old frontend interface

type OpId = string
type ElemId = string
type ObjectId = string
type Hash = string

type BinaryChange = Uint8Array & { __binaryChange: true }

type CollectionType =
  | 'list' //..
  | 'map'
  | 'table'
  | 'text'

type DataType =
  | 'counter' //..
  | 'timestamp'

interface Clock {
  [actorId: string]: number
}

type Request = Change

interface Change {
  message: string
  actor: string
  time: number
  seq: number
  startOp: number // missing
  deps: Hash[]
  ops: Op[]
}

interface Patch {
  actor?: string
  seq?: number
  maxOp: number // missing
  pendingChanges: number
  clock: Clock
  deps: Hash[]
  diffs: ObjectDiff
}

interface ObjectDiff {
  objectId: OpId
  type: CollectionType
  edits?: Edit[]
  props?: {[propName: string]: {[opId: string]: ObjectDiff | ScalarVal }}
}

interface Edit {
  action: 'insert' | 'remove'
  index: number
  elemId: OpId
}

function log(val)  {
  console.log(inspect(val,false,null,true))
}

interface OpIdStruct {
  counter: number
  actorId: string
}

interface FrontendOptions {
  backend?: any
  actor?: string
}

function parseOpId(opId: OpId): OpIdStruct {
  const match = /^(\d+)@(.*)$/.exec(opId || '')
  if (!match) {
    throw new RangeError(`Not a valid opId: ${opId}`)
  }
  return {counter: parseInt(match[1]), actorId: match[2]}
}

function lamportCompare(ts1: OpId, ts2: OpId) : number {
  const regex = /^(\d+)@(.*)$/
  const time1 = regex.test(ts1) ? parseOpId(ts1) : {counter: 0, actorId: ts1}
  const time2 = regex.test(ts2) ? parseOpId(ts2) : {counter: 0, actorId: ts2}
  if (time1.counter < time2.counter) return -1
  if (time1.counter > time2.counter) return  1
  if (time1.actorId < time2.actorId) return -1
  if (time1.actorId > time2.actorId) return  1
  return 0
}

type Val = MapVal | ListVal | ScalarVal

  /*
  string,
  number,
  ScalarVal
   */

namespace Value {
  export const Map = Symbol("_map")
  export const List = Symbol("_map")
  export function Counter(value: number) : ScalarVal {
    return { value, datatype: "counter" }
  }
  export function Datetime(value: number) : ScalarVal {
    return { value, datatype: "timestamp" }
  }
}

interface ScalarVal {
  value: number | boolean | string | null
  datatype?: DataType
}

interface MapVal {
  type: "map" | "table"
  objectId: string
  props: Map<string, Map<OpId, Val>>
}

interface ListVal {
  type: "list" | "text"
  objectId: string
  elems: List<ElemId>
  props: Map<ElemId, Map<OpId, Val>>
}

interface Op {
  obj: ObjectId
  action: string
  key?: string
  elemId?: string
  value?: string | number | null | boolean | null
  datatype?: string
  insert: boolean
  pred: OpId[]
}

function makeMapOp(obj: MapVal, action: string, key: string, val?: ScalarVal) : Op {
  let value = val || {}
  let objectId = obj.objectId
  let pred = obj.props.get(key, Map()).keySeq().toArray()
  let op = { action, obj: objectId, key, ... value, insert: false, pred }
  return op
}

function makeListOp(obj: ListVal, action: string, elemId: ElemId, insert: boolean, val?: ScalarVal) : Op {
  let value = val || {}
  let objectId = obj.objectId
  let pred = obj.props.get(elemId, Map()).keySeq().toArray()
  return { action, obj: objectId, elemId, ... value, insert, pred }
}

  /*
function ctx(val: Val, frontend: LowLevelFrontend, update?: (val) => void) : MapCtx {
  return new MapCtx(val, frontend, update)
}
   */

class Ctx {
  val: Val
  frontend: LowLevelFrontend
  update: (val) => void

  constructor(val: Val, frontend: LowLevelFrontend, update?: (val) => void) {
    this.val = val
    this.frontend = frontend
    this.update = update
  }

  protected nextOpId() : OpId {
    return `${this.frontend.ops.length + this.frontend.maxOp + 1}@${this.frontend.actor}`
  }

  protected pushOp(op: Op) {
    if (this.frontend.ops === null) { throw new Error("cannot set outside of a begin block") }
    this.frontend.ops.push(op)
  }

  value() : any {
      return null
  }

  asScalar() : ScalarCtx { return null }
  asMap() : MapCtx { return null }
  asList() : ListCtx { return null }
}

class ScalarCtx extends Ctx {
  val: ScalarVal;

  constructor(val: ScalarVal, frontend: LowLevelFrontend, update?: (val) => void) {
    super(val,frontend,update)
    this.val = val
  }

  value() : any {
      return this.val.value
  }

  asScalar() : ScalarCtx { return this }
}

function newMap(objectId: OpId) : MapVal {
  return { type: "map", objectId, props: Map() }
}

function newList(objectId: OpId) : ListVal {
  return { type: "list", objectId, elems: List(), props: Map() }
}

class ListCtx extends Ctx {
  val: ListVal;

  constructor(val: ListVal, frontend: LowLevelFrontend, update?: (val) => void) {
    super(val,frontend,update)
    this.val = val
  }

  private indexToElem(index: number, insert: boolean) : ElemId {
    if (insert) {
        return index === 0 ? "_head" :  this.val.elems.get(index - 1)
    } else {
      return this.val.elems.get(index)
    }
  }

  private handleSet(opId: OpId, index: number, action: string, insert: boolean, val?: Val, scalar?: ScalarVal) : ListCtx {
    let key = this.indexToElem(index, insert)
    this.pushOp(makeListOp(this.val, action, key, insert, scalar))
    if (!val) {
      let props = this.val.props.delete(key)
      let elems = this.val.elems.delete(index)
      this.val = { ... this.val, elems, props }
    } else if (insert) {
      let props = this.val.props.set(opId, Map({ [opId]: val }))
      let elems = this.val.elems.insert(index, opId)
      this.val = { ... this.val, elems, props }
    } else {
      let props = this.val.props.set(key, Map({ [opId]: val }))
      this.val = { ... this.val, props }
    }
    this.update(this.val)
    return this
  }

  insert(index: number , value: any) : ListCtx {
    return this.set(index, value, true)
  }

  del(index: number) : ListCtx {
    let opId = this.nextOpId()
    return this.handleSet(opId, index, 'del', false)
  }

  set(index: number , value: any, insert: boolean = false) : ListCtx {
    let opId = this.nextOpId()
    if (value === Value.Map) {
      return this.handleSet(opId, index, 'makeMap', insert, newMap(opId))
    } else if (value === Value.List) {
      return this.handleSet(opId, index, 'makeList', insert, newList(opId))
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      return this.handleSet(opId, index, 'set', insert, { value }, { value })
    } else if (typeof value.datatype !== 'undefined' && typeof value.value !== 'undefined') {
      return this.handleSet(opId, index, 'set', insert, value, value)
    } else {
      throw Error(`cannot set type for ${value}`)
    }
  }

  value() : any {
    return this.val.elems.map((val,i) => this.get(i).value()).toJS()
  }

  get(index: number) : Ctx {
    let val = this.val
    let elemId = val.elems.get(index)
    let opId = val.props.get(elemId, Map()).keySeq().toArray().sort(lamportCompare)[0]
    if (!opId) { return null }
    let subval = this.val.props.getIn([elemId, opId])
    let updater = (child) => {
      this.val = { ... val, props: val.props.set(elemId,Map({ [opId] : child }))}
      this.update(this.val)
    }
    switch (subval.type) {
      case "map":
      case "table":
        return new MapCtx(subval, this.frontend, updater)
      case "list":
      case "text":
        return new ListCtx(subval, this.frontend, updater)
      default:
        return new ScalarCtx(subval, this.frontend, null)
    }
  }

  getScalar(index: number) : ScalarCtx {
    let ctx = this.get(index)
    return ctx && ctx.asScalar()
  }

  getMap(index: number) : MapCtx {
    let ctx = this.get(index)
    return ctx && ctx.asMap()
  }

  getList(index: number) : ListCtx {
    let ctx = this.get(index)
    return ctx && ctx.asList()
  }

  asList() : ListCtx { return this }
}

class MapCtx extends Ctx {
  val: MapVal;

  constructor(val: MapVal, frontend: LowLevelFrontend, update?: (val) => void) {
    super(val,frontend,update)
    this.val = val
  }

  private handleSet(opId: OpId, key: string, action: string, val?: Val, scalar?: ScalarVal) : MapCtx {
    this.pushOp(makeMapOp(this.val, action, key, scalar))
    if (val) {
      this.val = { ... this.val, props: this.val.props.set(key, Map({ [opId]: val })) }
    } else {
      this.val = { ... this.val, props: this.val.props.delete(key) }
    }
    this.update(this.val)
    return this
  }

  set(key: string , value: any) {
    let opId = this.nextOpId()
    if (value === Value.Map) {
      return this.handleSet(opId, key, "makeMap", newMap(opId))
    } else if (value === Value.List) {
      return this.handleSet(opId, key, "makeList", newList(opId))
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
      return this.handleSet(opId, key, "set", { value }, { value })
    } else if (typeof value.datatype !== 'undefined' && typeof value.value !== 'undefined') {
      return this.handleSet(opId, key, "set", value, value)
    } else {
      throw Error(`cannot set type for ${value}`)
    }
  }

  del(key: string) : MapCtx {
    let opId = this.nextOpId()
    return this.handleSet(opId, key, "del")
  }

  value() : any {
    return this.val.props.mapEntries(([prop,_]) => [prop, this.get(prop).value()]).toJS()
  }

  get(key: string) : Ctx {
    let val = this.val
    let opId = val.props.get(key, Map()).keySeq().toArray().sort(lamportCompare)[0]
    if (!opId) { return null }
    let subval = this.val.props.getIn([key, opId])
    let updater = (child) => {
      this.val = { ... val, props: val.props.set(key,Map({ [opId] : child }))}
      this.update(this.val)
    }
    switch (subval.type) {
      case "map":
      case "table":
        return new MapCtx(subval, this.frontend, updater)
      case "list":
      case "text":
        return new ListCtx(subval, this.frontend, updater)
      default:
        return new ScalarCtx(subval, this.frontend, null)
    }
  }

  getScalar(key: string) : ScalarCtx {
    let ctx = this.get(key)
    return ctx && ctx.asScalar()
  }

  getMap(key: string) : MapCtx {
    let ctx = this.get(key)
    return ctx && ctx.asMap()
  }

  getList(key: string) : ListCtx {
    let ctx = this.get(key)
    return ctx && ctx.asList()
  }

  asMap() : MapCtx { return this }
}

class LowLevelFrontend {
  actor: string;
  maxOp: number;
  seq: number;
  backend: any;
  clock: Clock
  deps: Hash[]
  roots: MapVal[];
  ops: Op[];
  pendingChanges: number
  ctx?: MapCtx;

  private rootCtx() : MapCtx {
    return new MapCtx(this.roots[0], this, (val) => { this.roots[0] = val })
  }

  get(prop: string) : Ctx {
    return this.rootCtx().get(prop)
  }

  getMap(prop: string) : MapCtx {
    return this.rootCtx().getMap(prop)
  }

  getList(prop: string) : ListCtx {
    return this.rootCtx().getList(prop)
  }

  set(prop: string, value: any) {
    return this.rootCtx().set(prop,value)
  }

  del(prop: string) {
    return this.rootCtx().del(prop)
  }

  private createNewVal(diff: ObjectDiff) : MapVal | ListVal {
    return null
  }

  private interpretDiff(val: Val | null, diff: ObjectDiff|ScalarVal ) : Val {
    if ("type" in diff) {
      // this is a ObjectDiff
      if (val !== null && "type" in val && val.objectId !== diff.objectId) {
        throw new Error("objets out of sync - something happened")
      }
      if (diff.type === "list" || diff.type === "text") {
          return this.interpretListDiff(val as ListVal, diff)
      } else {
          return this.interpretMapDiff(val as MapVal, diff)
      }
    } else {
      // this is a ScalarValue so just return it
      return diff
    }
  }

  private interpretListDiff(val: ListVal | null, diff: ObjectDiff) : ListVal {
    // FIXME - list or text
    //val = val || { type: diff.type, objectId: diff.objectId, elems: List(), props: Map() }
    val = val || { type: "list", objectId: diff.objectId, elems: List(), props: Map() }
    let elems = val.elems
    let props = val.props
    for (let edit of (diff.edits || [])) {
      switch (edit.action) {
        case "insert":
          elems = elems.insert(edit.index, edit.elemId)
          break
        case "remove":
          // TODO - need to delete an element from an old commit - make sure it works
          props = props.delete(elems.get(edit.index))
          elems = elems.delete(edit.index)
          break
      } 
    }
    props = props.merge(Map(
      Object.entries(diff.props || {}).map(([index,values]) => {
        let elemId = elems.get(+index)
        return [ elemId, Map(Object.entries(values).map(([opid,value]) =>
          [opid, this.interpretDiff(props.getIn([elemId,opid],null), value)]
        ))]
      })
    ))
    return { ... val, elems, props }
  }

  private interpretMapDiff(val: MapVal | null, diff: ObjectDiff) : MapVal {
    //FIXME - map or table
    //val = val || { type: diff.type, objectId: diff.objectId, props: Map() }
    val = val || { type: "map", objectId: diff.objectId, props: Map() }
    let props = val.props
    Object.entries(diff.props || {}).forEach(([prop,values]) => {
      let updated : Map<OpId,Val> = Map(Object.entries(values).map(([opid,value]) =>
        [opid, this.interpretDiff(props.getIn([prop,opid],null), value)]
      ))
      if (updated.size === 0) {
        props = props.delete(prop)
      } else {
        props = props.set(prop, updated)
      }
    })
    return { ... val, props }
  }

  applyPatch(patch: Patch) {
    if (this.seq && this.roots.length < 2) {
      throw new Error("Cannot apply a patch - out of sync")
    }
    this.clock = patch.clock
    this.maxOp = Math.max(this.maxOp, patch.maxOp)
    this.deps = patch.deps
    this.pendingChanges = patch.pendingChanges

    let root = this.roots.pop()
    if (patch.seq) {
      // this is a local patch
      root = this.interpretDiff(root,patch.diffs) as MapVal
      let optimisticRoot = this.roots.pop() // normally we toss this
      // make sure this works!
      let val1 = (new MapCtx(root, null, null)).value()
      let val2 = (new MapCtx(optimisticRoot, null, null)).value()
      deepStrictEqual(val1, val2) // debug
    }
    this.roots.push(root)
  }

  begin() {
    if (this.ops !== null) {
      throw new Error("Change in progress - commit or rollback first")
    }
    // clone the newest root object
    this.roots.unshift({ ... this.roots[0] })
    this.ops = []
  }

  rollback() {
    if (this.ops === null) {
      throw new Error("No change in progress - cannot rollback")
    }
    this.roots.shift();
    this.ops = null
  }

  commit() : [ Request, BinaryChange ] {
    if (this.ops === null) {
      throw new Error("No change in progress - cannot commit")
    }
    this.seq += 1
    let request : Request = {
      actor: this.actor,
      message: "",
      seq: this.seq,
      startOp: this.maxOp + 1,
      time: 0,
      deps: [],
      ops: this.ops
    }
    this.clock[this.actor] = this.seq
    this.maxOp = this.maxOp + this.ops.length
    this.ops = null
    if (this.backend) {
      let [ backend, patch, change ] = Backend.applyLocalChange(this.backend, request)
      this.backend = backend
      this.applyPatch(patch)
      return [ request, change ]
    } else {
      return [ request, null ]
    }
  }

  value() : any {
    return this.rootCtx().value()
  }

  constructor(opts: FrontendOptions = {}) {
    this.roots = [ newMap("_root") ]
    this.actor = opts.actor || uuid()
    this.backend = opts.backend || null
    this.clock = {[this.actor]: 0}
    this.deps = []
    this.ops = null
    this.maxOp = 0
    this.pendingChanges = 0
    this.seq = 0
    this.ctx = null
  }
}


let backend = Backend.init()
let frontend = new LowLevelFrontend({ backend })
let request, change
frontend.begin()
frontend.set("hello", "world")
frontend.set("hello", "world2")
frontend.set("hello", "world3")
frontend.set("number", 127)
frontend.set("boolean", true)
frontend.set("null", null)
frontend.set("tmp", "xxx")
frontend.set("sub", Value.Map).getMap("sub").set("key","val")
frontend.getMap("sub").set("subsub",Value.Map).getMap("subsub").set("foo","bar")
frontend.set("items", Value.List)
frontend.getList("items").insert(0,"dog").insert(0,"bat").insert(1,"zebra").set(1,"sumo").set(1,Value.Map).getMap(1).set("a","AAA")
frontend.getList("items").insert(1,"xxx")
;[ request, change ] = frontend.commit()
log(request)
log(frontend.value())
frontend.begin()
frontend.del("tmp")
frontend.getList("items").del(1)
;[ request, change ] = frontend.commit()
//log(request)

//frontend.rollback()

strictEqual(frontend.roots.length, 1)
log(frontend.value())

