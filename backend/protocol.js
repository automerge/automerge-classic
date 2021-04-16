const Backend = require("./backend");
const { makeBloomFilter, BloomFilter, getChangesToSend, encodeSyncMessage, decodeSyncMessage } = require("./sync");
const { backendState } = require('./util')
const { getChangeChecksum } = require('./columnar')
const { equalBytes } = require('../src/common')

/****

  export interface PeerState {
      sharedHeads: Hash[]
      theirNeed: Hash[]
      ourNeed: Hash[]
      have: SyncHave[]
      unappliedChanges: BinaryChange[]
  }

  // (Decoded)
  interface SyncMessage {
      heads: Hash[]
      need: Hash[]
      have: SyncHave[]
      changes: Uint8Array[] // todo
  }

  interface SyncHave {
      lastSync: Hash[]
      bloom: Uint8Array
  }

*****/

function emptyPeerState() {
    return {
        sharedHeads: [],
        lastSentHeads: [],
        theirHeads: null,
        theirNeed: null,
        ourNeed: [],
        have: [],
        unappliedChanges: [],
        sentChanges: []
    };
}

function compareArrays(a, b) {
    return (a.length === b.length) && a.every((v, i) => v === b[i]);
}

/**
 * Takes two arrays of binary changes, `previousChanges` and `newChanges`. Returns those changes in
 * `newChanges` that do not appear in `previousChanges`.
 */
function deduplicateChanges(previousChanges, newChanges) {
  // To avoid an O(n^2) comparison of every change with every other change, we use the fact that
  // bytes 4 to 7 of every change are a 32-bit checksum that is uniformly distributed, i.e. two
  // different changes are likely to have different checksums. Thus, we first construct an index
  // from checksum to the indexes in `previousChanges` at which those checksums appear, and then we
  // can detect cheaply whether an entry in `newChanges` already exists in `previousChanges`.
  let index = new Map()
  for (let i = 0; i < previousChanges.length; i++) {
    const checksum = getChangeChecksum(previousChanges[i])
    if (!index.has(checksum)) index.set(checksum, [])
    index.get(checksum).push(i)
  }

  return newChanges.filter(change => {
    const positions = index.get(getChangeChecksum(change))
    if (!positions) return true
    return !positions.some(i => equalBytes(change, previousChanges[i]))
  })
}

/* generateSyncMessage
    given a backend and what we believe to be the state of our peer,
    generate a message which tells them about we have and includes any changes we believe they need
*/
function generateSyncMessage(backend, peerState, fetch = false) {
    peerState = peerState || emptyPeerState()

    const { sharedHeads, ourNeed, theirHeads, theirNeed, have: theirHave, unappliedChanges } = peerState;
    const ourHeads = Backend.getHeads(backend)
    const state = backendState(backend)

    // if we need some particular keys, sending the bloom filter will cause retransmission
    // of data (since the bloom filter doesn't include data waiting to be applied)
    // also, we could be using other peers' have messages to reduce any risk of resending data
    // actually, thinking more about this we probably want to include queued data in our bloom filter
    // but... it will work without it, just risks lots of resent data if you have many peers
    const have = (!ourNeed.length) ? [makeBloomFilter(state, sharedHeads)] : [];

    // Fall back to a full re-sync if the sender's last sync state includes hashes
    // that we don't know. This could happen if we crashed after the last sync and
    // failed to persist changes that the other node already sent us.
    if (theirHave.length > 0) {
        const lastSync = theirHave[0].lastSync;
        if (!lastSync.every(hash => Backend.getChangeByHash(backend, hash))) {
            // we need to queue them to send us a fresh sync message, the one they sent is uninteligible so we don't know what they need
            const resetMsg = { heads: ourHeads, need: [], have: [{ lastSync: [], bloom: Uint8Array.of() }], changes: [] };
            return [peerState, encodeSyncMessage(resetMsg)];
        }
    }

    // XXX: we should limit ourselves to only sending a subset of all the messages, probably limited by a total message size
    //      these changes should ideally be RLE encoded but we haven't implemented that yet.
    let changesToSend = !fetch && Array.isArray(theirHave) && Array.isArray(theirNeed) ? getChangesToSend(state, theirHave, theirNeed) : []
    const heads = Backend.getHeads(backend)

    // If the heads are equal, we're in sync and don't need to do anything further
    const headsUnchanged = Array.isArray(peerState.lastSentHeads) && compareArrays(heads, peerState.lastSentHeads)
    const headsEqual = Array.isArray(theirHeads) && compareArrays(ourHeads, theirHeads)
    if (headsUnchanged && headsEqual && changesToSend.length === 0 && ourNeed.length === 0) {
        return [peerState, null];
        // no need to send a sync message if we know we're synced!
    }

    if (peerState.sentChanges.length > 0 && changesToSend.length > 0) {
      changesToSend = deduplicateChanges(peerState.sentChanges, changesToSend)
    }

    // Regular response to a sync message: send any changes that the other node
    // doesn't have. We leave the "have" field empty because the previous message
    // generated by `syncStart` already indicated what changes we have.
    const syncMessage = {
        heads,
        have,
        need: ourNeed,
        changes: changesToSend
    };
    peerState = {
        ...peerState,
        lastSentHeads: heads,
        sentChanges: peerState.sentChanges.concat(changesToSend)
    }
    return [peerState, encodeSyncMessage(syncMessage)];
}

/**
 * Computes the heads that we share with a peer after we have just received some changes from that
 * peer and applied them. This may not be sufficient to bring our heads in sync with the other
 * peer's heads, since they may have only sent us a subset of their outstanding changes.
 *
 * `myOldHeads` are the local heads before the most recent changes were applied, `myNewHeads` are
 * the local heads after those changes were applied, and `ourOldSharedHeads` is the previous set of
 * shared heads. Applying the changes will have replaced some heads with others, but some heads may
 * have remained unchanged (because they are for branches on which no changes have been added). Any
 * such unchanged heads remain in the sharedHeads. Any sharedHeads that were replaced by applying
 * changes are also replaced as sharedHeads. This is safe because if we received some changes from
 * another peer, that means that peer had those changes, and therefore we now both know about them.
 */
function advanceHeads(myOldHeads, myNewHeads, ourOldSharedHeads) {
    const newHeads = myNewHeads.filter((head) => !myOldHeads.includes(head));
    const commonHeads = ourOldSharedHeads.filter((head) => myNewHeads.includes(head));
    const advancedHeads = [...new Set([...newHeads, ...commonHeads])].sort();
    return advancedHeads;
}


/* receiveSyncMessage
    given a backend, a message message and the state of our peer,
    apply any changes, update what we believe about the peer, 
    and (if there were applied changes) produce a patch for the frontend
*/
function receiveSyncMessage(backend, binaryMessage, oldPeerState) {
    let patch = null;
    oldPeerState = oldPeerState || emptyPeerState()
    let { unappliedChanges, ourNeed, sharedHeads, lastSentHeads } = oldPeerState;
    const message = decodeSyncMessage(binaryMessage)

    const { heads, changes } = message;
    const beforeHeads = Backend.getHeads(backend);
    // when we receive a sync message, first we apply any changes they sent us
    if (changes.length > 0) {
        unappliedChanges = [...unappliedChanges, ...changes];
        ourNeed = Backend.getMissingDeps(backend, unappliedChanges, heads);

        // If there are no missing dependencies, we can apply the changes we received and update
        // sharedHeads to include the changes we applied. This does not necessarily mean we have
        // received all the changes necessar to bring us in sync with the remote peer's heads: the
        // set of changes in the message may be a prefix of the change log. If the only outstanding
        // needs are for heads, that implies there are no missing dependencies.
        if (ourNeed.every(hash => heads.includes(hash))) {
            ;[backend, patch] = Backend.applyChanges(backend, unappliedChanges);
            unappliedChanges = [];
            sharedHeads = advanceHeads(beforeHeads, Backend.getHeads(backend), sharedHeads);
        }
    } else if (compareArrays(heads, beforeHeads)) {
        // If heads are equal, indicate we don't need to send a response message
        lastSentHeads = heads
    }

    // If all of the remote heads are known to us, that means either our heads are equal, or we are
    // ahead of the remote peer. In this case, take the remote heads to be our shared heads.
    if (heads.every(head => Backend.getChangeByHash(backend, head))) {
        sharedHeads = heads
    }

    const newPeerState = {
        sharedHeads, // what we have in common to generate an efficient bloom filter
        lastSentHeads,
        have: message.have, // the information we need to calculate the changes they need
        theirHeads: message.heads,
        theirNeed: message.need,
        ourNeed, // specifically missing change (bloom filter false positives)
        unappliedChanges, // the changes we can't use yet because of the above
        sentChanges: oldPeerState.sentChanges
    };
    return [backend, newPeerState, patch];
}

module.exports = { receiveSyncMessage, generateSyncMessage };
