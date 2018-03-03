## Automerge Synopsis

[Join the Automerge Slack community](https://communityinviter.com/apps/automerge/automerge)

---
### Automerge document pages
* **Automerge synopsis**
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
  * [State, operations and deltas](https://github.com/restarian/automerge/blob/brace_document/docs/internal_data_structures/state,_operations_and_deltas.md)

---

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
  peer-to-peer model using [WebRTC](https://webrtc.org/), and
  [Hypermerge](https://github.com/automerge/hypermerge) is a peer-to-peer networking layer that uses
  [Hypercore](https://github.com/mafintosh/hypercore), part of the [Dat project](https://datproject.org/).
* **Immutable state**. An Automerge object is an immutable snapshot of the application state at one
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


## Caveats

The project currently has a number of limitations that you should be aware of:

* No integrity checking: if a buggy (or malicious) device makes corrupted edits, it can cause
  the application state on other devices to become corrupted or go out of sync.
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
