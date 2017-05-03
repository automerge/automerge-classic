
let Debug = false

function pp(o) {
  let keys = Object.keys(o).sort();
  let o2 = {}
  for (let i in keys) {
    o2[keys[i]] = o[keys[i]]
  }
  return o2;
}

var UUID = (function() {
  var self = {};
  var lut = []; for (var i=0; i<256; i++) { lut[i] = (i<16?'0':'')+(i).toString(16); }
  self.generate = function() {
    var d0 = Math.random()*0xffffffff|0;
    var d1 = Math.random()*0xffffffff|0;
    var d2 = Math.random()*0xffffffff|0;
    var d3 = Math.random()*0xffffffff|0;
    return lut[d0&0xff]+lut[d0>>8&0xff]+lut[d0>>16&0xff]+lut[d0>>24&0xff]+'-'+
      lut[d1&0xff]+lut[d1>>8&0xff]+'-'+lut[d1>>16&0x0f|0x40]+lut[d1>>24&0xff]+'-'+
      lut[d2&0x3f|0x80]+lut[d2>>8&0xff]+'-'+lut[d2>>16&0xff]+lut[d2>>24&0xff]+
      lut[d3&0xff]+lut[d3>>8&0xff]+lut[d3>>16&0xff]+lut[d3>>24&0xff];
  }
  return self;
})();

// [x]=y --- set/link [x]=y
// push,pop,shift,unshift --- insert after, insert before
// 

/*
READ ONLY 

Array.prototype.map()
Array.prototype.forEach()
Array.prototype.filter()
Array.prototype.keys()
Array.prototype.concat()
Array.prototype.entries()
Array.prototype.every()
Array.prototype.findIndex()
Array.prototype.find()
Array.prototype.includes()
Array.prototype.toString()
Array.prototype.join()
Array.prototype.indexOf()
Array.prototype.lastIndexOf()
Array.prototype.reduce()
Array.prototype.reduceRight()
Array.prototype.toLocaleString()
Array.prototype.toSource()
Array.prototype.values()
Array.prototype.some()
Array.prototype.slice()

TODO

Array.prototype.splice()

DONE

Array.prototype.sort() // new array?
Array.prototype.reverse() // new array?
Array.prototype.pop()
Array.prototype.push()
Array.prototype.shift()
Array.prototype.unshift()
Array.prototype.copyWithin()
Array.prototype.fill()



----

*/

let ListHandler = {
  get: (target,key) => {
    if (Debug) { console.log("GET",key) }
    if (key == "_direct") return target
    if (key == "_set") return (key,val) => { target[key] = val }
    if (key == "_conflicts") return target._conflicts
    if (key == "splice") return function() { return target.splice(...arguments) }
    if (key == "_splice") return function() { return target._splice(...arguments) }
    return target[key]
  },
//  push: (target,v) => { target.push(v) },
  set: (target,key,value) => {
    if (Debug) { console.log("SET",key,"[",value,"]") }
    if (key.startsWith("_")) { throw "Invalid Key" }
    target._store.setListValue(target._id, parseInt(key), value)
    return true
  },
  deleteProperty: (target,key) => {
    if (Debug) { console.log("DELETE",key) }
    if (key.startsWith("_")) { throw "Invalid Key" }
    // TODO - do i need to distinguish 'del' from 'unlink' - right now, no, but keep eyes open for trouble
    target._store.apply({ action: "del", target: target._id, key: key })
  }
}

let MapHandler = {
  get: (target,key) => {
    if (key == "_direct") return target
    if (key == "_set") return (key,val) => { target[key] = val }
    if (key == "_conflicts") return target._conflicts
    return target[key]
  },
  set: (target,key,value) => {
    if (key.startsWith("_")) { throw "Invalid Key" }
    target._store.setMapValue(target._id, key, value)
  },
  deleteProperty: (target,key) => {
    if (key.startsWith("_")) { throw "Invalid Key" }
    // TODO - do i need to distinguish 'del' from 'unlink' - right now, no, but keep eyes open for trouble
    target._store.apply({ action: "del", target: target._id, key: key })
  }
}

function Map(store, id, map) {
    map.__proto__ = { _store: store, _id: id, _conflicts: store.conflicts[id], __proto__: map.__proto__ }
    return new Proxy(map, MapHandler)
}

function List(store, id, list) {
    let _splice = function() {
      let args = Array.from(arguments)
      let start = args.shift()
      let run = args.shift()
      let cut = this.slice(start,run)
      store.apply({ action: "splice", target: this._id, cut: [start,start + run], add: args })
      return cut
    }
    let _push = function() {
      let args = Array.from(arguments)
      this.splice(this.length,0,...args)
      return args[args.length - 1]
    }
    let _pop = function() {
      let val = this[this.length - 1]
      this.splice(this.length - 1, 1)
      return val
    }
    let _unshift = function() {
      let args = Array.from(arguments)
      this.splice(0,0,...args)
      return this.length
    }
    let _shift = function() {
      return this.splice(0,1)[0]
    }
    let _fill = function() {
      let args = Array.from(arguments)
      let val = args.shift()
      let start = args.shift() || 0 
      let end = args.shift() || this.length
      let n = this.slice(start,end).fill(val)
      this.splice(start,n.length,...n)
      return this
    }
    let _copyWithin = function(target) {
      // TODO - handle overcopy scenario :/
      let start = arguments[1] || 0
      let end   = arguments[2] || this.length
      let n = this.slice(start,end)
      this.splice(target,n.length,...n)
      return this
    }
    let _sort = function() {
      return Array.from(this).sort()
    }
    let _reverse = function() {
      return Array.from(this).reverse()
    }
    let _old_splice = list.splice
    list.__proto__ = {
      __proto__:  list.__proto__,
      _id:        id,
      _store:     store,
      _conflicts: store.conflicts[id],
      _splice:    _old_splice,
      splice:     _splice,
      shift:      _shift,
      unshift:    _unshift,
      push:       _push,
      pop:        _pop,
      fill:       _fill,
      copyWithin: _copyWithin,
      sort:       _sort,
      reverse:    _reverse
    }
    return new Proxy(list, ListHandler)
}

function Store(uuid) {
  let root_id = '00000000-0000-0000-0000-000000000000'
  let _uuid = uuid || UUID.generate()
  this._id = _uuid
  this.list_index = { }
  this.list_sequence = { }
  this.list_tombstones = { }
  this.conflicts = { [root_id]: {} }
  this.peer_actions = { [this._id]: [] }
  this.obj_actions = { [root_id]: {} }
  this.root = new Map(this, UUID.generate(), {})
  this.objects = { [root_id]: new Map(this, root_id, {}) }
  this.links = { [root_id]: {} }
  this.clock = { [this._id]: 0 }
  this.peers = {}
  this.syncing = true

  this.handlers = {change:[]}
  this.on = (event,handler) => {
    if (this.handlers[event]) {
      this.handlers[event].push(handler)
    }
  }

  this.did_apply = () => {
    this.handlers.change.forEach((h) => { h() })
  }

  this.merge = (peer) => {
    for (let id in peer.peer_actions) {
      let idx = (id in this.peer_actions) ? this.peer_actions[id].length : 0
      for (let i = idx; i < peer.peer_actions[id].length; i++) {
        this.push_action(peer.peer_actions[id][i])
      }
    }
    this.try_apply()
  }

  this.sync = (peer) => {
    this.merge(peer)
    peer.merge(this)
  }

  this.export = () => {
    return {
      peer_actions: Object.assign({}, this.peer_actions ),
      clock:   Object.assign({}, this.clock ),
      objects: Object.assign({}, this.objects ),
      links:   Object.assign({}, this.links )
    }
  }

  this.link = (store) => {
    this.peers[store._id] = store
    store.peers[this._id] = this
    this.sync(store)
  }

  this.pause = () => {
    this.syncing = false
  }

  this.unpause = () => {
    this.syncing = true
    this.try_sync_with_peers()
  }

  this.push_action = (action) => {
    const a = JSON.parse(JSON.stringify(action)) // avoid inadvertently sharing pointers between stores
    if (!(a.by in this.peer_actions)) {
      this.clock[a.by] = 0
      this.peer_actions[a.by] = []
    }
    this.peer_actions[a.by].push(a);
  }

  this.apply = (action) => {
    if (action.action != "create" && action.target == this.root._id && this.objects[this.root._id] === undefined) {
      this.apply({ action: "create", target: this.root._id, value: {} })
      this.apply({ action: "link", target: root_id, key: "root", value: action.target })
    }

    let a = Object.assign({ by: this._id, clock: this.tick() }, action)
    this.push_action(a)
    this.try_apply()
  }

  this.objectID = (value) => {
    if ('_id' in value) return value._id
    if (Array.isArray(value)) {
      // TODO what is the right way of handling arrays containing nested objects?
      let new_id = UUID.generate()
      this.apply({ action: "create", target: new_id, value: value })
      return new_id
    }

    let obj = Object.assign({}, value)
    let links = {}

    for (let key in obj) {
      if (typeof obj[key] == 'object' && value !== null) {
        links[key] = this.objectID(obj[key])
        delete obj[key]
      }
    }

    let new_id = UUID.generate()
    this.apply({ action: "create", target: new_id, value: obj })
    for (let key in links) {
      this.apply({ action: "link", target: new_id, key: key, value: links[key] })
    }
    return new_id
  }

  this.setMapValue = (target, key, value) => {
    if (typeof value == 'object' && value !== null) {
      this.apply({ action: "link", target: target, key: key, value: this.objectID(value) })
    } else {
      this.apply({ action: "set", target: target, key: key, value: value })
    }
  }

  this.setListValue = (target, key, value) => {
    if (typeof value == 'object' && value !== null) {
      this.apply({ action: "link", target: target, key: key, value: this.objectID(value) })
    } else {
      this.apply({ action: "splice", target: target, cut: [key, key + 1], add: [value] })
    }
  }

  // Returns true if the two actions are concurrent, that is, they happened without being aware of
  // each other (neither happened before the other). Returns false if one supercedes the other.
  this.is_concurrent = (action1, action2) => {
    let keys = Object.keys(action1.clock).concat(Object.keys(action2.clock))
    let oneFirst = false, twoFirst = false
    for (let i = 0; i < keys.length; i++) {
      let one = action1.clock[keys[i]] || 0
      let two = action2.clock[keys[i]] || 0
      if (one < two) oneFirst = true
      if (two < one) twoFirst = true
    }

    return oneFirst && twoFirst
  }

  this.can_apply = (action) => {
    for (let i in action.clock) {
      let local_clock = this.clock[i] || 0;
      if (i == action.by && local_clock + 1 != action.clock[i]) return false;
      if (i != action.by && local_clock < action.clock[i]) return false;
    }
    return true
  }

  this.try_apply = () => {
    var actions_applied
    var total_actions = 0
    do {
      actions_applied = 0
      for (var id in this.peer_actions) {
        let actions = this.peer_actions[id]
        let action_no = this.clock[id]
        if (action_no < actions.length) {
          let next_action = actions[action_no]
          if (this.can_apply(next_action)) {
            this.do_apply(next_action)
            actions_applied += 1
            total_actions += 1
          } else {
//            console.log("can apply failed:",this._id, next_action)
//            throw "x"
          }
        }
      }
    } while (actions_applied > 0)
    if (total_actions > 0) {
      this.did_apply()
    }
  }

  this.tick = () => {
    let t = Object.assign({},this.clock)
    t[this._id] += 1;
    return t
  }

  this.try_sync_with_peers = () => {
    for (let id in this.peers) {
      if (this.syncing && this.peers[id].syncing) {
        this.sync(this.peers[id])
      }
    }
  }

  this.do_apply = (a) => {
    console.assert(this.clock[a.by] + 1 == a.clock[a.by])
    this.clock[a.by] = a.clock[a.by]
    switch (a.action) {
      case "set":
      case "del":
      case "link":
        if (!(a.key in this.obj_actions[a.target])) this.obj_actions[a.target][a.key] = {}
        let actions = this.obj_actions[a.target][a.key]
        for (var source in actions) {
          if (!this.is_concurrent(a, actions[source])) {
            delete actions[source]
            delete this.conflicts[a.target][a.key][source]
          }
        }
        actions[a.by] = a

        let sources = Object.keys(actions).sort().reverse()
        let winner = actions[sources[0]]
        if (winner.action == "set") {
          this.objects[a.target]._set(a.key, winner.value)
        } else if (winner.action == "del") {
          delete this.objects[a.target]._direct[a.key]
          delete this.links[a.target][a.key]
        } else if (winner.action == "link") {
          this.objects[a.target]._set(a.key, this.objects[winner.value])
          this.links[a.target][a.key] = winner.value
          if (a.target == root_id && a.key == "root") this.root = this.objects[winner.value]
        }

        this.conflicts[a.target][a.key] = {}
        for (let i = 1; i < sources.length; i++) {
          let conflict = actions[sources[i]]
          this.conflicts[a.target][a.key][sources[i]] =
            (conflict.action == "link" ? this.objects[conflict.value] : conflict.value)
        }
        break;

      case "create":
        // cant have collisions here b/c guid is unique :p
        this.conflicts[a.target] = {}
        this.obj_actions[a.target] = {}
        if (Array.isArray(a.value)) {
          this.objects[a.target] = new List(this, a.target, a.value)            // objects[k] = [a,b,c]
          this.list_index[a.target] = this.objects[a.target].map((val,i) => i)  // list_index[k] = [0,1,2]
          this.list_sequence[a.target] = this.objects[a.target].length          // list_sequence = 3
          this.list_tombstones[a.target] = this.objects[a.target].map(() => []).concat([[]]) // list_tombstones = [[],[],[],[]]
/*
          console.log("--- create ----------------------------")
          console.log("--- object", this.objects[a.target])
          console.log("--- list_squence", this.list_sequence[a.target])
          console.log("--- list_index", this.list_index[a.target])
          console.log("--- list_tombstone", this.list_tombstones[a.target])
*/
        } else {
          this.objects[a.target] = new Map(this, a.target, Object.assign({}, a.value))
        }
        this.links[a.target] = {}
        break;
      case "splice":
/*
        console.log("splice - before", a)
        console.log("--- object", this.objects[a.target])
        console.log("--- list_squence", this.list_sequence[a.target])
        console.log("--- list_index", this.list_index[a.target])
        console.log("--- list_tombstone", this.list_tombstones[a.target])
*/
        let indexes = a.add.map((n,i) => this.list_sequence[a.target] + i)
        let tombs = a.add.map((n,i) => [])
        this.list_sequence[a.target] += a.add.length
        this.objects[a.target]._splice(a.cut[0],a.cut[1],...a.add)
        let new_tombstones = this.list_index[a.target].splice(a.cut[0],a.cut[1],...indexes)
        let moved_tombs = this.list_tombstones[a.target].splice(a.cut[0],a.cut[1],...tombs)
        moved_tombs.push(new_tombstones)
        if (this.list_tombstones[a.target][a.cut[0]] == undefined) {
          this.list_tombstones[a.target][a.cut[0]] =  []
        }
        this.list_tombstones[a.target][a.cut[0]] = this.list_tombstones[a.target][a.cut[0]].concat(...moved_tombs)
/*
        console.log("splice - after ---------------")
        console.log("--- tombs.splice()", a.cut[0],a.cut[1],tombs)
        console.log("--- a.cut[0]", a.cut[0])
        console.log("--- moved-tombs", moved_tombs)
        console.log("--- object", this.objects[a.target])
        console.log("--- list_squence", this.list_sequence[a.target])
        console.log("--- list_index", this.list_index[a.target])
        console.log("--- list_tombstone", this.list_tombstones[a.target])
*/
        break;
      default:
        console.log("unknown-action:", a.action)
    }
    this.try_sync_with_peers()
  }
}

module.exports = {
  Store: Store,
  debug: (bool) => { Debug = bool }
}


/*
[  1,  2,  3 ] // length = 3
[ [], [], [], [] ]

[  1,   2  ] //  length = 2
[ [],  [], [3] ]
[  1,   3  ] //  length = 2
[ [],  [2], [] ]
[  2,   3  ] //  length = 2
[ [1],  [], [] ]

[  1  ] // length = 1
[ [], [2,3], ]
[  2  ] // length = 1
[ [1], [3], ]
[  3  ] // length = 1
[ [1,2], [], ]

[  ] //  length = 0
[ [1, 2, 3] ]


*/
