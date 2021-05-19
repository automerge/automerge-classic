# Automerge Sync Protocol Documentation

The automerge network sync protocol is designed to bring two documents into sync by exchanging messages between peers until both documents they have the same contents. It does this by exchanging rounds of sync messages. These sync messages contain two parts: 
 * a lossily-compressed list of changes it already has (implicitly requesting the remainder)
 * changes it believe the other peer needs

Upon receiving a message, the developer calls `receiveSyncMessage(doc, syncState, message)`. This causes Automerge to apply any changes it received, then updates some internal metadata about the other peer and is ready to produce a reply. The developer can now call `generateSyncMessage(doc, syncState)` to produce the next message to a peer. These two functions are the main two functions and can continue to be called iteratively until `generateSyncMessage()` returns a `null` value indicating both documents are synchronized.

## How to use the Sync Protocol

Automerge synchronization occurs at a per-document level. Most automerge-based applications will be built around more than one document, so in our example code here we will assume these documents are identified by a string `docId`.

### Connecting: `loadSyncState()` or `initSyncState()`

When a peer is discovered, first create a new `syncState` with `initSyncState()` and store the result somewhere associated with that peer. These `syncState` objects can be persisted between program executions as an optimization, but it is not required. All subsequent sync operations with that peer will produce a new `syncState` to replace the previous one.

If you've already seen a peer, you should load your old `syncState` for them via `loadSyncState()`. This is not strictly necessary, but will reduce unnecessary computation and network traffic.

```
  if (data.type === 'HELLO') {
    if (syncStates[source] === undefined) {
      syncStates[source] = loadSyncState(db.getSyncState(docId, source))
      sendMessage({ source: workerId, target: source, type: 'HELLO' })
    }
    return
  }
```

### Synchronizing with one or more peers

In general, whenever a peer creates a local change or receives a sync message from another peer, it should respond to all the peers it is connected to with its updated status. This will both confirm receipt of any data to the sending peer and also allow other peers to request any changes they may still need. 

Generating new sync messages to other peers is straightforward. Simply call `generateSyncMessage` and, if `syncMessage` is not null, send it to the appropriate peer. You will also need to hold on to the returned `syncState` for that peer, since it keeps track of what data you have sent them to avoid sending data twice.

Here is a simple example:
```
function updatePeers(docId: string) {
  Object.entries(syncStates).forEach(([peer, syncState]) => {
    const [nextSyncState, syncMessage] = Backend.generateSyncMessage(
      backends[docId],
      syncState[docId] || Backend.initSyncState(),
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

After receiving a sync message, you should check if you need to send new sync messages to any connected peers using the code above. In our example code below this is represented by a call to `updatePeers()`

```
  const [nextBackend, nextSyncState, patch] = Backend.receiveSyncMessage(
    backends[docId],
    syncStates[source][docId] || Backend.initSyncState(),
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

When you create a local change to a document, simply call `generateSyncMessage()` for each peer to produce a message to send them. In general, you can use the same `updatePeers()` implementation for both receiving messages or creating local changes. You may want to rate limit or debounce these communications to reduce network traffic, but this isn't required. *Remember, after applying a local change to the backend you will need to forward the resulting patch to your frontend!*

Here's a sample implementation:

```

// Respond to messages from the frontend document
self.addEventListener('message', (evt: any) => {
  const { data } = evt
  const { docId } = data

  if (data.type === 'OPEN') {
    backends[docId] = Backend.init()
  }

  if (data.type === 'LOCAL_CHANGE') {
    const [newBackend, patch] = Backend.applyLocalChange(backends[docId], data.payload)
    backends[docId] = newBackend
    sendMessageToRenderer({ docId, patch })
  }

  // now tell everyone else about how things have changed
  updatePeers(docId)
})

```

### Handling disconnection

Remember to save your syncState object for a peer upon disconnection via `saveSyncState()`. That might look like this:

```
db.storeSyncState(docId, source, saveSyncState(syncStates[source]))
```

## How it works

### The first exchanges
If we don't already have any existing sync state with a peer, the first call to `generateSyncMessage()` will create a Bloom filter which contains encoded hashes of all the changes in the document. The recipient of this message will walk their local graph of changes backwards from each "head" in their document until the Bloom filter indicates the other peer has the change in question. Everything from that point forward is collected and sent in a response message -- along with a new bloom filter so the other peer can reciprocate.

### On the Bloom Filter
Conceptually, the most straightforward way to synchronize the two sets of changes would be to send over the complete list of changes from one peer to another, which could then exactly request the changes it was needed and offer any changes only it had. Unfortunately, this approach is prohibitively expensive. Every change is notionally represented by a 128-bit hash, which in cases like text editing can be larger than the actual change. By sending the compressed list of changes a document already `has` to the other peer, the recipient can then reply with their own changes they believe the sender is lacking. To reiterate because this was counter-intuitive: the receiver cannot determine which changes it needs by looking at the Bloom filter, only (estimate) what changes the sender needs.

### False positives

Bloom filters encode data probabalistically. The Automerge Bloom filter implementation is tuned such that there is a 1% chance per change of mistakenly believing the other peer already has the change in question. When this occurs, the receiving peer will not see any result from applying those changes. Until all change dependencies are in place, the new changes will remain invisible. To resolve this, the next syncMessage will include a `need` request which specifies particular changes by hash to send from the other peer.

### Shared Heads
To avoid constantly recalculating and retransmitting Bloom filters, the `syncState` tracks the "greatest common document" the two peers have in common. Every time changes are received and applied, we can safely skip adding those changes to any subsequent the Bloom filter. Thus, we simply begin adding changes to the Bloom filter at that point in the document history. TODO: We can also optimistically advance the sharedHeads when changes are sent, allowing us to efficiently send a long stream of messages without concern about when responses will come back.

### Error Recovery
Finally, Automerge helps recover failed peer nodes by resetting the list of `sharedHeads` in the document and beginning sync again from scratch. This can come in handy if one of the peers crashes after confirming data but before writing it to disk.

### Multiple Peers, Multiple Documents

The Automerge sync protocol behaves correctly when synchronizing with multiple peers at once, though specific implementation details will vary by domain. Synchronizing multiple documents is not currently supported by the protocol, and must be handled at a layer above by the user.

### Sequencing Network Communication
Many communication protocols require that only one of the two peers initiates the exchange. With automerge this is not the case: messages between peers can interleave arbitrarily, though each peer's messages should be delivered in-order to the recipient.
