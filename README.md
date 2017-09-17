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


## Example Usage

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

// Assigning to an array index is also fine:
doc1 = Automerge.change(doc1, 'Add another card', doc => {
  doc.cards[1] = {title: 'Reticulate splines', done: false}
})

// { cards:
//    [ { title: 'Rewrite everything in Clojure', done: false },
//      { title: 'Reticulate splines', done: false } ] }

// Automerge also defines an insertAt() method for inserting a new element at a particular
// position in a list. You could equally well use splice(), if you prefer.
doc1 = Automerge.change(doc1, 'Add a third card', doc => {
  doc.cards.insertAt(0, {title: 'Rewrite everything in Haskell', done: false})
})

// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Rewrite everything in Clojure', done: false },
//      { title: 'Reticulate splines', done: false } ] }

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
//      { title: 'Rewrite everything in Clojure', done: false },
//      { title: 'Reticulate splines', done: false } ] }

// And, unbeknownst to device 1, also make a change on device 2:
doc2 = Automerge.change(doc2, 'Delete card', doc => {
  delete doc.cards[1]
})

// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Reticulate splines', done: false } ] }

// Now comes the moment of truth. Let's merge the changes from device 2 back
// into device 1. You can also do the merge the other way round, and you'll get
// the same result. The merged result remembers that 'Rewrite everything in
// Haskell' was set to true, and that 'Rewrite everything in Clojure' was
// deleted:

let finalDoc = Automerge.merge(doc1, doc2)

// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: true },
//      { title: 'Reticulate splines', done: false } ] }

// If you want to know what changed from one version to another, you can get a
// diff describing the changes (the objectId is a unique identifier for a
// particular card object):

Automerge.diff(doc2, finalDoc)
// [ { action: 'set',
//     objectId: 'ef794659-d8fa-4e89-8605-06dff020513d',
//     key: 'done',
//     value: true } ]

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
//   [ 'Add a third card', 3 ],
//   [ 'Mark card as done', 3 ],
//   [ 'Delete card', 2 ] ]
```

For an example of a real-life application built upon Automerge, check out
[Trellis](https://github.com/automerge/trellis), a project management tool.


## Setup

If you're in Node.js, you can install Automerge through npm, and then import it with
`require('automerge')` as in the example above:

    $ npm install --save automerge

Otherwise, clone this repository, and then you can use the following commands:

* `npm install` — install dependencies.
* `npm test` — run the test suite in Node.
* `npm run browsertest` — run the test suite in web browsers.
* `npm run webpack` — create a bundled JS file for web browsers (including dependencies) that
  you can load through a script tag, and write it to `dist/automerge.js`.


## Caveats

The project currently has a number of limitations that you should be aware of:

* No integrity checking: if a buggy (or malicious) device makes corrupted edits, it can cause
  the application state on other devices to be come corrupted or go out of sync.
* No security: there is currently no encryption, authentication, or access control.
* Performance: it's good enough for small applications with a few dozen objects, but there is more
  work to be done before it's suitable for more ambitious apps.
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
