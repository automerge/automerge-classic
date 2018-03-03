## Conflicting changes

---
### Automerge document pages
* [Automerge synopsis](https://github.com/restarian/automerge/blob/brace_document/docs/automerge_synopsis.md)
* [Changelog](https://github.com/restarian/automerge/blob/brace_document/docs/changelog.md)
* **Conflicting changes**
* [Document lifecycle](https://github.com/restarian/automerge/blob/brace_document/docs/document_lifecycle.md)
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

Automerge allows different nodes to independently make arbitrary changes to their respective copies
of a document. In most cases, those changes can be combined without any trouble. For example, if
users modify two different objects, or two different properties in the same object, then it is
straightforward to combine those changes.

If users concurrently insert or delete items in a list (or characters in a text document), Automerge
preserves all the insertions and deletions. If two users concurrently insert at the same position,
Automerge will arbitrarily place one of the insertions first and the other second, while ensuring
that the final order is the same on all nodes.

The only case Automerge cannot handle automatically, because there is no well-defined resolution,
is when users concurrently update the same property in the same object (or, similarly, the same
index in the same list). In this case, Automerge arbitrarily picks one of the concurrently written
values as the "winner":

```js
let doc1 = Automerge.change(Automerge.init(), doc => { doc.x = 1 })
let doc2 = Automerge.change(Automerge.init(), doc => { doc.x = 2 })
doc1 = Automerge.merge(doc1, doc2)
doc2 = Automerge.merge(doc2, doc1)
// Now, doc1 might be either {x: 1} or {x: 2} -- the choice is random.
// However, doc2 will be the same, whichever value is chosen as winner.
```

Although only one of the concurrently written values shows up in the object, the other values are
not lost. They are merely relegated to a `_conflicts` object:

```js
doc1 // {x: 2}
doc2 // {x: 2}
doc1._conflicts // {x: {'0506162a-ac6e-4567-bc16-a12618b71940': 1}}
doc2._conflicts // {x: {'0506162a-ac6e-4567-bc16-a12618b71940': 1}}
```

Here, the `_conflicts` object contains the property `x`, which matches the name of the property
on which the concurrent assignments happened. The nested key `0506162a-ac6e-4567-bc16-a12618b71940`
is the actor ID that performed the assignment, and the associated value is the value it assigned
to the property `x`. You might use the information in the `_conflicts` object to show the conflict
in the user interface.

The next time you assign to a conflicting property, the conflict is automatically considered to
be resolved, and the property disappears from the `_conflicts` object.
