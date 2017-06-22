## Tesseract

An attempt at making a transparent javascript CRDT that behaves like native types.

### Example usage

```js
const tesseract = require('tesseract')
let state1 = tesseract.init()
// {}

state1 = tesseract.changeset(state1, 'Initialize card list', doc => {
  doc.cards = []
})
// { cards: [] }

state1 = tesseract.changeset(state1, 'Add card', doc => {
  doc.cards.push({title: 'Rewrite everything in Clojure', done: false})
})
// { cards: [ { title: 'Rewrite everything in Clojure', done: false } ] }

state1 = tesseract.changeset(state1, 'Add another card', doc => {
  doc.cards[1] = {title: 'Reticulate splines', done: false}
})
// { cards:
//    [ { title: 'Rewrite everything in Clojure', done: false },
//      { title: 'Reticulate splines', done: false } ] }

state1 = tesseract.changeset(state1, 'Add a third card', doc => {
  doc.cards.insertAt(0, {title: 'Rewrite everything in Haskell', done: false})
})
// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Rewrite everything in Clojure', done: false },
//      { title: 'Reticulate splines', done: false } ] }

let state2 = tesseract.init()
state2 = tesseract.merge(state2, state1)

state1 = tesseract.changeset(state1, 'Mark card as done', doc => {
  doc.cards[1].done = true
})
// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Rewrite everything in Clojure', done: true },
//      { title: 'Reticulate splines', done: false } ] }

state2 = tesseract.changeset(state2, 'Delete card', doc => {
  delete doc.cards[1]
})
// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Reticulate splines', done: false } ] }

state1 = tesseract.merge(state1, state2)
// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Reticulate splines', done: false } ] }

tesseract.getHistory(state1).map(state => [state.changeset.message, state.snapshot.cards.length])
// [ [ 'Initialize card list', 0 ],
//   [ 'Add card', 1 ],
//   [ 'Add another card', 2 ],
//   [ 'Add a third card', 3 ],
//   [ 'Mark card as done', 3 ],
//   [ 'Delete card', 2 ] ]
```

### Testing

```
  $ npm test
```
