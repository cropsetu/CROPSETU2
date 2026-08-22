/**
 * CRON_ENABLED — the gate that lets scheduled work move off the web tier
 * (claude.md §34).
 *
 * Twelve node-cron schedules are registered by every process that boots
 * server.js, which today means every latency-serving replica. Nine take a Redis
 * leader lock so only one does the work, but all twelve still wake, the three
 * that are NOT leader-locked genuinely multiply by replica count, and cron work
 * shares the same Prisma pool as the HTTP path.
 *
 * These assert the flag's SEMANTICS. The structural properties — one contiguous
 * gate, and the metric observer left outside it — were verified by booting the
 * server both ways and by forcing the daily-sync cron to fire, which is the only
 * thing that would have surfaced the ReferenceError the naive gate produces.
 */
import { readFileSync } from 'fs';

const envSrc    = readFileSync(new URL('../../../src/config/env.js', import.meta.url), 'utf8');
const serverSrc = readFileSync(new URL('../../../src/server.js', import.meta.url), 'utf8');

describe('the flag', () => {
  it('defaults to ON, so a single-service deploy needs no new configuration', () => {
    // `!== 'false'` rather than `=== 'true'`: an unset variable must keep the
    // schedules running, or the first deploy after this change silently stops
    // every sweep, reconcile and expiry in the system.
    expect(envSrc).toMatch(/CRON_ENABLED:\s*process\.env\.CRON_ENABLED !== 'false'/);
  });
});

describe('the gate', () => {
  it('is ONE block, not several', () => {
    // Two gates would split `triggerMandiSync`'s declaration from its use.
    expect(serverSrc.match(/if \(ENV\.CRON_ENABLED\)/g)).toHaveLength(1);
  });

  it('contains every cron.schedule in the file', () => {
    const start = serverSrc.indexOf('if (ENV.CRON_ENABLED)');
    const end   = serverSrc.indexOf("CRON_ENABLED=false — this replica serves traffic only");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const inside  = serverSrc.slice(start, end).match(/cron\.schedule\(/g) || [];
    const outside = (serverSrc.match(/cron\.schedule\(/g) || []).length - inside.length;

    // `outside === 0` is the whole property: EVERY cron must be gated, so a
    // replica started with CRON_ENABLED=false runs none of them.
    //
    // Deliberately not asserting an exact count any more. It used to say 12, and
    // that number went stale the moment a colleague's security commit added a
    // referential-integrity sweep — which was correctly inside the gate. A test
    // that fails when someone adds a properly-gated cron is training people to
    // edit the number rather than check the property, and the next person to do
    // that on autopilot could bump it past an UNgated one.
    expect(outside).toBe(0);
    expect(inside.length).toBeGreaterThanOrEqual(12);
  });

  it('declares triggerMandiSync and its caller in the SAME block', () => {
    // Both are block-scoped in an ES module. Gating them separately throws
    // ReferenceError on the 00:30 tick — at runtime, months later, not at boot.
    const start = serverSrc.indexOf('if (ENV.CRON_ENABLED)');
    const end   = serverSrc.indexOf("CRON_ENABLED=false — this replica serves traffic only");
    const body  = serverSrc.slice(start, end);

    expect(body).toContain('const AI_BASE');
    expect(body).toContain('async function triggerMandiSync');
    expect(body).toContain("withLeaderLock('mandi-daily-sync'");
  });

  it('leaves the serialization-conflict observer OUTSIDE the gate', () => {
    // Not a schedule — a per-process metric hook that happened to sit in the
    // middle of the cron region. A CRON_ENABLED=false replica is the one taking
    // the checkout traffic whose conflicts it counts.
    const gate = serverSrc.indexOf('if (ENV.CRON_ENABLED)');
    const obs  = serverSrc.indexOf('setSerializableConflictObserver(() =>');
    expect(obs).toBeGreaterThan(-1);
    expect(obs).toBeLessThan(gate);
  });
});
