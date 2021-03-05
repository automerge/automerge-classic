declare module 'automerge' {
  /**
   * The return type of `Automerge.init<T>()`, `Automerge.change<T>()`, etc. where `T` is the
   * original type. It is a recursively frozen version of the original type.
   */
  type Doc<T> = FreezeObject<T>

  /**
   * The argument pased to the callback of a `change` function is a mutable proxy of the original
   * type. `Proxy<D>` is the inverse of `Doc<T>`: `Proxy<Doc<T>>` is `T`, and `Doc<Proxy<D>>` is `D`.
   */
  type Proxy<D> = D extends Doc<infer T> ? T : never

  type ChangeFn<T> = (doc: T) => void

  // Automerge.* functions

  function init<T>(options?: InitOptions<T>): Doc<T>
  function from<T>(initialState: T | Doc<T>, options?: InitOptions<T>): Doc<T>
  function clone<T>(doc: Doc<T>): Doc<T>
  function free<T>(doc: Doc<T>): void

  type InitOptions<T> =
    | string // = actorId
    | { 
      actorId?: string
      deferActorId?: boolean
      freeze?: boolean
      patchCallback?: PatchCallback<T>
      observable?: Observable
    }

  type ChangeOptions<T> =
    | string // = message
    | {
      message?: string
      time?: number
      patchCallback?: PatchCallback<T>
    }

  type PatchCallback<T> = (patch: Patch, before: T, after: T, local: boolean, changes: Uint8Array[]) => void
  type ObserverCallback<T> = (diff: ObjectDiff, before: T, after: T, local: boolean, changes: Uint8Array[]) => void

  class Observable {
    observe<T>(object: T, callback: ObserverCallback<T>): void
  }

  function merge<T>(localdoc: Doc<T>, remotedoc: Doc<T>): Doc<T>

  function change<D, T = Proxy<D>>(doc: D, options: ChangeOptions<T>, callback: ChangeFn<T>): D
  function change<D, T = Proxy<D>>(doc: D, callback: ChangeFn<T>): D
  function emptyChange<D extends Doc<any>>(doc: D, options?: ChangeOptions<D>): D
  function applyChanges<T>(doc: Doc<T>, changes: Uint8Array[]): Doc<T>
  function equals<T>(val1: T, val2: T): boolean
  function encodeChange(change: Change): Uint8Array
  function decodeChange(binaryChange: Uint8Array): Change

  function getActorId<T>(doc: Doc<T>): string
  function getAllChanges<T>(doc: Doc<T>): Uint8Array[]
  function getChanges<T>(olddoc: Doc<T>, newdoc: Doc<T>): Uint8Array[]
  function getConflicts<T>(doc: Doc<T>, key: keyof T): any
  function getCurrentVersion<T>(doc: Doc<T>): Uint8Array
  function getHistory<D, T = Proxy<D>>(doc: Doc<T>): State<T>[]
  function getMissingDeps<T>(doc: Doc<T>): Hash[]
  function getObjectById<T>(doc: Doc<T>, objectId: OpId): any
  function getObjectId(object: any): OpId

  function startSync<T>(doc: Doc<T>, initState?: Uint8Array): Sync
  function finishSync<T>(doc: Doc<T>, sync: Sync, options?: ChangeOptions<T>): Doc<T>
  function load<T>(data: Uint8Array, options?: any): Doc<T>
  function save<T>(doc: Doc<T>): Uint8Array

  class Sync {
    readonly messageToSend: Uint8Array | undefined
    readonly isFinished: boolean
    processMessage(message: Uint8Array): Uint8Array | undefined
  }

  // custom CRDT types

  class TableRow {
    readonly id: UUID
  }

  class Table<T> {
    constructor()
    add(item: T): UUID
    byId(id: UUID): T & TableRow
    count: number
    ids: UUID[]
    remove(id: UUID): void
    rows(): (T & TableRow)[]
  }

  class List<T> extends Array<T> {
    insertAt?(index: number, ...args: T[]): List<T>
    deleteAt?(index: number, numDelete?: number): List<T>
  }

  class Text extends List<string> {
    constructor(text?: string | string[])
    get(index: number): string
    toSpans<T>(): (string | T)[]
  }

  // Note that until https://github.com/Microsoft/TypeScript/issues/2361 is addressed, we
  // can't treat a Counter like a literal number without force-casting it as a number.
  // This won't compile:
  //   `assert.strictEqual(c + 10, 13) // Operator '+' cannot be applied to types 'Counter' and '10'.ts(2365)`
  // But this will:
  //   `assert.strictEqual(c as unknown as number + 10, 13)`
  class Counter extends Number {
    constructor(value?: number)
    increment(delta?: number): void
    decrement(delta?: number): void
    toString(): string
    valueOf(): number
    value: number
  }

  // Readonly variants

  type ReadonlyTable<T> = ReadonlyArray<T> & Table<T>
  type ReadonlyList<T> = ReadonlyArray<T> & List<T>
  type ReadonlyText = ReadonlyList<string> & Text

  // Front & back

  namespace Frontend {
    function applyPatch<T>(doc: Doc<T>, patch: Patch): Doc<T>
    function change<D, T = Proxy<D>>(doc: D, message: string | undefined, callback: ChangeFn<T>): [D, Change]
    function change<D, T = Proxy<D>>(doc: D, callback: ChangeFn<T>): [D, Change]
    function emptyChange<T>(doc: Doc<T>, message?: string): [Doc<T>, Change]
    function from<T>(initialState: T | Doc<T>, options?: InitOptions<T>): [Doc<T>, Change]
    function getActorId<T>(doc: Doc<T>): string
    function getBackendState<T>(doc: Doc<T>): BackendState
    function getConflicts<T>(doc: Doc<T>, key: keyof T): any
    function getElementIds(list: any): string[]
    function getLastLocalChange<T>(doc: Doc<T>): Uint8Array
    function getObjectById<T>(doc: Doc<T>, objectId: OpId): Doc<T>
    function getObjectId<T>(doc: Doc<T>): OpId
    function init<T>(options?: InitOptions<T>): Doc<T>
    function setActorId<T>(doc: Doc<T>, actorId: string): Doc<T>
  }

  namespace Backend {
    function applyChanges(state: BackendState, changes: Uint8Array[]): [BackendState, Patch]
    function applyLocalChange(state: BackendState, change: Change): [BackendState, Patch, Uint8Array]
    function clone(state: BackendState): BackendState
    function free(state: BackendState): void
    function getAllChanges(state: BackendState): Uint8Array[]
    function getChanges(state: BackendState, haveDeps: Hash[]): Uint8Array[]
    function getCurrentVersion(state: BackendState): Uint8Array[]
    function getHeads(state: BackendState): Hash[]
    function getMissingDeps(state: BackendState): Hash[]
    function getPatch(state: BackendState): Patch
    function init(): BackendState
    function load(data: Uint8Array): BackendState
    function loadChanges(state: BackendState, changes: Uint8Array[]): BackendState
    function save(state: BackendState): Uint8Array
    function startSync(state: BackendState, initState?: Uint8Array): Sync
  }

  // Internals

  type Hash = string // 64-digit hex string
  type OpId = string // of the form `${counter}@${actorId}`

  type UUID = string
  type UUIDGenerator = () => UUID
  interface UUIDFactory extends UUIDGenerator {
    setFactory: (generator: UUIDGenerator) => void
    reset: () => void
  }
  const uuid: UUIDFactory

  interface Clock {
    [actorId: string]: number
  }

  interface State<T> {
    change: Change
    snapshot: T
  }

  interface BackendState {
    // no public methods or properties
  }

  interface Change {
    message: string
    actor: string
    time: number
    seq: number
    deps: Hash[]
    ops: Op[]
  }

  interface Op {
    action: OpAction
    obj: OpId
    key: string | number
    insert: boolean
    child?: OpId
    value?: number | boolean | string | null
    datatype?: DataType
    pred?: OpId[]
  }

  interface Patch {
    actor?: string
    seq?: number
    clock: Clock
    deps: Hash[]
    diffs: ObjectDiff
  }

  interface ObjectDiff {
    objectId: OpId
    type: CollectionType
    edits?: Edit[]
    props?: {[propName: string]: {[opId: string]: ObjectDiff | ValueDiff}}
  }

  interface ValueDiff {
    value: number | boolean | string | null
    datatype?: DataType
  }

  interface Edit {
    action: 'insert' | 'remove'
    index: number
    elemId: OpId
  }

  type OpAction =
    | 'del'
    | 'inc'
    | 'set'
    | 'link'
    | 'makeText'
    | 'makeTable'
    | 'makeList'
    | 'makeMap'

  type CollectionType =
    | 'list' //..
    | 'map'
    | 'table'
    | 'text'

  type DataType =
    | 'counter' //..
    | 'timestamp'

  // TYPE UTILITY FUNCTIONS

  // Type utility function: Freeze
  // Generates a readonly version of a given object, array, or map type applied recursively to the nested members of the root type.
  // It's like TypeScript's `readonly`, but goes all the way down a tree.

  // prettier-ignore
  type Freeze<T> =
    T extends Function ? T
    : T extends Text ? ReadonlyText
    : T extends Table<infer T> ? FreezeTable<T>
    : T extends List<infer T> ? FreezeList<T>
    : T extends Array<infer T> ? FreezeArray<T>
    : T extends Map<infer K, infer V> ? FreezeMap<K, V>
    : T extends string & infer O ? string & O
    : FreezeObject<T>

  interface FreezeTable<T> extends ReadonlyTable<Freeze<T>> {}
  interface FreezeList<T> extends ReadonlyList<Freeze<T>> {}
  interface FreezeArray<T> extends ReadonlyArray<Freeze<T>> {}
  interface FreezeMap<K, V> extends ReadonlyMap<Freeze<K>, Freeze<V>> {}
  type FreezeObject<T> = { readonly [P in keyof T]: Freeze<T[P]> }
}
