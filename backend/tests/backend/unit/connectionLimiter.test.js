/**
 * Per-user Socket.IO connection cap (SCALE-5).
 *
 * Acceptance: connection counts stay bounded and there's no handle leak. We
 * exercise the registry's add/remove lifecycle, the cap, and — crucially — that
 * the backing map releases a user's entry once their last socket disconnects.
 */
import { ConnectionRegistry } from '../../../src/socket/connectionLimiter.js';

describe('ConnectionRegistry', () => {
  it('accepts up to maxPerUser sockets, then refuses', () => {
    const reg = new ConnectionRegistry({ maxPerUser: 3 });
    expect(reg.tryAdd('u1', 's1')).toBe(true);
    expect(reg.tryAdd('u1', 's2')).toBe(true);
    expect(reg.tryAdd('u1', 's3')).toBe(true);
    expect(reg.tryAdd('u1', 's4')).toBe(false); // at cap → refused
    expect(reg.countFor('u1')).toBe(3);
  });

  it('does NOT track a refused socket (so disconnecting it is a no-op)', () => {
    const reg = new ConnectionRegistry({ maxPerUser: 1 });
    reg.tryAdd('u1', 's1');
    expect(reg.tryAdd('u1', 's2')).toBe(false);
    reg.remove('u1', 's2'); // the refused socket was never added
    expect(reg.countFor('u1')).toBe(1); // s1 still counted, no underflow
  });

  it('frees a slot on disconnect so a new socket can connect (no drift)', () => {
    const reg = new ConnectionRegistry({ maxPerUser: 2 });
    reg.tryAdd('u1', 's1');
    reg.tryAdd('u1', 's2');
    expect(reg.tryAdd('u1', 's3')).toBe(false);
    reg.remove('u1', 's1');                 // a session closes
    expect(reg.tryAdd('u1', 's3')).toBe(true); // slot reclaimed
    expect(reg.countFor('u1')).toBe(2);
  });

  it('drops the user entry when their last socket disconnects (map stays bounded)', () => {
    const reg = new ConnectionRegistry({ maxPerUser: 5 });
    reg.tryAdd('u1', 's1');
    reg.tryAdd('u1', 's2');
    expect(reg.users).toBe(1);
    reg.remove('u1', 's1');
    reg.remove('u1', 's2');
    expect(reg.countFor('u1')).toBe(0);
    expect(reg.users).toBe(0);   // no empty Set left behind
    expect(reg.size).toBe(0);
  });

  it('is idempotent for a repeated socket id', () => {
    const reg = new ConnectionRegistry({ maxPerUser: 2 });
    expect(reg.tryAdd('u1', 's1')).toBe(true);
    expect(reg.tryAdd('u1', 's1')).toBe(true); // same id again
    expect(reg.countFor('u1')).toBe(1);        // not double-counted
  });

  it('tracks users independently', () => {
    const reg = new ConnectionRegistry({ maxPerUser: 1 });
    expect(reg.tryAdd('u1', 's1')).toBe(true);
    expect(reg.tryAdd('u2', 's2')).toBe(true); // u2 has its own budget
    expect(reg.tryAdd('u1', 's3')).toBe(false);
    expect(reg.size).toBe(2);
    expect(reg.users).toBe(2);
  });

  it('stays bounded under sustained churn', () => {
    const reg = new ConnectionRegistry({ maxPerUser: 4 });
    for (let i = 0; i < 10_000; i++) {
      const u = `user-${i % 50}`;
      const s = `sock-${i}`;
      if (reg.tryAdd(u, s)) reg.remove(u, s); // connect then immediately disconnect
    }
    expect(reg.size).toBe(0);  // everything cleaned up
    expect(reg.users).toBe(0); // no leaked user entries
  });

  it('rejects an invalid cap', () => {
    expect(() => new ConnectionRegistry({ maxPerUser: 0 })).toThrow();
    expect(() => new ConnectionRegistry({ maxPerUser: -3 })).toThrow();
  });
});
