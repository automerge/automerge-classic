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

  function init<T>(options?: InitOptions): Doc<T>
  function from<T>(initialState: T | Doc<T>, options?: InitOptions): Doc<T>

  type InitOptions =
    | string // = actorId
    | { 
      actorId?: string
      deferActorId?: boolean
      freeze?: boolean 
    }

  function merge<T>(localdoc: Doc<T>, remotedoc: Doc<T>): Doc<T>

  function change<D, T = Proxy<D>>(doc: D, message: string, callback: ChangeFn<T>): D
  function change<D, T = Proxy<D>>(doc: D, callback: ChangeFn<T>): D
  function emptyChange<D extends Doc<any>>(doc: D, message?: string): D
  function applyChanges<T>(doc: Doc<T>, changes: Uint8Array[]): Doc<T>
  function equals<T>(val1: T, val2: T): boolean
  function encodeChange(change: Change): Uint8Array
  function decodeChange(binaryChange: Uint8Array): Change[]

  function getActorId<T>(doc: Doc<T>): string
  function getAllChanges<T>(doc: Doc<T>): Uint8Array[]
  function getChanges<T>(olddoc: Doc<T>, newdoc: Doc<T>): Uint8Array[]
  function getConflicts<T>(doc: Doc<T>, key: keyof T): any
  function getHistory<D, T = Proxy<D>>(doc: Doc<T>): State<T>[]
  function getMissingDeps<T>(doc: Doc<T>): Clock
  function getObjectById<T>(doc: Doc<T>, objectId: UUID): any
  function getObjectId(object: any): UUID

  function load<T>(doc: string, options?: any): Doc<T>
  function save<T>(doc: Doc<T>): string

  function canRedo<T>(doc: Doc<T>): boolean
  function canUndo<T>(doc: Doc<T>): boolean

  function redo<T>(doc: Doc<T>, message?: string): Doc<T>
  function undo<T>(doc: Doc<T>, message?: string): Doc<T>

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
    function canRedo<T>(doc: Doc<T>): boolean
    function canUndo<T>(doc: Doc<T>): boolean
    function change<D, T = Proxy<D>>(doc: D, message: string | undefined, callback: ChangeFn<T>): [D, Request]
    function change<D, T = Proxy<D>>(doc: D, callback: ChangeFn<T>): [D, Request]
    function emptyChange<T>(doc: Doc<T>, message?: string): [Doc<T>, Request]
    function from<T>(initialState: T | Doc<T>, options?: InitOptions): [Doc<T>, Request]
    function getActorId<T>(doc: Doc<T>): string
    function getBackendState<T>(doc: Doc<T>): BackendState
    function getConflicts<T>(doc: Doc<T>, key: keyof T): any
    function getObjectById<T>(doc: Doc<T>, objectId: UUID): Doc<T>
    function getObjectId<T>(doc: Doc<T>): UUID
    function init<T>(options?: InitOptions): Doc<T>
    function redo<T>(doc: Doc<T>, message?: string): [Doc<T>, Request]
    function setActorId<T>(doc: Doc<T>, actorId: string): Doc<T>
    function undo<T>(doc: Doc<T>, message?: string): [Doc<T>, Request]
  }

  namespace Backend {
    function applyChanges(state: BackendState, changes: Uint8Array[]): [BackendState, Patch]
    function applyLocalChange(state: BackendState, request: Request): [BackendState, Patch]
    function getChanges(state: BackendState, clock: Clock): Uint8Array[]
    function getChangesForActor(state: BackendState, actorId: string): Uint8Array[]
    function getMissingDeps(state: BackendState): Clock
    function getPatch(state: BackendState): Patch
    function init(): BackendState
  }

  // Internals

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

  // A change request, sent from the frontend to the backend
  interface Request {
    requestType: RequestType
    actor: string
    seq: number
    time: number
    message: string
    version: number
    ops: Op[]
  }

  interface Change {
    message?: string
    actor: string
    seq: number
    deps: Clock
    ops: Op[]
  }

  interface Op {
    action: OpAction
    obj: UUID
    key: string | number
    insert?: boolean
    child?: UUID
    value?: number | boolean | string | null
    datatype?: DataType
  }

  interface Patch {
    actor?: string
    seq?: number
    clock?: Clock
    version: number
    canUndo?: boolean
    canRedo?: boolean
    diffs: ObjectDiff
  }

  interface ObjectDiff {
    objectId: UUID
    type: CollectionType
    edits?: Edit[]
    props?: {[propName: string]: {[actorId: string]: ObjectDiff | ValueDiff}}
  }

  interface ValueDiff {
    value: number | boolean | string | null
    datatype?: DataType
  }

  interface Edit {
    action: 'insert' | 'remove'
    index: number
  }

  type RequestType =
    | 'change' //..
    | 'redo'
    | 'undo'

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

  type Lookup<T, K> = K extends keyof T ? T[K] : never
}
