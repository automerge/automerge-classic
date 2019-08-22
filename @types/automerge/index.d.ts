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
  function applyChanges<T>(doc: Doc<T>, changes: Change[]): Doc<T>
  function diff<D extends Doc<any>>(olddoc: D, newdoc: D): Diff[]
  function equals<T>(val1: T, val2: T): boolean

  function getActorId<T>(doc: Doc<T>): string
  function getChanges<T>(olddoc: Doc<T>, newdoc: Doc<T>): Change[]
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

  class Table<T, KeyOrder extends Array<keyof T>> extends Array<T> {
    constructor(columns: KeyArray<T, KeyOrder>)
    add(item: T | TupleFromInterface<T, KeyOrder>): UUID
    byId(id: UUID): T
    columns: string[]
    count: number
    ids: UUID[]
    remove(id: UUID): void
    rows(): T[]
    set(id: UUID, value: T): void
    set(id: 'columns', value: string[]): void
  }

  class List<T> extends Array<T> {
    insertAt?(index: number, ...args: T[]): List<T>
    deleteAt?(index: number, numDelete?: number): List<T>
  }

  class Text extends List<string> {
    constructor(objectId?: UUID, elems?: string[], maxElem?: number)
    get(index: number): string
    getElemId(index: number): string
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

  type ReadonlyTable<T, KeyOrder extends Array<keyof T>> = ReadonlyArray<T> & Table<T, KeyOrder>
  type ReadonlyList<T> = ReadonlyArray<T> & List<T>
  type ReadonlyText = ReadonlyList<string> & Text

  // Utility classes

  class Connection<T> {
    constructor(docSet: DocSet<T>, sendMsg: (msg: Message) => void)
    close(): void
    docChanged(docId: string, doc: Doc<T>): void
    maybeSendChanges(docId: string): void
    open(): void
    receiveMsg(msg: Message): Doc<T>
    sendMsg(docId: string, clock: Clock, changes: Change[]): void
  }

  type DocSetHandler<T> = (docId: string, doc: Doc<T>) => void
  class DocSet<T> {
    constructor()
    applyChanges(docId: string, changes: Change[]): T
    getDoc(docId: string): Doc<T>
    removeDoc(docId: string): void
    setDoc(docId: string, doc: Doc<T>): void
    docIds: string[]
    registerHandler(handler: DocSetHandler<T>): void
    unregisterHandler(handler: DocSetHandler<T>): void
  }

  type WatchableDocHandler<T> = (doc: Doc<T>) => void
  class WatchableDoc<D, T = Proxy<D>> {
    constructor(doc: D)
    applyChanges(changes: Change[]): D
    get(): D
    set(doc: D): void
    registerHandler(handler: WatchableDocHandler<T>): void
    unregisterHandler(handler: WatchableDocHandler<T>): void
  }

  // Front & back

  namespace Frontend {
    function applyPatch<T>(doc: Doc<T>, patch: Patch): Doc<T>
    function canRedo<T>(doc: Doc<T>): boolean
    function canUndo<T>(doc: Doc<T>): boolean
    function change<D, T = Proxy<D>>(
      doc: D,
      message: string | undefined,
      callback: ChangeFn<T>
    ): [T, Change]
    function change<D, T = Proxy<D>>(doc: D, callback: ChangeFn<T>): [D, Change]
    function emptyChange<T>(doc: Doc<T>, message?: string): [Doc<T>, Change]
    function from<T>(initialState: T | Doc<T>, options?: InitOptions): [Doc<T>, Change]
    function getActorId<T>(doc: Doc<T>): string
    function getBackendState<T>(doc: Doc<T>): BackendState
    function getConflicts<T>(doc: Doc<T>, key: keyof T): any
    function getElementIds(list: any): string[]
    function getObjectById<T>(doc: Doc<T>, objectId: UUID): Doc<T>
    function getObjectId<T>(doc: Doc<T>): UUID
    function init<T>(options?: InitOptions): Doc<T>
    function redo<T>(doc: Doc<T>, message?: string): [Doc<T>, Change]
    function setActorId<T>(doc: Doc<T>, actorId: string): Doc<T>
    function undo<T>(doc: Doc<T>, message?: string): [Doc<T>, Change]
  }

  namespace Backend {
    function applyChanges(state: BackendState, changes: Change[]): [BackendState, Patch]
    function applyLocalChange(state: BackendState, change: Change): [BackendState, Patch]
    function getChanges(oldState: BackendState, newState: BackendState): Change[]
    function getChangesForActor(state: BackendState, actorId: string): Change[]
    function getMissingChanges(state: BackendState, clock: Clock): Change[]
    function getMissingDeps(state: BackendState): Clock
    function getPatch(state: BackendState): Patch
    function init(): BackendState
    function merge(local: BackendState, remote: BackendState): BackendState
  }

  // Internals

  type UUID = string
  type UUIDGenerator = () => UUID
  interface UUIDFactory extends UUIDGenerator {
    setFactory: (generator: UUIDGenerator) => void
    reset: () => void
  }
  const uuid: UUIDFactory

  interface Message {
    docId: string
    clock: Clock
    changes?: Change[]
  }

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
    message?: string
    requestType?: RequestType
    actor: string
    seq: number
    deps: Clock
    ops: Op[]
    diffs?: Diff[]
  }

  interface Op {
    action: OpAction
    obj: UUID
    key?: string
    value?: any
    datatype?: DataType
    elem?: number
  }

  interface Patch {
    actor?: string
    seq?: number
    clock?: Clock
    deps?: Clock
    canUndo?: boolean
    canRedo?: boolean
    diffs: Diff[]
  }

  interface Diff {
    action: DiffAction
    type: CollectionType
    obj: UUID
    path?: string[]
    key?: string
    index?: number
    value?: any
    elemId?: string
    conflicts?: Conflict[]
    datatype?: DataType
    link?: boolean
  }

  interface Conflict {
    actor: string
    value: any
    link?: boolean
  }

  type RequestType =
    | 'change' //..
    | 'redo'
    | 'undo'

  type OpAction =
    | 'ins'
    | 'del'
    | 'inc'
    | 'link'
    | 'set'
    | 'makeText'
    | 'makeTable'
    | 'makeList'
    | 'makeMap'

  type DiffAction =
    | 'create' //..
    | 'insert'
    | 'set'
    | 'remove'

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
    : T extends Table<infer T, infer KeyOrder> ? FreezeTable<T, KeyOrder>
    : T extends List<infer T> ? FreezeList<T>
    : T extends Array<infer T> ? FreezeArray<T>
    : T extends Map<infer K, infer V> ? FreezeMap<K, V>
    : FreezeObject<T>

  interface FreezeTable<T, KeyOrder> extends ReadonlyTable<Freeze<T>, Array<keyof Freeze<T>>> {}
  interface FreezeList<T> extends ReadonlyList<Freeze<T>> {}
  interface FreezeArray<T> extends ReadonlyArray<Freeze<T>> {}
  interface FreezeMap<K, V> extends ReadonlyMap<Freeze<K>, Freeze<V>> {}
  type FreezeObject<T> = { readonly [P in keyof T]: Freeze<T[P]> }

  // Type utility function: KeyArray
  // Enforces that the array provided for key order only contains keys of T
  type KeyArray<T, KeyOrder extends Array<keyof T>> = keyof T extends KeyOrder[number]
    ? KeyOrder
    : Exclude<keyof T, KeyOrder[number]>[]

  // Type utility function: TupleFromInterface
  // Generates a tuple containing the types of each property of T, in the order provided by KeyOrder. For example:
  // ```
  // interface Book {
  //   authors: string[]
  //   title: string
  //   date: Date
  // }
  // type BookTuple = TupleFromInterface<Book, ['authors', 'title', 'date']> // [ string[], string, Date ]
  //
  // function add(b: Book | BookTuple): void
  // ```
  // Now the argument for `Table.add` can either be a `Book` object, or an array of values for each
  // of the properties of `Book`, in the order given.
  // ```
  // add({authors, title, date}) // valid
  // add([authors, title, date]) // also valid
  // ```
  type TupleFromInterface<T, KeyOrder extends Array<keyof T>> = {
    [I in keyof KeyOrder]: Lookup<T, KeyOrder[I]>
  }

  type Lookup<T, K> = K extends keyof T ? T[K] : never
}
