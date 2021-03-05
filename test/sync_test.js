const assert = require('assert')
const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const { checkEncoded } = require('./helpers')
const { equalBytes } = require('../src/common')

describe('Data sync protocol', () => {
  let randomSeed = 0
  beforeEach(() => { randomSeed = 0 })

  // Generates a pseudorandom hexadecimal string 1024 chars long, depending on randomSeed.
  // Resetting the seed before each test ensures identical strings are generated on every test run.
  // This makes the tests fully deterministic, avoiding flaky tests that sometimes fail spuriously.
  function longString() {
    let s = ''
    for (let i = 0; i < 128; i++) {
      // Linear congruential generator. Shift right operator ensures unsigned 32-bit integer.
      // Parameters from https://en.wikipedia.org/wiki/Linear_congruential_generator
      randomSeed = (1664525 * randomSeed + 1013904223) >>> 0
      let chars = randomSeed.toString(16)
      while (chars.length < 8) chars = '0' + chars
      s += chars
    }
    return s
  }

  describe('with docs already in sync', () => {
    it('should handle an empty document', () => {
      let n1 = Automerge.init(), n2 = Automerge.init()
      const s1 = Automerge.startSync(n1)
      assert.ok(s1.messageToSend instanceof Uint8Array)
      const s2 = Automerge.startSync(n2, s1.messageToSend)
      assert.ok(s2.messageToSend instanceof Uint8Array)
      assert.strictEqual(s2.isFinished, true)
      const m3 = s1.processMessage(s2.messageToSend)
      assert.strictEqual(m3, undefined)
      assert.strictEqual(s1.isFinished, true)
    })

    it('should work without prior sync state', () => {
      let n1 = Automerge.init(), n2 = Automerge.init()
      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, doc => doc.x = `${i} ${longString()}`)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      const s1 = Automerge.startSync(n1)
      assert.ok(s1.messageToSend.byteLength < 100) // small message means it doesn't contain any changes
      const s2 = Automerge.startSync(n2, s1.messageToSend)
      assert.ok(s2.messageToSend.byteLength < 100)
      assert.strictEqual(s2.isFinished, true)
      const m3 = s1.processMessage(s2.messageToSend)
      assert.strictEqual(m3, undefined)
      assert.strictEqual(s1.isFinished, true)
    })

    it('should work with prior sync state', () => {
      let n1 = Automerge.init(), n2 = Automerge.init()
      for (let i = 0; i < 5; i++) n1 = Automerge.change(n1, doc => doc.x = `${i} ${longString()}`)
      const lastSync = Automerge.getCurrentVersion(n1)
      assert.strictEqual(lastSync.byteLength, 34)
      for (let i = 5; i < 10; i++) n1 = Automerge.change(n1, doc => doc.x = `${i} ${longString()}`)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      const s1 = Automerge.startSync(n1, lastSync)
      assert.ok(s1.messageToSend.byteLength < 100)
      const s2 = Automerge.startSync(n2, s1.messageToSend)
      assert.ok(s2.messageToSend.byteLength < 50)
      assert.strictEqual(s2.isFinished, true)
      const m3 = s1.processMessage(s2.messageToSend)
      assert.strictEqual(m3, undefined)
      assert.strictEqual(s1.isFinished, true)
    })
  })

  describe('with diverged documents', () => {
    it('should work without prior sync state', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = `${i} ${longString()}`)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      for (let i = 10; i < 15; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = `${i} ${longString()}`)
      for (let i = 10; i < 15; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.x = `${i} ${longString()}`)
      const s1 = Automerge.startSync(n1)
      assert.ok(s1.messageToSend.byteLength < 100)
      const s2 = Automerge.startSync(n2, s1.messageToSend)
      assert.ok(s2.messageToSend.byteLength > 5000 && s2.messageToSend.byteLength < 6000)
      const m3 = s1.processMessage(s2.messageToSend)
      assert.ok(m3.byteLength > 5000 && m3.byteLength < 6000)
      const m4 = s2.processMessage(m3)
      assert.strictEqual(s2.isFinished, true)
      assert.ok(m4.byteLength < 10)
      n2 = Automerge.finishSync(n2, s2)
      assert.strictEqual(s1.processMessage(m4), undefined)
      assert.strictEqual(s1.isFinished, true)
      n1 = Automerge.finishSync(n1, s1)
      assert.ok(equalBytes(Automerge.getCurrentVersion(n1), Automerge.getCurrentVersion(n2)))
      assert.strictEqual(n1.x, n2.x)
    })

    it('should work with prior sync state', () => {
      let n1 = Automerge.init('01234567'), n2 = Automerge.init('89abcdef')
      for (let i = 0; i < 10; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = `${i} ${longString()}`)
      n2 = Automerge.applyChanges(n2, Automerge.getAllChanges(n1))
      const lastSync = Automerge.getCurrentVersion(n1)
      for (let i = 10; i < 15; i++) n1 = Automerge.change(n1, {time: 0}, doc => doc.x = `${i} ${longString()}`)
      for (let i = 10; i < 15; i++) n2 = Automerge.change(n2, {time: 0}, doc => doc.x = `${i} ${longString()}`)
      const s1 = Automerge.startSync(n1, lastSync)
      assert.ok(s1.messageToSend.byteLength < 100)
      const s2 = Automerge.startSync(n2, s1.messageToSend)
      assert.ok(s2.messageToSend.byteLength > 5000 && s2.messageToSend.byteLength < 6000)
      const m3 = s1.processMessage(s2.messageToSend)
      assert.ok(m3.byteLength > 5000 && m3.byteLength < 6000)
      const m4 = s2.processMessage(m3)
      assert.strictEqual(s2.isFinished, true)
      assert.ok(m4.byteLength < 10)
      n2 = Automerge.finishSync(n2, s2)
      assert.strictEqual(s1.processMessage(m4), undefined)
      assert.strictEqual(s1.isFinished, true)
      n1 = Automerge.finishSync(n1, s1)
      assert.ok(equalBytes(Automerge.getCurrentVersion(n1), Automerge.getCurrentVersion(n2)))
      assert.strictEqual(n1.x, n2.x)
    })

    it('should re-sync after a crash with data loss', () => {
    })
  })
})
