## Tesseract

An attempt at making a transparent javascript CRDT that behaves like native types.

### Example usage

```js
const tesseract = require('tesseract')
let state1 = tesseract.init()

// { _objectId: '00000000-0000-0000-0000-000000000000' }

state1 = tesseract.changeset(state1, 'Initialize card list', doc => {
  doc.cards = []
})

// { _objectId: '00000000-0000-0000-0000-000000000000', cards: [] }

state1 = tesseract.changeset(state1, 'Add card', doc => {
  doc.cards.push({title: 'Rewrite everything in Clojure', done: false})
})

// { _objectId: '00000000-0000-0000-0000-000000000000',
//   cards:
//    [ { _objectId: '4c6eb809-3eb1-4f63-9ca9-ac9abad7e897',
//        title: 'Rewrite everything in Clojure',
//        done: false } ] }

state1 = tesseract.changeset(state1, 'Add another card', doc => {
  doc.cards[1] = {title: 'Reticulate splines', done: false}
})

// { _objectId: '00000000-0000-0000-0000-000000000000',
//   cards:
//    [ { _objectId: '4c6eb809-3eb1-4f63-9ca9-ac9abad7e897',
//        title: 'Rewrite everything in Clojure',
//        done: false },
//      { _objectId: 'b3d0aedf-d715-4f18-ae62-18b3f5d20321',
//        title: 'Reticulate splines',
//        done: false } ] }

state1 = tesseract.changeset(state1, 'Add a third card', doc => {
  doc.cards.insertAt(0, {title: 'Rewrite everything in Haskell', done: false})
})

// { _objectId: '00000000-0000-0000-0000-000000000000',
//   cards:
//    [ { _objectId: '5fa360fb-c173-40f8-98b6-de9205c84f99',
//        title: 'Rewrite everything in Haskell',
//        done: false },
//      { _objectId: '4c6eb809-3eb1-4f63-9ca9-ac9abad7e897',
//        title: 'Rewrite everything in Clojure',
//        done: false },
//      { _objectId: 'b3d0aedf-d715-4f18-ae62-18b3f5d20321',
//        title: 'Reticulate splines',
//        done: false } ] }

let state2 = tesseract.init()
state2 = tesseract.merge(state2, state1)

state1 = tesseract.changeset(state1, 'Mark card as done', doc => {
  doc.cards[1].done = true
})

// { _objectId: '00000000-0000-0000-0000-000000000000',
//   cards:
//    [ { _objectId: '5fa360fb-c173-40f8-98b6-de9205c84f99',
//        title: 'Rewrite everything in Haskell',
//        done: false },
//      { _objectId: '4c6eb809-3eb1-4f63-9ca9-ac9abad7e897',
//        title: 'Rewrite everything in Clojure',
//        done: true },
//      { _objectId: 'b3d0aedf-d715-4f18-ae62-18b3f5d20321',
//        title: 'Reticulate splines',
//        done: false } ] }

state2 = tesseract.changeset(state2, 'Delete card', doc => {
  delete doc.cards[1]
})

// { _objectId: '00000000-0000-0000-0000-000000000000',
//   cards:
//    [ { _objectId: '5fa360fb-c173-40f8-98b6-de9205c84f99',
//        title: 'Rewrite everything in Haskell',
//        done: false },
//      { _objectId: 'b3d0aedf-d715-4f18-ae62-18b3f5d20321',
//        title: 'Reticulate splines',
//        done: false } ] }

state1 = tesseract.merge(state1, state2)

// { _objectId: '00000000-0000-0000-0000-000000000000',
//   cards:
//    [ { _objectId: '5fa360fb-c173-40f8-98b6-de9205c84f99',
//        title: 'Rewrite everything in Haskell',
//        done: false },
//      { _objectId: 'b3d0aedf-d715-4f18-ae62-18b3f5d20321',
//        title: 'Reticulate splines',
//        done: false } ] }

tesseract.getHistory(state1).map(state => [state.changeset.message, state.snapshot.cards.length])
// [ [ 'Initialize card list', 0 ],
//   [ 'Add card', 1 ],
//   [ 'Add another card', 2 ],
//   [ 'Add a third card', 3 ],
//   [ 'Mark card as done', 3 ],
//   [ 'Delete card', 2 ] ]
```

### Testing

To run the test suite in Node:

    $ npm test

To run the test suite in web browsers:

    $ npm browsertest
