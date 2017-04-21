
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
    map.__proto__ = { _store: store, _id: id, _conflicts: store.conflicts[id] }
    return new Proxy(map, MapHandler)
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
        this.objects[a.target] = new Map(this, a.target, a.value)
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
    }
    this.try_sync_with_peers()
  }
}

module.exports = {
  Store: Store
}

