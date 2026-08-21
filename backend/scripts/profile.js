/**
 * Runtime profile of a live server process (claude.md §58).
 *
 * §58 asks for heap, RSS, GC, event-loop lag, event-loop utilisation and CPU.
 * All six are available from Node's own built-ins — `perf_hooks` and `v8` — so
 * this needs no profiler dependency, no instrumentation of the app, and no
 * production agent. It is `require`d into the server process by
 * PROFILE=1 npm start, samples on an interval, and writes NDJSON.
 *
 * WHY the built-ins rather than clinic/0x: those want to own the process
 * lifecycle and produce a flamegraph of ONE run. What was missing here is not a
 * flamegraph — it is a continuous answer to "is the event loop being blocked,
 * and is the heap growing", which has to be sampled WHILE load is applied.
 *
 * The numbers that matter, and why:
 *
 *   eventLoopDelay   p50/p99 in ms. The single most important number for a Node
 *                    API. It is how long a ready callback waited before running,
 *                    so it is the latency every request pays on top of its own
 *                    work. Anything above ~50 ms p99 means something synchronous
 *                    is holding the loop — a large JSON.parse, a base64 decode,
 *                    a sync crypto call. §58 names all three.
 *   elu              Event-loop utilisation, 0..1. The fraction of wall time the
 *                    loop spent working rather than waiting. Near 1.0 means the
 *                    process is CPU-bound and adding concurrency will not help;
 *                    it needs another replica or the work moved off the loop.
 *   heapUsed / rss   Growth ACROSS samples is the signal, not any single value.
 *                    A heap that climbs and never falls after GC is a retained
 *                    reference — the unbounded-Map class of defect in §10.
 *   gc               Pause time by kind. Many long major collections mean large
 *                    objects being promoted: the Base64 strings and Buffers §58
 *                    calls out.
 *
 * Usage:
 *   PROFILE=1 PROFILE_OUT=/tmp/prof.ndjson node src/server.js
 *   node scripts/profile.js --summarise /tmp/prof.ndjson
 */
import { monitorEventLoopDelay, performance, PerformanceObserver } from 'perf_hooks';
import v8 from 'v8';
import fs from 'fs';

const MS = 1e6; // the delay histogram reports nanoseconds

/**
 * Start sampling. Returns a stop() that flushes and closes.
 *
 * @param {object}  [opts]
 * @param {number}  [opts.intervalMs] sample period
 * @param {string}  [opts.out]        NDJSON path; stdout when absent
 */
export function startProfiling({ intervalMs = 1000, out = null } = {}) {
  // resolution:10 — the histogram itself costs a timer at this period, so
  // sampling finer than 10 ms measures the profiler as much as the server.
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();

  const gc = { count: 0, totalMs: 0, maxMs: 0, byKind: {} };
  const KINDS = { 1: 'minor', 2: 'major', 4: 'incremental', 8: 'weakcb', 16: 'all' };
  const obs = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const kind = KINDS[e.detail?.kind] || 'other';
      gc.count += 1;
      gc.totalMs += e.duration;
      gc.maxMs = Math.max(gc.maxMs, e.duration);
      gc.byKind[kind] = (gc.byKind[kind] || 0) + 1;
    }
  });
  obs.observe({ entryTypes: ['gc'] });

  let lastELU = performance.eventLoopUtilization();
  let lastCpu = process.cpuUsage();
  let lastGcTotal = 0;
  const stream = out ? fs.createWriteStream(out, { flags: 'a' }) : null;

  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    // Both of these are DELTAS since the previous sample — an absolute cpuUsage
    // or ELU since process start says nothing about behaviour under the load
    // being applied right now.
    const elu = performance.eventLoopUtilization(lastELU);
    const cpu = process.cpuUsage(lastCpu);
    lastELU = performance.eventLoopUtilization();
    lastCpu = process.cpuUsage();

    const sample = {
      t: new Date().toISOString(),
      loopDelayMs: {
        p50: +(loopDelay.percentile(50) / MS).toFixed(2),
        p95: +(loopDelay.percentile(95) / MS).toFixed(2),
        p99: +(loopDelay.percentile(99) / MS).toFixed(2),
        max: +(loopDelay.max / MS).toFixed(2),
      },
      elu: +elu.utilization.toFixed(4),
      cpuMs: { user: +(cpu.user / 1000).toFixed(1), system: +(cpu.system / 1000).toFixed(1) },
      memMB: {
        rss: +(mem.rss / 1048576).toFixed(1),
        heapUsed: +(mem.heapUsed / 1048576).toFixed(1),
        heapTotal: +(mem.heapTotal / 1048576).toFixed(1),
        external: +(mem.external / 1048576).toFixed(1),
        arrayBuffers: +(mem.arrayBuffers / 1048576).toFixed(1),
      },
      heapLimitMB: +(heap.heap_size_limit / 1048576).toFixed(0),
      gc: { count: gc.count, totalMs: +gc.totalMs.toFixed(1), maxMs: +gc.maxMs.toFixed(1),
            sinceLastMs: +(gc.totalMs - lastGcTotal).toFixed(1), byKind: { ...gc.byKind } },
    };
    lastGcTotal = gc.totalMs;
    // The histogram is reset each sample so percentiles describe THIS window.
    // Cumulative percentiles hide a spike behind hours of idle.
    loopDelay.reset();

    const line = JSON.stringify(sample);
    if (stream) stream.write(line + '\n'); else console.log(line);
  }, intervalMs);

  timer.unref?.();

  return function stop() {
    clearInterval(timer);
    loopDelay.disable();
    obs.disconnect();
    stream?.end();
  };
}

/** Reduce an NDJSON run to the table §58 asks for. */
export function summarise(path) {
  const rows = fs.readFileSync(path, 'utf8').trim().split('\n')
    .filter(Boolean).map((l) => JSON.parse(l));
  if (!rows.length) return null;

  const max = (f) => Math.max(...rows.map(f));
  const avg = (f) => rows.reduce((s, r) => s + f(r), 0) / rows.length;
  const first = rows[0]; const last = rows[rows.length - 1];

  return {
    samples: rows.length,
    loopDelayP50Avg: +avg((r) => r.loopDelayMs.p50).toFixed(2),
    loopDelayP99Max: +max((r) => r.loopDelayMs.p99).toFixed(2),
    loopDelayMax:    +max((r) => r.loopDelayMs.max).toFixed(2),
    eluAvg:          +avg((r) => r.elu).toFixed(3),
    eluMax:          +max((r) => r.elu).toFixed(3),
    rssStartMB:      first.memMB.rss,
    rssEndMB:        last.memMB.rss,
    rssMaxMB:        +max((r) => r.memMB.rss).toFixed(1),
    heapStartMB:     first.memMB.heapUsed,
    heapEndMB:       last.memMB.heapUsed,
    heapMaxMB:       +max((r) => r.memMB.heapUsed).toFixed(1),
    // The retention signal: heap higher at the end than the start, after GC has
    // had every chance to run, is something being held.
    heapGrowthMB:    +(last.memMB.heapUsed - first.memMB.heapUsed).toFixed(1),
    gcCount:         last.gc.count,
    gcTotalMs:       last.gc.totalMs,
    gcMaxPauseMs:    last.gc.maxMs,
    gcByKind:        last.gc.byKind,
  };
}

// CLI: node scripts/profile.js --summarise <file>
const [, , flag, file] = process.argv;
if (flag === '--summarise' && file) {
  console.log(JSON.stringify(summarise(file), null, 2));
}
