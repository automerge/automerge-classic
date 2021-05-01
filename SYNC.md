# Automerge Sync Protocol Documentation

The automerge network sync protocol is designed to bring two documents into sync by exchanging messages between peers until both documents they have the same contents. It does this by exchanging rounds of sync messages. These sync messages contain two parts: 
 * a lossily-compressed list of changes it already has (implicitly requesting the remainder)
 * changes it believe the other peer needs

Upon receiving a message, the developer calls `receiveSyncMessage(doc, syncState, message)`. This causes Automerge to apply any changes it received, then updates some internal metadata about the other peer and is ready to produce a reply. The developer can now call `generateSyncMessage(doc, syncState)` to produce the next message to a peer. These two functions are the main two functions and can continue to be called iteratively until `generateSyncMessage()` returns a `null` value indicating both documents are synchronized.

## How to use the Sync Protocol

### Load or `initSyncState()`
When a peer is discovered, first create a new `syncState` with `initSyncState()` and store the result somewhere associated with that peer. These `syncState` objects can be persisted between program executions as an optimization, but it is not required. All subsequent sync operations with that peer will produce a new `syncState` to replace the previous one.

### The first exchanges
If we do not yet recognize this peer, the first call to `generateSyncMessage()` will create a Bloom filter which contains encoded hashes of all the changes in the document. Upon receipt of a message, we will walk the graph of changes we have locally backwards from each "head" until the Bloom filter indicates the other peer has the change in question. Everything from that point forward is collected and sent in a response message -- along with a new bloom filter so the other peer can reciprocate.

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
