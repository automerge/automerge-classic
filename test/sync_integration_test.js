const assert = require("assert");
const { EventEmitter } = require("events");
const A =
  process.env.TEST_DIST === "1"
    ? require("../dist/automerge")
    : require("../src/automerge");

describe("sync protocol - integration", () => {
  beforeEach(() => {
    iterations = 0;
  });

  describe("two peers", () => {
    it(`syncs a single change`, () => {
      let doc = A.from({});

      const alice = new ConnectedDoc("alice", doc);
      const bob = new ConnectedDoc("bob", doc);

      connect(alice, bob);

      // alice makes a change
      alice.change((s) => {
        s.alice = 1;
      });

      // bob gets the changes
      assert.deepStrictEqual(alice.doc, bob.doc);
    });

    it("syncs divergent changes", () => {
      let doc = A.from({});

      const alice = new ConnectedDoc("alice", doc);
      const bob = new ConnectedDoc("bob", doc);

      connect(alice, bob);

      alice.disconnect();

      // alice makes a change
      alice.change((s) => (s.alice = 1));

      // bob makes a change
      bob.change((s) => (s.bob = 1));

      // while they're disconnected, they have divergent docs
      assert.notDeepStrictEqual(alice.doc, bob.doc);

      alice.connect();

      // after connecting, their docs converge
      assert.deepStrictEqual(alice.doc, bob.doc);
    });
  });

  describe("three peers", () => {
    it(`syncs a single change`, () => {
      let doc = A.from({});

      const alice = new ConnectedDoc("alice", doc);
      const bob = new ConnectedDoc("bob", doc);
      const charlie = new ConnectedDoc("charlie", doc);

      connect(alice, bob);
      connect(bob, charlie);

      // alice makes a change
      alice.change((s) => {
        s.alice = 1;
      });

      // charlie gets the changes (via bob)
      assert.deepStrictEqual(alice.doc, charlie.doc);
    });

    it(`syncs a single change (all connected to all)`, () => {
      let doc = A.from({});

      const alice = new ConnectedDoc("alice", doc);
      const bob = new ConnectedDoc("bob", doc);
      const charlie = new ConnectedDoc("charlie", doc);

      connect(alice, bob);
      connect(bob, charlie);
      connect(alice, charlie);

      // alice makes a change
      alice.change((s) => {
        s.alice = 1;
      });

      // charlie gets the changes (via bob)
      assert.deepStrictEqual(alice.doc, charlie.doc);
    });

    it(`syncs multiple changes`, () => {
      let doc = A.from({});

      const alice = new ConnectedDoc("alice", doc);
      const bob = new ConnectedDoc("bob", doc);
      const charlie = new ConnectedDoc("charlie", doc);

      connect(alice, bob);
      connect(bob, charlie);
      connect(alice, charlie);

      // each one makes a change
      alice.change((s) => (s.alice = 1));
      bob.change((s) => (s.bob = 1));
      charlie.change((s) => (s.charlie = 1));

      // all docs converge
      assert.deepStrictEqual(alice.doc, bob.doc);
      assert.deepStrictEqual(bob.doc, charlie.doc);
      assert.deepStrictEqual(alice.doc, charlie.doc);
    });

    it("syncs divergent changes", async () => {
      let doc = A.from({});

      const alice = new ConnectedDoc("alice", doc);
      const bob = new ConnectedDoc("bob", doc);
      const charlie = new ConnectedDoc("charlie", doc);

      // console.log('---------------- connecting')

      connect(alice, charlie);
      connect(alice, bob);
      connect(alice, charlie);

      // console.log('---------------- disconnecting')

      alice.disconnect();
      bob.disconnect();
      charlie.disconnect();

      // console.log('---------------- making changes')

      // each one makes a change
      alice.change((s) => (s.alice = 1));
      bob.change((s) => (s.bob = 1));
      charlie.change((s) => (s.charlie = 1));

      // while they're disconnected, they have divergent docs
      assert.notDeepStrictEqual(alice.doc, bob.doc);
      assert.notDeepStrictEqual(bob.doc, charlie.doc);
      assert.notDeepStrictEqual(alice.doc, charlie.doc);

      // console.log('---------------- reconnecting')

      alice.connect();
      bob.connect();
      charlie.connect();

      // after connecting, their docs converge
      assert.deepStrictEqual(alice.doc, bob.doc);
      assert.deepStrictEqual(bob.doc, charlie.doc);
      assert.deepStrictEqual(alice.doc, charlie.doc);
    });
  });
});

function connect(a, b) {
  const channel = new Channel();
  a.connectTo(b.peerId, channel);
  b.connectTo(a.peerId, channel);
}

class ConnectedDoc extends EventEmitter {
  constructor(peerId, doc) {
    super();
    this.peerId = peerId;
    this.doc = A.clone(doc);
    this.peers = {};
  }

  connectTo(remotePeerId, channel) {
    this.connected = true;
    channel.join();
    const peer = new Peer(this.peerId, remotePeerId, channel);
    channel.addListener("data", (senderId, msg) => {
      if (senderId === this.peerId) return;
      const newDoc = this.peers[senderId].receiveSync(this.doc, msg);
      this.update(newDoc);
    });
    this.peers[remotePeerId] = peer;
  }

  update(doc) {
    this.doc = doc;
    for (const peerId in this.peers) {
      const peer = this.peers[peerId];
      const msg = peer.generateSync(this.doc);
      if (msg) {
        peer.write(msg);
      }
    }
  }

  change(fn) {
    const updatedDoc = A.change(this.doc, fn);
    this.update(updatedDoc);
  }

  disconnect() {
    this.connected = false;
    for (const peerId in this.peers) {
      this.peers[peerId].channel.leave();
      this.peers[peerId].channel.leave();
    }
  }

  connect() {
    this.connected = true;
    for (const peerId in this.peers) {
      const peer = this.peers[peerId];
      peer.channel.join();
      peer.channel.join();
      this.update(this.doc);
    }
  }
}

class Peer extends EventEmitter {
  constructor(ourId, peerId, channel) {
    super();
    this.ourId = ourId;
    this.channel = channel;
    this.syncState = A.initSyncState();
    this.peerId = peerId;
  }

  write(msg) {
    this.channel.write(this.ourId, msg);
  }

  generateSync(doc) {
    const [syncState, msg] = A.generateSyncMessage(doc, this.syncState);
    this.syncState = syncState;
    return msg;
  }

  receiveSync(doc, msg) {
    const [newDoc, syncState] = A.receiveSyncMessage(doc, this.syncState, msg);
    // console.log(`received update ${this.peerId}<-${this.remotePeerId}`, doc)
    this.syncState = syncState;
    return newDoc;
  }
}

// dummy 2-way channel for testing
class Channel extends EventEmitter {
  constructor() {
    super();
    this.peers = 0;
    this.buffer = [];
  }
  join() {
    this.peers += 1;
    if (this.peers >= 3) throw new Error("This channel only supports 2 peers");
    if (this.peers === 2) {
      // someone is already here, emit any messages they sent before we joined
      for (const { peerId, msg } of this.buffer) {
        this.emit("data", peerId, msg);
      }
      this.buffer = [];
    }
    return this;
  }

  leave() {
    this.peers -= 1;
  }

  write(peerId, msg) {
    if (this.peers === 2) {
      // there's someone on the other end
      this.emit("data", peerId, msg);
    } else {
      // we're alone, save up messages until someone else joins
      this.buffer.push({ peerId, msg });
    }
  }
}

const pause = (t = 100) =>
  new Promise((resolve) => setTimeout(() => resolve(), t));
