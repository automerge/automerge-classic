## Sending and receiving changes

---
### Automerge document pages
* [Automerge synopsis](https://github.com/restarian/automerge/blob/brace_document/docs/automerge_synopsis.md)
* [Changelog](https://github.com/restarian/automerge/blob/brace_document/docs/changelog.md)
* [Conflicting changes](https://github.com/restarian/automerge/blob/brace_document/docs/conflicting_changes.md)
* [Document lifecycle](https://github.com/restarian/automerge/blob/brace_document/docs/document_lifecycle.md)
* [Examining document history](https://github.com/restarian/automerge/blob/brace_document/docs/examining_document_history.md)
* [Example usage](https://github.com/restarian/automerge/blob/brace_document/docs/example_usage.md)
* [Manipulating and inspecting data](https://github.com/restarian/automerge/blob/brace_document/docs/manipulating_and_inspecting_data.md)
* **Sending and receiving changes**
* [Text editing support](https://github.com/restarian/automerge/blob/brace_document/docs/text_editing_support.md)
* Internal data structures
  * [Actor IDs, vector clocks and causality](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/actor_IDs,_vector_clocks_and_causality.md)
  * [Change structure and operation types](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/change_structure_and_operation_types.md)
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

---

The Automerge library itself is agnostic to the network layer — that is, you can use whatever
communication mechanism you like to get changes from one node to another. There are currently
a few options, with more under development:

* Use `Automerge.getChanges()` and `Automerge.applyChanges()` to manually capture changes on one
  node and apply them on another.
* Use [`Automerge.Connection`](https://github.com/automerge/automerge/blob/master/src/connection.js),
  an implementation of a protocol that syncs up two nodes by determining missing changes and
  sending them to each other.
* Use [MPL](https://github.com/automerge/mpl), which runs the `Automerge.Connection` protocol
  over WebRTC.

The `getChanges()/applyChanges()` API works as follows:

```js
// On one node
newDoc = Automerge.change(currentDoc, doc => {
  // make arbitrary change to the document
})
val changes = Automerge.getChanges(currentDoc, newDoc)
network.broadcast(JSON.stringify(changes))

// On another node
val changes = JSON.parse(network.receive())
newDoc = Automerge.applyChanges(currentDoc, changes)
```

Note that `Automerge.getChanges(oldDoc, newDoc)` takes two documents as arguments: an old state
and a new state. It then returns a list of all the changes that were made in `newDoc` since
`oldDoc`. If you want a list of all the changes ever made in `newDoc`, you can call
`Automerge.getChanges(Automerge.init(), newDoc)`.

The counterpart, `Automerge.applyChanges(oldDoc, changes)` applies the list of `changes` to the
given document, and returns a new document with those changes applied. Automerge guarantees that
whenever any two documents have applied the same set of changes — even if the changes were
applied in a different order — then those two documents are equal. That property is called
*convergence*, and it is the essence of what Automerge is all about.

`Automerge.merge(doc1, doc2)` is a related function that is useful for testing. It looks for any
changes that appear in `doc2` but not in `doc1`, and applies them to `doc1`, returning an updated
version of `doc1`. This function requires that `doc1` and `doc2` have different actor IDs (that is,
they originated from different calls to `Automerge.init()`). See the Example Usage section above
for an example using `Automerge.merge()`.
