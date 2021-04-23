const assert = require('assert').strict;
const { performance, PerformanceObserver } = require('perf_hooks');
const Automerge = require('./src/automerge');


const perfObserver = new PerformanceObserver(items => {
    console.log('change count'.padEnd(15), 'syncCount'.padEnd(15), 'duration (ms)'.padEnd(15), 'backend')
    items.getEntries().forEach(entry => {
        console.log(
            entry.detail.count.toString().padEnd(15),
            entry.detail.syncCount.toString().padEnd(15),
            Math.round(entry.duration).toString().padEnd(15),
            entry.detail.backend,
        );
    });
});

perfObserver.observe({ type: 'measure', buffered: false });

const START_MARKER = `start`;
const END_MARKER = `end`;

function sync(
  a,
  b,
  aSyncState = initSyncState(),
  bSyncState = initSyncState()
) {
  const MAX_ITER = 10;
  let aToBmsg = null,
    bToAmsg = null,
    i = 0;
  do {
    [aSyncState, aToBmsg] = Automerge.generateSyncMessage(a, aSyncState);
    if (aToBmsg) {
      [b, bSyncState] = Automerge.receiveSyncMessage(b, bSyncState, aToBmsg);
    }

    [bSyncState, bToAmsg] = Automerge.generateSyncMessage(b, bSyncState);
    if (bToAmsg) {
      [a, aSyncState] = Automerge.receiveSyncMessage(a, aSyncState, bToAmsg);
    }

    if (i++ > MAX_ITER) {
      throw new Error(
        `Did not synchronize within ${MAX_ITER} iterations. Do you have a bug causing an infinite loop?`
      );
    }
  } while (aToBmsg || bToAmsg);

  return [a, b, aSyncState, bSyncState];
}

function syncPerChange(count, syncInterval, backend) {
    let n1 = Automerge.init(), n2 = Automerge.init();
    let s1 = Automerge.initSyncState(), s2 = Automerge.initSyncState();
    let syncCount = 0

    performance.mark(START_MARKER);
    n1 = Automerge.change(n1, { time: 0 }, (doc) => (doc.n = []));
    for (let i = 0; i < count; i++) {
        n1 = Automerge.change(n1, { time: 0 }, (doc) => doc.n.push(i));

        if (i % syncInterval == syncInterval-1) {
            syncCount += 1
            ;[n1, n2, s1, s2] = sync(n1, n2, s1, s2);
            assert.deepStrictEqual(n1, n2)
        }
    }
    performance.measure(`sync`, {detail: {count, syncCount, backend}, start: START_MARKER})
}

intervals = [1, 10, 100, 1000].reverse()
counts = [1000, 2000, 5000, 10000]

counts.forEach(c => intervals.forEach(i => i <= c ? syncPerChange(c, i, "js") : null))

// requires a backend built with `yarn release` in the automerge-backend-wasm directory
Automerge.setDefaultBackend(require("../automerge-rs/automerge-backend-wasm/build/cjs"))
counts.forEach(c => intervals.forEach(i => i <= c ? syncPerChange(c, i, "wasm") : null))
