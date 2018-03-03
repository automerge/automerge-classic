## Actor IDs, vector clocks, and causality

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
  * **Actor IDs, vector clocks and causality**
  * [Change structure and operation types](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/change_structure_and_operation_types.md)
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

---

Each Automerge instance has an *actor ID* — a UUID that is generated randomly
whenever you do `Automerge.init()` or `Automerge.load()` (unless you explicitly
pass an actor ID into those functions). Whenever you make a local edit on that
Automerge instance, the operations are tagged with that actor ID as the origin.
All changes made on a Automerge instance are numbered sequentially, starting
with 1 and never skipping or reusing sequence numbers. We assume that nobody
else is using the same actor ID, and thus each change is uniquely identified
by the combination of its originating actor ID and its sequence number. That
unique identifier for the change always remains fixed, even when it is
applied on remote copies of the document.

An actor ID is a bit similar to a device ID. Each device can generate changes
independently from every other device, and so each device needs to have its own
numbering sequence. You can have several actor IDs for the same device, for
example if the user might run several instances of the application on the same
device (in which case, each instance needs its own actor ID). However, there is
a performance cost to having lots of actor IDs, so it's a good idea to keep
using the same actor ID if possible (at least for the lifetime of an application
process).

With those sequence numbers in place, we can fairly efficiently keep track of
all changes we've seen: for each actor ID, we apply the changes
originating on that instance in strictly incrementing order; and then we only
need to store the highest sequence number we've seen for each actor ID. This
mapping from actor ID to highest sequence number is called a *vector clock*.

With our documents, one change sometimes depends on another. For example, if
an item is first added and then removed, it doesn't make sense to try to apply
the removal if you haven't already seen the addition (since you'd be trying to
remove something that doesn't yet exist). To keep track of these dependencies,
every change includes the vector clock of the originating Automerge instance
at the time when the local edit was made. Every other Automerge instance that
wants to apply this change needs to check that the prior changes have
already been applied; it can do this by checking that for all known actor IDs,
the greatest sequence number it has already applied is no less than the sequence
number in the change's vector clock. If the change depends on some other
change that has not yet been seen, the change is buffered until the
prerequisite change arrives. This ordering and buffering process is known as
*causally ordered delivery* (because it ensures that everybody first sees the
cause, then the effect, not the other way round).

