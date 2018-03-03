## Examining document history

---
### Automerge document pages
* [Automerge synopsis](https://github.com/restarian/automerge/blob/brace_document/docs/automerge_synopsis.md)
* [Changelog](https://github.com/restarian/automerge/blob/brace_document/docs/changelog.md)
* [Conflicting changes](https://github.com/restarian/automerge/blob/brace_document/docs/conflicting_changes.md)
* [Document lifecycle](https://github.com/restarian/automerge/blob/brace_document/docs/document_lifecycle.md)
* **Examining document history**
* [Example usage](https://github.com/restarian/automerge/blob/brace_document/docs/example_usage.md)
* [Manipulating and inspecting data](https://github.com/restarian/automerge/blob/brace_document/docs/manipulating_and_inspecting_data.md)
* [Sending and receiving changes](https://github.com/restarian/automerge/blob/brace_document/docs/sending_and_receiving_changes.md)
* [Text editing support](https://github.com/restarian/automerge/blob/brace_document/docs/text_editing_support.md)
* Internal data structures
  * [Actor IDs, vector clocks and causality](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/actor_IDs,_vector_clocks_and_causality.md)
  * [Change structure and operation types](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/change_structure_and_operation_types.md)
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

---

An Automerge document internally saves a complete history of all the changes that were ever made
to it. This enables a nice feature: looking at the document state at past points in time, a.k.a.
*time travel!*

`Automerge.getHistory(doc)` returns a list of all edits made to a document. Each edit is an object
with two properties: `change` is the internal representation of the change (in the same form as
`Automerge.getChanges()` returns), and `snapshot` is the state of the document at the moment just
after that change had been applied.

```js
Automerge.getHistory(doc2)
// [ { change: { message: 'Set x to 1', ... }, snapshot: { x: 1 } },
//   { change: { message: 'Set x to 2', ... }, snapshot: { x: 2 } } ]
```

Within the change object, the property `message` is set to the free-form "commit message" that
was passed in as second argument to `Automerge.change()` (if any). The rest of the change object
is specific to Automerge implementation details, and normally shouldn't need to be interpreted.

If you want to find out what actually changed in a particular edit, rather than inspecting the
change object, it is better to use `Automerge.diff(oldDoc, newDoc)`. This function returns a list
of edits that were made in document `newDoc` since its prior version `oldDoc`. You can pass in
snapshots returned by `Automerge.getHistory()` in order to determine differences between historic
versions.

The data returned by `Automerge.diff()` has the following form:

```js
let history = Automerge.getHistory(doc2)
Automerge.diff(history[2].snapshot, doc2) // get all changes since history[2]
// [ { action: 'set', type: 'map', obj: '...', key: 'x', value: 1 },
//   { action: 'set', type: 'map', obj: '...', key: 'x', value: 2 } ]
```

In the objects returned by `Automerge.diff()`, `obj` indicates the object ID of the object being
edited (matching its `_objectId` property), and `type` indicates whether that object is a `map`,
`list`, or `text`.

The available values for `action` depend on the type of object. For `type: 'map'`, the possible
actions are:

* `action: 'set'`: Then the property `key` is the name of the property being updated. If the value
  assigned to the property is a primitive (string, number, boolean, null), then `value` contains
  that value. If the assigned value is an object (map, list, or text), then `value` contains the
  `_objectId` of that object, and additionally the property `link: true` is set. Moreover, if this
  assignment caused conflicts, then the conflicting values are additionally contained in a
  `conflicts` property.
* `action: 'remove'`: Then the property `key` is the name of the property being removed.

For `type: 'list'` and `type: 'text'`, the possible actions are:

* `action: 'insert'`: Then the property `index` contains the list index at which a new element is
  being inserted, and `value` contains the value inserted there. If the inserted value is an
  object, the `value` property contains its `_objectId`, and the property `link: true` is set.
* `action: 'set'`: Then the property `index` contains the list index to which a new value is being
  assigned, and `value` contains that value. If the assigned value is an object, the `value`
  property contains its `_objectId`, and the property `link: true` is set.
* `action: 'remove'`: Then the property `index` contains the list index that is being removed from
  the list.
