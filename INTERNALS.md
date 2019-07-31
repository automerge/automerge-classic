Automerge internal data structures
==================================

This document is a quick summary of how Automerge stores data internally. You
shouldn't need to read it in order to use Automerge in your application, but you
might find it useful if you want to hack on the Automerge code itself.


State, operations, and deltas
-----------------------------

You get a Automerge instance by calling `Automerge.init()` (creates a new, empty
document) or `Automerge.load()` (loads an existing document, typically from
a file on disk). By default, this document exists only in memory on a single
device, and you don't need any network communication for read or write access.
There may be a separate networking layer that asynchronously propagates changes
from one device to another, but that networking layer is outside of the scope of
Automerge itself.

The Automerge document looks like a JavaScript object (by default the empty
object `{}`), but it's actually a wrapper (technically, a
[Proxy](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Proxy))
around a *state* object. The *state* is an
[Immutable.js](http://facebook.github.io/immutable-js/) data structure
containing the set of changes that were made to the state over time. Think of
the state as being like a database of edits; then then proxy is like a database
query through which you can examine the current state of the document.

The state is immutable and is never updated in place. Instead, whenever you want
to do something that changes the state, you call a function that takes the old
state as first argument, and returns a new state reflecting the change. There
are two ways how the state can change:

1. *Local operations*, which are generally triggered by the user changing some
   piece of application data in the user interface. Such editing by the user is
   expressed by calling `Automerge.change()`, which groups together a block
   of operations that should be applied as an atomic unit. Within that block, a
   mutable API is used for expressing the changes, but internally these API
   calls are translated into operations on the immutable state. The
   `change()` function returns a new copy of the state with those operations
   included.
2. *Remote operations*: a user on another device has edited their copy of
   a document, that change was sent to you via the network, and now you want
   to apply it to your own copy of the document. Remote operations are applied
   using `Automerge.applyDeltas()`, which again returns a new copy of the
   state. For testing purposes there is also `Automerge.merge()`, which is
   is a short-cut for the case where the "remote" document is actually just
   another instance of Automerge in the same process.

To facilitate network communication, the functions `Automerge.getVClock()` and
`.getDeltasAfter()` allow Automerge instances on different devices to figure out
their differences (which operations are missing on which device). These
functions only query the state, but do not change it.


Actor IDs, vector clocks, and causality
---------------------------------------

Each Automerge instance has an *actor ID* — a UUID that is generated randomly
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

With our documents, one change sometimes depends on another. For example, if
an item is first added and then removed, it doesn't make sense to try to apply
the removal if you haven't already seen the addition (since you'd be trying to
remove something that doesn't yet exist). To keep track of these dependencies,
every change includes the vector clock of the originating Automerge instance
at the time when the local edit was made. Every other Automerge instance that
wants to apply this change needs to check that the prior changes have
already been applied; it can do this by checking that for all known actor IDs,
the greatest sequence number it has already applied is no less than the sequence
number in the change's vector clock. If the change depends on some other
change that has not yet been seen, the change is buffered until the
prerequisite change arrives. This ordering and buffering process is known as
*causally ordered delivery* (because it ensures that everybody first sees the
cause, then the effect, not the other way round).


Change structure and operation types
------------------------------------

Every change is a JSON document with four properties:

* `actor`: The actor ID on which the change originated (a UUID).
* `clock`: The vector clock of the originating Automerge instance at the time
  the change was generated, represented as a map from actor IDs to sequence
  numbers: `{[actorId1]: seq1, [actorId2]: seq2, ...}`. The entry for the actor
  ID on which the change originated, i.e. `change.clock[change.actor]`,
  is the sequence number of this particular change.
* `message`: An optional human-readable "commit message" that describes the
  change in a meaningful way. It is not interpreted by Automerge, only
  stored for introspection, debugging, undo, and similar purposes.
* `ops`: An array of operations that are grouped into this change.

Each operation in the `ops` array is a JSON object. Automerge currently uses the
following types of operation:

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

  The user inserted a new item into a list. `obj` is the UUID of the list object
  being modified. `key` is the ID of an existing element after which the new
  element should be inserted, or the string `'_head'` if the new element should
  be inserted at the beginning of the list. `elem` is an integer that is
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

* `{ action: 'set', obj: objectId, key: key, value: value }`

  The user assigned a value to a key in a map, or to an existing index in a
  list. `obj` is the UUID of the map or list being modified. If the target
  is a map, `key` is the name of the field being assigned. If the target is a
  list, `key` is the ID of the list element to be updated. This ID must have
  been created by a prior `ins` operation. `value` is always a primitive value
  (string, number, boolean, or null); use `link` for assigning objects or arrays.

* `{ action: 'link', obj: objectId, key: key, value: objectId }`

  The user took a previously created map (created with `makeMap`) or list
  object (created with `makeList`), and made it a nested object within another
  map or list. Put another way, this operation creates a reference or pointer from
  one object to another. It is acceptable for the same object to be referenced
  from several different places in a document. In principle, you could also
  create reference cycles, but the code currently doesn't handle them, so you'll
  get infinite loops.

  `obj` is the UUID of the map or list being modified (i.e. the outer map or
  list in the nesting). `key` is the name of the field (in the case of `obj`
  being a map) or the ID of the list element (if `obj` is a list) being
  updated. `value` is the UUID of the object being referenced (i.e. the nested
  map or list).

* `{ action: 'del', obj: objectId, key: key }`

  The user deleted a key from a map, or an element from a list. `obj` is the
  UUID of the map or list being modified. `key` is the key being removed from
  the map, or the ID of the list element being removed, as appropriate.
  Assigning the value `undefined` is interpreted as a deletion.

* `{ action: 'inc', obj: objectId, value: number }`

  The user incremented or decremented a counter. `obj` is the UUID of the
  counter being modified. `value` is the amount by which the counter is
  incremented, with a negative value representing a decrement.

For example, the following code:

```js
Automerge.change(Automerge.init(), 'Create document', doc => doc.cards = [ { title: 'hello world' } ])
```

generates the following JSON object describing the change:

```js
{ actor: 'be3a9238-66c1-4215-9694-8688f1162cea',        // actorId where this change originated
  clock: { 'be3a9238-66c1-4215-9694-8688f1162cea': 1 }, // sequence number 1
  message: 'Create document',                           // human-readable message
  ops:
   [ { action: 'makeList',                              // Make a list object to hold the cards
       obj: '3a64c13f-c270-4af4-a733-abaadc5e7c46' },   // New UUID for the list
     { action: 'ins',                                   // Insert a new element into the list we created
       obj: '3a64c13f-c270-4af4-a733-abaadc5e7c46',
       key: '_head',                                    // Insert at the beginning of the list
       elem: 1 },
     { action: 'makeMap',                               // Make a map object to reprsent a card
       obj: '4f1cd0ee-3855-4b56-9b8d-85f88cd614e3' },
     { action: 'set',                                   // Set the title of the card
       obj: '4f1cd0ee-3855-4b56-9b8d-85f88cd614e3',
       key: 'title',
       value: 'hello world' },
     { action: 'link',                                  // Make the card the first element of the list
       obj: '3a64c13f-c270-4af4-a733-abaadc5e7c46',
       key: 'be3a9238-66c1-4215-9694-8688f1162cea:1',   // Assign to the list element with elem:1
       value: '4f1cd0ee-3855-4b56-9b8d-85f88cd614e3' }, // UUID of the card object
     { action: 'link',                                  // Place the list of cards in the root object
       obj: '00000000-0000-0000-0000-000000000000',     // UUID of the root object (hard-coded)
       key: 'cards',
       value: '3a64c13f-c270-4af4-a733-abaadc5e7c46' } ] }
```


Applying operations to the local state
--------------------------------------

The local state is comprised of a few different pieces:

* `queue`: A list of pending changes.
* `history`: A list of all applied changes.

The two pieces of state above represent the single source-of-truth for every
change that the system has observed. When saving and loading an Automerge CRDT,
only the `history` is used. The pieces described in the next section below
contain cached information that would otherwise have to be computed by iterating
over the entire history.

* `states`: A map keyed by actor IDs. The values are lists, where each element
  is a change plus all of the changes dependencies, including transitive
  dependencies. (Since each change only stores direct dependencies, this
  essentially caches the transitive dependencies for each change.)
* `byObject`: A map of object IDs to objects. An "object" is a map, a list, or a
  text sequence.
* `clock`: A map keyed by actor IDs, with sequence numbers as the values. This
  represents the current vector clock of the local state.
* `deps`: A map

Finally, the pieces of state below store the information necessary to support
undo and redo operations:

* `undoPos`: An integer, representing the current place in the undo stack.
* `undoStack`: A list of changes that, if applied to the state, would perform an
  "undo".
* `redoStack`: A list of changes that, if applied to the state, would perform a
  "redo".

When a change is generated (whether locally or remotely), it is immediately
added to the `queue` list of changes. Automerge then iterates through every
change in `queue`, performing the following steps for each pending change:
* The local state is checked to see if the change is causally ready (described
  below). If a change is not causally ready, then it is skipped and Automerge
  moves on to the next pending change. If the change is causally ready, then
  Automerge continues with the next step.
* The change is applied. This step updates several different parts of the state
  and is described in depth below.

### Determining if a change is causally ready

For each change that it receives, Automerge checks to make sure that every
sequence number in the change's dependencies is less than or equal to the
sequence number stored in the local vector clock (`clock` described above). If
every sequence number satisfies this condition, then the change is considered
_causally ready_.

### TODO

This section is still a work in progress. More to come!


Querying the local state
------------------------

TODO
