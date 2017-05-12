
let Debug = false
function Log() {
  if (Debug) {
    console.log(...arguments)
  }
}

let unique = function(list) { return list.filter( (v,i,self) => self.indexOf(v) === i ) }


function load(data) {
  let imp = JSON.parse(data)
  if (imp.tesseract != "v1") throw "Cant Import Data - Invalid"
  let s = new Store()
  s.peer_actions = Object.assign(s.peer_actions, imp.actions)
  s.clock = Object.keys(imp.actions).reduce((obj,n) => Object.assign(obj,{[n]:0}),s.clock)
  s.try_apply()
  //console.log("CLOCK",s.clock)
  //console.log("OBJ",s.objects)
  //console.log("META",s.list_meta)
  //console.log("PEER",s.peer_actions)
  return s
}

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

let ListHandler = {
  get: (target,key) => {
    if (key == "_direct") return target
    if (key == "_set") return (key,val) => { target[key] = val }
    if (key == "_conflicts") return target._conflicts
    if (key == "splice") return function() { return target.splice(...arguments) }
    if (key == "_splice") return function() { return target._splice(...arguments) }
    return target[key]
  },
  set: (target,key,value) => {
    if (key.startsWith("_")) { throw "Invalid Key" }
    let n = parseInt(key)
    if (n >= target.length) {
      let padding = (new Array(n - target.length)).fill(null)
      padding.push(value)
      target.push(...padding)
    } else {
      target._store.setListValue(target._id, n, value)
    }
    return true
  },
  deleteProperty: (target,key) => {
    if (key.startsWith("_")) { throw "Invalid Key" }
    // TODO - do i need to distinguish 'del' from 'unlink' - right now, no, but keep eyes open for trouble
    target._store.apply({ action: "del", target: target._id, key: key })
    return true
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
    return true
  },
  deleteProperty: (target,key) => {
    if (key.startsWith("_")) { throw "Invalid Key" }
    // TODO - do i need to distinguish 'del' from 'unlink' - right now, no, but keep eyes open for trouble
    target._store.apply({ action: "del", target: target._id, key: key })
    return true
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
      let cut = this.slice(start,start+run)
      let cut_index = store.list_index[this._id].slice(start,start+run)
      let at1 = store.list_index[this._id][start - 1] || "HEAD"
      let at2 = store.list_index[this._id][start + run] || "TAIL"
      let cut1 = cut_index.shift()
      let cut2 = cut_index.pop() || cut1;
      let idx = args.map((n,i) => store._id + ":" + (store.list_sequence[this._id] + i))
      store.list_sequence[this._id] += args.length
      store.apply({ action: "splice", target: this._id, idx:idx, cut: [cut1,cut2], at: [at1,at2], value:store.to_vals(args), links:store.to_links(args) })
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
    store.list_index[id] = []
    store.list_meta[id] = {}
    list.__proto__ = {
      __proto__:  list.__proto__,
      _id:        id,
      _store:     store,
      _conflicts: store.conflicts[id],
      _index:     store.list_index[id],
      _meta:      store.list_meta[id],
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
  this.list_meta = { }
  this.list_sequence = { }
  this.conflicts = { [root_id]: {} }
  this.peer_actions = { [this._id]: [] }
  this.obj_actions = { [root_id]: {} }
  this.root = new Map(this, root_id, {})
  this.objects = { [this.root._id]: this.root }
  this.links = { [this.root._id]: {} }
  this.clock = { [this._id]: 0 }
  this.peers = {}
  this.syncing = true

  this.handlers = {change:[]}
  this.getState = () => this.root
  this.subscribe = (handler) => {
    if (this.handlers['change']) {
      this.handlers['change'].push(handler)
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

  this.log = () => {
    Log(...arguments)
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
    let a = Object.assign({ by: this._id, clock: this.tick() }, action)
    this.push_action(a)
    this.try_apply()
  }

  this.to_vals = (array) => {
    return array.map((n) => typeof n == 'object' ? null : n )
  }

  this.to_links = (array) => {
    return array.map((n) => typeof n == 'object' ? this.objectID(n) : null )
  }

  this.objectID = (value) => {
    if ('_id' in value) return value._id
    if (Array.isArray(value)) {
      // TODO what is the right way of handling arrays containing nested objects?
      let new_id = UUID.generate()
      let idx = value.map((n,i) => this._id + ":" + i)
      this.list_sequence[new_id] = value.length
      this.apply({ action: "create", target: new_id, value:this.to_vals(value), idx: idx, links:this.to_links(value)  })
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
      this.apply({ action: "set", target: target, key:key, value: value })
    }
  }

  // Returns true if the two actions are concurrent, that is, they happened without being aware of
  // each other (neither happened before the other). Returns false if one supercedes the other.
  this.is_concurrent = (action1, action2) => {
    // FIXME - unqiue()
    let keys = unique(Object.keys(action1.clock).concat(Object.keys(action2.clock)))
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
//            Log("can apply failed:",this._id, next_action)
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

  this.is_covering = (b, seen) => {
    if (b.at == undefined) return false;
    return seen.hasOwnProperty(b.at[0]) && seen.hasOwnProperty(b.at[1])
  }

  this.is_covered = (a,meta) => {
    let FALSE = [false]
    if (a.cut == undefined) return FALSE
    if (a.at[0] == "HEAD") return FALSE
    if (a.at[1] == "TAIL") return FALSE
    let m0 = meta[a.at[0]]
    let m1 = meta[a.at[1]]
    if (m0 == undefined) return FALSE
    if (m1 == undefined) return FALSE
    if (m0.deleted == false) return FALSE
    if (m1.deleted == false) return FALSE
    if (m0.action != m1.action) return FALSE
    if (!this.is_concurrent(m0.action,a)) return FALSE
    if (!this.is_concurrent(m1.action,a)) return FALSE
    return [true, m0.action]
  }

  this.do_splice = (a) => {
    let value      = a.value
    let links      = a.links
    let object     = this.objects[a.target]
    let index      = this.list_index[a.target]
    let meta       = this.list_meta[a.target]
    let newIndex   = a.idx || value.map((n,i) => a.by + ":" + i)

    // CUT DATA

    let [covered,covered_action] = this.is_covered(a,meta)

    let cut        = a.cut && a.cut[0]
    let concurrent = {}

    // find all the things in the span
    Log("Splice",a)
    Log("PRE",object)
    Log("PRE",index)
    //Log("PRE",meta)
    Log("COVERED?",covered)

    while (cut) {
      let n = index.indexOf(cut)
      concurrent[cut] = this.is_concurrent(a,meta[cut].action)
      if (cut == a.cut[1]) break; // we reached the end of the cut
      cut = meta[cut].next
    }

    for (let s in concurrent) {
      // only delete if its not deleted
      if (meta[s].deleted == false) {
        // delete if its not concurrent 
        // OR
        // I saw the begin and end insertion points while walking the list (we're covering it)
        if (concurrent[s] == false || this.is_covering(meta[s].action, concurrent)) {
          let n = index.indexOf(s)
          Log("CUT",n)
          object._splice(n,1)
          index.splice(n,1)
          meta[s].deleted = true
          meta[s].action = a
        }
      }
    }

    let last = a.at === undefined ? "HEAD" : a.at[0]
    let next = meta[last] ? meta[last].next : index[0]

    Log("LAST",last)
    Log("NEXT",next)
    for (;;) {
      if (meta[next] === "TAIL") break;
      let b = meta[next].action
      if (!this.is_concurrent(a,b)) break;
      if (a.by > b.by) break;
      last = next
      next = meta[last].next
      Log("NEXT+",next)
    }

    // walk backwards to find an undeleted node to attach to
    let begin = last
    while( meta[begin] && index.indexOf(begin) == -1) {
      begin = meta[begin].last
      Log("BACK",begin)
    }
    let n = index.indexOf(begin) + 1

    for (let v in value) {
      let here = newIndex[v]
      // covered means that another concurrent spliced covered this splice deleteing it
      if (!covered) {
        let val = value[v] || this.objects[links[v]]
        object._splice(n,0,val)
        index.splice(n,0,here)
      }
      meta[here] = { action: covered ? covered_action : a, val: value[v], link:links[v], deleted: covered, last: last, next: meta[last] ? meta[last].next : "TAIL"  }
      if (meta[last]) meta[last].next = here
      if (meta[next]) meta[next].last = here
      last = here
      next = meta[here].next
      n++
    }
    Log("POST",object)
    Log("POST",index)
    //Log("POST",meta)
  }

  this.save = () => {
    return JSON.stringify({
      tesseract: "v1",
      actions: this.peer_actions
    })
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
        this.conflicts[a.target] = {}
        this.obj_actions[a.target] = {}
        if (Array.isArray(a.value)) {
          this.objects[a.target] = new List(this, a.target, [])            // objects[k] = [a,b,c]
          this.list_sequence[a.target] = this.list_sequence[a.target] || 0
          this.list_index[a.target] = []
          this.list_meta[a.target]["HEAD"] = { action: a, deleted: false, next: "TAIL" }
          this.list_meta[a.target]["TAIL"] = { action: a, deleted: false, last: "HEAD" }
          this.do_splice(a)
        } else {
          this.objects[a.target] = new Map(this, a.target, Object.assign({}, a.value))
        }
        this.links[a.target] = {}
        break;
      case "splice":
        this.do_splice(a)
        break;
      default:
        console.log("unknown-action:", a.action)
    }
    this.try_sync_with_peers()
  }
}

module.exports = {
  Store: Store,
  load: load,
  debug: (bool) => { Debug = bool }
}


