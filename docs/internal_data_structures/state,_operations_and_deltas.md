## State, operations, and deltas

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
  * [Change structure and operation types](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/change_structure_and_operation_types.md)
  * **State, operations and deltas**

---

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

