// This file is used for running the test suite against an alternative backend
// implementation, such as the WebAssembly version compiled from Rust.
// It needs to be loaded before the test suite files, which can be done with
// `mocha --file test/wasm.js` (shortcut: `yarn testwasm`).
// You need to set the environment variable WASM_BACKEND_PATH to the path where
// the alternative backend module can be found; typically this is something
// like `../automerge-rs/automerge-backend-wasm`.
// Since this file relies on an environment variable and filesystem paths, it
// currently only works in Node, not in a browser.

const Automerge = process.env.TEST_DIST === '1' ? require('../dist/automerge') : require('../src/automerge')
const CodecFunctions = require('../backend/columnar')
const path = require('path')

if (process.env.WASM_BACKEND_PATH) {
  const wasmBackend = require(path.resolve(process.env.WASM_BACKEND_PATH))
  wasmBackend.initCodecFunctions(CodecFunctions)
  Automerge._js_backend = Automerge.Backend
  Automerge.setDefaultBackend(wasmBackend)
} else {
  throw new RangeError('Please set environment variable WASM_BACKEND_PATH to the path of the WebAssembly backend')
}
