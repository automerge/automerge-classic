## Automerge document lifecycle

---
### Automerge document pages
* [Automerge synopsis](https://github.com/restarian/automerge/blob/brace_document/docs/automerge_synopsis.md)
* [Changelog](https://github.com/restarian/automerge/blob/brace_document/docs/changelog.md)
* [Conflicting changes](https://github.com/restarian/automerge/blob/brace_document/docs/conflicting_changes.md)
* **Document lifecycle**
* [Examining document history](https://github.com/restarian/automerge/blob/brace_document/docs/examining_document_history.md)
* [Example usage](https://github.com/restarian/automerge/blob/brace_document/docs/example_usage.md)
* [Manipulating and inspecting data](https://github.com/restarian/automerge/blob/brace_document/docs/manipulating_and_inspecting_data.md)
* [Sending and receiving changes](https://github.com/restarian/automerge/blob/brace_document/docs/sending_and_receiving_changes.md)
* [Text editing support](https://github.com/restarian/automerge/blob/brace_document/docs/text_editing_support.md)
* Internal data structures
  * [Actor IDs, vector clocks and causality](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/actor_IDs,_vector_clocks_and_causality.md)
  * [Change structure and operation types](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/change_structure_and_operation_types.md)
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

---

`Automerge.init(actorId)` creates a new, empty Automerge document.
You can optionally pass in an `actorId`, which is a string that uniquely identifies the current
node; if you omit `actorId`, a random UUID is generated.

If you pass in your own `actorId`, you must ensure that there can never be two different processes
with the same actor ID. Even if you have two different processes running on the same machine, they
must have distinct actor IDs. Unless you know what you are doing, it is recommended that you stick
with the default, and let `actorId` be auto-generated.

`Automerge.save(doc)` serializes the state of Automerge document `doc` to a string, which you can
write to disk. The string contains an encoding of the full change history of the document
(a bit like a git repository).

`Automerge.load(string, actorId)` unserializes an Automerge document from a `string` that was
produced by `Automerge.save()`. The `actorId` argument is optional, and allows you to specify
a string that uniquely identifies the current node, like with `Automerge.init()`. Unless you know
what you are doing, it is recommended that you omit the `actorId` argument.


