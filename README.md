<img src='./img/sign.svg' width='500' alt='Automerge logo' />

💬 [Join the Automerge Slack community](https://join.slack.com/t/automerge/shared_invite/zt-e4p3760n-kKh7r3KRH1YwwNfiZM8ktw)

[![Build Status](https://github.com/automerge/automerge/actions/workflows/automerge-ci.yml/badge.svg)](https://github.com/automerge/automerge/actions/workflows/automerge-ci.yml)
[![Browser Test Status](https://app.saucelabs.com/buildstatus/automerge)](https://app.saucelabs.com/open_sauce/user/automerge/builds)

Automerge is a library of data structures for building collaborative applications in JavaScript.

A common approach to building JavaScript apps involves keeping the state of your application in
model objects, such as a JSON document. For example, imagine you are developing a task-tracking app
in which each task is represented by a card. In vanilla JavaScript you might write the following:

```js
const doc = { cards: [] }

// User adds a card
doc.cards.push({ title: 'Reticulate splines', done: false })

// User marks a task as done
doc.cards[0].done = true
```

Automerge is used in a similar way, but the big difference is that it supports **automatic syncing
and merging**:

- You can have a copy of the application state locally on several devices (which may belong to the
  same user, or to different users). Each user can independently update the application state on
  their local device, even while offline, and save the state to local disk.

  (Similar to git, which allows you to edit files and commit changes offline.)

- When a network connection is available, Automerge figures out which changes need to be synced from
  one device to another, and brings them into the same state.

  (Similar to git, which lets you push your own changes, and pull changes from other developers,
  when you are online.)

- If the state was changed concurrently on different devices, Automerge automatically merges the
  changes together cleanly, so that everybody ends up in the same state, and no changes are lost.

  (Different from git: **no merge conflicts to resolve!**)

- Automerge keeps track of the changes you make to the state, so that you can view old versions,
  compare versions, create branches, and choose when to merge them.

  (Similar to git, which allows diffing, branching, merging, and pull request workflows.)

## Features and design principles

- **Network-agnostic**. Automerge is a pure data structure library that does not care about what
  kind of network you use. It works with any connection-oriented network protocol, which could be
  client/server (e.g. WebSocket), peer-to-peer (e.g. WebRTC), or entirely local (e.g. Bluetooth).
  Bindings to particular networking technologies are handled by separate libraries;
  see the section on [Sending and receiving changes](#sending-and-receiving-changes) for examples.
  It also works with unidirectional messaging: you can send an Automerge file as email attachment,
  or on a USB drive in the mail, and the recipient will be able to merge it with their version.
- **Immutable state**. An Automerge object is an immutable snapshot of the application state at one
  point in time. Whenever you make a change, or merge in a change that came from the network, you
  get back a new state object reflecting that change. This fact makes Automerge compatible with the
  functional reactive programming style of [React](https://reactjs.org) and
  [Redux](http://redux.js.org/), for example.
- **Automatic merging**. Automerge is a _Conflict-Free Replicated Data Type_ ([CRDT](https://crdt.tech/)),
  which allows concurrent changes on different devices to be merged automatically without requiring any
  central server. It is based on [academic research on JSON CRDTs](https://arxiv.org/abs/1608.03960), but
  the details of the algorithm in Automerge are different from the JSON CRDT paper, and we are
  planning to publish more detail about it in the future.
- **Fairly portable**. We're not yet making an effort to support old platforms, but we have tested
  Automerge in Node.js, Chrome, Firefox, Safari, MS Edge, and [Electron](https://electron.atom.io/).
  For TypeScript users, Automerge comes with
  [type definitions](https://github.com/automerge/automerge/blob/main/@types/automerge/index.d.ts)
  that allow you to use Automerge in a type-safe way.

Automerge is designed for creating [local-first software](https://www.inkandswitch.com/local-first.html),
i.e. software that treats a user's local copy of their data (on their own device) as primary, rather
than centralising data in a cloud service. The local-first approach enables offline working while
still allowing several users to collaborate in real-time and sync their data across multiple
devices. By reducing the dependency on cloud services (which may disappear if someone stops paying
for the servers), local-first software can have greater longevity, stronger privacy, and better
performance, and it gives users more control over their data.
The [essay on local-first software](https://www.inkandswitch.com/local-first.html) goes into more
detail on the philosophy behind Automerge, and the pros and cons of this approach.

However, if you want to use Automerge with a centralised server, that works fine too! You still get
useful benefits, such as allowing several clients to concurrently update the data, easy sync between
clients and server, being able to inspect the change history of your app's data, and support for
branching and merging workflows.

## Setup

If you're using npm, `npm install automerge`. If you're using yarn, `yarn add automerge`. Then you
can import it with `require('automerge')` as in [the example below](#usage) (or
`import * as Automerge from 'automerge'` if using ES2015 or TypeScript).

Otherwise, clone this repository, and then you can use the following commands:

- `yarn install` — installs dependencies.
- `yarn test` — runs the test suite in Node.
- `yarn run browsertest` — runs the test suite in web browsers.
- `yarn build` — creates a bundled JS file `dist/automerge.js` for web browsers. It includes the
  dependencies and is set up so that you can load through a script tag.

## Usage

For examples of real-life applications built upon Automerge, check out:

- [PushPin](https://github.com/automerge/pushpin), a mature React-based personal archiving application
- [Farm](https://github.com/inkandswitch/farm), a programmable, collaborative computing environment
- [Capstone](https://github.com/inkandswitch/capstone), a tablet-based note-taking and
  idea-development tool ([blog post](https://www.inkandswitch.com/capstone-manuscript.html))
- [Pixelpusher](https://github.com/automerge/pixelpusher), a pixel art editor
  ([blog post](https://medium.com/@pvh/pixelpusher-real-time-peer-to-peer-collaboration-with-react-7c7bc8ecbf74)).
- [Trellis](https://github.com/automerge/trellis), a project management tool in the style of
  [Trello](https://trello.com/).

The following code sample gives a quick overview of how to use Automerge.

```js
// This is how you load Automerge in Node. In a browser, simply including the
// script tag will set up the Automerge object.
const Automerge = require('automerge')

// Let's say doc1 is the application state on device 1.
// Further down we'll simulate a second device.
// We initialize the document to initially contain an empty list of cards.
let doc1 = Automerge.from({ cards: [] })

// The doc1 object is treated as immutable -- you must never change it
// directly. To change it, you need to call Automerge.change() with a callback
// in which you can mutate the state. You can also include a human-readable
// description of the change, like a commit message, which is stored in the
// change history (see below).

doc1 = Automerge.change(doc1, 'Add card', doc => {
  doc.cards.push({ title: 'Rewrite everything in Clojure', done: false })
})

// Now the state of doc1 is:
// { cards: [ { title: 'Rewrite everything in Clojure', done: false } ] }

// Automerge also defines an insertAt() method for inserting a new element at
// a particular position in a list. Or you could use splice(), if you prefer.
doc1 = Automerge.change(doc1, 'Add another card', doc => {
  doc.cards.insertAt(0, { title: 'Rewrite everything in Haskell', done: false })
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

Automerge.getHistory(finalDoc).map(state => [state.change.message, state.snapshot.cards.length])
// [ [ 'Initialization', 0 ],
//   [ 'Add card', 1 ],
//   [ 'Add another card', 2 ],
//   [ 'Mark card as done', 2 ],
//   [ 'Delete card', 1 ] ]
```

## Automerge document lifecycle

### Initializing a document

`Automerge.init()` creates a new, empty Automerge document.

```js
const doc = Automerge.init() // doc = {}
```

`Automerge.from(initialState)` creates a new Automerge document and populates it with the contents
of the object `initialState`.

```js
const doc = Automerge.from({ cards: [] }) // doc = { cards: [] }
```

The value passed to `Automerge.from` **must always be an object**.

An Automerge document must be treated as immutable. It is **never changed directly**, only with the
`Automerge.change` function, described [below](#updating-a-document).

> At the moment, Automerge does not enforce this immutability due to the
> [performance cost](https://github.com/automerge/automerge/issues/177). If you want to make the
> document object strictly immutable you can pass an option: `Automerge.init({freeze: true})` or
> `Automerge.load(string, {freeze: true})`.

### Updating a document

`Automerge.change(doc, message, changeFn)` enables you to modify an Automerge document `doc`,
returning an updated copy of the document.

The `changeFn` function you pass to `Automerge.change()` is called with a mutable version of `doc`,
as shown below.

The optional `message` argument allows you to attach an arbitrary string to the change, which is not
interpreted by Automerge, but saved as part of the change history. You can omit the `message`
argument and simply call `Automerge.change(doc, callback)`.

Within the callback you can use standard JavaScript object manipulation operations to change the
document:

```js
newDoc = Automerge.change(currentDoc, doc => {
  // NOTE: never modify `currentDoc` directly, only ever change `doc`!

  doc.property = 'value' // assigns a string value to a property
  doc['property'] = 'value' // equivalent to the previous line

  delete doc['property'] // removes a property

  // all JSON primitive datatypes are supported
  doc.stringValue = 'value'
  doc.numberValue = 1
  doc.boolValue = true
  doc.nullValue = null

  doc.nestedObject = {} // creates a nested object
  doc.nestedObject.property = 'value'

  // you can also assign an object that already has some properties
  doc.otherObject = { key: 'value', number: 42 }

  // Arrays are fully supported
  doc.list = [] // creates an empty list object
  doc.list.push(2, 3) // push() adds elements to the end
  doc.list.unshift(0, 1) // unshift() adds elements at the beginning
  doc.list[3] = Math.PI // overwriting list element by index
  // now doc.list is [0, 1, 2, 3.141592653589793]

  // Looping over lists works as you'd expect:
  for (let i = 0; i < doc.list.length; i++) doc.list[i] *= 2
  // now doc.list is [0, 2, 4, 6.283185307179586]

  doc.list.splice(2, 2, 'automerge')
  // now doc.list is [0, 'hello', 'automerge', 4]

  doc.list[4] = { key: 'value' } // objects can be nested inside lists as well

  // Arrays in Automerge offer the convenience functions `insertAt` and `deleteAt`
  doc.list.insertAt(1, 'hello', 'world') // inserts elements at given index
  doc.list.deleteAt(5) // deletes element at given index
  // now doc.list is [0, 'hello', 'world', 2, 4]
})
```

The `newDoc` returned by `Automerge.change()` is a regular JavaScript object containing all the
edits you made in the callback. Any parts of the document that you didn't change are carried over
unmodified. The only special things about it are:

- It is treated as immutable, so all changes must go through `Automerge.change()`.
- Every object has a unique ID, which you can get by passing the object to the
  `Automerge.getObjectId()` function. This ID is used by Automerge to track which object is which.
- Objects also have information about _conflicts_, which is used when several users make changes to
  the same property concurrently (see [below](#conflicting-changes)). You can get conflicts using
  the `Automerge.getConflicts()` function.

### Making fine-grained changes

If you have previously worked with immutable state in JavaScript, you might be in the habit of
using [idioms like these](https://redux.js.org/recipes/structuring-reducers/updating-normalized-data):

```js
state = Automerge.change(state, 'Add card', doc => {
  const newItem = { id: 123, title: 'Rewrite everything in Rust', done: false }
  doc.cards = {
    ids: [...doc.cards.ids, newItem.id],
    entities: { ...doc.cards.entities, [newItem.id]: newItem }
  }
})
```

While this pattern works fine outside of Automerge, please **don't do this in Automerge**! Please
use mutable idioms to update the state instead, like this:

```js
state = Automerge.change(state, 'Add card', doc => {
  const newItem = { id: 123, title: 'Rewrite everything in Rust', done: false }
  doc.cards.ids.push(newItem.id)
  doc.cards.entities[newItem.id] = newItem
})
```

Even though you are using mutating APIs, Automerge ensures that the code above does not actually
mutate `state`, but returns a new copy of `state` in which the changes are reflected. The problem
with the first example is that from Automerge's point of view, you are replacing the entire
`doc.cards` object (and everything inside it) with a brand new object. Thus, if two users
concurrently update the document, Automerge will not be able to merge those changes (instead, you
will just get a conflict on the `doc.cards` property).

The second example avoids this problem by making the changes at a fine-grained level: adding one
item to the array of IDs with `ids.push(newItem.id)`, and adding one item to the map of entities
with `entities[newItem.id] = newItem`. This code works much better, since it tells Automerge
exactly which changes you are making to the state, and this information allows Automerge to deal
much better with concurrent updates by different users.

As a general principle with Automerge, you should make state updates at the most fine-grained
level possible. Don't replace an entire object if you're only modifying one property of that
object; just assign that one property instead.

### Persisting a document

`Automerge.save(doc)` serializes the state of Automerge document `doc` to a byte array
(`Uint8Array`), which you can write to disk (e.g. as a file on the filesystem if you're using
Node.js, or to IndexedDB if you're running in a browser). The serialized data contains the full
change history of the document (a bit like a Git repository).

`Automerge.load(byteArray)` unserializes an Automerge document from a byte array that was produced
by `Automerge.save()`.

> ### Note: Specifying `actorId`
>
> The Automerge `init`, `from`, and `load` functions take an optional `actorId` parameter:
>
> ```js
> const actorId = '1234-abcd-56789-qrstuv'
> const doc1 = Automerge.init(actorId)
> const doc2 = Automerge.from({ foo: 1 }, actorId)
> const doc3 = Automerge.load(str, actorId)
> ```
>
> The `actorId` is a string that uniquely identifies the current node; if you omit `actorId`, a
> random UUID is generated. If you pass in your own `actorId`, you must ensure that there can never
> be two different processes with the same actor ID. Even if you have two different processes
> running on the same machine, they must have distinct actor IDs.
>
> **Unless you know what you are doing, you should stick with the default**, and let `actorId` be
> auto-generated.
>
> To get the `actorId` of the current node, call `Automerge.getActorId(doc)`.

### Sending and receiving changes

The Automerge library itself is agnostic to the network layer — that is, you can use whatever
communication mechanism you like to get changes from one node to another. There are currently a few
options, with more under development:

- Use `Automerge.getChanges()` and `Automerge.applyChanges()` to manually capture changes on one
  node and apply them on another. These changes are encoded as byte arrays (`Uint8Array`). You can
  also store a log of these changes on disk in order to persist them.
- Use `Automerge.generateSyncMessage()` to generate messages, send them over any transport protocol
  (e.g. WebSocket), and call `Automerge.receiveSyncMessage()` on the recipient to process the
  messages. The sync protocol is documented in
  [SYNC.md](https://github.com/automerge/automerge/blob/main/SYNC.md).
- There are also a number of external libraries that provide network sync for Automerge; these are
  in the process of being updated for the Automerge 1.0 data format and sync protocol.

The `getChanges()/applyChanges()` API works as follows:

```js
// On one node
let newDoc = Automerge.change(currentDoc, doc => {
  // make arbitrary change to the document
})
let changes = Automerge.getChanges(currentDoc, newDoc)

// broadcast changes as a byte array
network.broadcast(changes)

// On another node, receive the byte array
let changes = network.receive()
let [newDoc, patch] = Automerge.applyChanges(currentDoc, changes)
// `patch` is a description of the changes that were applied (a kind of diff)
```

Note that `Automerge.getChanges(oldDoc, newDoc)` takes two documents as arguments: an old state and
a new state. It then returns a list of all the changes that were made in `newDoc` since `oldDoc`. If
you want a list of all the changes ever made in `doc`, you can call `Automerge.getAllChanges(doc)`.

The counterpart, `Automerge.applyChanges(oldDoc, changes)` applies the list of `changes` to the
given document, and returns a new document with those changes applied. Automerge guarantees that
whenever any two documents have applied the same set of changes — even if the changes were applied
in a different order — then those two documents are equal. That property is called _convergence_,
and it is the essence of what Automerge is all about.

`Automerge.merge(doc1, doc2)` is a related function that is useful for testing. It looks for any
changes that appear in `doc2` but not in `doc1`, and applies them to `doc1`, returning an updated
version of `doc1`. This function requires that `doc1` and `doc2` have different actor IDs (that is,
they originated from different calls to `Automerge.init()`). See the [Usage](#usage) section above
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

The only case Automerge cannot handle automatically, because there is no well-defined resolution, is
**when users concurrently update the same property in the same object** (or, similarly, the same
index in the same list). In this case, Automerge arbitrarily picks one of the concurrently written
values as the "winner":

```js
// Initialize documents with known actor IDs
let doc1 = Automerge.change(Automerge.init('actor-1'), doc => {
  doc.x = 1
})
let doc2 = Automerge.change(Automerge.init('actor-2'), doc => {
  doc.x = 2
})
doc1 = Automerge.merge(doc1, doc2)
doc2 = Automerge.merge(doc2, doc1)

// Now, doc1 might be either {x: 1} or {x: 2} -- the choice is random.
// However, doc2 will be the same, whichever value is chosen as winner.
assert.deepEqual(doc1, doc2)
```

Although only one of the concurrently written values shows up in the object, the other values are
not lost. They are merely relegated to a conflicts object. Suppose `doc.x = 2` is chosen as the
"winning" value:

```js
doc1 // {x: 2}
doc2 // {x: 2}
Automerge.getConflicts(doc1, 'x') // {'1@01234567': 1, '1@89abcdef': 2}
Automerge.getConflicts(doc2, 'x') // {'1@01234567': 1, '1@89abcdef': 2}
```

Here, we've recorded a conflict on property `x`. The object returned by `getConflicts` contains the
conflicting values, both the "winner" and the "loser". You might use the information in the
conflicts object to show the conflict in the user interface. The keys in the conflicts object are
the internal IDs of the operations that updated the property `x`.

The next time you assign to a conflicting property, the conflict is automatically considered to be
resolved, and the conflict disappears from the object returned by `Automerge.getConflicts()`.

### Examining document history

An Automerge document internally saves a complete history of all the changes that were ever made to
it. This enables a nice feature: looking at the document state at past points in time, a.k.a. "time
travel"!

`Automerge.getHistory(doc)` returns a list of all edits made to a document. Each edit is an object
with two properties: `change` is the internal representation of the change (in the same form that
`Automerge.getChanges()` returns), and `snapshot` is the state of the document immediately after the
change was applied.

```js
Automerge.getHistory(doc2)
// [ { change: { message: 'Set x to 1', ... }, snapshot: { x: 1 } },
//   { change: { message: 'Set x to 2', ... }, snapshot: { x: 2 } } ]
```

Within the change object, the property `message` is set to the free-form "commit message" that was
passed in as second argument to `Automerge.change()` (if any). The rest of the change object
describes the changes in Automerge's internal change format.

## Custom CRDT types

### Counter

If you have a numeric value that is only ever changed by adding or subtracting (e.g. counting how
many times the user has done a particular thing), you should use the `Automerge.Counter` datatype
instead of a plain number, because it deals with concurrent changes correctly.

> **Note:** Using the `Automerge.Counter` datatype is safer than changing a number value yourself
> using the `++` or `+= 1` operators. For example, suppose the value is currently **3**:
>
> - If two users increment it concurrently, they will both register **4** as the new value, whereas
>   the two increments should result in a value of **5**.
> - If one user increments twice and the other user increments three times before the documents are
>   merged, we will now have [conflicting changes](#conflicting-changes) (**5** vs. **6**), rather
>   than the desired value of **8** (3 + 2 + 3).

To set up a `Counter`:

```js
state = Automerge.change(state, doc => {
  // The counter is initialized to 0 by default. You can pass a number to the
  // Automerge.Counter constructor if you want a different initial value.
  doc.buttonClicks = new Automerge.Counter()
})
```

To get the current counter value, use `doc.buttonClicks.value`. Whenever you want to increase or
decrease the counter value, you can use the `.increment()` or `.decrement()` method:

```js
state = Automerge.change(state, doc => {
  doc.buttonClicks.increment() // Add 1 to counter value
  doc.buttonClicks.increment(4) // Add 4 to counter value
  doc.buttonClicks.decrement(3) // Subtract 3 from counter value
})
```

> **Note:** In relational databases it is common to use an auto-incrementing counter to generate
> primary keys for rows in a table, but this is not safe in Automerge, since several users may end
> up generating the same counter value! See the [Table](#table) datatype below for implementing a
> relational-like table with a primary key.

### Text

`Automerge.Text` provides support for collaborative text editing. Under the hood, text is
represented as a list of characters, which is edited by inserting or deleting individual characters.
Compared to using a regular JavaScript array, `Automerge.Text` offers better performance.

> **Note:** Technically, text should be represented as a list of
> [Unicode _grapheme clusters_](http://www.unicode.org/reports/tr29/). What the user thinks of as a
> "character" may actually be a series of several Unicode code points, including accents,
> diacritics, and other combining marks. A grapheme cluster is the smallest editable unit of text:
> that is, the thing that gets deleted if you press the delete key once, or the thing that the
> cursor skips over if you press the right-arrow key once. Emoji make a good test case, since many
> emoji consist of a sequence of several Unicode code points (for example, the
> [skintone modifier](http://www.unicode.org/reports/tr51/) is a combining mark).

You can create a Text object inside a change callback. Then you can use `insertAt()` and
`deleteAt()` to insert and delete characters (same API as for list modifications, shown
[above](#updating-a-document)):

```js
newDoc = Automerge.change(currentDoc, doc => {
  doc.text = new Automerge.Text()
  doc.text.insertAt(0, 'h', 'e', 'l', 'l', 'o')
  doc.text.deleteAt(0)
  doc.text.insertAt(0, 'H')
})
```

To inspect a text object and render it, you can use the following methods (outside of a change
callback):

```js
newDoc.text.length // returns 5, the number of characters
newDoc.text.get(0) // returns 'H', the 0th character in the text
newDoc.text.toString() // returns 'Hello', the concatenation of all characters
for (let char of newDoc.text) console.log(char) // iterates over all characters
```

### Table

`Automerge.Table` provides a collection datatype that is similar to a table in a relational
database. It is intended for a set of objects (_rows_) that have the same properties (_columns_ in a
relational table). Unlike a list, the objects have no order. You can scan over the objects in a
table, or look up individual objects by their primary key. An Automerge document can contain as many
tables as you want.

Each object is assigned a primary key (a unique ID) by Automerge. When you want to reference one
object from another, it is important that you use this Automerge-generated ID; do not generate your
own IDs.

You can create new tables and insert rows like this:

```js
let database = Automerge.change(Automerge.init(), doc => {
  doc.authors = new Automerge.Table()
  doc.publications = new Automerge.Table()

  // Automerge.Table.add() inserts a new row into the database
  // and returns the primary key (unique ID) of the new row
  const martinID = doc.authors.add({ surname: 'Kleppmann', forename: 'Martin' })

  // Adding a publication that references the above author ID
  const ddia = doc.publications.add({
    type: 'book',
    authors: [martinID],
    title: 'Designing Data-Intensive Applications',
    publisher: "O'Reilly Media",
    year: 2017
  })
})
```

You can read the contents of a table like this:

```js
// Array of row objects
database.publications.rows

// Array of row IDs (primary keys)
database.publications.ids

// Looking up a row by primary key
database.publications.byId('29f6cd15-61ff-460d-b7fb-39a5594f32d5')

// Number of rows in the table
database.publications.count

// Like "SELECT * FROM publications WHERE title LIKE 'Designing%'"
database.publications.filter(pub => pub.title.startsWith('Designing'))

// Like "SELECT publisher FROM publications"
database.publications.map(pub => pub.publisher)
```

You can modify rows in a table like this:

```js
database = Automerge.change(database, doc => {
  // Update a row
  let book = doc.publications.byId('29f6cd15-61ff-460d-b7fb-39a5594f32d5')
  book.isbn = '1449373321'

  // Delete a row
  doc.publications.remove('29f6cd15-61ff-460d-b7fb-39a5594f32d5')
})
```

Note that currently the `Automerge.Table` type does not enforce a schema. By convention, the row
objects that you add to a table should have the same properties (like columns in a table), but
Automerge does not enforce this. This is because different users may be running different versions
of your app, which might be using different properties.

## Scope of Automerge

Automerge is an in-memory data structure library. It does not perform any I/O, neither disk access
nor network communication. Automerge includes general-purpose building blocks for network protocols,
but you need to use a separate library to perform the actual communication (including encryption,
authentication, and access control). Similarly, disk persistence needs to happen in a separate layer
outside of Automerge.

## Meta

Copyright 2017–2021, the Automerge contributors. Released under the terms of the
MIT license (see `LICENSE`).

Created by [Martin Kleppmann](https://martin.kleppmann.com/) and
[many great contributors](https://github.com/automerge/automerge/graphs/contributors).
