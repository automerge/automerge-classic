declare module 'automerge' {
  function applyChanges<T>(doc: T, changes: Change[]): T
  function canRedo<T>(doc: T): boolean
  function canUndo<T>(doc: T): boolean
  function change<T>(doc: T, message: string, callback: ChangeFn<T>): T
  function change<T>(doc: T, callback: ChangeFn<T>): T
  function diff<T>(oldDoc: T, newDoc: T): Diff
  function emptyChange<T>(doc: T, message?: string): T
  function equals<T>(val1: T, val2: T): boolean
  function getActorId<T>(doc: T): UUID
  function getChanges<T>(oldDoc: T, newDoc: T): Change[]
  function getConflicts<T>(doc: T, key: Key): any
  function getHistory<T>(doc: T): State<T>[]
  function getMissingDeps<T>(doc: T): Clock
  function getObjectById<T>(doc: T, objectId: UUID): T
  function getObjectId<T>(doc: T): string
  function init<T>(actorId?: string): T
  function load<T>(doc: T, actorId?: string): T
  function merge<T>(localDoc: T, remoteDoc: T): T
  function redo<T>(doc: T, message?: string): T
  function save<T>(doc: T): T
  function setActorId<T>(doc: T, actorId: UUID): T
  function undo<T>(doc: T, message?: string): T
  function getElemId<T=string>(object: List<T> | Text, index: number): UUID

  class Connection<T> {
    constructor(docSet: DocSet<T>, sendMsg: (msg: Message) => void)
    close(): void
    docChanged(docId: UUID, doc: T): void
    maybeSendChanges(docId: UUID): void
    open(): void
    receiveMsg(msg: Message): T
    sendMsg(docId: UUID, clock: Clock, changes: Change[]): void
  }

  class Table<T> {
    constructor(columns: string[])
    [Symbol.iterator](): {
      next: () => {
        done: boolean
        value: T
      }
    }
    add(elem: T): UUID
    // TODO: Doesn't enforce order when passing property values as array
    // may be able to do this right, see https://stackoverflow.com/questions/55522477/typescript-create-tuple-from-interface/55526906#55526906
    add<K extends keyof T, V extends T[K]>(values: V[]): UUID
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
    get?(index: number): string
    getElemId(index: number): UUID
  }

  class DocSet<T> {
    constructor()
    applyChanges(docId: UUID, changes: Change[]): T
    getDoc(docId: UUID): T
    setDoc(docId: UUID, doc: T): void
    registerHandler(handler: Handler<T>): void
    unregisterHandler(handler: Handler<T>): void
  }

  class WatchableDoc<T> {
    constructor(doc: T)
    applyChanges(changes: Change[]): T
    get(): T
    set(doc: T): void
    registerHandler(handler: Handler<T>): void
    unregisterHandler(handler: Handler<T>): void
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

  namespace Frontend {
    function applyPatch<T>(doc: T, patch: Patch): T
    function canRedo<T>(doc: T): boolean
    function canUndo<T>(doc: T): boolean
    function change<T>(doc: T, message: string | undefined, callback: ChangeFn<T>): [T, Change]
    function change<T>(doc: T, callback: ChangeFn<T>): [T, Change]
    function emptyChange<T>(doc: T, message?: string): T
    function getActorId<T>(doc: T): UUID
    function getBackendState<T>(doc: T): T
    function getConflicts<T>(doc: T, key: Key): any
    function getElementIds(list: any): UUID[]
    function getObjectById<T>(doc: T, objectId: UUID): T
    function getObjectId<T>(doc: T): UUID
    function init<T>(actorId?: string): T
    function init<T>(options?: any): T
    function redo<T>(doc: T, message?: string): T
    function setActorId<T>(doc: T, actorId: UUID): any
    function undo<T>(doc: T, message?: string): any
  }

  namespace Backend {
    function applyChanges<T>(state: T, changes: Change[]): [T, Patch]
    function applyLocalChange<T>(state: T, change: Change): [T, Patch]
    function getChanges<T>(oldState: T, newState: T): Change[]
    function getChangesForActor<T>(state: T, actorId: UUID): Change[]
    function getMissingChanges<T>(state: T, clock: Clock): Change[]
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
  type Handler<T> = (docId: UUID, doc: T) => void
  type Key = string | number
  type UUID = string | number
  type filterFn<T> = (elem: T) => boolean

  interface Message {
    docId: UUID
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

  interface Change {
    message?: string
    requestType?: RequestType
    actor: UUID
    seq: number
    deps: Clock
    ops: Op[]
    before?: any // TODO: make this Change<T> and before?: T
    diffs?: Diff[]
  }

  interface Op {
    action: Action
    obj: UUID
    key?: string
    value?: any
    datatype?: DataType
    elem?: number
  }

  interface Patch {
    actor?: UUID
    seq?: number
    clock?: Clock
    deps?: Clock
    canUndo?: boolean
    canRedo?: boolean
    diffs: Diff[]
  }

  interface Diff {
    action: Action
    type: CollectionType
    obj: UUID
    path?: string[]
    key?: string
    index?: number
    value?: any
    elemId?: UUID
    conflicts?: Conflict[]
    datatype?: DataType
    link?: boolean
  }

  interface Conflict {
    actor: UUID
    value: any
    link?: boolean
  }

  type RequestType =
    | 'change' //
    | 'redo'
    | 'undo'

  type Action =
    | 'create'
    | 'del'
    | 'inc'
    | 'ins' // TODO are 'ins' and 'insert' different things?
    | 'insert'
    | 'link'
    | 'makeList'
    | 'makeMap'
    | 'maxElem'
    | 'remove'
    | 'set'

  type CollectionType =
    | 'list'
    | 'map' //
    | 'table'
    | 'text'

  type DataType = 'counter' | 'timestamp'

}
