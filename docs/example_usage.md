## Example usage

---
### Automerge document pages
* [Automerge synopsis](https://github.com/restarian/automerge/blob/brace_document/docs/automerge_synopsis.md)
* [Changelog](https://github.com/restarian/automerge/blob/brace_document/docs/changelog.md)
* [Conflicting changes](https://github.com/restarian/automerge/blob/brace_document/docs/conflicting_changes.md)
* [Document lifecycle](https://github.com/restarian/automerge/blob/brace_document/docs/document_lifecycle.md)
* [Examining document history](https://github.com/restarian/automerge/blob/brace_document/docs/examining_document_history.md)
* **Example usage**
* [Manipulating and inspecting data](https://github.com/restarian/automerge/blob/brace_document/docs/manipulating_and_inspecting_data.md)
* [Sending and receiving changes](https://github.com/restarian/automerge/blob/brace_document/docs/sending_and_receiving_changes.md)
* [Text editing support](https://github.com/restarian/automerge/blob/brace_document/docs/text_editing_support.md)
* Internal data structures
  * [Actor IDs, vector clocks and causality](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/actor_IDs,_vector_clocks_and_causality.md)
  * [Change structure and operation types](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/change_structure_and_operation_types.md)
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

---

The following code samples give a quick overview of how to use Automerge.
For examples of real-life applications built upon Automerge, check out:

* [Trellis](https://github.com/automerge/trellis), a project management tool
  in the style of [Trello](https://trello.com/).
* [Pixelpusher](https://github.com/automerge/pixelpusher), a pixel art editor
  ([blog post](https://medium.com/@pvh/pixelpusher-real-time-peer-to-peer-collaboration-with-react-7c7bc8ecbf74)).

```js
// This is how you load Automerge in Node. In a browser, simply including the
// script tag will set up the Automerge object.
const Automerge = require('automerge')

// Let's say doc1 is the application state on device 1.
// Further down we'll simulate a second device.
let doc1 = Automerge.init()

// That initial state is just an empty object: {}
// Actually, it's got an automatically generated _objectId property, but we'll
// leave out the object IDs from this example in order to make it easier to
// read.

// The doc1 object is immutable -- you cannot change it directly (if you try,
// you'll either get an exception or your change will be silently ignored,
// depending on your JavaScript engine). To change it, you need to call
// Automerge.change() with a callback in which you can mutate the state. You
// can also include a human-readable description of the change, like a commit
// message, which is stored in the change history (see below).

doc1 = Automerge.change(doc1, 'Initialize card list', doc => {
  doc.cards = []
})

// { cards: [] }

// To change the state, you can use the regular JavaScript array mutation
// methods such as push(). Internally, Automerge translates this mutable API
// call into an update of the immutable state object. Note that we must pass in
// doc1, and get back an updated object which we assign to the same variable
// doc1. The original document object is not modified.

doc1 = Automerge.change(doc1, 'Add card', doc => {
  doc.cards.push({title: 'Rewrite everything in Clojure', done: false})
})

// { cards: [ { title: 'Rewrite everything in Clojure', done: false } ] }

// Automerge also defines an insertAt() method for inserting a new element at a particular
// position in a list. You could equally well use splice(), if you prefer.
doc1 = Automerge.change(doc1, 'Add another card', doc => {
  doc.cards.insertAt(0, {title: 'Rewrite everything in Haskell', done: false})
})

// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Rewrite everything in Clojure', done: false } ] }

// Now let's simulate another device, whose application state is doc2. We
// initialise it separately, and merge doc1 into it. After merging, doc2 has
// a copy of all the cards in doc1.

let doc2 = Automerge.init()
doc2 = Automerge.merge(doc2, doc1)

// Now make a change on device 1:
doc1 = Automerge.change(doc1, 'Mark card as done', doc => {
  doc.cards[0].done = true
})

// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: true },
//      { title: 'Rewrite everything in Clojure', done: false } ] }

// And, unbeknownst to device 1, also make a change on device 2:
doc2 = Automerge.change(doc2, 'Delete card', doc => {
  delete doc.cards[1]
})

// { cards: [ { title: 'Rewrite everything in Haskell', done: false } ] }

// Now comes the moment of truth. Let's merge the changes from device 2 back
// into device 1. You can also do the merge the other way round, and you'll get
// the same result. The merged result remembers that 'Rewrite everything in
// Haskell' was set to true, and that 'Rewrite everything in Clojure' was
// deleted:

let finalDoc = Automerge.merge(doc1, doc2)

// { cards: [ { title: 'Rewrite everything in Haskell', done: true } ] }

// As our final trick, we can inspect the change history. Automerge
// automatically keeps track of every change, along with the "commit message"
// that you passed to change(). When you query that history, it includes both
// changes you made locally, and also changes that came from other devices. You
// can also see a snapshot of the application state at any moment in time in the
// past. For example, we can count how many cards there were at each point:

Automerge.getHistory(finalDoc)
  .map(state => [state.change.message, state.snapshot.cards.length])
// [ [ 'Initialize card list', 0 ],
//   [ 'Add card', 1 ],
//   [ 'Add another card', 2 ],
//   [ 'Mark card as done', 2 ],
//   [ 'Delete card', 1 ] ]
```


