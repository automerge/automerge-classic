# Automerge

[Join the Automerge Slack community](https://communityinviter.com/apps/automerge/automerge)

Automerge is a library of data structures for building collaborative applications in JavaScript.

A common approach to building JavaScript apps involves keeping the state of your application in
model objects, such as a JSON document. For example, imagine you are developing a task-tracking app
in which each task is represented by a card. In vanilla JavaScript you might write the following:

```js
var doc = {cards: []}

// User adds a card
doc.cards.push({title: 'Reticulate splines', done: false})

// User marks a task as done
doc.cards[0].done = true

// Save the document to disk
localStorage.setItem('MyToDoList', JSON.stringify(doc))
```

Automerge is used in a similar way, but the big difference is that it supports **automatic syncing
and merging**:

* You can have a copy of the application state locally on several devices (which may belong to the
  same user, or to different users). Each user can independently update the application state on
  their local device, even while offline, and save the state to local disk.
  
  (Similar to git, which allows you to edit files and commit changes offline.)

* When a network connection is available, Automerge figures out which changes need to be synced from
  one device to another, and brings them into the same state.

  (Similar to git, which lets you push your own changes, and pull changes from other developers,
  when you are online.)

* If the state was concurrently changed on different devices, Automerge automatically merges the
  changes together cleanly, so that everybody ends up in the same state, and no changes are lost.

  (Different from git: **no merge conflicts to resolve!**)


## Features and Design Principles

* **Network-agnostic**. Automerge is a pure data structure library that does not care what kind of
  network you use: client/server, peer-to-peer, Bluetooth, carrier pigeon, whatever, anything goes.
  Bindings to particular networking technologies are handled by separate libraries. For example, see
  [MPL](https://github.com/automerge/mpl) for an implementation that uses Automerge in a
  peer-to-peer model using [WebRTC](https://webrtc.org/).
* **Immutable state**. A Automerge object is an immutable snapshot of the application state at one
  point in time. Whenever you make a change, or merge in a change that came from the network, you
  get back a new state object reflecting that change. This fact makes Automerge compatible with the
  functional reactive programming style of [Redux](http://redux.js.org/) and
  [Elm](http://elm-lang.org/), for example. Internally, Automerge is built upon Facebook's
  [Immutable.js](http://facebook.github.io/immutable-js/), but the Automerge API uses regular
  JavaScript objects (using
  [`Object.freeze`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze)
  to prevent accidental mutation).
* **Automatic merging**. Automerge is a so-called Conflict-Free Replicated Data Type
  ([CRDT](https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type)), which allows
  concurrent changes on different devices to be merged automatically without requiring any central
  server. It is based on [academic research on JSON CRDTs](https://arxiv.org/abs/1608.03960), but
  the details of the algorithm in Automerge are different from the JSON CRDT paper, and we are
  planning to publish more detail about it in the future.
* **Fairly portable**. We're not yet making an effort to support old platforms, but we have tested
  Automerge in Node.js, Chrome, Firefox, and [Electron](https://electron.atom.io/).


## Setup

If you're in Node.js, you can install Automerge through npm:

    $ npm install --save automerge

Then you can import it with `require('automerge')` as in the example below.

Otherwise, clone this repository, and then you can use the following commands:

* `npm install` — installs dependencies.
* `npm test` — runs the test suite in Node.
* `npm run browsertest` — runs the test suite in web browsers.
* `npm run webpack` — creates a bundled JS file `dist/automerge.js` for web browsers.
  It includes the dependencies and is set up so that you can load through a script tag.


## Example Usage

The following code samples give a quick overview of how to use Automerge.
For an example of a real-life application built upon Automerge, check out
[Trellis](https://github.com/automerge/trellis), a project management tool.

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
//      { title: 'Rewrite everything in Clojure', done: false } }

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


## Documentation

### Automerge document lifecycle

`Automerge.init(actorId)` creates a new, empty Automerge document.
You can optionally pass in an `actorId`, which is a string that uniquely identifies the current
node; if you omit `actorId`, a random UUID is generated.

If you pass in your own `actorId`, you must ensure that there can never be two different processes
with the same actor ID. Even if you have two different processes running on the same machine, they
must have distinct actor IDs. Unless you know what you are doing, it is recommended that you stick
with the default, and let `actorId` be auto-generated.

`Automerge.save(doc)` serializes the state of Automerge document `doc` to a string, which you can
write to disk. The string contains an encoding of all of the full change history of the document
(a bit like a git repository).

`Automerge.load(string, actorId)` unserializes an Automerge document from a `string` that was
produced by `Automerge.save()`. The `actorId` argument is optional, and allows you to specify
a string that uniquely identifies the current node, like with `Automerge.init()`. Unless you know
what you are doing, it is recommended that you omit the `actorId` argument.

### Manipulating and inspecting state

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

### Text editing support

`Automerge.Text` provides experimental support for collaborative text editing.
Under the hood, text is represented as a list of characters, which is edited by inserting or
deleting individual characters. Compared to using a regular JavaScript array,
`Automerge.Text` offers better performance.

(Side note: technically, text should be represented as a list of
[Unicode *grapheme clusters*](http://www.unicode.org/reports/tr29/).
What the user thinks of as a "character" may actually be a series of several Unicode code points,
including accents, diacritics, and other combining marks. A grapheme cluster is the smallest
editable unit of text: that is, the thing that gets deleted if you press the delete key once, or the
thing that the cursor skips over if you press the right-arrow key once. Emoji make a good test case,
since many emoji consist of a sequence of several Unicode code points — for example, the
[skintone modifier](http://www.unicode.org/reports/tr51/) is a combining mark.)

You can create a Text object inside a change callback.
Then you can use `insertAt()` and `deleteAt()` to insert and delete characters (same API as for
list modifications, shown above):

```js
newDoc = Automerge.change(currentDoc, doc => {
  doc.text = new Automerge.Text()
  doc.text.insertAt(0, 'h', 'e', 'l', 'l', 'o')
  doc.text.deleteAt(0)
  doc.text.insertAt(0, 'H')
})
```

To inspect a text object and render it, you can use the following methods
(outside of a change callback):

```js
newDoc.text.length   // returns 5, the number of characters
newDoc.text.get(0)   // returns 'H', the 0th character in the text
newDoc.text.join('') // returns 'Hello', the concatenation of all characters
for (let char of newDoc.text) console.log(char) // iterates over all characters
```

### Sending and receiving changes

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

### Conflicting changes

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

### Examining document history

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

## Caveats

The project currently has a number of limitations that you should be aware of:

* No integrity checking: if a buggy (or malicious) device makes corrupted edits, it can cause
  the application state on other devices to be come corrupted or go out of sync.
* No security: there is currently no encryption, authentication, or access control.
* Small number of collaborators: Automerge is designed for small-group collaborations. While there
  is no hard limit on the number of devices that can update a document, performance will degrade
  if you go beyond, say, 100 devices or so.
* ...and more, see the [open issues](https://github.com/automerge/automerge/issues).


## Meta

Copyright 2017, Ink & Switch LLC, and University of Cambridge.
Released under the terms of the MIT license (see `LICENSE`).

Created by
[Martin Kleppmann](http://martin.kleppmann.com/),
Orion Henry,
[Peter van Hardenberg](https://twitter.com/pvh),
[Roshan Choxi](https://www.linkedin.com/in/choxi/), and
[Adam Wiggins](http://about.adamwiggins.com/).
