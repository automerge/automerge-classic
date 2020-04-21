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
values, and the actorId of the author of the change. This ID is used whenever we
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
* `time`: The timestamp at which this change was generated, as an integer
  indicating the number of milliseconds since the 1970 Unix epoch. Dates
  before the epoch are represented as a negative number.
* `ops`: An array of operations, as documented below.

An operation is a JSON object with the following properties:

* `action`: One of `'set'`, `'del'`, `'inc'`, `'link'`, `'makeMap'`,
  `'makeList'`, `'makeText'`, or `'makeTable'`. These have broadly the same
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
* `child`: Only used in the case of a `link` operation, in which case this
  property contains the ID of the child object being referenced.
* `pred`: An array of IDs of operations that are overwritten by this operation,
  in the form `counter@actorId`. Any existing operations that are not
  overwritten must be concurrent, and result in a conflict. The `pred` property
  appears on all types of operation, but it is always empty on an operation with
  `insert: true`, since such an operation does not overwrite anything.

Note several differences to the old format:

1. There is no longer an insert operation. Instead, all operation types (except
   `del` and `inc`) can have an `insert: true` property when modifying a list or
   text object, causing it to insert a new list element rather than overwriting
   an existing list element. The value of the new list element can be a
   primitive value (using a `set` operation), a new nested object (using
   a `make*` operation), or a reference to an existing object (using a
   `link` operation).
2. In the old format, the `make*` operations created a new object, but requried
   a separate `link` object to integrate them into the document tree. Now, every
   `make*` operation includes the `obj` and `key` to which the new object should
   be assigned. `link` operations still exist, but they are now only used in the
   context of undo/redo (`link` undoes a `del` operation that removed a child
   object).
3. The `obj` field of a `make*` operation is now the ID of the parent object,
   not the ID of the object being created.
4. Assignments to the same property or list element: in the old format, we had
   to use the dependency graph and vector clocks to figure out whether one
   assignment overwrites another, or whether they are concurrent. In the new
   format there is a new `pred` property of operations that explicitly captures
   the relationship between operations on the same property.

Open questions:

* Get rid of the all-zeros UUID, and just use a special string `_root` instead?
* Get rid of the option for objects to be created with a UUID objectId, and
  force all objects to use operationIds? This would imply that a frontend object
  cannot know its objectId until after a round-trip through the backend. This is
  particularly relevant to Automerge.Table, which currently uses the objectId of
  a row as its primary key.


Binary representation of changes
--------------------------------

TODO (see `backend/encoding.js`)


Frontend-backend protocol
-------------------------

The protocol for communication between frontend and backend has also changed.
The changes are partly a consequence of the new change format, but also an
independent refactoring aimed at making the frontend as simple and lightweight
as possible, and moving most of the complexity into the backend.

The responsibilities between frontend and backend are assigned as follows:

* The frontend knows the current session's actorId; the backend does not. This
  opens the possibility of in the future maybe having multiple frontends backed
  by a single backend.
* The frontend assigns sequence numbers to locally generated changes.
* The backend assigns operation IDs.
  * Therefore, when the frontend creates a new object, it doesn't know that
    object's ID (= the ID of the `make*` operation that created it) until after
    a round-trip through the backend. The frontend-backend protocol therefore
    needs to use a temporary object ID for objects whose creation is in flight.
    We use UUIDs as these temporary IDs.
  * The reason for having the backend assign operation IDs is that the exact
    number of operations in a change is not known until the backend has filtered
    out duplicate operations, which requires information not known to the
    frontend. And the exact number of operations is important because operation
    IDs are assigned sequentially within a change, to maximise compression.
* The frontend references list elements by their index; the mapping between
  indexes and list element IDs is only known to the backend.
  * Hence, both directions of the frontend-backend protocol use list indexes,
    not list element IDs.
  * The reason for this is to keep the management of the list element ID data
    structure, which can be expensive, off the UI thread.
* Undo history is maintained by the backend. This means that an undo request
  will only take effect after a round-trip through the backend.
  * Actually, it should be possible to implement frontend-only undo in the
    "easy case" where the most recent change to the frontend is a local one
    (and hence the undo is just returning to a previous state, not having to
    merge a mixture of local and remote state changes). Waiting for the
    round-trip through the backend would then only be required if the most
    recent patch applied to the frontend is a remote one. However, this is
    not implemented yet.

### Change requests

As in the old format, a change request is sent from the frontend to the backend
as the result of local user input.

A change request is a JSON object with the following properties:

* `requestType`: One of `'change'`, `'undo'`, or `'redo'`.
* `actor`, `seq`, `time` and `message`: As in the change format. The
  frontend knows the local actorId and generates the sequence number.
  These properties appear on all request types.
* `version`: An integer containing the highest document version number
  (as assigned by the backend) that the frontend has seen at the time it
  generated this change request. The version number is zero for a newly
  created document.
* `ops`: When the `requestType` is `change`, this is an array of
  operation object as described below. Not present on `undo` and `redo`
  requests.

Each operation in the `ops` array is similar to the operations in a change
(as documented above), with the following differences:

* When the object being modified is a list or text, the `key` property
  does not contain a list element ID or the string `_head`, but instead,
  it contains the integer index of the list element being updated. If the
  `insert` property of the operation is true, the `key` property contains
  the index at which the new list element is being inserted.
* Every `make*` operation must have a `child` property containing a UUID,
  and subsequent operations (in the same change request or later requests)
  may refer to this UUID in their `obj` when updating this newly created
  object. The backend will translate this temporary UUID-based objectId
  into an operationId.
* The operation has no `pred` property; this is filled in by the backend.

**NOTE:** The backend's processing of change requests from the frontend
currently relies on the immutability of the backend. Translating any list
indexes in the change request into the corresponding element IDs relies on
the backend knowing the state of the list at the time when the frontend
generated the request. In the meantime, the backend may have processed
remote changes that could have modified the list. If the backend is
mutable, it will have to support list index translation queries on a state
that contains all local changes, but excludes any remote changes that had
not yet been seen by the frontend at the time it generated the request.


### Patch format

As in the old format, a patch is sent from the backend to the frontend,
describing how the document should change. The new patch format is very
different from the old one; the new format allows the frontend to be
lighter-weight (in particular, it removes the need for the frontend to
maintain an index from child object to parent object).

A patch is a JSON object with the following properties:

* `actor`, `seq`: If the patch is the result of applying a local change
  request, these properties are set to the `actor` and `seq` of that
  request. Absent on patches that result from remote changes or loading
  changes from file.
* `version`: An integer that sequentially numbers the patches applied to
  a particular document, starting with zero. The backend assigns these
  version numbers, and when the frontend makes a change request, it must
  include the latest version number it has seen in its request. Note that
  `version` is different from `seq`: `version` is incremented on any
  patch, regardless of whether it is the result of local or remote
  changes, while `seq` is incremented only on local changes.
* `clock`, `canUndo`, `canRedo`: Like in the old patch format.
* `diffs`: A JSON object describing the changes that need to be made to
  the document. In the old patch format, this was a flat list of changes,
  while in the new patch format this is a nested structure mirroring the
  structure of the document, as described below.
  
A diff object has either the following structure:

```js
{
  objectId: `${counter}@${actorId}`,
  type: 'list',
  edits: [
    {action: 'insert', index: 0}
  ],
  props: {
    [propName]: {
      [opId]: <nested diff object>
    }
  }
}
```

or the following structure:

```js
{
  value: 123,
  datatype: "counter"
}
```

The first structure represents an object type (as indicated by the `type`
property, which is one of `'map'`, `'list'`, `'table'`, or `'text'`),
while the second structure represents a primitive value (string, number,
boolean, or null) with an optional `datatype` property to describe its
interpretation. The object diff can contain nested diffs, which may be
another object diff or a primitive diff.

In the object diff, the `objectId` property indicates the ID of the object
being updated, in `counter@actorId` form, or the all-zeros UUID for the
root object. The `edits` and `props` properties then describe how that
object should be modified. The object diff does not mention any object
properties or list elements that are unchanged. Thus, `edits` and `props`
can be empty, in which case the whole object is left unchanged.

`edits` appears only on `list` or `text` objects. On such objects, `edits`
must be applied first, before applying the updates in `props`. `edits`
consists of an array of objects of one of the following forms:

* `{action: 'insert', index: 0}`: Insert a new list element at the given
  index. The value associated with this list element is given separately
  in the `props` part of the diff.
* `{action: 'remove', index: 0}`: Remove the list element at the given
  index.

The edits must be applied in the order they appear in the array.

**NOTE:** At the moment, each entry in the `edits` array inserts or
removes just a single list element. For efficiency, we should consider
allowing edits that operate on a contiguous span of list elements in one
go. This would be particularly useful for text.

`props` appears on all types of objects. It contains two-level nested JSON
objects. In the outer layer, the keys are property names (in the case of a
`map` object), primary keys of rows (in the case of `table`), or list
indexes represented as decimal strings (in the case of `list` and `text`).
In the inner layer, the keys are operation IDs of the form
`counter@actorId` of the operations that most recently assigned a value to
that property or list element. Inside the two-level object structure are
nested diff objects.

The outer layer contains only those properties or list indexes within
which updates have occurred. In the case of a list, the indexes refer to
the state of the list in which the insertions and removals in `edit` have
already been applied. In the inner layer, the following values are
possible:

* The object is empty. This means that there is no longer any value
  associated with this property, i.e. the property has been deleted. (Note
  that a `null` value is still a value, and not the same as the absence of
  a value.)
* The object has one key. This is the common case: the property has one
  value (which might be a primitive value or a nested object).
* The object has multiple keys. This happens if there is a conflict, i.e.
  multiple concurrent assignments to the same property or list element.
  The keys in the object indicate the IDs of the concurrent assignment
  operations.

It is possible for an update to occur somewhere inside a nested object in
the document tree while there is a conflict somewhere along the path from
the root object to the object being updated. In this case, the patch will
continue to report the conflict on the appropriate property. The property
will change from having multiple values to having one value (or no value)
only when the user explicitly resolves the conflict by assigning to the
conflicting property.
