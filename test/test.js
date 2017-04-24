
// -------------------------------------------- //
//         Tesseract Integration Tests 
// -------------------------------------------- //

var assert = require('assert');
let tesseract = require('../src/tesseract')
let Store = tesseract.Store

let deep_equals = (a,b) => {
  if ((typeof a == 'object' && a != null) &&
      (typeof b == 'object' && b != null))
  {
    let ak = Object.keys(a).sort()
    let bk = Object.keys(b).sort()
    if (ak.length != bk.length) return false
    for (let i = 0; i < ak.length; i++) {
      if (ak[i] != bk[i]) return false
      if (deep_equals(a[ak[i]],b[bk[i]]) == false) return false
    }
    return true
  }
  else
  {
    return a === b
  }
}

function pp(o) {
  let keys = Object.keys(o).sort();
  let o2 = {}
  for (let i in keys) {
    o2[keys[i]] = o[keys[i]]
  }
  return o2;
}

let store1 = new Store("store1")
store1.root.foo = "foo"
store1.root.bar = store1.root.foo + "bar"
store1.root.dang = 12345
store1.root.obj = { hello: "world" }
store1.root.obj2 = store1.root.obj
delete store1.root["dang"]

let mark1 = {
  foo: 'foo',
  bar: 'foobar',
  obj: { hello: 'world' },
  obj2: { hello: 'world' }
}

console.log("Test - 01 - local set / nest / link")
console.assert(deep_equals(store1.root,mark1))

let store2 = new Store("store2")
store2.root["xxx"] = "yyy"
store2.sync(store1)
store2.root.obj3 = store2.root.obj
delete store2.root.obj

store2.sync(store1)

let mark2 = {
  foo: 'foo',
  bar: 'foobar',
  obj2: { hello: 'world' },
  obj3: { hello: 'world' },
  xxx: 'yyy'
}

console.log("Test - 02 - sync both ways")
console.assert(deep_equals(store1.root,store2.root))
console.assert(deep_equals(store1.root, mark2))

let store3 = new Store("store3")

store1.link(store2)

store1.root.linktest1 = "123"
store2.root.linktest2 = "abc"

console.log("Test - 03 - linked stores")
console.assert(deep_equals(store1.root,store2.root))
console.assert(store2.root.linktest1 == "123")
console.assert(store1.root.linktest2 == "abc")

console.log("Test - 04 - linked w two nodes who cant talk")
store3.link(store2)
store3.root.linktest3 = "zzz"
store1.root.linktest1 = "aaa"
console.assert(store3.root.linktest3 == "zzz")
console.assert(store2.root.linktest3 == "zzz")
console.assert(store1.root.linktest3 == "zzz")
console.assert(store3.root.linktest1 == "aaa")
console.assert(store2.root.linktest1 == "aaa")
console.assert(store1.root.linktest1 == "aaa")

console.log("Test - 05 - pause syncing")

store2.pause()
store3.root.linktest3 = "vvv"
store1.root.linktest1 = "bbb"
console.assert(store3.root.linktest3 == "vvv")
console.assert(store2.root.linktest3 == "zzz")
console.assert(store1.root.linktest3 == "zzz")
console.assert(store3.root.linktest1 == "aaa")
console.assert(store2.root.linktest1 == "aaa")
console.assert(store1.root.linktest1 == "bbb")

console.log("Test - 06 - unpause syncing")

store2.unpause()
console.assert(store3.root.linktest3 == "vvv")
console.assert(store2.root.linktest3 == "vvv")
console.assert(store1.root.linktest3 == "vvv")
console.assert(store3.root.linktest1 == "bbb")
console.assert(store2.root.linktest1 == "bbb")
console.assert(store1.root.linktest1 == "bbb")

console.log("Test - 07 - conflicts")

store2.pause()
store1.root.conflict_test = "111"
store2.root.conflict_test = "222"
store3.root.conflict_test = "333"
store2.unpause()

console.assert(store3.root.conflict_test == "333")
console.assert(store2.root.conflict_test == "333")
console.assert(store1.root.conflict_test == "333")

console.assert(deep_equals(store1.root._conflicts.conflict_test,{store1:'111',store2:'222'}))
console.assert(deep_equals(store2.root._conflicts.conflict_test,{store1:'111',store2:'222'}))
console.assert(deep_equals(store3.root._conflicts.conflict_test,{store1:'111',store2:'222'}))

store1.root.conflict_test = "new1"

console.assert(store3.root.conflict_test == "new1")
console.assert(store2.root.conflict_test == "new1")
console.assert(store1.root.conflict_test == "new1")

console.log("Test - 08 - conflict delete")

store2.pause()
store1.root.conflict_test = "xxx"
delete store3.root.conflict_test
store2.unpause()

console.assert(store1.root.conflict_test === undefined)
console.assert(store2.root.conflict_test === undefined)
console.assert(store3.root.conflict_test === undefined)

console.assert(deep_equals(store1.root._conflicts.conflict_test,{store1:'xxx'}))
console.assert(deep_equals(store2.root._conflicts.conflict_test,{store1:'xxx'}))
console.assert(deep_equals(store3.root._conflicts.conflict_test,{store1:'xxx'}))

store2.pause()
delete store1.root.conflict_test
store3.root.conflict_test = "yyy"
store2.unpause()

console.assert(store1.root.conflict_test === "yyy")
console.assert(store2.root.conflict_test === "yyy")
console.assert(store3.root.conflict_test === "yyy")

console.assert(deep_equals(store1.root._conflicts.conflict_test,{store1:undefined}))
console.assert(deep_equals(store2.root._conflicts.conflict_test,{store1:undefined}))
console.assert(deep_equals(store3.root._conflicts.conflict_test,{store1:undefined}))

console.log("Test - 09 - many conflicts")

store2.pause()
store1.root.conflict_test = "s1a"
store1.root.conflict_test = "s1b"
store1.root.conflict_test = "s1c"
store1.root.conflict_test = "s1d"
store2.root.conflict_test = "s2a"
store2.root.conflict_test = "s2b"
store3.root.conflict_test = "s3a"
store3.root.conflict_test = "s3b"
store3.root.conflict_test = "s3c"
store2.unpause()

console.assert(store1.root.conflict_test === "s3c")
console.assert(store2.root.conflict_test === "s3c")
console.assert(store3.root.conflict_test === "s3c")

console.assert(deep_equals(store1.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'}))
console.assert(deep_equals(store2.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'}))
console.assert(deep_equals(store3.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'}))

console.log("Test - 10 - link conflicts")

store2.pause()
store1.root.conflict_test = "111"
store2.root.conflict_test = "222"
store3.root.conflict_test = store3.root.obj2
store2.unpause()

store2.root.x = 1;

console.assert(deep_equals(store1.root.conflict_test,{ hello: "world" }))
console.assert(deep_equals(store3.root.conflict_test,{ hello: "world" }))
console.assert(deep_equals(store1.root._conflicts.conflict_test,{ store1: '111', store2: '222'}))

store2.pause()
store1.root.conflict_test = store3.root.obj2
store3.root.conflict_test = "111"
store2.unpause()

console.assert(store1.root.conflict_test === "111")
console.assert(store3.root.conflict_test === "111")
console.assert(deep_equals(store1.root._conflicts.conflict_test,{ store1: {hello: 'world' }}))

console.log("Test - 11 - linking to a virgin store")

let store4 = new Store("store4")
let store5 = new Store("store5")

store4.root.new_test = "123"
store4.link(store5)

console.assert(store5.root.new_test === "123")

store4.pause()
store4.root.new_test = "333"
store5.root.new_test = "444"
store4.unpause()

console.assert(store4.root.new_test === "444")
console.assert(store5.root.new_test === "444")

console.log("Test - 12 - messy network")

store4.link(store3)
store5.link(store2)
store5.link(store1)

store1.root.complex_test = "complex1"
store5.root.complex_test = "complex5"

console.assert(store1.root.complex_test === "complex5")
console.assert(store2.root.complex_test === "complex5")
console.assert(store3.root.complex_test === "complex5")
console.assert(store4.root.complex_test === "complex5")
console.assert(store5.root.complex_test === "complex5")

console.log("Test - 13 - list (set)")

let store6 = new Store("store6")
store6.root.lists = []
store6.root.lists[0] = 111
console.assert(deep_equals(store6.root.lists,[111]))

console.log("Test - 14 - list (push)")

store6.root.lists.push(222)
store6.root.lists.push(333)
console.assert(deep_equals(store6.root.lists,[111,222,333]))

console.log("Test - 15 - list (pop)")

let l1 = store6.root.lists.pop()
console.assert(l1 === 333)
console.assert(deep_equals(store6.root.lists,[111,222]))

console.log("Test - 16 - list (shift)")

let l2 = store6.root.lists.shift()
console.assert(l2 === 111)
console.assert(deep_equals(store6.root.lists,[222]))

console.log("Test - 17 - list (unshift)")

let l3 = store6.root.lists.unshift(444)
let l4 = store6.root.lists.unshift(555)
console.assert(l3 === 2)
console.assert(l4 === 3)
console.assert(deep_equals(store6.root.lists,[555,444,222]))

console.log("Test - 18 - list (fill) [TODO]")
console.log("Test - 19 - list (copyWithin) [TODO]")
console.log("Test - 20 - list (splice) [TODO]")
console.log("Test - 21 - lists with objects [TODO]")
console.log("Test - 22 - list deletes [TODO]")
console.log("Test - 23 - list merge conflicts [TODO]")

//tesseract.debug(true)

console.log("All tests passed")

