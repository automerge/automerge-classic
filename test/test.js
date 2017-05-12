
// -------------------------------------------- //
//         Tesseract Integration Tests 
// -------------------------------------------- //

var assert = require('assert');
let tesseract = require('../src/tesseract')
let Store = tesseract.Store

describe('Tesseract', function() {
  var s1,s2,s3,s4,s5,s6;
  describe('CRDTs', function() {
    beforeEach(function() {
      s1 = new Store("s1")
      s2 = new Store("s2")
      s3 = new Store("s3")
      s4 = new Store("s4")
      s5 = new Store("s5")
      s6 = new Store("s6")
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
      let c = { s2: 'test2', s1: 'test1' }
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

      assert.deepEqual(s1.root._conflicts.conflict_test,{s1:'xxx'})
      assert.deepEqual(s2.root._conflicts.conflict_test,{s1:'xxx'})
      assert.deepEqual(s3.root._conflicts.conflict_test,{s1:'xxx'})

      s2.pause()
      delete s1.root.conflict_test
      s3.root.conflict_test = "yyy"
      s2.unpause()

      assert.equal(s1.root.conflict_test, "yyy")
      assert.equal(s2.root.conflict_test, "yyy")
      assert.equal(s3.root.conflict_test, "yyy")

      assert.deepEqual(s1.root._conflicts.conflict_test,{s1:undefined})
      assert.deepEqual(s2.root._conflicts.conflict_test,{s1:undefined})
      assert.deepEqual(s3.root._conflicts.conflict_test,{s1:undefined})
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

      assert.deepEqual(s1.root._conflicts.conflict_test,{ s1: 's1d', s2: 's2b'})
      assert.deepEqual(s2.root._conflicts.conflict_test,{ s1: 's1d', s2: 's2b'})
      assert.deepEqual(s3.root._conflicts.conflict_test,{ s1: 's1d', s2: 's2b'})
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
      assert.deepEqual(s1.root._conflicts.conflict_test,{ s1: '111', s2: '222'})

      s2.pause()
      s1.root.conflict_test = {hello:"world"}
      s3.root.conflict_test = "111"
      s2.unpause()

      assert.equal(s1.root.conflict_test, "111")
      assert.equal(s3.root.conflict_test, "111")
      assert.deepEqual(s1.root._conflicts.conflict_test,{ s1: {hello: 'world' }})
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
      s1 = new Store("s1")
      s2 = new Store("s2")
      s3 = new Store("s3")
      s4 = new Store("s4")
      s5 = new Store("s5")
      s6 = new Store("s6")
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
      s1 = new Store("s1")
      s2 = new Store("s2")
      s3 = new Store("s3")
      s4 = new Store("s4")
      s5 = new Store("s5")
      s6 = new Store("s6")
    })
    it('should init', function() {
      let l1 = ['a','b','c','d','e']
      s1.root.lists = l1
      assert.deepEqual(s1.root.lists,l1)
    })
    it('should handle splice', function() {
      let l1 = ['a','b','c','d','e']
      s1.root.lists = l1
      let l2 = s1.root.lists
      l1.splice(3,0,'x','y')
      l2.splice(3,0,'x','y')
      assert.deepEqual(l1,l2)
      l1.splice(2,1,'q')
      l2.splice(2,1,'q')
      assert.deepEqual(l1,l2)
      l1.splice(4,10,'t','r','s')
      l2.splice(4,10,'t','r','s')
      assert.deepEqual(l1,l2)
/*
      l1.splice(1,1,'A','B')
      l2.splice(1,1,'A','B')
      assert.deepEqual(l1,l2)
*/
    })
    it('should handle push', function() {
      let l1 = []
      s1.root.lists = l1
      let l2 = s1.root.lists
      assert.deepEqual(l1,l2)
      l1.push(1)
      l2.push(1)
      assert.deepEqual(l1,l2)
      l1.push(2)
      l2.push(2)
      assert.deepEqual(l1,l2)
      l1.push(4,5)
      l2.push(4,5)
      assert.deepEqual(l1,l2)
    })
    it('should handle pop', function() {
      let l1 = [1,2,3,4,5,6]
      s1.root.lists = l1
      let l2 = s1.root.lists
      assert.deepEqual(l1,l2)
      let p1 = l1.pop()
      let p2 = l2.pop()
      assert.deepEqual(l1,l2)
      assert.equal(p1,p2)
      let p3 = l1.pop()
      let p4 = l2.pop()
      assert.deepEqual(l1,l2)
      assert.equal(p3,p4)
      let p5 = l1.pop()
      let p6 = l2.pop()
      assert.deepEqual(l1,l2)
      assert.equal(p5,p6)
    })
    it('should handle shift', function() {
      let l1 = [1,2,3,4,5,6]
      s1.root.lists = l1
      let l2 = s1.root.lists
      assert.deepEqual(l1,l2)
      let p1 = l1.shift()
      let p2 = l2.shift()
      assert.deepEqual(l1,l2)
      assert.equal(p1,p2)
      let p3 = l1.shift()
      let p4 = l2.shift()
      assert.deepEqual(l1,l2)
      assert.equal(p3,p4)
      let p5 = l1.shift()
      let p6 = l2.shift()
      assert.deepEqual(l1,l2)
      assert.equal(p5,p6)
    })
    it('should handle unshift', function() {
      let l1 = []
      s1.root.lists = l1
      let l2 = s1.root.lists
      assert.deepEqual(l1,l2)
      l1.unshift(1)
      l2.unshift(1)
      assert.deepEqual(l1,l2)
      l1.unshift(2)
      l2.unshift(2)
      assert.deepEqual(l1,l2)
      l1.unshift(4,5)
      l2.unshift(4,5)
      assert.deepEqual(l1,l2)
    })
    it('should handle reverse', function() {
      // reverse is not in place!
      s1.root.list = [1,2,3,4,5]
      let l = s1.root.list
      assert.deepEqual(l,[1,2,3,4,5])
      assert.deepEqual(l.reverse(),[5,4,3,2,1])
      assert.deepEqual(l,[1,2,3,4,5])
    })
    it('should handle sort', function() {
      // sort is not in place!
      s1.root.list = [5,4,3,2,1]
      let l = s1.root.list
      assert.deepEqual(l,[5,4,3,2,1])
      assert.deepEqual(l.reverse(),[1,2,3,4,5])
      assert.deepEqual(l,[5,4,3,2,1])
    })
    it('should handle copyWithin/fill [TODO]', function() {
    })
    it('should sync actions and indexes [1]', function() {
      s1.root.list = [1,2,3,4,5]
      let l = s1.root.list
      assert.deepEqual(l,[1,2,3,4,5])
      l.splice(0,10,'a','b','c')
      assert.deepEqual(l,['a','b','c'])
      l.splice(0,10)
      assert.deepEqual(l,[])
    })
    it('should sync actions and indexes [2]', function() {
      s1.link(s2)
      s1.root.list = []
      s1.root.list.push(1,2,3,4,5)
      s2.root.list.push(10,11,12,13,14)
      assert.deepEqual(s1.root.list,s2.root.list)
      s2.root.list.splice(3,3)
      assert.deepEqual(s1.root.list,s2.root.list)
    })
/*
    it('should record tombstones on splice', function() {
      s1.root.list = [1,2,3]
      assert.deepEqual(s1.root.list._tombs,[[],[],[],[]])
      s1.root.list.splice(0,3)
      assert.deepEqual(s1.root.list,[])
      assert.deepEqual(s1.root.list._tombs,[['s1:0', 's1:1', 's1:2']])
    })
    it('should record tombstones pop', function() {
      s1.root.list = [1,2,3]
      assert.deepEqual(s1.root.list._tombs,[[],[],[],[]])
      s1.root.list.pop()
      assert.deepEqual(s1.root.list,[1,2])
      assert.deepEqual(s1.root.list._tombs,[[],[],['s1:2']])
    })
    it('should record tombstones shift', function() {
      s1.root.list = [1,2,3]
      assert.deepEqual(s1.root.list._tombs,[[],[],[],[]])
      s1.root.list.shift()
      assert.deepEqual(s1.root.list,[2,3])
      assert.deepEqual(s1.root.list._tombs,[['s1:0'],[],[]])
    })
    it('should compound tombstones', function() {
      s1.root.list = [1,2,3,4,5,6,7]
      assert.deepEqual(s1.root.list._tombs,[[],[],[],[],[],[],[],[]])
      s1.root.list.pop()
      s1.root.list.pop()
      assert.deepEqual(s1.root.list,[1,2,3,4,5])
      assert.deepEqual(s1.root.list._tombs,[[],[],[],[],[],['s1:6','s1:5']])
      s1.root.list.shift()
      s1.root.list.shift()
      assert.deepEqual(s1.root.list,[3,4,5])
      assert.deepEqual(s1.root.list._tombs,[['s1:1','s1:0'],[],[],['s1:6','s1:5']])
      s1.root.list.splice(2,0,'c','d')
      s1.root.list.splice(1,0,'a','b')
      assert.deepEqual(s1.root.list,[3,'a','b',4,'c','d',5])
      assert.deepEqual(s1.root.list._tombs,[['s1:1','s1:0'],[],[],[],[],[],[],['s1:6','s1:5']])
    })
    it('should sync tombstones', function() {
      s2.link(s1)
      s1.root.list = [1,2,3,4,5,6,7]
      assert.deepEqual(s2.root.list._tombs,[[],[],[],[],[],[],[],[]])
      s1.root.list.pop()
      s1.root.list.pop()
      assert.deepEqual(s2.root.list,[1,2,3,4,5])
      assert.deepEqual(s2.root.list._tombs,[[],[],[],[],[],['s1:6','s1:5']])
      s1.root.list.shift()
      s1.root.list.shift()
      assert.deepEqual(s2.root.list,[3,4,5])
      assert.deepEqual(s2.root.list._tombs,[['s1:1','s1:0'],[],[],['s1:6','s1:5']])
      s1.root.list.splice(2,0,'c','d')
      s1.root.list.splice(1,0,'a','b')
      assert.deepEqual(s2.root.list,[3,'a','b',4,'c','d',5])
      assert.deepEqual(s2.root.list._tombs,[['s1:1','s1:0'],[],[],[],[],[],[],['s1:6','s1:5']])
    })
*/
/*
    it('should track list actions', function() {
      s1.root.list = [1,2,3]
      assert.deepEqual(s1.root.list._meta['s1:0'].action, s1.peer_actions['s1'][0])
      assert.deepEqual(s1.root.list._meta['s1:1'].action, s1.peer_actions['s1'][0])
      assert.deepEqual(s1.root.list._meta['s1:2'].action, s1.peer_actions['s1'][0])
      s1.root.list.pop()
      assert.deepEqual(s1.root.list._meta['s1:0'].action, s1.peer_actions['s1'][0])
      assert.deepEqual(s1.root.list._meta['s1:1'].action, s1.peer_actions['s1'][0])
      assert.deepEqual(s1.root.list._meta['s1:2'].action, s1.peer_actions['s1'][2])
      s1.root.list.pop()
      assert.deepEqual(s1.root.list._meta['s1:0'].action, s1.peer_actions['s1'][0])
      assert.deepEqual(s1.root.list._meta['s1:1'].action, s1.peer_actions['s1'][3])
      assert.deepEqual(s1.root.list._meta['s1:2'].action, s1.peer_actions['s1'][2])
    })
*/
    it('should track handle concurrent inserts', function() {
      s1.link(s2)
      s1.root.list = [1,2,3,4,5,6]
      s1.pause()
      s1.root.list.splice(3,0,'a','b','c')
      s2.root.list.splice(3,0,'x','y','z')
      s1.unpause()
      assert.deepEqual(s1.root.list,s2.root.list)
      s2.pause()
      s2.root.list.splice(3,0,'q','r','s')
      s1.root.list.splice(3,0,'m','b','d')
      s2.unpause()
      assert.deepEqual(s1.root.list,s2.root.list)
    })
    it('should track handle concurrent deletes', function() {
      s1.link(s2)
      let n = [1,2,3,4,5,6,7]
      s1.root.list = n
      s1.pause()
      s1.root.list.splice(2,2)
      s2.root.list.splice(3,2)
      n.splice(2,3)
      s1.unpause()
      assert.deepEqual(s1.root.list,s2.root.list)
      assert.deepEqual(s1.root.list,n)
    })
    it('should track handle concurrent deletes and inserts', function() {
      s1.link(s2)
      let n = [1,2,3,4,5,6,7]
      s1.root.list = n
      s1.pause()
      s1.root.list.splice(2,2,'a','b')
      s2.root.list.splice(3,2,'x','y')
      n.splice(2,3,'a','b','x','y')
      s1.unpause()
      assert.deepEqual(s1.root.list,s2.root.list)
      assert.deepEqual(s1.root.list,n)
    })
    it('should track handle concurrent nested deletes and inserts', function() {
      s1.link(s2)
      let n = [1,2,3,4,5,6,7]
      s1.root.list = n
      s1.pause()
      s1.root.list.splice(1,5,'a','b')
      s2.root.list.splice(2,3,'x','y')
      n.splice(1,5,'a','b')
      s1.unpause()
      assert.deepEqual(s1.root.list,n)
      assert.deepEqual(s2.root.list,n)
      assert.deepEqual(s1.root.list,s2.root.list)
    })
    it('should track handle list init with objects', function() {
      s1.root.list = [1,2,{ foo: "bar" }]
      s1.link(s2)
      s2.root.list[2].stuff = ["derp",{hey:"now"},"zip"]
      s1.root.list[2].stuff[1].hey = "then"
      assert.deepEqual(s1.root,s2.root)
    })
    it('should track handle nested maps and lists', function() {
      s1.root.list = [1,2,3]
      s1.root.list[1] =  { foo: "bar", name: "bob" }
      s1.root.list[1].foo = "zip"
      s1.link(s2)
      s2.root.list[1].stuff = [1,2,3]
      assert.deepEqual(s1.root,s2.root)
    })
    it('should track handle concurrent splices [2]', function() {
      let l = [1,1,1,1,1,1,1]
      s1.root.list = l
      s1.link(s2)
      s1.pause()
      s1.root.list.splice(6, 0, 8, 8, 8, 8, 8, 8, 8, 8)
      s2.root.list.splice(5, 3, 9, 9, 9, 9, 9, 9, 9, 9, 9)
      s1.unpause()
      assert.deepEqual(s1.root.list,s2.root.list)
    })
    it('should track handle concurrent splices [3]', function() {
      s1.root.list = [ 10, 10, 16, 16, 18, 18, 1, 1, 15 ]
      s1.link(s2)
      s1.pause()
      let l = [ 10, 10, 16, 16, 18, 18, 1, 1, 15 ]
      l.splice( 0,4, 20, 20, 20 )
      s1.root.list.splice( 0,4, 20, 20, 20 )
      s2.root.list.splice( 0,0, 21, 21 )
      s1.unpause()
      assert.deepEqual(s1.root.list,s2.root.list)
    })
    it('should track handle concurrent splices [4]', function() {
      let t = [ 11, 10, 10, 10, 9 ]
      s1.root.list = t
      s1.link(s2)
      s1.pause()
      s1.root.list.splice( 3, 1, 12, 12, 12)
      s2.root.list.splice( 0, 3, 13, 13 )
      s1.unpause()
      assert.deepEqual(s1.root.list,s2.root.list)
    })
    it('should track handle concurrent chaos [TODO]', function() {
      s1.root.list = [1,1,1,1,1,1,1]
      //console.log("BEGIN",s1.root.list)
      let seq = 8
      s1.link(s2)
//      s2.link(s3)
      let rand = (n) => {
        return Math.floor(Math.random() * n)
      }
      let random_splice = (store) => {
        let data = (new Array(rand(4)).fill(seq))
        seq += 1
        let len = store.root.list.length
        let r1 = rand(len)
        let r2 = rand(Math.round(len/2))
        //console.log("s1.root.list =",store.root.list)
        //console.log("s1.splice(",[r1,r2,...data].join(" ,"),")")
        //console.log("s2.splice(",[r1,r2,...data].join(" ,"),")")
        store.root.list.splice(r1,r2,...data)
        //console.log("END",store._id,store.root.list)
      }
      for (let j = 0; j < 100; j++) 
      {
        s2.pause()
        for (let i = 0; i < 1; i++)
        {
          random_splice(s1)
          random_splice(s2)
  //        random_splice(s3)
        }
        s2.unpause()
        assert.deepEqual(s1.root.list,s2.root.list)
      }
//      assert.deepEqual(s1.root.list,s3.root.list)
    })
  })
})

