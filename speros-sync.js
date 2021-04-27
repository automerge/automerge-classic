const {
  init,
  change,
  initSyncState,
  // generateSyncMessage,
  generateSyncMessage: _generateSyncMessage,
  receiveSyncMessage,
} = require("./src/automerge");
const { decodeSyncMessage } = require("./backend/sync");
const { performance, PerformanceObserver } = require("perf_hooks");
let aDoc = init(),
  bDoc = init();
const n = 500;
let syncMsgCt = 0;
const genSyncMsgTimes = [];
const syncMessageChangeSizes = [];
let syncMessageBloomSizes = [];
const generateSyncMessage = (...args) => {
  syncMsgCt++;
  const start = performance.now();
  const [syncState, msg] = _generateSyncMessage(...args);
  genSyncMsgTimes.push(performance.now() - start);
  if (msg) {
    const decodedMsg = decodeSyncMessage(msg);
    syncMessageChangeSizes.push(decodedMsg.changes.length);
    syncMessageBloomSizes = syncMessageBloomSizes.concat(
      decodedMsg.have.map((h) => h.bloom.length)
    );
  }
  return [syncState, msg];
};
const perfObserver = new PerformanceObserver((items) => {
  items.getEntries().forEach((entry) => {
    console.log(entry);
  });
});
perfObserver.observe({ entryTypes: ["measure"], buffered: true });
let a_syncStateForB = initSyncState(),
  b_syncStateForA = initSyncState();
const sendMsgFromBToA = mockAsync((msg) => {
  let replyMsg = null;
  [aDoc, a_syncStateForB] = receiveSyncMessage(aDoc, a_syncStateForB, msg);
  [a_syncStateForB, replyMsg] = generateSyncMessage(aDoc, a_syncStateForB);
  if (replyMsg) sendMsgFromAToB(replyMsg);
});
let hasMeasured = false;
const sendMsgFromAToB = mockAsync((msg) => {
  let replyMsg = null;
  [bDoc, b_syncStateForA] = receiveSyncMessage(bDoc, b_syncStateForA, msg);
  [b_syncStateForA, replyMsg] = generateSyncMessage(bDoc, b_syncStateForA);
  if (replyMsg) sendMsgFromBToA(replyMsg);
  if (bDoc.i === n && !hasMeasured) {
    performance.mark("END");
    performance.measure(`1 peer inserting ${n} times`, "START", "END");
    hasMeasured = true;
    console.log("SYNCMSGCT", syncMsgCt);
    let maxTime = -Infinity;
    let sumTime = 0;
    genSyncMsgTimes.forEach((time) => {
      maxTime = Math.max(time, maxTime);
      sumTime += maxTime;
    });
    console.log("max time", maxTime);
    console.log("avg time", sumTime / genSyncMsgTimes.length);
    let maxChangesSize = -Infinity;
    let sumChangesSize = 0;
    syncMessageChangeSizes.forEach((v) => {
      maxChangesSize = Math.max(v, maxChangesSize);
      sumChangesSize += v;
    });
    console.log("max changes size", maxChangesSize);
    console.log(
      "avg changes size",
      sumChangesSize / syncMessageChangeSizes.length
    );
    let maxBloomSize = -Infinity;
    let sumBloomSize = 0;
    syncMessageBloomSizes.forEach((v) => {
      maxBloomSize = Math.max(v, maxBloomSize);
      sumBloomSize += v;
    });
    console.log("max bloom size", maxBloomSize);
    console.log("avg bloom size", sumBloomSize / syncMessageBloomSizes.length);
  }
});
performance.mark("START");

let msg
[b_syncStateForA, msg] = generateSyncMessage(bDoc, b_syncStateForA);
[aDoc, a_syncStateForB] = receiveSyncMessage(aDoc, a_syncStateForB, msg);


for (let i = 0; i <= n; i++) {
  aDoc = change(aDoc, (doc) => {
    doc.i = i;
  });
  // On each change, trigger sync message for B
  let msg = null;
  [a_syncStateForB, msg] = generateSyncMessage(aDoc, a_syncStateForB);
  if (msg) sendMsgFromAToB(msg);
}
function mockAsync(cb) {
  // return cb; // Uncomment this to run synchronously
  return (...args) => setTimeout(() => cb(...args), 0);
}
