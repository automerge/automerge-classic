
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


// { a: 1 } vs { b: 1 } -> current 
// { b: 1 } vs { a: 1 } -> conflict 
// { a: 1 , b: 2 } vs { a: 1, b: 1 } -> next 
// { a: 1 , b: 1 } vs { a: 1, b: 2 } -> anchient 

// a1:b1:c1

// a2:b1:c1 
// a3:b1:c1
// a4:b1:c1
// --------
// a1:b2:c1
// a1:b3:c1
// a1:b4:c1

// a5:b4:c1

// clock v item -> old, next, future
// item  v item -> burried, [ conflicted, superseeded ], replace

function can_apply(clock, item) {
  for (let i in item) {
    if (i == item.by && clock[i] + 1 != item.clock[i]) return false;
    if (i != item.by && clock[i] > item.clock[i]) return false;
  }
  return true
}

function can_superseed(old, item) {
  for (let i in item) {
    if (i == item.by && clock[i] + 1 != item.clock[i]) return false;
    if (i != item.by && clock[i] != item[i]) return false;
  }
  return true
}

let MapHandler = {
  get: (target,key) => {
    if (key == "_direct") return target
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
    map.__proto__ = { _store: store, _id: id, _actions: {} }
    return new Proxy(map, MapHandler)
}

function Store() {
  let root_id = '00000000-0000-0000-0000-000000000000'
  this._id = UUID.generate();
  this.actions = { [this._id]: [] }
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

  this.try_apply = () => {
    var actions_applied
    do {
      actions_applied = 0
      for (var id in this.actions) {
        let actions = this.actions[id]
        let action_no = this.clock[id]
        if (action_no < actions.length) {
          //console.log("ACTION NO",action_no)
          //console.log("ACTIONS.LENGTH",actions.length)
          //console.log("ACTIONS",actions)
          let next_action = actions[action_no]
          //console.log("NEXT ACTION",next_action)
          if (can_apply(next_action)) {
            this.do_apply(next_action)
            actions_applied += 1
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

  this.do_apply = (a) => {
    console.assert(this.clock[a.by] + 1 == a.clock[a.by])
    this.clock[a.by] = a.clock[a.by]
    switch (a.action) {
      case "set":
        this.objects[a.target]._direct[a.key] = a.value
        this.objects[a.target]._direct._actions[a.key] = a
        break;
      case "del":
        delete this.objects[a.target]._direct[a.key]
        delete this.links[a.target][a.key]
        this.objects[a.target]._direct._actions[a.key] = a
        break;
      case "create":
        // cant have collisions here b/c guid is unique :p
        this.objects[a.target] = new Map(this, a.target, a.value)
        this.links[a.target] = {}
        break;
      case "link":
        this.objects[a.target]._direct[a.key] = this.objects[a.value]
        this.objects[a.target]._direct._actions[a.key] = a
        this.links[a.target][a.key] = a.value
        break;
    }
    this.try_sync_with_peers()
  }
}

module.exports = {
  Store: Store
}

