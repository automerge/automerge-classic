const { List } = require('immutable')
const OpSet = require('./op_set')
const { hexStringToBytes, bytesToHexString, Encoder, Decoder } = require('./encoding')
const { encodeChange, decodeChange, decodeChanges, encodeDocument } = require('./columnar')

const HASH_SIZE = 32 // 256 bits = 32 bytes
const MESSAGE_TYPE_VERSION = 1
const MESSAGE_TYPE_BLOOM_REQ = 2
const MESSAGE_TYPE_BLOOM_RESP = 3
const MESSAGE_TYPE_NEEDS = 4

// These constants correspond to a 1% false positive rate. The values can be changed without
// breaking compatibility of the network protocol, since the parameters used for a particular
// Bloom filter are encoded in the wire format.
const BITS_PER_ENTRY = 10, NUM_PROBES = 7

/**
 * A Bloom filter implementation that can be serialised to a byte array for transmission
 * over a network. The entries that are added are assumed to already be SHA-256 hashes,
 * so this implementation does not perform its own hashing.
 */
class BloomFilter {
  constructor (arg) {
    if (Array.isArray(arg)) {
      // arg is an array of SHA256 hashes in hexadecimal encoding
      this.numEntries = arg.length
      this.numBitsPerEntry = BITS_PER_ENTRY
      this.numProbes = NUM_PROBES
      this.bits = new Uint8Array(Math.ceil(this.numEntries * this.numBitsPerEntry / 8))
      for (let hash of arg) this.addHash(hash)
    } else if (arg instanceof Decoder) {
      // arg is an encoded byte array wrapped in a Decoder
      this.numEntries = arg.readUint32()
      this.numBitsPerEntry = arg.readUint32()
      this.numProbes = arg.readUint32()
      this.bits = arg.readRawBytes(Math.ceil(this.numEntries * this.numBitsPerEntry / 8))
    } else {
      throw new TypeError('invalid argument')
    }
  }

  /**
   * Returns the Bloom filter state, encoded as a byte array.
   */
  get bytes() {
    const encoder = new Encoder()
    encoder.appendUint32(this.numEntries)
    encoder.appendUint32(this.numBitsPerEntry)
    encoder.appendUint32(this.numProbes)
    encoder.appendRawBytes(this.bits)
    return encoder.buffer
  }

  /**
   * Given a SHA-256 hash (as hex string), returns an array of probe indexes indicating which bits
   * in the Bloom filter need to be tested or set for this particular entry. We do this by
   * interpreting the first 12 bytes of the hash as three little-endian 32-bit unsigned integers,
   * and then using triple hashing to compute the probe indexes. The algorithm comes from:
   *
   * Peter C. Dillinger and Panagiotis Manolios. Bloom Filters in Probabilistic Verification.
   * 5th International Conference on Formal Methods in Computer-Aided Design (FMCAD), November 2004.
   * http://www.ccis.northeastern.edu/home/pete/pub/bloom-filters-verification.pdf
   */
  getProbes(hash) {
    const hashBytes = hexStringToBytes(hash), modulo = 8 * this.bits.byteLength
    if (hashBytes.byteLength !== 32) throw new RangeError(`Not a 256-bit hash: ${hash}`)
    // on the next three lines, the right shift means interpret value as unsigned
    let x = ((hashBytes[0] | hashBytes[1] << 8 | hashBytes[2]  << 16 | hashBytes[3]  << 24) >>> 0) % modulo
    let y = ((hashBytes[4] | hashBytes[5] << 8 | hashBytes[6]  << 16 | hashBytes[7]  << 24) >>> 0) % modulo
    let z = ((hashBytes[8] | hashBytes[9] << 8 | hashBytes[10] << 16 | hashBytes[11] << 24) >>> 0) % modulo
    const probes = [x]
    for (let i = 1; i < this.numProbes; i++) {
      x = (x + y) % modulo
      y = (y + z) % modulo
      probes.push(x)
    }
    return probes
  }

  /**
   * Sets the Bloom filter bits corresponding to a given SHA-256 hash (given as hex string).
   */
  addHash(hash) {
    for (let probe of this.getProbes(hash)) {
      this.bits[probe >>> 3] |= 1 << (probe & 7)
    }
  }

  /**
   * Tests whether a given SHA-256 hash (given as hex string) is contained in the Bloom filter.
   */
  containsHash(hash) {
    for (let probe of this.getProbes(hash)) {
      if ((this.bits[probe >>> 3] & (1 << (probe & 7))) === 0) return false
    }
    return true
  }
}

/**
 * Encodes a sorted array of SHA-256 hashes (as hexadecimal strings) into a byte array.
 */
function encodeHashes(encoder, hashes) {
  if (!Array.isArray(hashes)) throw new TypeError('hashes must be an array')
  encoder.appendUint32(hashes.length)
  for (let i = 0; i < hashes.length; i++) {
    if (i > 0 && hashes[i - 1] >= hashes[i]) throw new RangeError('hashes must be sorted')
    const bytes = hexStringToBytes(hashes[i])
    if (bytes.byteLength !== HASH_SIZE) throw new TypeError('heads hashes must be 256 bits')
    encoder.appendRawBytes(bytes)
  }
}

/**
 * Decodes a byte array in the format returned by encodeHashes(), and returns its content as an
 * array of hex strings.
 */
function decodeHashes(decoder) {
  let length = decoder.readUint32(), hashes = []
  for (let i = 0; i < length; i++) {
    hashes.push(bytesToHexString(decoder.readRawBytes(HASH_SIZE)))
  }
  return hashes
}

/**
 * Returns a byte array encoding the current heads hashes of a document.
 */
function encodeCurrentVersion(heads) {
  const encoder = new Encoder()
  encoder.appendUint32(MESSAGE_TYPE_VERSION)
  encodeHashes(encoder, heads)
  return encoder.buffer
}


/**
 * Implementation of the data synchronisation protocol that brings a local and a remote document
 * into the same state. This is typically used when two peers have been disconnected for some time,
 * and need to exchange any changes that happened while they were disconnected. The two peers that
 * are syncing could be client and server, or server and client, or two peers with symmetric roles).
 *
 * The protocol is based on this paper: Martin Kleppmann and Heidi Howard. Byzantine Eventual
 * Consistency and the Fundamental Limits of Peer-to-Peer Databases. https://arxiv.org/abs/2012.00472
 *
 * The protocol assumes that every time a peer successfully syncs with another peer, it remembers
 * the document version (as returned by `Automerge.getCurrentVersion()`) after the last sync with
 * that peer. The next time we try to sync with the same peer, we start from the assumption that
 * the other peer's document version is no older than the outcome of the last sync, so we only need
 * to exchange any changes that are more recent than the last sync. This assumption may not be true
 * if the other peer did not correctly persist its state (perhaps it crashed before writing the
 * result of the last sync to disk), and we fall back to sending the entire document in this case.
 *
 * Let's say we want to sync A and B, and A is the first peer to send a message. Then the protocol
 * state at A is initialised using the document version from the last sync with B (or `undefined`
 * if this is the first time we're syncing with B). Then the peers exchange the following messages:
 *
 * 1. A sends B a message of type `MESSAGE_TYPE_BLOOM_REQ` containing the head hashes from the last
 *    sync between A and B, A's current head hashes, and a Bloom filter summarising all the changes
 *    that A knows about that were added since the last sync.
 * 2. B responds to A with a message of type `MESSAGE_TYPE_BLOOM_RESP` containing the hashes of any
 *    changes that B wants from A, B's latest head hashes, a Bloom filter summarising all the
 *    changes that B knows about that were added since the last sync, and the changes that A needs
 *    from B (any changes that B has, that were added since the last sync and that are not contained
 *    in the Bloom filter; this set may be incomplete due to Bloom filter false positives).
 * 3. If the last message contained at least one change or at least one hash that B wants, then A
 *    responds to B with a message of type `MESSAGE_TYPE_NEEDS`. This message contains the hashes of
 *    any changes that A wants from B, and any changes requested by B in its last message. This
 *    message is sent even if A does not want any more changes and B did not request any changes, in
 *    order to indicate that sync is complete.
 * 4. If the last message indicated that A wanted further changes from B, then B replies with
 *    another `MESSAGE_TYPE_NEEDS` message containing those changes. Moreover, if there are any
 *    remaining hashes for which B does not have the corresponding changes, B also requests those in
 *    the same message. This process continues with further `MESSAGE_TYPE_NEEDS` messages (and A and
 *    B swapping roles each time) until both peers have all the changes (and their dependencies)
 *    contained in the other peer's head hashes in their initial message. The final
 *    `MESSAGE_TYPE_NEEDS` message is one containing no changes and no requested changes, which
 *    signals that the sync is complete (this message may be from A to B or from B to A).
 */
class Sync {
  constructor(opSet, initState) {
    this.opSet = opSet
    this.myHeads = OpSet.getHeads(opSet)
    this.receivedChanges = []
    this.receivedHashes = {}
    this.missingHashes = []
    if (!initState || initState[0] === MESSAGE_TYPE_VERSION) {
      this.messageToSend = this._makeBloomRequest(initState)
    } else if (initState[0] === MESSAGE_TYPE_BLOOM_REQ) {
      this.messageToSend = this._makeBloomResponse(initState)
    } else {
      throw new RangeError(`Unknown message type: ${initState[0]}`)
    }
  }

  /**
   * Constructs a Bloom filter containing all changes that are not one of the hashes in
   * `this.lastSync` or its transitive dependencies. In other words, the filter contains those
   * changes that have been applied since the version identified by `this.lastSync`.
   * Private method, do not call from outside the class.
   */
  _makeBloomFilter() {
    const newChanges = OpSet.getMissingChanges(this.opSet, List(this.lastSync)).map(decodeChange)
    return new BloomFilter(newChanges.map(change => change.hash)).bytes
  }

  /**
   * Reads a Bloom filter in the form encoded by `_makeBloomFilter()`. Finds all the changes that
   * were added since `this.lastSync` and that are not present in the Bloom filter, and returns
   * those (as well as their dependents). Additionally returns any changes whose hashes appear in
   * the array `extraNeeds`. If the whole encoded document is smaller than the log of changes,
   * returns the document instead.
   */
  _getBloomNegativeChanges(decoder, extraNeeds) {
    const bloomFilter = new BloomFilter(decoder)
    const hashesToSend = OpSet.getMissingChanges(this.opSet, List(this.lastSync))
      .map(change => decodeChange(change).hash)
      .filter(hash => !bloomFilter.containsHash(hash) || extraNeeds.indexOf(hash) >= 0)
    const changes = OpSet.getChangesAndDependents(this.opSet, List(hashesToSend))
    const changesSize = changes.reduce((total, change) => total + change.byteLength, 0)
    const wholeDoc = encodeDocument(OpSet.getMissingChanges(this.opSet, List()))
    return (wholeDoc.byteLength < changesSize) ? [wholeDoc] : changes
  }

  /**
   * Constructs the initial message of a sync exchange.
   * Private method, do not call from outside of the class.
   */
  _makeBloomRequest(lastVersion) {
    this.lastSync = []
    if (lastVersion) {
      const decoder = new Decoder(lastVersion)
      decoder.skip(1) // equals MESSAGE_TYPE_VERSION, already checked previously
      this.lastSync = decodeHashes(decoder)
      if (!decoder.done) throw new RangeError('unexpected trailing bytes in initial sync state')
    }
    const encoder = new Encoder()
    encoder.appendUint32(MESSAGE_TYPE_BLOOM_REQ)
    if (lastVersion) {
      encoder.appendRawBytes(lastVersion.subarray(1))
    } else {
      encoder.appendUint32(0) // zero hashes in the last sync state
    }
    encodeHashes(encoder, this.myHeads)
    encoder.appendRawBytes(this._makeBloomFilter())
    return encoder.buffer
  }

  /**
   * Processes a message that was generated by `_makeBloomRequest()`.
   * Private method, do not call from outside of the class.
   */
  _makeBloomResponse(message) {
    const decoder = new Decoder(message)
    decoder.skip(1) // equals MESSAGE_TYPE_BLOOM_REQ, already checked previously
    this.lastSync = decodeHashes(decoder)
    this.theirHeads = decodeHashes(decoder)

    // Check if all hashes from the last sync are known to us. If not, restart the sync without
    // assuming any common changes.
    if (this.lastSync.some(hash => !this.opSet.hasIn(['hashes', hash]))) {
      this.lastSync = []
      const encoder = new Encoder()
      encoder.appendUint32(MESSAGE_TYPE_BLOOM_REQ)
      encodeHashes(encoder, this.lastSync)
      encodeHashes(encoder, this.myHeads)
      encoder.appendRawBytes(this._makeBloomFilter())
      return encoder.buffer
    }

    const changesToSend = this._getBloomNegativeChanges(decoder, [])
    this.missingHashes = this.theirHeads.filter(hash => !this.opSet.hasIn(['hashes', hash]))
    const encoder = new Encoder()
    encoder.appendUint32(MESSAGE_TYPE_BLOOM_RESP)
    encodeHashes(encoder, this.missingHashes)
    encodeHashes(encoder, this.myHeads)
    encoder.appendRawBytes(this._makeBloomFilter())
    for (let change of changesToSend) encoder.appendRawBytes(change)

    // We still send this message, but it's the last message in this sync
    if (this.missingHashes.length === 0 && changesToSend.length === 0) this.isFinished = true
    return encoder.buffer
  }

  /**
   * Takes a set of changes received from the other peer (concatenated into a byte array),
   * parses them, and updates `this.missingHashes` to contain any missing dependencies.
   */
  _receiveChanges(bytes) {
    let decodedChanges = []
    for (let change of decodeChanges([bytes])) {
      decodedChanges.push(change)
      this.receivedHashes[change.hash] = true
      this.receivedChanges.push(encodeChange(change))
    }
    this.missingHashes = this.missingHashes.filter(hash => !this.receivedHashes[hash])
    for (let change of decodedChanges) {
      for (let dep of change.deps) {
        if (!this.receivedHashes[dep] && !this.opSet.hasIn(['hashes', dep]) &&
             this.missingHashes.indexOf(dep) === -1) {
          this.missingHashes.push(dep)
        }
      }
    }
    this.missingHashes.sort()
  }

  /**
   * Takes a message received from the other peer and processes it. Returns a response
   * message to send back to the other peer, or undefined if no message needs to be sent.
   */
  processMessage(message) {
    this.messageToSend = undefined
    let changes
    const decoder = new Decoder(message), messageType = decoder.readUint32()
    if (messageType === MESSAGE_TYPE_BLOOM_REQ) {
      return this._makeBloomResponse(message)
    } else if (messageType === MESSAGE_TYPE_BLOOM_RESP) {
      let theirNeeds = decodeHashes(decoder)
      this.theirHeads = decodeHashes(decoder)
      this.missingHashes = this.theirHeads.filter(hash => !this.opSet.hasIn(['hashes', hash]))
      changes = this._getBloomNegativeChanges(decoder, theirNeeds)
    } else if (messageType === MESSAGE_TYPE_NEEDS) {
      changes = decodeHashes(decoder).map(hash => this.opSet.getIn(['hashes', hash, 'change']))
    } else {
      throw new RangeError(`Unexpected message type: ${messageType}`)
    }

    if (changes.length === 0 && decoder.done) {
      this.isFinished = true
      return undefined // no need to send any message in response
    }
    this._receiveChanges(decoder.buf.subarray(decoder.offset))
    if (changes.length === 0 && this.missingHashes.length === 0) {
      this.isFinished = true // the next message we send is the last one
    }

    const encoder = new Encoder()
    encoder.appendUint32(MESSAGE_TYPE_NEEDS)
    encodeHashes(encoder, this.missingHashes)
    for (let change of changes) encoder.appendRawBytes(change)
    return encoder.buffer
  }
}

module.exports = { encodeCurrentVersion, Sync }
