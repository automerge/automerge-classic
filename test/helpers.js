const assert = require('assert')
const { Encoder } = require('../backend/encoding')

// Assertion that succeeds if the first argument deepStrictEquals at least one of the
// subsequent arguments (but we don't care which one)
function assertEqualsOneOf(actual, ...expected) {
  assert(expected.length > 0)
  for (let i = 0; i < expected.length; i++) {
    try {
      assert.deepStrictEqual(actual, expected[i])
      return // if we get here without an exception, that means success
    } catch (e) {
      if (!e.name.match(/^AssertionError/) || i === expected.length - 1) throw e
    }
  }
}

/**
 * Asserts that the byte array maintained by `encoder` contains the same byte
 * sequence as the array `bytes`.
 */
function checkEncoded(encoder, bytes, detail) {
  const encoded = (encoder instanceof Encoder) ? encoder.buffer : encoder
  const expected = new Uint8Array(bytes)
  const message = (detail ? `${detail}: ` : '') + `${encoded} expected to equal ${expected}`
  assert(encoded.byteLength === expected.byteLength, message)
  for (let i = 0; i < encoded.byteLength; i++) {
    assert(encoded[i] === expected[i], message)
  }
}

module.exports = { assertEqualsOneOf, checkEncoded }
