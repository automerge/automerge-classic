
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
    let store = target._store;
    if (typeof value == 'object') {
      if (!('_id' in value)) {
        store.apply({ action: "create", target: UUID.generate(), value: value, by: target._store._id, clock: target._store.tick() })
      }
      store.apply({ action: "link", target: target._id, key: key, value: value._id, by: target._store._id, clock: target._store.tick() })
    } else {
      store.apply({ action: "set", target: target._id, key: key, value: value, by: target._store._id, clock: target._store.tick() })
    }
    return true
  },
  deleteProperty: (target,key) => {
    if (Debug) { console.log("DELETE",key) }
    if (key.startsWith("_")) { throw "Invalid Key" }
    let store = target._store;
    // TODO - do i need to distinguish 'del' from 'unlink' - right now, no, but keep eyes open for trouble
    let action = {
      action: "del",
      target: target._id,
      key: key,
      by: target._store._id,
      clock: target._store.tick()
    }
    store.apply(action);
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
    let store = target._store;
    if (typeof value == 'object') {
      if (!('_id' in value)) {
        store.apply({ action: "create", target: UUID.generate(), value: value, by: target._store._id, clock: target._store.tick() })
      }
      store.apply({ action: "link", target: target._id, key: key, value: value._id, by: target._store._id, clock: target._store.tick() })
    } else {
      store.apply({ action: "set", target: target._id, key: key, value: value, by: target._store._id, clock: target._store.tick() })
    }
  },
  deleteProperty: (target,key) => {
    if (key.startsWith("_")) { throw "Invalid Key" }
    let store = target._store;
    // TODO - do i need to distinguish 'del' from 'unlink' - right now, no, but keep eyes open for trouble
    let action = { action: "del", target: target._id, key: key, by: target._store._id, clock: target._store.tick() }
    store.apply(action);
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
      store.apply({ action: "splice", target: this._id, cut: [start,start + run], add: args, by: store._id, clock: store.tick() })
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
  this.actions = { [this._id]: [] }
  this.conflicts = { [root_id]: {} }
  this.actions = { [root_id]: {} }
  this.root = new Map(this, root_id, {})
  this.objects = { [this.root._id]: this.root }
  this.links = { [this.root._id]: {} }
  this.clock = { [this._id]: 0 }
  this.peers = {}
  this.syncing = true

  this.merge = (peer) => {
    for (let id in peer.actions) {
      let idx = (id in this.actions) ? this.actions[id].length : 0
      for (let i = idx; i < peer.actions[id].length; i++) { // in peer.actions[id].slice(idx)) {
        this.push_action(peer.actions[id][i])
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
      actions: Object.assign({}, this.actions ),
      clock:   Object.assign({}, this.clock ),
      objects: Object.assign({}, this.objects ),
      links:   Object.assign({}, this.links )
    }
  }

  this.link = (store) => {
    if (store.clock[this._id] === undefined) store.clock[this._id] = 0
    if (this.clock[store._id] === undefined) this.clock[store._id] = 0

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

  this.push_action = (a) => {
    if (!(a.by in this.actions)) {
      this.clock[a.by] = 0
      this.actions[a.by] = []
    }
    this.actions[a.by].push(a);
  }

  this.apply = (a) => {
    this.push_action(a)
    this.try_apply()
  }


  this.superseeds = (action) => {
    for (let i in action.clock) {
      if (this.clock[i] != action.clock[i]) return false;
    }
    return true
  }

  this.can_apply = (clock, action) => {
    for (let i in action.clock) {
      if (i == action.by && clock[i] + 1 != action.clock[i]) return false;
      if (i != action.by && clock[i] < action.clock[i]) return false;
    }
    return true
  }

  this.try_apply = () => {
    var actions_applied
    do {
      actions_applied = 0
      for (var id in this.actions) {
        let actions = this.actions[id]
        let action_no = this.clock[id]
        if (action_no < actions.length) {
          let next_action = actions[action_no]
          if (this.can_apply(this.clock, next_action)) {
            this.do_apply(next_action)
            actions_applied += 1
          } else {
//            console.log("can apply failed:",this._id, next_action)
//            throw "x"
          }
        }
      }
    } while (actions_applied > 0)
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

  this.will_conflict = (a) => {
    return this.actions[a.target][a.key].by > a.by
  }

  this.do_apply = (a) => {
    console.assert(this.clock[a.by] + 1 == a.clock[a.by])
    this.clock[a.by] = a.clock[a.by]
    switch (a.action) {
      case "set":
        //console.log("can superseed", this._id, this.objects[a.target][a.key], "vs", a.value)
        //console.log("clock ",pp(this.clock) )
        //console.log("action",pp(a.clock))
        if (this.superseeds( a )) {
          this.objects[a.target]._set(a.key, a.value)
          this.actions[a.target][a.key] = a
          this.conflicts[a.target][a.key] = {}
        } else if (this.will_conflict(a)) {
          this.conflicts[a.target][a.key][a.by] = a.value
        } else {
          this.conflicts[a.target][a.key][this.actions[a.target][a.key].by] = this.objects[a.target][a.key]
          this.objects[a.target]._set(a.key, a.value)
          this.actions[a.target][a.key] = a
          delete this.conflicts[a.target][a.key][a.by]
        }
        break;
      case "del":
        if (this.superseeds( a )) {
          delete this.objects[a.target]._direct[a.key]
          delete this.links[a.target][a.key]
          this.conflicts[a.target][a.key] = {}
          this.actions[a.target][a.key] = a
        } else if (this.will_conflict(a)) {
          this.conflicts[a.target][a.key][a.by] = undefined
        } else {
          this.conflicts[a.target][a.key][this.actions[a.target][a.key].by] = this.objects[a.target][a.key]
          delete this.objects[a.target]._direct[a.key]
          delete this.links[a.target][a.key]
          this.actions[a.target][a.key] = a
          delete this.conflicts[a.target][a.key][a.by]
        }
        break;
      case "create":
        // cant have collisions here b/c guid is unique :p
        this.conflicts[a.target] = {}
        this.actions[a.target] = {}
        if (Array.isArray(a.value)) {
          this.objects[a.target] = new List(this, a.target, a.value)
        } else {
          this.objects[a.target] = new Map(this, a.target, a.value)
        }
        this.links[a.target] = {}
        break;
      case "link":
        if (this.superseeds( a )) {
          this.objects[a.target]._set(a.key, this.objects[a.value])
          this.actions[a.target][a.key] = a
          this.links[a.target][a.key] = a.value
          this.conflicts[a.target][a.key] = {}
        } else if (this.will_conflict(a)) {
          this.conflicts[a.target][a.key][a.by] = this.objects[a.value]
        } else {
          this.conflicts[a.target][a.key][this.actions[a.target][a.key].by] = this.objects[a.target][a.key]
          this.objects[a.target]._set(a.key, this.objects[a.value])
          this.actions[a.target][a.key] = a
          this.links[a.target][a.key] = a.value
          delete this.conflicts[a.target][a.key][a.by]
        }
        break;
      case "splice":
        this.objects[a.target]._splice(a.cut[0],a.cut[1],...a.add)
        //console.log("splice",this._id,a)
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

