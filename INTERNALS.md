Automerge internal data structures
==================================

This document explains how Automerge stores data internally. You shouldn't need
to read it in order to use Automerge in your application, but you might find it
useful if you want to hack on the Automerge code itself.


Document, changes, and operations
---------------------------------

You get an Automerge instance by calling `Automerge.init()` (creates a new, empty
document) or `Automerge.load()` (loads an existing document, typically from
a file on disk). By default, this document exists only in memory on a single
device, and you don't need any network communication for read or write access.
There may be a separate networking layer that asynchronously propagates changes
from one device to another, but that networking layer is outside of the scope of
Automerge itself.

The Automerge instance represents the current state of your application (or some part of it).
The state is immutable and is never updated in place. Instead, whenever you want
to do something that changes the state, you call a function that takes the old
state as first argument, and returns a new state reflecting the change. There
are two ways how the state can change:

1. **Local changes**, which are generally triggered by the user changing some
   piece of application data in the user interface. Such editing by the user is
   expressed by calling `Automerge.change()`, which groups together a block
   of operations that should be applied as an atomic unit. Within the change
   callback you have access to a mutable version of the Automerge document,
   implemented as a
   [Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy)).
   The proxy records any mutations you make as *operations* (e.g. changing the
   value of a particular property of a particular object). The `change()`
   function returns a new copy of the state with those operations applied.
2. **Remote changes**: a user on another device has edited their copy of
   a document, that change was sent to you via the network, and now you want
   to apply it to your own copy of the document. Remote operations are applied
   using `Automerge.applyChanges()`, which again returns a new copy of the
   state. For testing purposes there is also `Automerge.merge()`, which is
   is a short-cut for the case where the "remote" document is actually just
   another instance of Automerge in the same process.

Some terminology:

* An **operation** is a fine-grained description of a single modification, e.g.
  setting the value of a particular property of a particular object, or
  inserting one element into a list. Users normally never see operations — they
  are a low-level implementation detail.
* A **change** is a collection of operations grouped into a unit that is
  applied atomically (a bit like a database transaction). Each call to
  `Automerge.change()` produces exactly one change, and inside the change there
  may be any number of operations. A change is also the smallest unit that gets
  transmitted over the network to other devices.
* A **document** is the state of a single Automerge instance. The state of a
  document is determined by the set of all changes that have been applied to
  it. Automerge ensures that whenever any two documents have seen the same
  set of changes, even if the changes were applied in a different order, then
  those documents are in the same state. This means an Automerge document is a
  [CRDT](https://crdt.tech/).

`Automerge.getChanges()` returns all the changes that have occurred between one
document state and another, so that they can be encoded and sent over the
network to other devices. On the recipient's end, `Automerge.applyChanges()`
updates the corresponding document to incorporate those changes.

You can save a document to disk using `Automerge.save()`. This function really
just takes all the changes that have ever happened in the document, and encodes
them as a string. Conversely, `Automerge.load()` decodes that string and applies
all of the changes to a new, blank document. This works because we can always
reconstruct the document state from the set of changes. For this reason, a
document preserves its entire editing history, even across saves and reloads
(a bit like a Git repository).

One day, we may need to allow this history to be pruned in order to save disk
space. There are also privacy implications in storing the whole history: any
new collaborator who gets access to a document can see all past states of the
document, including any content that is now deleted. However, for now we are
choosing to preserve all history as it makes synchronisation easier (imagine
a device that has been offline for a long time, and then needs to catch up on
everything that has been changed by other users while it was offline).
Moreover, being able to inspect edit history is itself a useful feature.


Actor IDs, vector clocks, and causality
---------------------------------------

Each Automerge instance has an **actor ID** — a UUID that is generated randomly
whenever you do `Automerge.init()` or `Automerge.load()` (unless you explicitly
pass an actor ID into those functions). Whenever you make a local edit on that
Automerge instance, the operations are tagged with that actor ID as the origin.
All changes made on a Automerge instance are numbered sequentially, starting
with 1 and never skipping or reusing sequence numbers. We assume that nobody
else is using the same actor ID, and thus each change is uniquely identified
by the combination of its originating actor ID and its sequence number. That
unique identifier for the change always remains fixed, even when it is
applied on remote copies of the document.

An actor ID is a bit similar to a device ID. Each device can generate changes
independently from every other device, and so each device needs to have its own
numbering sequence. You can have several actor IDs for the same device, for
example if the user might run several instances of the application on the same
device (in which case, each instance needs its own actor ID). However, there is
a performance cost to having lots of actor IDs, so it's a good idea to keep
using the same actor ID if possible (at least for the lifetime of an application
process).

With those sequence numbers in place, we can fairly efficiently keep track of
all changes we've seen: for each actor ID, we apply the changes
originating on that instance in strictly incrementing order; and then we only
need to store the highest sequence number we've seen for each actor ID. This
mapping from actor ID to highest sequence number is called a *vector clock*.

The vector clock is useful when two peers are communicating, and need to
figure out which changes they need to send to each other in order to get in
sync. If the peers send each other their vector clocks, each peer can see the
highest sequence number for each actor that the other peer has seen; if it has
any changes with higher sequence numbers, it sends those. See `src/connection.js`
for an implementation of such a protocol.

### Dependencies

In our documents, one change sometimes depends on another. For example, if
an item is first added and then removed, it doesn't make sense to try to apply
the removal if you haven't already seen the addition (since you'd be trying to
remove something that doesn't yet exist). This requires *causal ordering* of
changes, which we implement by each change declaring its *dependencies*.

Every change by actor *X* with sequence number *n* (with *n* > 1) implicitly
depends on *X*'s change with sequence number *n* – 1. Moreover, assume that
in between *X* generating change number *n* – 1 and change number *n*, *X*
received a change from actor *Y* with sequence number *m*. In that case, *X*'s
change *n* also declares an explicit dependency on *Y*'s change *m*.

When any Automerge instance wants to apply a change that depends on another
change, it ensures that the dependency is applied first. If it has not yet
received the dependency, the dependent change is buffered until the prerequisite
change arrives. This ordering and buffering process happens automatically, which
means that you can pass changes to `Automerge.applyChanges()` in any order, and
Automerge will take care of applying them in causal order.


Change structure and operation types
------------------------------------

**NB. This section describes the format used by the currently released version
of Automerge (on the `main` branch). A new format is in development on the
`performance` branch).**

Every change is a JSON object with five properties:

* `actor`: The actor ID on which the change originated (a UUID).
* `seq`: The sequence number of the change, starting with 1 for a given actor
  ID and proceeding as an incrementing sequence.
* `deps`: The change's dependencies, represented as an object where keys are
  actor IDs and values are the highest sequence number seen from that actor:
  `{[actorId1]: seq1, [actorId2]: seq2, ...}`. The implicit dependency on
  sequence number `seq – 1` by the same `actor` need not be declared. Any
  dependency that is also a transitive dependency of another change need not
  be declared either.
* `message`: An optional human-readable "commit message" that describes the
  change in a meaningful way. It is not interpreted by Automerge, only
  stored for introspection, debugging, undo, and similar purposes.
* `ops`: An array of operations that are grouped into this change.

Each operation acts on an object, which is identified by a UUID. There are four
types of object: `map` (represented in the document as a JavaScript object),
`list` (represented as a JavaScript array), `text` (represented as an instance
of `Automerge.Text`), and `table` (represented as an instance of
`Automerge.Table`). When processing operations, we mostly consider just `map`
and `list` as object types, because `table` behaves almost like `map`, and
`text` behaves almost like `list`. The root of an Automerge document has
a special UUID that consists only of zeroes, and its type is always `map`.

Note that `Automerge.Counter` and `Date` objects are not types of object for
Automerge purposes, but rather datatypes of values (see documentation of the
`set` operation).

Each operation in the `ops` array of a change is a JSON object. Automerge
currently uses the following types of operation:

* `{ action: 'makeMap', obj: objectId }`

  The user created a new empty map object, and that object will henceforth be
  identified by the UUID `obj`. The contents of the map, and its position within
  the document, are defined by subsequent operations. For the root object, which
  has a fixed UUID consisting of all zeros, a `makeMap` operation is not
  required.

* `{ action: 'makeList', obj: objectId }`

  The user created a new empty list object, and that list will henceforth be
  identified by the UUID `obj`.

* `{ action: 'makeText', obj: objectId }`

  The user created a new empty text sequence, and that sequence will henceforth
  be identified by the UUI `obj`. (A text sequence provides better performance
  for text editing compared with using a regular JavaScript array.)

* `{ action: 'makeTable', obj: objectId }`

  The user created a new empty table, and that table will henceforth be
  identified by the UUID `obj`. The table does not enforce a schema; the columns
  that exist in the table depend on the contents of each row. Rows are added in
  subsequent operations.

* `{ action: 'ins', obj: listId, key: elemId, elem: uint }`

  The user inserted a new item into a list or text object. `obj` is the UUID of
  the object being modified. `key` is the ID of an existing element after which
  the new element should be inserted, or the string `'_head'` if the new element
  should be inserted at the beginning of the list. `elem` is an integer that is
  strictly greater than the `elem` value of any other element in this list at
  the time of insertion.

  The ID of the newly inserted list element is constructed by concatenating the
  actor ID on which the operation originated, a colon character `':'`, and the
  elem value (as a decimal string). This ID is unique per list: although
  different actors may generate insertions with the same elem value, the same
  actor never reuses elems. This element ID is then used by subsequent `set` and
  `link` operations to assign a value to the list element, by `del` operations
  to delete the list element, and by `ins` operations to insert new list
  elements after this one.

  Note that the operation does not use list indexes, which are not safe under
  concurrent use, but instead uses unique identifiers for list elements. Note
  also that this operation does not specify what value should be inserted into
  the list; it only creates a placeholder at a particular position. A subsequent
  `set` or `link` operation is used to assign the actual value.

  The elem value looks a bit similar to a sequence number in the vector clock,
  but it is different due to the requirement that it must be greater than *any
  other* elem in that list (regardless of originating actor). This fact is
  required to ensure the list elements are ordered correctly. Technically, this
  construction is known as a
  [Lamport timestamp](https://en.wikipedia.org/wiki/Lamport_timestamps).

* `{ action: 'set', obj: objectId, key: key, value: value, datatype: datatype }`

  The user assigned a value to a key in a map, added a row to a table, or
  assigned a value to an index in a list. `obj` is the UUID of the object being
  modified. If the object is a map, `key` is the name of the field being
  assigned. If the object is a list or text, `key` is the unique ID
  of the list element to be updated, as created by a prior `ins` operation.
  `value` is always a primitive value (string, number, boolean, or null); use a
  `link` operation for assigning objects.

  The `datatype` property is usually absent, in which case the property value
  is just the primitive `value` as given. If the value of the `datatype` property
  is `'counter'`, the value must be an integer, and it is turned into an
  `Automerge.Counter` object in the document. If the `datatype` property is
  `'timestamp'`, the value is interpreted as the number of milliseconds since
  the 1970 Unix epoch, and turned into a JavaScript
  [Date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date)
  object in the document.

* `{ action: 'link', obj: objectId, key: key, value: objectId }`

  The user took a previously created object (created with `makeMap`, `makeList`,
  `makeText`, or `makeTable`), and made it a nested object within another
  object. Put another way, this operation creates a reference or pointer from
  one object to another. Multiple references to the same element are not allowed.
  Moreover, reference cycles are not allowed; the code currently doesn't check
  for them, so if you create a cycle, you'll get infinite loops.

  `obj` is the UUID of the object being modified (i.e. the parent object in the
  nesting). If the object is a map, `key` is the name of the property in the
  parent object being updated. If the object is a table, `key` is the primary
  key of the row (= the object ID of the row). If the object is a list or text,
  `key` is the ID of the list element, as created by a prior `ins` operation.
  `value` is the UUID of the object being referenced (i.e. the child object).

* `{ action: 'del', obj: objectId, key: key }`

  The user deleted a key from a map, a row from a table, or an element from a
  list or text object. `obj` is the UUID of the object being modified. `key`
  is the key being removed from the map, the primary key of the row being
  removed from the table, or the ID of the list/text element being removed,
  as appropriate.

* `{ action: 'inc', obj: objectId, key: key, value: number }`

  The user incremented or decremented the value of an `Automerge.Counter`.
  `obj` is the UUID of the parent object being modified, and `key` is the name
  of the property or the list element ID where the counter is located within
  that object. `value` is the amount by which the counter is incremented, with
  a negative value representing a decrement.

For example, the following code:

```js
Automerge.change(Automerge.init(), 'Create document', doc => doc.cards = [ { title: 'hello world' } ])
```

generates the following JSON object describing the change:

```js
{ actor: 'be3a9238-66c1-4215-9694-8688f1162cea',        // actorId where this change originated
  seq: 1,                                               // sequence number 1
  deps: {},                                             // no dependencies on other changes
  message: 'Create document',                           // human-readable description
  ops:
   [ { action: 'makeList',                              // Make a list object to hold the cards
       obj: '3a64c13f-c270-4af4-a733-abaadc5e7c46' },   // New UUID for the list
     { action: 'ins',                                   // Insert a new element into the list we created
       obj: '3a64c13f-c270-4af4-a733-abaadc5e7c46',     // UUID of the list object
       key: '_head',                                    // Insert at the beginning of the list
       elem: 1 },
     { action: 'makeMap',                               // Make a map object to reprsent a card
       obj: '4f1cd0ee-3855-4b56-9b8d-85f88cd614e3' },   // New UUID for the card
     { action: 'set',                                   // Set the title of the card
       obj: '4f1cd0ee-3855-4b56-9b8d-85f88cd614e3',     // UUID of the card object
       key: 'title',
       value: 'hello world' },
     { action: 'link',                                  // Make the card the first element of the list
       obj: '3a64c13f-c270-4af4-a733-abaadc5e7c46',     // UUID of the list object
       key: 'be3a9238-66c1-4215-9694-8688f1162cea:1',   // Assign to the list element with elem:1
       value: '4f1cd0ee-3855-4b56-9b8d-85f88cd614e3' }, // UUID of the card object
     { action: 'link',                                  // Place the list of cards in the root object
       obj: '00000000-0000-0000-0000-000000000000',     // UUID of the root object (hard-coded)
       key: 'cards',
       value: '3a64c13f-c270-4af4-a733-abaadc5e7c46' } ] }
```


Frontend-backend protocol
-------------------------

Internally, most of Automerge is split into two major parts: a frontend and a
backend. The source code is organised into two directories with these names.
The idea behind this split is that the two parts can run on two separate
threads: the frontend runs as part of the user application on the render thread,
while the backend can run in a background thread, e.g. as a
[web worker](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers).
This allows the backend to perform computationally expensive tasks without
affecting the responsiveness of the user interface.

If you use the `Automerge.{init,load,change,...}` APIs, you don't see the
frontend/backend distinction, and both just run on the same thread (the frontend
communicates with the backend by just calling its functions directly). If you
want to run them on separate threads, you need to use the `Automerge.Frontend.*`
and `Automerge.Backend.*` APIs instead, and you will have to wire up the
inter-thread communication yourself.

The communication between frontend and backend is by asynchronous
message-passing, and the messages consist only of regular JavaScript objects and
arrays (no instances of any other classes), so they can be serialized to JSON if
necessary. This design also opens up the possibility of frontend and backend
being implemented in different languages. The only requirement is that messages
between frontend and backend must be received in the order they were sent —
reordering is not allowed.

Changes that are made by the local user are first made to the frontend, and then
sent to the backend; the backend processes the change, and then sends a
confirmation back to the frontend. When changes arrive over the network from
remote users, they are first processed by the backend, and then sent to the
frontend to update its state.

Messages from the frontend to the backend are called **change requests** (as
they always represent a change made by the local user, via
`Automerge.{change,undo,redo}`). Messages from the backend to the frontend are
called **patches** (because they describe a modification that needs to be made
to the frontend state).

**NB. This section describes the frontend/backend communication protocol used by
the currently released version of Automerge (on the `main` branch). An updated
protocol has been implemented on the `performance` branch).**

### Change requests

Change requests (sent from frontend to backend) are generated by
`Frontend.from()`, `Frontend.change()`, `Frontend.emptyChange()`,
`Frontend.undo()`, or `Frontend.redo()`. Change requests look very similar to
changes: they have properties `actor`, `seq`, `deps`, `message`, and `ops` as
documented above. The difference is that there is one additional property
`requestType`, whose value must be either `'change'`, `'undo'`, or `'redo'`.

In the case of `'change'`, the other properties describe the change by the local
user that should be applied to the backend state. In the case of a `requestType`
of `'undo'` or `'redo'`, the change request does not contain any `ops` property
(but the other properties `actor`, `seq`, `deps`, and `message` are still
present). In this case, the list of ops is filled in by the backend (since the
backend maintains the undo/redo history).

A change request from the frontend is applied to the backend using
`Backend.applyLocalChange()`, and the backend responds with a patch describing
the change.

### Patch format

Three backend functions generate patches: `Backend.applyLocalChange()` takes
a change request from the frontend, applies it, and returns a patch confirming
the change; `Backend.applyChanges()` applies a set of existing changes (which
may be loaded from disk or received over the network) and returns a patch
describing the modifications made by those changes; and `Backend.getPatch()`
returns a patch that creates a new document from scratch, reflecting the current
backend state.

On the frontend, `Frontend.applyPatch()` applies a patch to an Automerge
document, returning an updated document.

A patch is a JSON object with the following properties:

* `actor` and `seq`: If the patch is a response to a change request, these
  properties are set to match the `actor` and `seq` in the change request.
  Not set on patches generated by `applyChanges()` or `getPatch()`.
* `canUndo` and `canRedo`: Booleans that indicate whether, after applying this
  patch, `undo()` and `redo()` should be enabled, respectively. Undo is enabled
  if there is at least one local change that has not been undone, and redo is
  enabled if there has been at least one undo since the last change.
* `clock` and `deps`: Objects in which the keys are actor IDs, and the values
  are the highest sequence number that the backend has processed from that
  actor. The difference between `clock` and `deps` is that `clock` contains all
  actor IDs ever seen by the backend, while `deps` contains only direct
  dependencies that cannot be reached transitively via one of the other
  dependencies. The frontend should include `deps` in the next change request
  it sends to the backend.
* `diffs`: An array of diffs, where each diff describes a modification to the
  document. A diff is similar in purpose to an operation, but they differ in
  the details, as shown below. (Terminology: a diff is contained in a patch,
  while an operation is contained in a change.) Diffs must be applied to the
  document in the order in which they appear in this array.

A diff is a JSON object with the following properties:

* `obj`: The UUID of the object being updated.
* `type`: The type of object being updated, which must be one of `'map'`,
  `'table'`, `'list'`, or `'text'`.
* `path`: The path from the root of the document to the object being updated,
  given as an array. The empty array refers to the root object. Otherwise, read
  the array from left to right to traverse from the root object to `obj`. When
  the object is a `map`, the path element is the name of the property to
  navigate to. When the object is a `table`, the path element is the primary key
  of the row. When the object is a `list` or `text`, the path element is the
  integer index of the list element. The entire path may be `null` if the object
  is not reachable from the document root.
* `action`: If the object is a `map` or `table`, the action is either
  `'create'`, `'set'`, or `'remove'`. If the object is a `list` or `text`, the
  action is one of `'create'`, `'insert'`, `'set'`, `'remove'`, or `'maxElem'`.
  The action types are explained below.
* `key`: Used when the object is a `map` or `table`, and when the action is
  `set` or `remove`. Indicates the name of the property (in the case of a `map`)
  or the primary key of the row (in the case of a `table`) that should be
  updated or removed.
* `index`: Used when the object is a `list` or `text`, and when the action is
  one of `insert`, `set`, or `remove`. Indicates the integer list index where
  a new element should be inserted, or where the value should be updated, or
  that should be removed, respectively.
* `elemId`: Used when the object is a `list` or `text`, and when the action is
  `insert`. This property contains the element ID of the newly inserted element,
  as a string of the form `'actorId:integer'`.
* `value` or `link`: Used when the action is `set` or `insert`. Which property
  is used depends on whether the value assigned or inserted in this action is
  a primitive value (number, string, boolean, or null, in which case the `value`
  property is used), or another object (in which case the `link` property
  contains the object ID of the object assigned in this action).

  The `value` property is also used when the action is `maxElem`. In this case,
  the `value` property contains the highest `elem` integer that has appeared in
  any `ins` operation (see documentation of the `ins` operation). This action
  ensures that the same element ID is not reused in certain edge cases.
* `datatype`: Used when the action is `set` or `insert`, and the `value`
  property is set. The value of the `datatype` property is either `'timestamp'`,
  `'counter'`, or the property is absent. The meaning is as documented for the
  `set` operation.
* `conflicts`: Used when the action is `set` or `insert`. If present, the value
  is an array of objects, where each object represents a conflicting value that
  was concurrently assigned to this property or list index. Each object in the
  `conflicts` array has a property `actor` containing the ID of the actor that
  assigned this value. In addition, the object has either a `link` property
  (containing the object ID of the nested object that was assigned), or `value`
  and `datatype` properties (containing the primitive value, and optionally the
  datatype interpretation, that was assigned).


Applying operations to the backend
----------------------------------

The local state in the backend is comprised of a few different pieces:

* `queue`: A list of pending changes that have not yet been applied because some
  of their dependencies are missing.
* `history`: A list of all applied changes.

The two pieces of state above represent the single source-of-truth for every
change that the system has observed. When saving and loading an Automerge CRDT,
only the `history` is used. The pieces described below contain cached information
that would otherwise have to be computed by iterating over the entire history.

* `states`: A map keyed by actor IDs. The values are lists of the form
  `[{change: change1, allDeps: allDeps1}, {change: ..., allDeps: ...}, ...]`,
  where the n-th object in the list contains the change with sequence number n+1
  by that actor, and `allDeps` is the full vector clock of dependencies (and
  transitive dependencies) of that change.
* `byObject`: A map keyed by object ID, where each value is a map containing the
  following keys:
  * `_init`: The operation that created this object (an object whose `action`
    property is one of `makeMap`, `makeList`, `makeTable`, or `makeText`).
  * `_keys`: A map where the keys are property names (in the case of a map
    object), row primary keys (in the case of a table object), or element IDs
    (in the case of a list or text object). The value for each key is a list of
    operations that assign a value to this key. In the common case, there is
    either no operation (indicating the absence of a value, e.g. a tombstone in
    a list), or one operation (containing the current value of this property).
    Multiple operations appear in this list if there were conflicting,
    concurrent assignments to the same element.
  * `_inbound`: The set of `link` operations whose value is this object ID; in
    other words, the set of operations that establish a link between this
    object and its parents. Normally an object may appear only once in the
    tree, in which case it has exactly one parent, and this set contains
    exactly one operation. The set is empty if the object is the root object,
    or if it is removed from the tree.
  * `_insertion`: Used in list and text objects only. A map whose keys are the
    list element IDs, and the value for each key is the `ins` operation that
    inserted the element with that ID.
  * `_following`: Used in list and text objects only. A map whose keys are list
    element IDs, or the string `'_head'`, and the value for each key is a list
    of `ins` operations that reference that key in their `key` property. There
    may be multiple such operations if there have been multiple insertions at
    the same place in the list.
  * `_elemIds`: Used in list and text objects only. An instance of the
    `SkipList` class, containing the sequence of element IDs of visible elements
    in the list (i.e. element IDs that have at least one associated value).
    This skip list is used to efficiently translate between element IDs and
    list indexes.
* `clock`: A map where keys are actor IDs, and the value is the highest change
  sequence number that we have applied from that actor. This represents the
  current vector clock of the local state, containing all actor IDs ever seen.
* `deps`: A map of the same form as `clock`, but excluding transitive
  dependencies — that is, containing only actorID/seqNo pairs that cannot be
  reached through the indirect dependencies of another of the dependencies.
* `undoPos`: An integer, representing the current place in the undo stack. At
  any point in time, the first `undoPos` elements of `undoStack` (i.e. indexes
  0 to undoPos–1) are undoable, and any indexes >= undoPos in `undoStack` have
  already been undone.
* `undoStack`: A list of list of operations. One element in the outer list is
  pushed when a local change is performed through `applyLocalChange()`, and it
  is set to the list of operations that need to be performed in order to undo
  that change. Those operations are chosen such that they restore the prior
  value(s) of any properties that are updated in the course of the local change.
* `redoStack`: A list of list of operations, similar to `undoStack`. Here, an
  element is pushed to the outer list when an undo is performed, and it
  contains the operations that we need to perform in order to undo the undo.
