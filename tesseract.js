
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


/*
   c44d2f08-76c5-43ef-9020-fabd041059c5 
   { 
     'c44d2f08-76c5-43ef-9020-fabd041059c5': 11,
     '4e61065a-5678-4ae7-a9ff-0565c79c1917': 4,
     '98987743-2397-4b99-81e1-a138b3b849b3': 2 }

     'c44d2f08-76c5-43ef-9020-fabd041059c5': 10,
     '4e61065a-5678-4ae7-a9ff-0565c79c1917': 5,
     '98987743-2397-4b99-81e1-a138b3b849b3': 2 }
*/

let MapHandler = {
  get: (target,key) => {
    if (key == "_direct") return target
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
    map.__proto__ = { _store: store, _id: id, _actions: {}, _conflicts: store.conflicts[id] }
    return new Proxy(map, MapHandler)
}

function Store(uuid) {
  let root_id = '00000000-0000-0000-0000-000000000000'
  let _uuid = uuid || UUID.generate()
  this._id = _uuid
  this.actions = { [this._id]: [] }
  this.conflicts = { [root_id]: {} }
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


  this.can_superseed = (old_action, action) => {
    if (old_action == undefined) return true 
    //console.log("Testing...", action)
    for (let i in action.clock) {
      //console.log( action.by, i == action.by,  old_action.clock[i], action.clock[i])
      console.log("CAN SUPER", "me:", this._id, "val:", action.value, "by:", action.by, "key:",i , i == action.by, old_action.clock[i] , action.clock[i] )
      if (i == action.by && old_action.clock[i] + 1 != action.clock[i]) return false;
      if (i != action.by && old_action.clock[i] != action.clock[i]) return false;
    }
    return true
  }

  this.can_apply = (clock, action) => {
    for (let i in action.clock) {
//      console.log("CAN APPLY", "me:", this._id, "by:", action.by, "key:",i , i == action.by, clock[i] , action.clock[i] )
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
          //console.log("ACTION NO",action_no)
          //console.log("ACTIONS.LENGTH",actions.length)
          //console.log("ACTIONS",actions)
          let next_action = actions[action_no]
          //console.log("NEXT ACTION",next_action)
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

  this.do_apply = (a) => {
    console.assert(this.clock[a.by] + 1 == a.clock[a.by])
    //console.log("updating clock for",this._id,"at",a.by,this.clock[a.by],a.clock[a.by])
    this.clock[a.by] = a.clock[a.by]
    switch (a.action) {
      case "set":
        if (this.can_superseed( this.objects[a.target]._direct._actions[a.key] , a )) {
          this.objects[a.target]._direct[a.key] = a.value
          this.objects[a.target]._direct._actions[a.key] = a
          //console.log(a)
          //console.log(this.conflicts[a.target])
          this.conflicts[a.target][a.key] = []
        }
        else 
        {
          //console.log("CONFLICT")
          if (this.objects[a.target]._direct._actions[a.key].by > a.by) {
            this.conflicts[a.target][a.key].push(a.value)
          } else {
            this.conflicts[a.target][a.key].push(this.objects[a.target][a.key])
            this.objects[a.target]._direct[a.key] = a.value
            this.objects[a.target]._direct._actions[a.key] = a
          }
        }
        break;
      case "del":
        delete this.objects[a.target]._direct[a.key]
        delete this.links[a.target][a.key]
        delete this.conflicts[a.target][a.key]
        this.objects[a.target]._direct._actions[a.key] = a
        break;
      case "create":
        // cant have collisions here b/c guid is unique :p
        this.conflicts[a.target] = {}
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

