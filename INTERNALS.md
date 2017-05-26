Tesseract internal data structures
==================================

This document is a quick summary of how Tesseract stores data internally. You
shouldn't need to read it in order to use Tesseract in your application, but you
might find it useful if you want to hack on the Tesseract code itself.


Store, state, actions, and deltas
---------------------------------

You get a store by calling `tesseract.init()` (creates a new, empty document) or
`tesseract.load()` (loads an existing document, typically from a file on disk).
The store exists only in memory on a single device, and accessing it does not
require any network communication. There may be a networking layer that
asynchronously propagates changes from one device to another, but that
networking layer is outside of the scope of Tesseract itself.

The store looks like a JavaScript object (by default the empty object `{}`), but
it's actually a wrapper around a *state* object.
The *state* is an [Immutable.js](http://facebook.github.io/immutable-js/) data
structure containing the document data and a whole lot of CRDT metadata. Among
other things, it contains a history of *actions*, which are the changes that
have been made to the document over time. Most of the interesting stuff in
Tesseract revolves around how the state changes as a result of things happening.

The state is immutable and is never updated in place. Instead, whenever you want
to do something that changes the state, you call a function that takes the old
state as first argument, and returns a new state reflecting the change. There
are two ways how the state can change:

1. A *local edit*, which is generally triggered by the user changing some piece
   of application data in the user interface. A local edit is expressed as one
   or more calls to `tesseract.set()`, `.assign()`, `.insert()`, and/or
   `.remove()`. Internally, the local edit creates one or more actions that are
   added to the history, and the functions return an updated copy of the state
   in which the changes have been applied.
2. A *remote action*, where a user on another device made a local edit, that
   change was sent to you via the network, and now you want to apply the change
   to your own copy of the store. Remote actions are applied using
   `tesseract.applyDeltas()`, and `tesseract.merge()` is a short-cut for the
   case where the "remote" store is actually just another instance of Tesseract
   in the same process.

To facilitate network communication, the functions `tesseract.getVClock()` and
`.getDeltasAfter()` allow stores on different devices to figure out which
actions are missing on which device. These functions only query the state, but
do not change it.

> *TODO: some of the terminology here is unnecessarily confusing. "Delta",
> "action", and "operation" mean almost the same thing, and the distinction
> between "store" and "state" is also a bit unnecessary (and possibly
> inconsistent with the usage of those words in Redux). It would be good to
> standardise our terminology here.*


Store IDs, vector clocks, and causality
---------------------------------------

Each store has a UUID that is generated randomly whenever you do
`tesseract.init()` or `tesseract.load()` (unless you explicitly pass a store ID
into those functions). Every local edit that is made on that store is tagged as
originating on that store ID. All edits made on a store are numbered
sequentially, starting with 1 and never skipping or reusing sequence numbers.
Thus, each action is uniquely identified by the store ID on which it originated
and the sequence number. That unique identifier for the action always remains
the same, even when the action is applied on remote stores.

It's perhaps easiest to think of the store ID as a device ID. Each device can
generate local edits independently from every other device, and so each device
needs to have its own numbering sequence for actions. The execution of
operations at a device must be single-threaded, or at least synchronised between
threads, so that it does not reuse or skip sequence numbers.

With those sequence numbers in place, we can fairly efficiently keep track of
all actions we've seen: for each store ID, we apply the actions originating on
that store in strictly incrementing order; and then we only need to store the
highest sequence number we've seen for each store ID. This mapping from store
ID to highest sequence number is called a *vector clock*.

With our documents, one action sometimes depends on another. For example, if an
item is first added and then removed, it doesn't make sense to try to apply the
removal if you haven't already seen the addition (since you'd be trying to
remove something that doesn't exist). To keep track of these dependencies, every
action includes the vector clock of the originating store at the time when the
local edit was made. Every other store that wants to apply this action needs to
check that the prior operations have already been applied; it can do this by
checking that for all known store IDs, the greatest sequence number it has
already applied is no less than the sequence number in the action's vector
clock. If the action depends on some other action that has not yet been seen,
the action is buffered until the prerequisite action arrives. This ordering and
buffering process is known as *causally ordered delivery* (because it ensures
that everybody first sees the cause, then the effect, not the other way round).


Action types
------------

As mentioned above, every action has two common properties:

* `by`: The store ID on which the action originated (a UUID).
* `clock`: The vector clock of the store at the time the action was generated,
  represented as a map from store IDs to sequence numbers:
  `{[storeId1]: seq1, [storeId2]: seq2, ...}`. The entry for the store ID on
  which the action originated, i.e. `action.clock[action.by]`, is the sequence
  number of this particular action.

The remaining properties depend on the type of action. Tesseract currently uses
the following types of action:

* `{ action: 'makeMap', target: objId }`

  The user created a new empty map object, and that object will henceforth be
  identified by the UUID `objId`. The contents of the map, and its position
  within the document, are defined by subsequent actions. For the root object,
  which has a fixed UUID consisting of all zeros, a `makeMap` action is not
  required.

* `{ action: 'makeList', target: objId }`

  The user created a new empty list object, and that list will henceforth be
  identified by the UUID `objId`.

* `{ action: 'ins', target: listId, after: elemId, elem: elemId }`

  The user inserted a new item into a list. `target` is the UUID of the list
  object being modified. `after` and `elem` are both IDs that identify elements
  within the list, and which must be constructed in a particular way
  (technically, they must be
  [Lamport timestamps](https://en.wikipedia.org/wiki/Lamport_timestamps)).
  `elem` is the ID of the newly inserted element, which must not exist in the
  list already. `after` is the ID of an existing element after which the new
  element should be inserted, or the string `'_head'` if the new element should
  be inserted at the beginning of the list.

  Note that the action does not use list indexes, which are not safe under
  concurrent use, but instead uses unique identifiers for list elements. Note
  also that this action does not specify what value should be inserted into the
  list; it only creates a placeholder at a particular position. A `set` or
  `link` action is used to assign the actual value.

* `{ action: 'set', target: objId, key: key, value: value }`

  The user assigned a value to a key in a map, or to an existing index in a
  list. `target` is the UUID of the map or list being modified. If the target
  is a map, `key` is the name of the field being assigned. If the target is a
  list, `key` is the ID of the list element to be updated. This ID must have
  been created by a prior `ins` action. `value` is always a primitive value
  (string, number, boolean, or null), never an object or array.

* `{ action: 'link', target: objId, key: key, value: objId }`

  The user took a previously created map (created with `makeMap`) or list
  object (created with `makeList`), and made it a nested object within another
  map or list. Put another way, this action creates a reference or pointer from
  one object to another. It is acceptable for the same object to be referenced
  from several different places in a document. In principle, you could also
  create reference cycles, but the code currently doesn't handle them, so you'll
  get infinite loops.
  
  `target` is the UUID of the map or list being modified (i.e. the outer map or
  list in the nesting). `key` is the name of the field (in the case of `target`
  being a map) or the ID of the list element (if `target` is a list) being
  updated. `value` is the UUID of the object being referenced (i.e. the nested
  map or list).

* `{ action: 'del', target: objId, key: key }`

  The user deleted a key from a map, or an element from a list. `target` is the
  UUID of the map or list being modified. `key` is the key being removed from
  the map, or the ID of the list element being removed, as appropriate.
  Assigning the value `undefined` is interpreted as a deletion.

For example, the following local edit:

```js
tesseract.set(tesseract.init(), 'cards', [ { title: 'hello world' } ])
```

expands into the following sequence of actions:

```js
// Make a list object to hold the cards
{ action: 'makeList',
  target: 'fd06ead4-039b-4959-b848-5fe500679a0e',  // new UUID for the list
  by: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',      // all actions originate on the same store ID
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 1 } } // sequence number 1

// Insert a list element to contain the card
{ action: 'ins',
  target: 'fd06ead4-039b-4959-b848-5fe500679a0e',  // insert into the list we just created
  after: '_head',                                  // insert at the beginning of the list
  elem: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd:1',  // the :1 makes it an element identifier
  by: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 2 } } // sequence number 2

// Make a map object to represent a card
{ action: 'makeMap',
  target: '39530b90-5361-43f8-80dd-a9e737af75a7',  // new UUID for the card object
  by: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 3 } }

// Set the title of the card
{ action: 'set',
  target: '39530b90-5361-43f8-80dd-a9e737af75a7',  // update the map object we just created
  key: 'title',                                    // set the title field
  value: 'hello world',
  by: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 4 } }

// Make the card the first element of the list
{ action: 'link',
  target: 'fd06ead4-039b-4959-b848-5fe500679a0e',  // update the list object
  key: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd:1',   // update the new list element we created earlier
  value: '39530b90-5361-43f8-80dd-a9e737af75a7',   // value is the UUID of the card object
  by: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 5 } }

// Now place the list of cards in the root object
{ action: 'link',
  target: '00000000-0000-0000-0000-000000000000',  // UUID of the root object (hard-coded)
  key: 'cards',                                    // setting root.cards
  value: 'fd06ead4-039b-4959-b848-5fe500679a0e',   // UUID of the list object
  by: 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd',
  clock: { 'dc5ee0b8-ee92-484f-aecc-81c1f56a65fd': 6 } } 
```

Aren't you glad you don't have to write all those actions by hand? :)


Applying actions to the local state
-----------------------------------

TODO


Querying the local state
------------------------

TODO
