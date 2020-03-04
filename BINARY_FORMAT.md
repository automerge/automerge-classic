Automerge binary data format
============================

This file documents the new binary data format being developed on the
`performance` branch of the Automerge repository. It is not yet part of any
Automerge release, but the intention is to make this data format the default
in Automerge 1.0.

This file assumes that you have already read the [INTERNALS](INTERNALS.md)
document.


JSON representation of changes
------------------------------

A change has a JSON representation and a binary representation. The two are
equivalent in expressiveness; the JSON representation is supposed to be more
human-readable. The JSON is similar, but not identical, to the format used by
the currently released version of Automerge.

The biggest difference in the new version is that each operation has a unique
operation ID, which consists of an integer counter and an actor ID. The
operations within a change are given operation IDs with consecutive counter
values, and the actorId of the author fo the change. This ID is used whenever we
need to refer to the operation or the things it has done: for example, while the
old version generated a UUID to refer to an object, the new version refers to an
object by the ID of the operation that created it. Likewise, we refer to a list
element (or a character in text) by the ID of the operation that inserted this
element.

The (human-readable) string representation of an operation ID is
`${counter}@${actorId}`, that is, the concatenation of the counter as a decimal
integer, the `'@'` sign, and the actorId. In the binary data format, the
(counter, actorId) operation IDs can be encoded much more densely than UUIDs: we
use a lookup table to translate actorIds into small integers, and then store the
two integers in compressed form. The counter has the same characteristics as the
`elem` field of an `ins` operation in the old format: that is, when generating
a new operation, an actor always picks a counter value that is 1 greater than
any existing counter value in the document (it's a
[Lamport timestamp](https://en.wikipedia.org/wiki/Lamport_timestamps)).

A change is a JSON object with the following properties:

* `actor`, `seq`, `deps`, `message`: as in the old format, documented in
  `INTERNALS.md`.
* `startOp`: An integer, containing the counter value of the ID of the first
  operation in this change. Subsequent operations are assigned IDs in an
  incrementing sequence.
* `ops`: An array of operations, as documented below.

An operation is a JSON object with the following properties:

* `action`: One of `'set'`, `'del'`, `'inc'`, `'link'`, `'makeMap'`,
  `'makeList'`, `'makeText'`, or `'makeTable'`. These broadly have the same
  meaning as before:
  * `set` assigns a primitive value (string, number, boolean, or null) to a
    property of an object or a list element
  * `del` deletes a property or list element
  * `inc` increments or decrements a counter stored in a particular property or
    list element
  * `link` updates a property or list element to reference some other object
    that already exists
  * `make*` creates a new object of the specified type, and assigns it to a
    property of an object or a list element
* `obj`: The objectId of the object being modified in this operation. This may
  be the UUID consisting of all zeros (indicating the root object), a string
  of the form `counter@actorId` (indicating the object created by the operation
  with that ID), or a string containing another UUID (if the object was created
  by an operation with a `child` property). Note: in `make*` operations, the
  `obj` property contains the ID of the parent object, not the ID of the object
  being created.
* `insert`: A boolean that may be present on operations that modify list or text
  objects, and on all operation types except `del` and `inc`. If the `insert`
  property is false or absent, the operation updates the property or list
  element identified by `key`. If it is true, the operation inserts a new list
  element or character after the element identified by `key`, and the ID of this
  operation becomes the list element ID of the new element.
* `key`: A string that identifies the property of the object `obj` that is being
  modified, present on all operations. If the object is a map, this is a string
  containing the property name. If the object is a table, this is a string
  containing the primary key of the row. If the object is a list or text, this
  is a string of the form `counter@actorId` identifying the list element ID, or
  the string `'_head'` indicating insertion at the beginning of the list (the
  value `'_head'` is allowed only if `insert` is true).
* `value`: On `set` operations only, this property contains the primitive value
  (string, number, boolean, or null) to assign.
* `datatype`: On `set` operations only, this property can optionally be set to
  `'counter'` or `'timestamp'` to change the way the value is interpreted, as
  in the old format.
* `child`: In the case of a `make*` operation, this property optionally contains
  a UUID that can be used to refer to this object (this is currently only used
  for rows of an Automerge.Table object). In the case of a `link` operation,
  this property contains the ID of the child object being referenced. Not
  present on other operations.

Note several differences to the old format:

1. There is no longer an insert operation. Instead, all operation types (except
   `del` and `inc`) can have an `insert: true` property when modifying a list or
   text object, causing it to insert a new list element rather than overwriting
   an existing list element.
2. In the old format, the `make*` operations created a new object, but requried
   a separate `link` object to integrate them into the document tree. Now, every
   `make*` operation includes the `obj` and `key` to which the new object should
   be assigned. `link` operations still exist, but they are now only used in the
   context of undo/redo (`link` undoes a `del` operation that removed a child
   object).
3. The `obj` field of a `make*` operation is now the ID of the parent object,
   not the ID of the object being created.

Open questions:

* Get rid of the all-zeros UUID, and just use a special string `_root` instead?
* Get rid of the option for objects to be created with a UUID objectId, and
  force all objects to use operationIds? This would imply that a frontend object
  cannot know its objectId until after a round-trip through the backend. This is
  particularly relevant to Automerge.Table, which currently uses the objectId of
  a row as its primary key.
