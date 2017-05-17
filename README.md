## Tesseract

  An attempt at making a transparent javascript CRDT that behaves like native types.

### Example usage

```js
const t = require('tesseract')
let s1 = t.init()
// {}

s1 = t.set(s1, 'cards', [])
// { cards: [] }

s1 = t.insert(s1.cards, 0, {title: 'Rewrite everything in Clojure', done: false})
// { cards: [ { title: 'Rewrite everything in Clojure', done: false } ] }

s1 = t.insert(s1.cards, 1, {title: 'Reticulate splines', done: false})
// { cards:
//    [ { title: 'Rewrite everything in Clojure', done: false },
//      { title: 'Reticulate splines', done: false } ] }

s1 = t.insert(s1.cards, 0, {title: 'Rewrite everything in Haskell', done: false})
// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Rewrite everything in Clojure', done: false },
//      { title: 'Reticulate splines', done: false } ] }

let s2 = t.init()
s2 = t.merge(s2, s1)

s1 = t.set(s1.cards[1], 'done', true)
// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Rewrite everything in Clojure', done: true },
//      { title: 'Reticulate splines', done: false } ] }

s2 = t.remove(s2.cards, 1)
// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Reticulate splines', done: false } ] }

s1 = t.merge(s1, s2)
// { cards:
//    [ { title: 'Rewrite everything in Haskell', done: false },
//      { title: 'Reticulate splines', done: false } ] }

t.equals(s1.cards[1], { title: 'Reticulate splines', done: false })
// true
```

### Testing

```
  $ npm test
```

## List TODO
[X] Create/init lists
[X] Implement set/delete
[X] Implement splice
[X] Implement push/pop/shift/unshift
[X] Implement index metadata
[X] Implement non-concurrent syncing/edits
[X] Implement Tombstone Metadata
[X] Implement Action Metadata
[ ] Implement List+Link
[ ] Implement Concurrent Inserts
[ ] Implement Concurrent Deletes

## Other Things to Do
[ ] Non-durable data
[ ] WebRTC
[ ] Boilerplate npm/gulp/babel

vals()    = [ a, b, c, d, e, f, g, h ]
idx(uuid) = [ 1, 2, 3, 4, 5, 6, 7, 8 ]
tombs     = [ ., ., ., ., ., ., ., . ]

x = []
x[0] = 1 // x.push(n)
x[5] = 1 // x.push(null,null,null,null,n)

uuid->small number mapping for efficency
set
delete (begin,end)
insertAfter() -> [] // special element is the head (null)
insertAfter(X)
  walk through the elements after until i find something happened before
  insert myself in correct sort order amongs the current elements
  X has been deleted
    [ well then insert is deleted ]
    if (X and X+1) were both deleted concurrently by the same delete with the insert then delete
    [X] N [X+1]

list = [ 1,2,3 ]

splice()

list[1] = 5
list[1] = 6
list[1] = 7

list = [ 1,7,3 ]
         [5,6]
list.splice(1,1,5)


