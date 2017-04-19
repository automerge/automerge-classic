
// -------------------------------------------- //
//         Tesseract Integration Tests 
// -------------------------------------------- //

let Store = require('./tesseract').Store

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

let store1 = new Store()
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

console.log("Test - 1 - local set / nest / link")
console.assert(deep_equals(store1.root,mark1))

let store2 = new Store()
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

console.log("Test - 2 - sync both ways")
console.assert(deep_equals(store1.root,store2.root))
console.assert(deep_equals(store1.root, mark2))

let store3 = new Store()

store1.link(store2)

store1.root.linktest1 = "123"
store2.root.linktest2 = "abc"

console.log("Test - 3 - linked stores")
console.assert(deep_equals(store1.root,store2.root))
console.assert(store2.root.linktest1 == "123")
console.assert(store1.root.linktest2 == "abc")

console.log("Test - 4 - linked w two nodes who cant talk")
store3.link(store2)
store3.root.linktest3 = "zzz"
store1.root.linktest1 = "aaa"
console.assert(store3.root.linktest3 == "zzz")
console.assert(store2.root.linktest3 == "zzz")
console.assert(store1.root.linktest3 == "zzz")
console.assert(store3.root.linktest1 == "aaa")
console.assert(store2.root.linktest1 == "aaa")
console.assert(store1.root.linktest1 == "aaa")

console.log("Test - 5 - pause syncing")

store2.pause()
store3.root.linktest3 = "vvv"
store1.root.linktest1 = "bbb"
console.assert(store3.root.linktest3 == "vvv")
console.assert(store2.root.linktest3 == "zzz")
console.assert(store1.root.linktest3 == "zzz")
console.assert(store3.root.linktest1 == "aaa")
console.assert(store2.root.linktest1 == "aaa")
console.assert(store1.root.linktest1 == "bbb")

console.log("Test - 6 - unpause syncing")

store2.unpause()
console.assert(store3.root.linktest3 == "vvv")
console.assert(store2.root.linktest3 == "vvv")
console.assert(store1.root.linktest3 == "vvv")
console.assert(store3.root.linktest1 == "bbb")
console.assert(store2.root.linktest1 == "bbb")
console.assert(store1.root.linktest1 == "bbb")

console.log("Test - 7 - conflicts [todo]")

store2.pause()
store1.root.conflict_test = "111"
store2.root.conflict_test = "222"
store3.root.conflict_test = "333"
store2.unpause()

console.assert(store3.root.conflict_test == "111")
console.assert(store2.root.conflict_test == "333")
console.assert(store1.root.conflict_test == "333")

console.log("All tests passed")

