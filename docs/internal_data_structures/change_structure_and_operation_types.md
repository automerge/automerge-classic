## Change structure and operation types

---
### Automerge document pages
* [Automerge synopsis](https://github.com/restarian/automerge/blob/brace_document/docs/automerge_synopsis.md)
* [Changelog](https://github.com/restarian/automerge/blob/brace_document/docs/changelog.md)
* [Conflicting changes](https://github.com/restarian/automerge/blob/brace_document/docs/conflicting_changes.md)
* [Document lifecycle](https://github.com/restarian/automerge/blob/brace_document/docs/document_lifecycle.md)
* [Examining document history](https://github.com/restarian/automerge/blob/brace_document/docs/examining_document_history.md)
* [Example usage](https://github.com/restarian/automerge/blob/brace_document/docs/example_usage.md)
* [Manipulating and inspecting data](https://github.com/restarian/automerge/blob/brace_document/docs/manipulating_and_inspecting_data.md)
* [Sending and receiving changes](https://github.com/restarian/automerge/blob/brace_document/docs/sending_and_receiving_changes.md)
* [Text editing support](https://github.com/restarian/automerge/blob/brace_document/docs/text_editing_support.md)
* Internal data structures
  * [Actor IDs, vector clocks and causality](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/actor_IDs,_vector_clocks_and_causality.md)
  * **Change structure and operation types**
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

---

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

