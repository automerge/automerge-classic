## Manipulating and inspecting state

---
### Automerge document pages
* [Automerge synopsis](https://github.com/restarian/automerge/blob/brace_document/docs/automerge_synopsis.md)
* [Changelog](https://github.com/restarian/automerge/blob/brace_document/docs/changelog.md)
* [Conflicting changes](https://github.com/restarian/automerge/blob/brace_document/docs/conflicting_changes.md)
* [Document lifecycle](https://github.com/restarian/automerge/blob/brace_document/docs/document_lifecycle.md)
* [Examining document history](https://github.com/restarian/automerge/blob/brace_document/docs/examining_document_history.md)
* [Example usage](https://github.com/restarian/automerge/blob/brace_document/docs/example_usage.md)
* **Manipulating and inspecting data**
* [Sending and receiving changes](https://github.com/restarian/automerge/blob/brace_document/docs/sending_and_receiving_changes.md)
* [Text editing support](https://github.com/restarian/automerge/blob/brace_document/docs/text_editing_support.md)
* Internal data structures
  * [Actor IDs, vector clocks and causality](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/actor_IDs,_vector_clocks_and_causality.md)
  * [Change structure and operation types](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/change_structure_and_operation_types.md)
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

___


`Automerge.change(doc, message, callback)` enables you to modify an Automerge document `doc`.
The `doc` object is not modified directly, since it is immutable; instead, `Automerge.change()`
returns an updated copy of the document. The `callback` function is called with a mutable copy of
`doc`, as shown below. The `message` argument allows you to attach arbitrary additional data to the
change, which is not interpreted by Automerge, but saved as part of the change history. The `message`
argument is optional; if you want to omit it, you can simply call `Automerge.change(doc, callback)`.

Within the callback you can use standard JavaScript object manipulation operations to change the
document:

```js
newDoc = Automerge.change(currentDoc, doc => {
  doc.property    = 'value'  // assigns a string value to a property
  doc['property'] = 'value'  // equivalent to the previous line

  delete doc['property']     // removes a property

  doc.stringValue = 'value'  // all JSON primitive datatypes are supported
  doc.numberValue = 1
  doc.boolValue = true
  doc.nullValue = null

  doc.nestedObject = {}      // creates a nested object
  doc.nestedObject.property = 'value'

  // you can also assign an object that already has some properties:
  doc.otherObject = {key: 'value', number: 42}
})
```

Object properties starting with an underscore cannot be used, as these are reserved by Automerge.

The top-level Automerge document is always an object (i.e. a mapping from properties to values).
You can use arrays (lists) by assigning a JavaScript array object to a property within a document.
Then you can use most of the standard
[Array functions](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array)
to manipulate the array:

```js
newDoc = Automerge.change(currentDoc, doc => {
  doc.list = []              // creates an empty list object
  doc.list.push(2, 3)        // push() adds elements to the end
  doc.list.unshift(0, 1)     // unshift() adds elements at the beginning
  doc.list[3] = Math.PI      // overwriting list element by index
  // now doc.list is [0, 1, 2, 3.141592653589793]

  // Looping over lists works as you'd expect:
  for (let i = 0; i < doc.list.length; i++) doc.list[i] *= 2
  // now doc.list is [0, 2, 4, 6.283185307179586]

  doc.list.insertAt(1, 'hello', 'world')  // inserts elements at given index
  doc.list.deleteAt(5)                    // deletes element at given index
  // now doc.list is [0, 'hello', 'world', 2, 4]

  doc.list.splice(2, 2, 'automerge')      // like JS standard Array.splice()
  // now doc.list is [0, 'hello', 'automerge', 4]

  doc.list[4] = {key: 'value'}  // objects can be nested inside lists as well
})
```

The `newDoc` returned by `Automerge.change()` is a regular JavaScript object containing all the
edits you made in the callback. Any parts of the document that you didn't change are carried over
unmodified. The only special things about it are:

* All objects in the document are made immutable using
  [`Object.freeze()`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze),
  to ensure you don't accidentally modify them outside of an `Automerge.change()` callback.
* Every object and every array has an `_objectId` property, which is used by Automerge to track
  which object is which.
* Objects also have a `_conflicts` property, which is used when several users make conflicting
  changes at the same time (see below).

