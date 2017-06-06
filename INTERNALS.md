Tesseract internal data structures
==================================

This document is a quick summary of how Tesseract stores data internally. You
shouldn't need to read it in order to use Tesseract in your application, but you
might find it useful if you want to hack on the Tesseract code itself.


State, operations, and deltas
-----------------------------

You get a Tesseract instance by calling `tesseract.init()` (creates a new, empty
document) or `tesseract.load()` (loads an existing document, typically from
a file on disk). By default, this document exists only in memory on a single
device, and you don't need any network communication for read or write access.
There may be a separate networking layer that asynchronously propagates changes
from one device to another, but that networking layer is outside of the scope of
Tesseract itself.

The Tesseract document looks like a JavaScript object (by default the empty
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

1. A *local operation*, which is generally triggered by the user changing some
   piece of application data in the user interface. Such editing by the user is
   expressed as one or more calls to `tesseract.set()`, `.assign()`,
   `.insert()`, and/or `.remove()`, which are internally translated into
   operations. The functions return a copy of the state with those new
   operations included.
2. A *remote operation*: a user on another device has edited their copy of
   a document, that change was sent to you via the network, and now you want to
   apply the change to your own copy of the document. Remote operations are
   applied using `tesseract.applyDeltas()`, and `tesseract.merge()` is
   a short-cut for the case where the "remote" document is actually just another
   instance of Tesseract in the same process.

To facilitate network communication, the functions `tesseract.getVClock()` and
`.getDeltasAfter()` allow Tesseract instances on different devices to figure out
their differences (which operations are missing on which device). These
functions only query the state, but do not change it.


Actor IDs, vector clocks, and causality
---------------------------------------

Each Tesseract instance has an *actor ID* — a UUID that is generated randomly
whenever you do `tesseract.init()` or `tesseract.load()` (unless you explicitly
pass an actor ID into those functions). Whenever you make a local edit on that
Tesseract instance, the origin of those operations is set to that actor ID. All
edits made on a Tesseract instance are numbered sequentially, starting with
1 and never skipping or reusing sequence numbers. We assume that nobody else is
using the same actor ID, and thus each operation is uniquely identified by the
combination of its originating actor ID and its sequence number. That unique
identifier for the operation always remains fixed, even when the operation is
applied on remote copies of the document.

It's perhaps easiest to think of the actor ID as a device ID. Each device can
generate local edits independently from every other device, and so each device
needs to have its own numbering sequence for operations. There might be cases in
which you want several actor IDs for a single device, but there is a performance
cost to having lots of actor IDs, so it's a good idea to preserve actor IDs
across restarts of an application on the same device, if possible.

With those sequence numbers in place, we can fairly efficiently keep track of
all operations we've seen: for each actor ID, we apply the operations
originating on that instance in strictly incrementing order; and then we only
need to store the highest sequence number we've seen for each actor ID. This
mapping from actor ID to highest sequence number is called a *vector clock*.

With our documents, one operation sometimes depends on another. For example, if
an item is first added and then removed, it doesn't make sense to try to apply
the removal if you haven't already seen the addition (since you'd be trying to
remove something that doesn't yet exist). To keep track of these dependencies,
every operation includes the vector clock of the originating Tesseract instance
at the time when the local edit was made. Every other Tesseract instance that
wants to apply this operation needs to check that the prior operations have
already been applied; it can do this by checking that for all known actor IDs,
the greatest sequence number it has already applied is no less than the sequence
number in the operation's vector clock. If the operation depends on some other
operation that has not yet been seen, the operation is buffered until the
prerequisite operation arrives. This ordering and buffering process is known as
*causally ordered delivery* (because it ensures that everybody first sees the
cause, then the effect, not the other way round).


Operation types
---------------

As mentioned above, every operation has two common properties:

* `actor`: The actor ID on which the operation originated (a UUID).
* `clock`: The vector clock of the originating Tesseract instance at the time
  the operation was generated, represented as a map from actor IDs to sequence
  numbers: `{[actorId1]: seq1, [actorId2]: seq2, ...}`. The entry for the actor
  ID on which the operation originated, i.e. `operation.clock[operation.actor]`,
  is the sequence number of this particular operation.

The remaining properties depend on the type of operation. Tesseract currently uses
the following types of operation:

* `{ action: 'makeMap', obj: objId }`

  The user created a new empty map object, and that object will henceforth be
  identified by the UUID `objId`. The contents of the map, and its position
  within the document, are defined by subsequent operations. For the root object,
  which has a fixed UUID consisting of all zeros, a `makeMap` operation is not
  required.

* `{ action: 'makeList', obj: objId }`

  The user created a new empty list object, and that list will henceforth be
  identified by the UUID `objId`.

* `{ action: 'ins', obj: listId, key: elemId, counter: int }`

  The user inserted a new item into a list. `obj` is the UUID of the list object
  being modified. `key` is the ID of an existing element after which the new
  element should be inserted, or the string `'_head'` if the new element should
  be inserted at the beginning of the list. `counter` is an integer that is
  strictly greater than the counter of any other element in this list at the
  time of insertion.

  The ID of the newly inserted list element is constructed by concatenating the
  actor ID on which the operation originated, a colon character `':'`, and the
  counter value (as a decimal string). This ID is unique per list: although
  different actors may generate insertions with the same counter value, the same
  actor never reuses counters. This element ID is then used by subsequent `set`
  and `link` operations to assign a value to the list element, by `del`
  operations to delete the list element, and by `ins` operations to insert new
  list elements after this one.

  Note that the operation does not use list indexes, which are not safe under
  concurrent use, but instead uses unique identifiers for list elements. Note
  also that this operation does not specify what value should be inserted into
  the list; it only creates a placeholder at a particular position. A subsequent
  `set` or `link` operation is used to assign the actual value.

  The counter looks a bit similar to a sequence number in the vector clock, but
  it is different due to the requirement that it must be greater than *any
  other* counter in that list (regardless of originating actor). This fact is
  required to ensure the list elements are ordered correctly. Technically, this
  construction is known as a
  [Lamport timestamp](https://en.wikipedia.org/wiki/Lamport_timestamps).

* `{ action: 'set', obj: objId, key: key, value: value }`

  The user assigned a value to a key in a map, or to an existing index in a
  list. `obj` is the UUID of the map or list being modified. If the target
  is a map, `key` is the name of the field being assigned. If the target is a
  list, `key` is the ID of the list element to be updated. This ID must have
  been created by a prior `ins` operation. `value` is always a primitive value
  (string, number, boolean, or null); use `link` for assigning objects or arrays.

* `{ action: 'link', obj: objId, key: key, value: objId }`

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

* `{ action: 'del', obj: objId, key: key }`

  The user deleted a key from a map, or an element from a list. `obj` is the
  UUID of the map or list being modified. `key` is the key being removed from
  the map, or the ID of the list element being removed, as appropriate.
  Assigning the value `undefined` is interpreted as a deletion.

For example, the following local edit:

```js
tesseract.set(tesseract.init(), 'cards', [ { title: 'hello world' } ])
```

expands into the following sequence of operations:

```js
// Make a list object to hold the cards
{ action: 'makeList',
  obj: 'fd06ead4-039b-4959-b848-5fe500679a0e',    // new UUID for the list
  actor: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',  // all operations originate on the same actor ID
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 1 } } // sequence number 1

// Insert a list element to contain the card
{ action: 'ins',
  obj: 'fd06ead4-039b-4959-b848-5fe500679a0e',    // insert into the list we just created
  key: '_head',                                   // insert at the beginning of the list
  counter: 1,                                     // for constructing the new list element ID
  actor: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 2 } } // sequence number 2

// Make a map object to represent a card
{ action: 'makeMap',
  obj: '39530b90-5361-43f8-80dd-a9e737af75a7',    // new UUID for the card object
  actor: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 3 } }

// Set the title of the card
{ action: 'set',
  obj: '39530b90-5361-43f8-80dd-a9e737af75a7',    // update the map object we just created
  key: 'title',                                   // set the title field
  value: 'hello world',
  actor: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 4 } }

// Make the card the first element of the list
{ action: 'link',
  obj: 'fd06ead4-039b-4959-b848-5fe500679a0e',    // update the list object
  key: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd:1',  // assign to the new list element (note the :1)
  value: '39530b90-5361-43f8-80dd-a9e737af75a7',  // value is the UUID of the card object
  actor: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 5 } }

// Now place the list of cards in the root object
{ action: 'link',
  obj: '00000000-0000-0000-0000-000000000000',    // UUID of the root object (hard-coded)
  key: 'cards',                                   // setting root.cards
  value: 'fd06ead4-039b-4959-b848-5fe500679a0e',  // UUID of the list object
  actor: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 6 } } 
```

Aren't you glad you don't have to write all those operations by hand? :)


Applying operations to the local state
-----------------------------------

TODO


Querying the local state
------------------------

TODO
