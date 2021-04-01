/**
 * Implementation of the data synchronisation protocol that brings a local and a remote document
 * into the same state. This is typically used when two nodes have been disconnected for some time,
 * and need to exchange any changes that happened while they were disconnected. The two nodes that
 * are syncing could be client and server, or server and client, or two peers with symmetric roles.
 *
 * The protocol is based on this paper: Martin Kleppmann and Heidi Howard. Byzantine Eventual
 * Consistency and the Fundamental Limits of Peer-to-Peer Databases. https://arxiv.org/abs/2012.00472
 *
 * The protocol assumes that every time a node successfully syncs with another node, it remembers
 * the current heads (as returned by `Backend.getHeads()`) after the last sync with that node. The
 * next time we try to sync with the same node, we start from the assumption that the other node's
 * document version is no older than the outcome of the last sync, so we only need to exchange any
 * changes that are more recent than the last sync. This assumption may not be true if the other
 * node did not correctly persist its state (perhaps it crashed before writing the result of the
 * last sync to disk), and we fall back to sending the entire document in this case.
 */

const { List } = require('immutable')
const OpSet = require('automerge/backend/op_set')
const { hexStringToBytes, bytesToHexString, Encoder, Decoder } = require('automerge/backend/encoding')
const { decodeChangeMeta } = require('automerge/backend/columnar')

const HASH_SIZE = 32 // 256 bits = 32 bytes
const MESSAGE_TYPE_SYNC = 0x42 // first byte of a sync message, for identification

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
    } else if (arg instanceof Uint8Array) {
      if (arg.byteLength === 0) {
        this.numEntries = 0
        this.numBitsPerEntry = 0
        this.numProbes = 0
        this.bits = arg
      } else {
        const decoder = new Decoder(arg)
        this.numEntries = decoder.readUint32()
        this.numBitsPerEntry = decoder.readUint32()
        this.numProbes = decoder.readUint32()
        this.bits = decoder.readRawBytes(Math.ceil(this.numEntries * this.numBitsPerEntry / 8))
      }
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
    if (this.numEntries === 0) return false
    for (let probe of this.getProbes(hash)) {
      if ((this.bits[probe >>> 3] & (1 << (probe & 7))) === 0) {
        return false
      }
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
 * Takes a sync message of the form `{heads, need, have}` and encodes it as a byte array for
 * transmission.
 */
function encodeSyncMessage(message) {
  const encoder = new Encoder()
  encoder.appendByte(MESSAGE_TYPE_SYNC)
  encodeHashes(encoder, message.heads)
  encodeHashes(encoder, message.need)
  encoder.appendUint32(message.have.length)
  for (let have of message.have) {
    encodeHashes(encoder, have.lastSync)
    encoder.appendPrefixedBytes(have.bloom)
  }
  return encoder.buffer
}

/**
 * Takes a binary-encoded sync message and decodes it into the form `{heads, need, have}`.
 */
function decodeSyncMessage(bytes) {
  const decoder = new Decoder(bytes)
  const messageType = decoder.readByte()
  if (messageType !== MESSAGE_TYPE_SYNC) {
    throw new RangeError(`Unexpected message type: ${messageType}`)
  }
  const heads = decodeHashes(decoder)
  const need = decodeHashes(decoder)
  const haveCount = decoder.readUint32()
  let message = {heads, need, have: []}
  for (let i = 0; i < haveCount; i++) {
    const lastSync = decodeHashes(decoder)
    const bloom = decoder.readPrefixedBytes(decoder)
    message.have.push({lastSync, bloom})
  }
  // Ignore any trailing bytes -- they can be used for extensions by future versions of the protocol
  return message
}

/**
 * Constructs a Bloom filter containing all changes that are not one of the hashes in
 * `lastSync` or its transitive dependencies. In other words, the filter contains those
 * changes that have been applied since the version identified by `lastSync`. Returns
 * an object of the form `{lastSync, bloom}` as required for the `have` field of a sync
 * message.
 */
function makeBloomFilter(backend, lastSync) {
  const newChanges = OpSet.getMissingChanges(backend.get('opSet'), List(lastSync))
  const hashes = newChanges.map(change => decodeChangeMeta(change, true).hash)
  return {lastSync, bloom: new BloomFilter(hashes).bytes}
}

/**
 * Call this function when a sync message is received from another node. The `message` argument
 * needs to already have been decoded using `decodeSyncMessage()`. This function determines the
 * changes that we need to send to the other node in response. Returns an array of changes (as
 * byte arrays).
 */
function getChangesToSend(backend, have, need) {
  const opSet = backend.get('opSet')
  if (have.length === 0) {
    return need.map(hash => OpSet.getChangeByHash(opSet, hash))
  }

  let lastSyncHashes = {}, bloomFilters = []
  for (let h of have) {
    for (let hash of h.lastSync) lastSyncHashes[hash] = true
    bloomFilters.push(new BloomFilter(h.bloom))
  }

  // Get all changes that were added since the last sync
  const changes = OpSet.getMissingChanges(opSet, List(Object.keys(lastSyncHashes)))
    .map(change => decodeChangeMeta(change, true))

  let changeHashes = {}, dependents = {}, hashesToSend = {}
  for (let change of changes) {
    changeHashes[change.hash] = true

    // For each change, make a list of changes that depend on it
    for (let dep of change.deps) {
      if (!dependents[dep]) dependents[dep] = []
      dependents[dep].push(change.hash)
    }

    // Exclude any change hashes contained in one or more Bloom filters
    if (bloomFilters.every(bloom => !bloom.containsHash(change.hash))) {
      hashesToSend[change.hash] = true
    }
  }

  // Include any changes that depend on a Bloom-negative change
  let stack = Object.keys(hashesToSend)
  while (stack.length > 0) {
    const hash = stack.pop()
    if (dependents[hash]) {
      for (let dep of dependents[hash]) {
        if (!hashesToSend[dep]) {
          hashesToSend[dep] = true
          stack.push(dep)
        }
      }
    }
  }

  // Include any explicitly requested changes
  let changesToSend = []
  for (let hash of need) {
    hashesToSend[hash] = true
    if (!changeHashes[hash]) { // Change is not among those returned by getMissingChanges()?
      const change = OpSet.getChangeByHash(opSet, hash)
      if (change) changesToSend.push(change)
    }
  }

  // Return changes in the order they were returned by getMissingChanges()
  for (let change of changes) {
    if (hashesToSend[change.hash]) changesToSend.push(change.change)
  }
  return changesToSend
}

const { receiveSyncMessage, generateSyncMessage } = require('automerge/backend/protocol')
module.exports = { BloomFilter, encodeSyncMessage, decodeSyncMessage, receiveSyncMessage, generateSyncMessage }
