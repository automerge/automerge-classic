
// -------------------------------------------- //
//         Tesseract Integration Tests 
// -------------------------------------------- //

var assert = require('assert');
let tesseract = require('../src/tesseract')
let Store = tesseract.Store

describe('Tesseract', function() {
    var s1,s2,s3,s4,s5,s6;
    describe('CDRTs', function() {
      beforeEach(function() {
        s1 = new Store("store1")
        s2 = new Store("store2")
        s3 = new Store("store3")
        s4 = new Store("store4")
        s5 = new Store("store5")
        s6 = new Store("store6")
      })
      it('should handle sync', function() {
        s1.root.foo = "foo"
        s1.root.baz = "baz"
        s1.root.bar = { bar: "bar" }
        delete s1.root.baz
        s2.link(s1)
        assert.deepEqual(s2.root,{ foo: "foo", bar: { bar:"bar" }})
      })
      it('should handle sync both ways', function() {
        s1.root.foo1 = "foo1"
        s2.root.foo2 = "foo2"
        s1.root.baz = "baz"
        s2.root.bar = { bar: "bar" }
        delete s1.root.baz
        s2.link(s1)
        assert.deepEqual(s2.root,{ foo1: "foo1", foo2: "foo2", bar: { bar:"bar" }})
      })
      it('should handle more syncing', function() {
        s1.root.one = "one"
        s2.root.two = "two"
        s1.link(s2)
        assert.deepEqual(s1.root, s2.root)

        s3.link(s4)
        s4.link(s5)
        s3.root.a = "a"
        s4.pause()
        s3.root.a = "aa"
        s3.root.b = "bb"
        s5.root.a = "aaa"
        s5.root.b = "bbb"
        s4.unpause()
        assert.deepEqual(s3.root, s5.root)
    })
      it('should handle deep sync both ways', function() {
        s1.link(s2)
        s1.root.a = {b: {c: "d"}}
        s2.root.a.b.c = "ddd"
        assert.equal(s1.root.a.b.c,"ddd")
      })
      it('should handle indirectly linked stores', function() {
        s1.link(s2)
        s2.link(s3)
        s1.root.foo = "foo"
        s3.root.bar = "bar"
        assert.deepEqual(s1.root,{foo:"foo",bar:"bar"})
        assert.deepEqual(s2.root,{foo:"foo",bar:"bar"})
        assert.deepEqual(s3.root,{foo:"foo",bar:"bar"})
      })
      it('should handle indirectly pausing/unpausing', function() {
        s1.link(s2)
        s2.link(s3)
        s1.root.foo = "foo"
        s3.root.bar = "bar"
        assert.deepEqual(s1.root,{foo:"foo",bar:"bar"})
        assert.deepEqual(s2.root,{foo:"foo",bar:"bar"})
        assert.deepEqual(s3.root,{foo:"foo",bar:"bar"})
        s2.pause()
        s1.root.foo = "foo2"
        s3.root.bar = "bar2"
        assert.deepEqual(s1.root,{foo:"foo2",bar:"bar"})
        assert.deepEqual(s2.root,{foo:"foo",bar:"bar"})
        assert.deepEqual(s3.root,{foo:"foo",bar:"bar2"})
        s2.unpause()
        assert.deepEqual(s1.root,{foo:"foo2",bar:"bar2"})
        assert.deepEqual(s2.root,{foo:"foo2",bar:"bar2"})
        assert.deepEqual(s3.root,{foo:"foo2",bar:"bar2"})
      })
      it('should handle conflicts', function() {
        s1.link(s2)
        s2.link(s3)
        s2.pause()
        s1.root.conflict_test = "test1"
        s2.root.conflict_test = "test2"
        s3.root.conflict_test = "test3"
        assert.deepEqual(s1.root,{conflict_test:"test1"})
        assert.deepEqual(s2.root,{conflict_test:"test2"})
        assert.deepEqual(s3.root,{conflict_test:"test3"})
        s2.unpause()
        assert.deepEqual(s1.root,{conflict_test:"test3"})
        assert.deepEqual(s2.root,{conflict_test:"test3"})
        assert.deepEqual(s3.root,{conflict_test:"test3"})
        let c = { store2: 'test2', store1: 'test1' }
        assert.deepEqual(s1.root._conflicts.conflict_test,c)
        assert.deepEqual(s2.root._conflicts.conflict_test,c)
        assert.deepEqual(s3.root._conflicts.conflict_test,c)
        s1.root.conflict_test = "test4"
        assert.deepEqual(s1.root,{conflict_test:"test4"})
        assert.deepEqual(s2.root,{conflict_test:"test4"})
        assert.deepEqual(s3.root,{conflict_test:"test4"})
        assert.deepEqual(s1.root._conflicts.conflict_test,{})
        assert.deepEqual(s2.root._conflicts.conflict_test,{})
        assert.deepEqual(s3.root._conflicts.conflict_test,{})
      })
      it('should handle delete conflicts', function() {
        s1.root.conflict_test = "init"
        s1.link(s2)
        s2.link(s3)
        s2.pause()
        s1.root.conflict_test = "xxx"
        delete s3.root.conflict_test
        s2.unpause()

        assert.equal(s1.root.conflict_test,undefined)
        assert.equal(s2.root.conflict_test,undefined)
        assert.equal(s3.root.conflict_test,undefined)

        assert.deepEqual(s1.root._conflicts.conflict_test,{store1:'xxx'})
        assert.deepEqual(s2.root._conflicts.conflict_test,{store1:'xxx'})
        assert.deepEqual(s3.root._conflicts.conflict_test,{store1:'xxx'})

        s2.pause()
        delete s1.root.conflict_test
        s3.root.conflict_test = "yyy"
        s2.unpause()

        assert.equal(s1.root.conflict_test, "yyy")
        assert.equal(s2.root.conflict_test, "yyy")
        assert.equal(s3.root.conflict_test, "yyy")

        assert.deepEqual(s1.root._conflicts.conflict_test,{store1:undefined})
        assert.deepEqual(s2.root._conflicts.conflict_test,{store1:undefined})
        assert.deepEqual(s3.root._conflicts.conflict_test,{store1:undefined})
      })
      it('should handle many conflicts', function() {
        s1.link(s2)
        s2.link(s3)
        s2.pause()
        s1.root.conflict_test = "s1a"
        s1.root.conflict_test = "s1b"
        s1.root.conflict_test = "s1c"
        s1.root.conflict_test = "s1d"
        s2.root.conflict_test = "s2a"
        s2.root.conflict_test = "s2b"
        s3.root.conflict_test = "s3a"
        s3.root.conflict_test = "s3b"
        s3.root.conflict_test = "s3c"
        s2.unpause()

        assert.equal(s1.root.conflict_test, "s3c")
        assert.equal(s2.root.conflict_test, "s3c")
        assert.equal(s3.root.conflict_test, "s3c")

        assert.deepEqual(s1.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'})
        assert.deepEqual(s2.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'})
        assert.deepEqual(s3.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'})
      })
      it('should handle object/link conflicts', function() {
        s1.link(s2)
        s2.link(s3)
        s2.pause()
        s1.root.conflict_test = "111"
        s2.root.conflict_test = "222"
        s3.root.conflict_test = {hello: "world"}
        s2.unpause()

        s2.root.x = 1;

        assert.deepEqual(s1.root.conflict_test,{ hello: "world" })
        assert.deepEqual(s3.root.conflict_test,{ hello: "world" })
        assert.deepEqual(s1.root._conflicts.conflict_test,{ store1: '111', store2: '222'})

        s2.pause()
        s1.root.conflict_test = {hello:"world"}
        s3.root.conflict_test = "111"
        s2.unpause()

        assert.equal(s1.root.conflict_test, "111")
        assert.equal(s3.root.conflict_test, "111")
        assert.deepEqual(s1.root._conflicts.conflict_test,{ store1: {hello: 'world' }})
      })
      it('should handle linking to a virgin store', function() {
        s4.root.new_test = "123"
        s4.link(s5)

        assert.equal(s5.root.new_test, "123")

        s4.pause()
        s4.root.new_test = "333"
        s5.root.new_test = "444"
        s4.unpause()

        assert.equal(s4.root.new_test, "444")
        assert.equal(s5.root.new_test, "444")
      })
      it('should handle messy network configs', function() {
        s1.link(s2)
        s2.link(s3)
        s4.link(s3)
        s5.link(s2)
        s5.link(s3)

        s1.root.complex_test = "complex1"
        s5.root.complex_test = "complex5"

        assert.equal(s1.root.complex_test, "complex5")
        assert.equal(s2.root.complex_test, "complex5")
        assert.equal(s3.root.complex_test, "complex5")
        assert.equal(s4.root.complex_test, "complex5")
        assert.equal(s5.root.complex_test, "complex5")
      })
    })
    describe('Maps', function() {
      beforeEach(function() {
        s1 = new Store("store1")
        s2 = new Store("store2")
        s3 = new Store("store3")
        s4 = new Store("store4")
        s5 = new Store("store5")
        s6 = new Store("store6")
      })
      it('should handle set', function() {
        s1.root.foo = "foo"
        assert.equal(s1.root.foo,"foo")
      })
      it('should handle delete', function() {
        s1.root.bar = "bar"
        s1.root.foo = "foo"
        delete s1.root.foo
        assert.deepEqual(s1.root,{ bar:"bar" })
      })
      it('should handle link', function() {
        s1.root.foo = "foo"
        s1.root.bar = { bar: "bar" }
        assert.deepEqual(s1.root,{ foo: "foo", bar: { bar:"bar" }})
      })
    })
    describe('Lists', function() {
      beforeEach(function() {
        s1 = new Store("store1")
        s2 = new Store("store2")
        s3 = new Store("store3")
        s4 = new Store("store4")
        s5 = new Store("store5")
        s6 = new Store("store6")
      })
      it('should handle ::set()', function() {
        s1.root.lists = []
        s1.root.lists[0] = 111
        assert.deepEqual(s1.root.lists,[111])
        s1.root.lists[2] = 110
        assert.deepEqual(s1.root.lists,[111,null,110])
      })
      it('should handle ::push()', function() {
        s1.root.lists = []
        s1.root.lists.push(111)
        s1.root.lists.push(222)
        s1.root.lists.push(333)
        assert.deepEqual(s1.root.lists,[111,222,333])
      })
      it('should handle ::pop()', function() {
        s1.root.lists = []
        s1.root.lists.push(111)
        s1.root.lists.push(222)
        s1.root.lists.push(333)
        let p1 = s1.root.lists.pop()
        let p2 = s1.root.lists.pop()
        assert.deepEqual(s1.root.lists,[111])
        assert.equal(p1,333)
        assert.equal(p2,222)
      })
  })
})


/*

let store1 = new Store("store1")
//store1.on('change',() => console.log("UPDATE",store1.root))
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

console.log("Test - 01 - map: local set / nest / link")
assert_deep_equals(store1.root,mark1)

let store2 = new Store("store2")
store2.root["xxx"] = "yyy"
store2.sync(store1)
store2.root.obj3 = store2.root.obj
delete store2.root.obj

store2.sync(store1)


console.log("Test - 02 - sync both ways")
let mark2 = {
  foo: 'foo',
  bar: 'foobar',
  obj2: { hello: 'world' },
  obj3: { hello: 'world' },
  xxx: 'yyy'
}
assert_deep_equals(store1.root,store2.root)
assert_deep_equals(store1.root, mark2)

let store3 = new Store("store3")

store1.link(store2)

store1.root.linktest1 = "123"
store2.root.linktest2 = "abc"

console.log("Test - 03 - linked stores")
assert_deep_equals(store1.root,store2.root)
console.assert(store2.root.linktest1 == "123")
console.assert(store1.root.linktest2 == "abc")

store1.root.a = {b: {c: "d"}}
store2.root.a.b.c = "ddd"
console.assert(store1.root.a.b.c == "ddd")

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

store3.root.a.b.c = "xyz"
console.assert(store3.root.a.b.c == "xyz")
console.assert(store2.root.a.b.c == "ddd")
console.assert(store1.root.a.b.c == "ddd")

console.log("Test - 06 - unpause syncing")

store2.unpause()
console.assert(store3.root.linktest3 == "vvv")
console.assert(store2.root.linktest3 == "vvv")
console.assert(store1.root.linktest3 == "vvv")
console.assert(store3.root.linktest1 == "bbb")
console.assert(store2.root.linktest1 == "bbb")
console.assert(store1.root.linktest1 == "bbb")
console.assert(store3.root.a.b.c == "xyz")
console.assert(store2.root.a.b.c == "xyz")
console.assert(store1.root.a.b.c == "xyz")

console.log("Test - 07 - map: conflicts")

store2.pause()
store1.root.conflict_test = "111"
store2.root.conflict_test = "222"
store3.root.conflict_test = "333"
store2.unpause()

console.assert(store3.root.conflict_test == "333")
console.assert(store2.root.conflict_test == "333")
console.assert(store1.root.conflict_test == "333")

assert_deep_equals(store1.root._conflicts.conflict_test,{store1:'111',store2:'222'})
assert_deep_equals(store2.root._conflicts.conflict_test,{store1:'111',store2:'222'})
assert_deep_equals(store3.root._conflicts.conflict_test,{store1:'111',store2:'222'})

store1.root.conflict_test = "new1"

console.assert(store3.root.conflict_test == "new1")
console.assert(store2.root.conflict_test == "new1")
console.assert(store1.root.conflict_test == "new1")

const s1 = new Store("store1")
const s2 = new Store("store2")
s1.root.one = "one"
s2.root.two = "two"
s1.link(s2)
assert_deep_equals(s1.root, s2.root)

const s3 = new Store("store3")
const s4 = new Store("store4")
const s5 = new Store("store5")
s3.link(s4)
s4.link(s5)
s3.root.a = "a"
s4.pause()
s3.root.a = "aa"
s3.root.b = "bb"
s5.root.a = "aaa"
s5.root.b = "bbb"
s4.unpause()
assert_deep_equals(s3.root, s5.root)

console.log("Test - 08 - map: conflict delete")

store2.pause()
store1.root.conflict_test = "xxx"
delete store3.root.conflict_test
store2.unpause()

console.assert(store1.root.conflict_test === undefined)
console.assert(store2.root.conflict_test === undefined)
console.assert(store3.root.conflict_test === undefined)

assert_deep_equals(store1.root._conflicts.conflict_test,{store1:'xxx'})
assert_deep_equals(store2.root._conflicts.conflict_test,{store1:'xxx'})
assert_deep_equals(store3.root._conflicts.conflict_test,{store1:'xxx'})

store2.pause()
delete store1.root.conflict_test
store3.root.conflict_test = "yyy"
store2.unpause()

console.assert(store1.root.conflict_test === "yyy")
console.assert(store2.root.conflict_test === "yyy")
console.assert(store3.root.conflict_test === "yyy")

assert_deep_equals(store1.root._conflicts.conflict_test,{store1:undefined})
assert_deep_equals(store2.root._conflicts.conflict_test,{store1:undefined})
assert_deep_equals(store3.root._conflicts.conflict_test,{store1:undefined})

console.log("Test - 09 - map: many conflicts")

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

assert_deep_equals(store1.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'})
assert_deep_equals(store2.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'})
assert_deep_equals(store3.root._conflicts.conflict_test,{ store1: 's1d', store2: 's2b'})

console.log("Test - 10 - map: link conflicts")

store2.pause()
store1.root.conflict_test = "111"
store2.root.conflict_test = "222"
store3.root.conflict_test = store3.root.obj2
store2.unpause()

store2.root.x = 1;

assert_deep_equals(store1.root.conflict_test,{ hello: "world" })
assert_deep_equals(store3.root.conflict_test,{ hello: "world" })
assert_deep_equals(store1.root._conflicts.conflict_test,{ store1: '111', store2: '222'})

store2.pause()
store1.root.conflict_test = store3.root.obj2
store3.root.conflict_test = "111"
store2.unpause()

console.assert(store1.root.conflict_test === "111")
console.assert(store3.root.conflict_test === "111")
assert_deep_equals(store1.root._conflicts.conflict_test,{ store1: {hello: 'world' }})

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

console.log("Test - 13 - list: (set)")

let store6 = new Store("store6")
store6.root.lists = []
store6.root.lists[0] = 111
assert_deep_equals(store6.root.lists,[111])
store6.root.lists[2] = 110
assert_deep_equals(store6.root.lists,[111,null,110])
//console.log(store6.list_tombstones[store6.root.lists._id],[[],[]])
//assert_deep_equals(store6.list_tombstones[store6.root.lists._id],[[],[]])

console.log("Test - 14 - list: (push)")

store6.root.lists.push(222)
store6.root.lists.push(333)
assert_deep_equals(store6.root.lists,[111,null,110,222,333])

console.log("Test - 15 - list: (pop)")

let l1 = store6.root.lists.pop()
console.assert(l1 === 333)
assert_deep_equals(store6.root.lists,[111,null,110,222])

console.log("Test - 16 - list: (shift)")

let l2 = store6.root.lists.shift()
console.assert(l2 === 111)
let l3 = store6.root.lists.shift()
console.assert(l3 === null)
let l4 = store6.root.lists.shift()
console.assert(l4 === 110)
assert_deep_equals(store6.root.lists,[222])

console.log("Test - 17 - list: (unshift)")

let l5 = store6.root.lists.unshift(444)
let l6 = store6.root.lists.unshift(555)
console.assert(l5 === 2)
console.assert(l6 === 3)
assert_deep_equals(store6.root.lists,[555,444,222])

console.log("Test - 18 - list: (fill)")

store6.root.lists.fill(10)
assert_deep_equals(store6.root.lists,[10,10,10])
store6.root.lists.fill(11,1)
assert_deep_equals(store6.root.lists,[10,11,11])
store6.root.lists.fill(12,0,2)
assert_deep_equals(store6.root.lists,[12,12,11])

console.log("Test - 19 - list: deletes")

store6.root.lists[0] = null
console.log(store6.root)
delete store6.root.lists[1]

let skipList = [null]
skipList[2] = 11

assert_deep_equals(store6.root.lists,skipList)

console.log("Test - 20 - list: (copyWithin) [TODO]")

console.log("Test - 21 - list: (splice) [TODO]")

console.log("Test - 22 - list: merge conflicts [TODO]")
console.log("Test - 23 - list of maps [TODO]")

//tesseract.debug(true)

console.log("All tests passed")

*/
