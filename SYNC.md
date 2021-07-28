# Automerge Sync Protocol Documentation

The Automerge network sync protocol is designed to bring two documents into sync by exchanging messages between peers until both documents have the same contents. The protocol can run on top of any connection-based network link that supports bidirectional messages, including WebSocket, WebRTC, or plain TCP. It can be used in any network topology: client/server, peer-to-peer, or server-to-server sync are all supported.

The protocol works by exchanging rounds of sync messages. These sync messages contain two parts: 
 * a lossily-compressed list of changes it already has (implicitly requesting the remainder)
 * changes it believe the other peer needs

Each node will also maintain a local `syncState` for each peer they want to synchronize with, which keeps track of what the local node knows about that peer. This sync state has to be kept around during synchronization, and can be saved to disk between executions as a performance optimization, but will be automatically regenerated if the protocol detects any problems.

On connection, each peer should start the exchange with an initial message via `generateSyncMessage(doc, syncState)`. This first message generally does not include changes, but provides the recipient with the information it needs to determine which changes it should send. Upon receiving any message, a peer should always call `receiveSyncMessage(doc, syncState, message)`. This will update the `syncState` with the information necessary to calculate what changes to send, and also cause Automerge to apply any changes it received. The developer can now call `generateSyncMessage(doc, syncState)` to produce the next message to a peer. 

From then on, a peer should continue to call these functions until `generateSyncMessage()` returns a `null` value, indicating both peers are synchronized and no further communication is necessary.

## How to use the Sync Protocol

Automerge synchronization occurs at a per-document level. Most Automerge-based applications will be built around more than one document, so in our example code here we will assume these documents are identified by a string `docId`.

Throughout the example code below we're going to assume a couple of global variables exist, described here:

```js
// global variables (but maybe don't use global variables)
const syncStates = {} // a hash of [source][docId] containing in-memory sync states
const backends = {} // a hash by [docId] of current backend values
```

### Connecting: `decodeSyncState()` or `initSyncState()`

Automerge keeps track of ongoing exchanges with another peer using a `syncState` data structure. During synchronization, Automerge uses a probabilistic structure known as a Bloom filter to avoid having to send the full descriptions of every local change to peers. To reduce the size and cost of this structure, it is only built for changes the other peer has not already told us they have. This is described in more detail later in the "how it works" section of this document.

To maintain this structure, when a peer is discovered, first create a new `syncState` via `initSyncState()` and store the result somewhere associated with that peer. These `syncState` objects can be persisted between program executions as an optimization, but it is not required. All subsequent sync operations with that peer will return a new `syncState` to replace the previous one.

If you've already seen a peer, you should load your old `syncState` for them via `decodeSyncState()`. This is not strictly necessary, but will reduce unnecessary computation and network traffic.

```js
  if (data.type === 'HELLO') {
    if (syncStates[source] === undefined) {
      syncStates[source] = {}
      syncStates[source][docId] = Automerge.Backend.decodeSyncState(db.getSyncState(docId, source))
      sendMessage({ source: workerId, target: source, type: 'HELLO' })
    }
    return
  }
```

### Synchronizing with one or more peers

In general, whenever a peer creates a local change or receives a sync message from another peer, it should respond to all the peers it is connected to with its updated status. This will both confirm receipt of any data to the sending peer and also allow other peers to request any changes they may still need. 

Generating new sync messages to other peers is straightforward. Simply call `generateSyncMessage` and, if `syncMessage` is not null, send it to the appropriate peer. You will also need to hold on to the returned `syncState` for that peer, since it keeps track of what data you have sent them to avoid sending data twice.

Here is a simple example:
```js
function updatePeers(docId: string) {
  Object.entries(syncStates).forEach(([peer, syncState]) => {
    const [nextSyncState, syncMessage] = Automerge.Backend.generateSyncMessage(
      backends[docId],
      syncState[docId] || Automerge.Backend.initSyncState(),
    )
    syncStates[peer] = { ...syncStates[peer], [docId]: nextSyncState }
    if (syncMessage) {
      sendMessage({
        docId, source: workerId, target: peer, syncMessage,
      })
    }
  })
}
```

### Receiving sync messages

Receiving sync messages is also simple. Just pass the document, syncState, and incoming message to `receiveSyncMessage()`, and keep the updated results. Calling `receiveSyncMessage` may also produce a `patch`, which you must forward to the frontend.

After receiving a sync message, you should check if you need to send new sync messages to any connected peers using the code above. In our example code below this is represented by a call to `updatePeers()`:

```js
  const [nextBackend, nextSyncState, patch] = Automerge.Backend.receiveSyncMessage(
    backends[docId],
    syncStates[source][docId] || Automerge.Backend.initSyncState(),
    syncMessage,
  )
  backends[docId] = nextBackend
  syncStates[source] = { ...syncStates[source], [docId]: nextSyncState }

  updatePeers(docId)

  if (patch) {
    sendPatchToFrontend({ docId, patch })
  }
}
```

### Applying and distributing local changes

When you create a local change to a document, simply call `generateSyncMessage()` for each peer to produce a message to send them. In general, you can use the same `updatePeers()` implementation for both receiving messages and creating local changes. You may want to rate limit or debounce these communications to reduce network traffic, but this isn't required. *Remember, after applying a local change to the backend you will need to forward the resulting patch to your frontend!*

Here's a sample implementation:

```js
// sample message data format for sending from a renderer to a worker in a browser  
interface FrontendMessage {
  docId: string
  type: "OPEN" | "LOCAL_CHANGE"
  payload: Uint8Array
} 

// Respond to messages from the frontend document
self.addEventListener('message', (event: Event) => {
  const { data: FrontendMessage } = event
  const { docId } = data

  if (data.type === 'OPEN') {
    backends[docId] = Automerge.Backend.init()
  }

  if (data.type === 'LOCAL_CHANGE') {
    const [newBackend, patch] = Automerge.Backend.applyLocalChange(backends[docId], data.payload)
    backends[docId] = newBackend
    sendMessageToRenderer({ docId, patch })
  }

  // now tell everyone else about how things have changed
  updatePeers(docId)
})

```

### Handling disconnection

Remember to save your syncState object for a peer upon disconnection via `encodeSyncState()`. That might look like this:

```js
db.storeSyncState(docId, source, encodeSyncState(syncStates[source]))
```

## How it works

The algorithm is described in more detail in [this paper](https://arxiv.org/abs/2012.00472) and [this blog post](https://martin.kleppmann.com/2020/12/02/bloom-filter-hash-graph-sync.html).

### The first exchanges
If we don't already have any existing sync state with a peer, the first call to `generateSyncMessage()` will create a Bloom filter which contains encoded hashes of all the changes in the document. The recipient of this message will walk their local graph of changes backwards from each "head" in their document until the Bloom filter indicates the other peer has the change in question. Everything from that point forward is collected and sent in a response message -- along with a new bloom filter so the other peer can reciprocate.

### On the Bloom Filter
Conceptually, the most straightforward way to synchronize the two sets of changes would be to send over the complete list of changes from one peer to another, which could then exactly request the changes it was needed and offer any changes only it had. Unfortunately, this approach is prohibitively expensive. Every change is notionally represented by a 256-bit hash, which in cases like text editing can be larger than the actual change. By sending the compressed list of changes a document already *has* to the other peer, the recipient can then reply with their own changes they believe the sender is lacking. To reiterate because this was counter-intuitive: the receiver cannot determine which changes it needs by looking at the Bloom filter, only (estimate) what changes the sender needs.

### False positives

Bloom filters encode data probabalistically. The Automerge Bloom filter implementation is tuned such that there is a 1% chance per change of mistakenly believing the other peer already has the change in question. When this occurs, the receiving peer will not see any result from applying those changes. Until all change dependencies are in place, the new changes will remain invisible. To resolve this, the next syncMessage will include a `need` request which specifies particular changes by hash to send from the other peer.

### Shared Heads
To avoid constantly recalculating and retransmitting Bloom filters, the `syncState` tracks the "greatest common document" the two peers have in common. Every time changes are received and applied, we can safely skip adding those changes to any subsequent the Bloom filter. Thus, we simply begin adding changes to the Bloom filter at that point in the document history.

### Bloom filter example 

```js
a: [ a0, b0, a1, b1 ] + [ a2, a3 ]
b: [ a0, b0, a1, b1 ] + [ b2, b3 ]
```

In this example, we show data on two peers. If we imagine in some past synchronization exchange both peers synchronized and wound up with "shared heads" of `[a1, b1]`. This is the "greatest common document". To synchronize the two nodes, peer `a` would encode their local changes `[a2, a3]` into a Bloom filter and send them to `b`.

Upon receipt, `b` would check the Bloom filter for each of its local changes beginning with `b2`. Once it found a change `a` was missing, it would assume all subsequent changes should be sent. Thus 99% of the time (as we noted, the Bloom filter is probabalistic), it would send all the changes `a` needed. The remaining 1% of the time, it would mistakenly not send `b2`, but rather begin sending changes with `b3`. In this case, upon receiving those changes, `a` would see that it was still missing the `b2` dependency for `b3` and explicitly request it. 

### Error Recovery
Finally, Automerge helps recover failed peer nodes by resetting the list of `sharedHeads` in the document and beginning sync again from scratch. This can come in handy if one of the peers crashes after confirming data but before writing it to disk.

If the connection times out due to packet loss, when you reconnect, you should reset the sync state as follows, if you haven't already:

```js
for (let docId of Object.keys(syncStates[peer])) {
  syncStates[peer][docId] = decodeSyncState(encodeSyncState(syncStates[peer][docId]))
}
```

This tells the sync protocol that the last message it sent may have been lost, and restarts the sync protocol from the last known "greatest common document".

### Multiple Peers, Multiple Documents

The Automerge sync protocol behaves correctly when synchronizing with multiple peers at once, though specific implementation details will vary by domain. Synchronizing multiple documents is not currently supported by the protocol, and must be handled by the user at a layer above.

### Sequencing Network Communication
Many communication protocols require that only one of the two peers initiates the exchange. With Automerge this is not the case: messages between peers can interleave arbitrarily, though each peer's messages should be delivered in-order to the recipient.
