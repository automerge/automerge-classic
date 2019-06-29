declare module 'automerge' {
  type Doc<T> = DeepFreezeObject<T>
  type DocShape<D> = D extends Doc<infer T> ? T : never

  function init<T>(actorId?: string): Doc<T>
  function from<T>(initialState: T | Doc<T>): Doc<T>
  function merge<T>(localdoc: Doc<T>, remotedoc: Doc<T>): Doc<T>

  function change<D, T = DocShape<D>>(doc: D, message: string, callback: ChangeFn<T>): D
  function change<D, T = DocShape<D>>(doc: D, callback: ChangeFn<T>): D
  function emptyChange<D extends Doc<any>>(doc: D, message?: string): D
  function applyChanges<D, T = DocShape<D>>(doc: D, changes: Change<T>[]): D
  function diff<D extends Doc<any>>(olddoc: D, newdoc: D): Diff[]
  function equals<T>(val1: T, val2: T): boolean

  function getActorId<T>(doc: Doc<T>): string
  function getChanges<D, T = DocShape<D>>(olddoc: D, newdoc: D): Change<T>[]
  function getConflicts<T>(doc: Doc<T>, key: Key): any
  function getHistory<D, T = DocShape<D>>(doc: Doc<T>): State<T>[]
  function getMissingDeps<T>(doc: Doc<T>): Clock
  function getObjectById<T>(doc: Doc<T>, objectId: UUID): any
  function getObjectId(object: any): UUID

  function load<T>(doc: string, actorId?: string): Doc<T>
  function save<T>(doc: Doc<T>): string

  function canRedo<T>(doc: Doc<T>): boolean
  function canUndo<T>(doc: Doc<T>): boolean

  function redo<T>(doc: Doc<T>, message?: string): Doc<T>
  function undo<T>(doc: Doc<T>, message?: string): Doc<T>

  class Connection<T> {
    constructor(docSet: DocSet<T>, sendMsg: (msg: Message<T>) => void)
    close(): void
    docChanged(docId: string, doc: Doc<T>): void
    maybeSendChanges(docId: string): void
    open(): void
    receiveMsg(msg: Message<T>): Doc<T>
    sendMsg(docId: string, clock: Clock, changes: Change<T>[]): void
  }

  class Table<T, KeyOrder extends Array<keyof T>> {
    constructor(columns: KeyArray<T, KeyOrder>)
    [Symbol.iterator](): Iterator<T>
    add(item: T | TupleFromInterface<T, KeyOrder>): UUID
    byId(id: UUID): T
    columns: string[]
    count: number
    ids: UUID[]
    filter(fn: filterFn<T>): T[]
    find(fn: filterFn<T>): T
    map<U>(fn: (elem: T) => U): U[]
    remove(id: UUID): void
    rows(): T[]
    set(id: UUID, value: T): void
    set(id: 'columns', value: string[]): void
    sort(arg?: Function | string | string[]): void
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

  type ReadonlyTable<T, KeyOrder extends Array<keyof T>> = Omit<
    Table<T, KeyOrder>,
    'add' | 'remove' | 'set' | 'sort'
  > & {
    [Symbol.iterator](): Iterator<T>
  }
  type ReadonlyList<T> = ReadonlyArray<T>
  type ReadonlyText = ReadonlyList<string> & {
    get(index: number): string
    getElemId(index: number): string
  }

  class DocSet<T> {
    constructor()
    applyChanges(docId: string, changes: Change<T>[]): T
    getDoc(docId: string): T
    setDoc(docId: string, doc: Doc<T>): void
    registerHandler(handler: Handler<T>): void
    unregisterHandler(handler: Handler<T>): void
  }

  class WatchableDoc<D, T = DocShape<D>> {
    constructor(doc: D)
    applyChanges(changes: Change<T>[]): D
    get(): D
    set(doc: D): void
    registerHandler(handler: Handler<T>): void
    unregisterHandler(handler: Handler<T>): void
  }

  namespace Frontend {
    function applyPatch<T>(doc: Doc<T>, patch: Patch): Doc<T>
    function canRedo<T>(doc: Doc<T>): boolean
    function canUndo<T>(doc: Doc<T>): boolean
    function change<D, T = DocShape<D>>(
      doc: D,
      message: string | undefined,
      callback: ChangeFn<T>
    ): [T, Change<T>]
    function change<D, T = DocShape<D>>(doc: D, callback: ChangeFn<T>): [D, Change<T>]
    function emptyChange<T>(doc: Doc<T>, message?: string): [Doc<T>, Change<T>]
    function from<T>(initialState: T | Doc<T>): [Doc<T>, Change<T>]
    function getActorId<T>(doc: Doc<T>): string
    function getBackendState<T>(doc: Doc<T>): Doc<T>
    function getConflicts<T>(doc: Doc<T>, key: Key): any
    function getElementIds(list: any): string[]
    function getObjectById<T>(doc: Doc<T>, objectId: UUID): Doc<T>
    function getObjectId<T>(doc: Doc<T>): UUID
    function init<T>(actorId?: string): Doc<T>
    function init<T>(options?: any): Doc<T>
    function redo<T>(doc: Doc<T>, message?: string): [Doc<T>, Change<T>]
    function setActorId<T>(doc: Doc<T>, actorId: string): Doc<T>
    function undo<T>(doc: Doc<T>, message?: string): [Doc<T>, Change<T>]
  }

  namespace Backend {
    function applyChanges<T>(state: T, changes: Change<T>[]): [T, Patch]
    function applyLocalChange<T>(state: T, change: Change<T>): [T, Patch]
    function getChanges<T>(oldState: T, newState: T): Change<T>[]
    function getChangesForActor<T>(state: T, actorId: string): Change<T>[]
    function getMissingChanges<T>(state: T, clock: Clock): Change<T>[]
    function getMissingDeps<T>(state: T): Clock
    function getPatch<T>(state: T): Patch
    function init<T>(): T
    function merge<T>(local: T, remote: T): T
  }

  type UUIDGenerator = () => UUID
  interface UUIDFactory extends UUIDGenerator {
    setFactory: (generator: UUIDGenerator) => void
    reset: () => void
  }
  const uuid: UUIDFactory

  type ChangeFn<T> = (doc: T) => void
  type Handler<T> = (docId: string, doc: Doc<T>) => void
  type Key = string | number
  type UUID = string
  type filterFn<T> = (elem: T) => boolean

  interface Message<T> {
    docId: string
    clock: Clock
    changes?: Change<T>[]
  }

  interface Clock {
    [actorId: string]: number
  }

  interface State<T> {
    change: Change<T>
    snapshot: T
  }

  interface Change<T> {
    message?: string
    requestType?: RequestType
    actor: string
    seq: number
    deps: Clock
    ops: Op[]
    before?: T
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

  // Type utility function: DeepFreeze
  // Generates a readonly version of a given object, array, or map type applied recursively to the nested members of the root type.
  // It's like TypeScript's `readonly`, but goes all the way down a tree.

  // prettier-ignore
  type DeepFreeze<T> = 
    T extends Function ? T
    : T extends Text ? ReadonlyText
    : T extends List<infer E> ? DeepFreezeList<E>
    : T extends Table<infer R, infer KeyOrder> ? DeepFreezeTable<R, KeyOrder>
    : T extends ReadonlyArray<infer R> ? DeepFreezeArray<R>
    : T extends Map<infer K, infer V> ? DeepFreezeMap<K, V>
    : DeepFreezeObject<T>

  interface DeepFreezeList<T> extends ReadonlyList<DeepFreeze<T>> {}
  interface DeepFreezeTable<T, KeyOrder>
    extends ReadonlyTable<DeepFreeze<T>, Array<keyof DeepFreeze<T>>> {}
  interface DeepFreezeArray<T> extends ReadonlyArray<DeepFreeze<T>> {}
  interface DeepFreezeMap<K, V> extends ReadonlyMap<DeepFreeze<K>, DeepFreeze<V>> {}
  type DeepFreezeObject<T> = { readonly [P in keyof T]: DeepFreeze<T[P]> }
}

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
