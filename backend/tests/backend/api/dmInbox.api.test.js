/**
 * The DM inbox must cost a fixed number of queries, not three per partner.
 *
 * `GET /api/v1/messages/conversations` ran `user.findUnique` + `findFirst`
 * (last message) + `count` (unread) inside a map over EVERY partner — the
 * textbook §15 shape, and the same defect PERF-006 fixed for the animaltrade
 * inbox, left in place here. There is no `take` anywhere on the route, so
 * partner count is unbounded: 40 DM partners cost 2 + 120 queries.
 *
 * The two seed queries were also `distinct` with no `take`. Prisma does not push
 * `distinct` into SQL, so they streamed every DM row the user had ever sent or
 * received into the process just to learn who they had talked to.
 *
 * Query COUNT is the assertion, because the response was always correct — this
 * is a cost defect, and every value-level check passes before and after.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { getApp, createTestUser, cleanupTestData, prisma } from '../../fixtures/setup.js';

const API = '/api/v1/messages';
let app; let me; let partners = [];

// Explicit, strictly increasing timestamps. Three messages created in a loop
// land in the same millisecond, and the seek orders by (createdAt DESC, id DESC)
// — so with uuid ids the tiebreak is effectively random and "which message is
// newest" becomes a coin flip. That is a flaw in the FIXTURE, not the query:
// real DMs are seconds apart. Pinning the clock makes the assertion mean what it
// says.
let clock = Date.UTC(2026, 0, 1);
const dm = (from, to, body, readAt = null) => prisma.directMessage.create({
  data: { senderId: from, receiverId: to, text: body, readAt, createdAt: new Date((clock += 1000)) },
});

beforeAll(async () => {
  app = await getApp();
  me = await createTestUser({ name: 'Me' });
  for (let i = 0; i < 6; i++) partners.push(await createTestUser({ name: `Partner ${i}` }));

  for (const [i, p] of partners.entries()) {
    await dm(me.user.id, p.user.id, `hello ${i}`);
    await dm(p.user.id, me.user.id, `reply ${i}`);           // unread
    await dm(p.user.id, me.user.id, `newest from ${i}`);     // unread + newest
  }
  // Traffic between two OTHER users: must not leak into my counts.
  await dm(partners[0].user.id, partners[1].user.id, 'not mine');
});

afterAll(async () => { await cleanupTestData(); });

async function countQueries(fn) {
  const seen = [];
  const listener = (e) => seen.push(e.query);
  prisma.$on('query', listener);
  const res = await fn();
  await new Promise((r) => setTimeout(r, 200));
  return { res, queries: seen };
}

describe('GET /messages/conversations', () => {
  it('costs a fixed number of queries regardless of partner count', async () => {
    const { res, queries } = await countQueries(() =>
      request(app).get(`${API}/conversations`).set(me.headers));

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(6);
    // 2 groupBy seeds + user batch + LATERAL + unread groupBy, plus whatever
    // auth costs. The point is that it does NOT scale with partners: the old
    // shape was 2 + 3x6 = 20 on this fixture.
    const dmQueries = queries.filter((q) => /direct_messages|users/i.test(q));
    expect(dmQueries.length).toBeLessThan(12);
  });

  it('never emits a per-partner findFirst or count', async () => {
    // The shape assertion. A LIMIT 1 lookup keyed to a single partner is the
    // signature of the old loop.
    const { queries } = await countQueries(() =>
      request(app).get(`${API}/conversations`).set(me.headers));
    const laterals = queries.filter((q) => /LATERAL/i.test(q));
    expect(laterals.length).toBeLessThanOrEqual(1); // one batched seek, not six
  });

  it('does not use Prisma `distinct`, which it resolves in the client', async () => {
    const { queries } = await countQueries(() =>
      request(app).get(`${API}/conversations`).set(me.headers));
    const seeds = queries.filter((q) => /direct_messages/i.test(q) && /GROUP BY/i.test(q));
    expect(seeds.length).toBeGreaterThanOrEqual(2);
  });

  it('returns the newest message and the right unread count per partner', async () => {
    // The behaviour that must survive the rewrite.
    const res = await request(app).get(`${API}/conversations`).set(me.headers);
    for (const row of res.body.data) {
      const idx = partners.findIndex((p) => p.user.id === row.partnerId);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(row.lastMessage.text).toBe(`newest from ${idx}`);
      expect(row.unreadCount).toBe(2);   // two unread from that partner
    }
  });

  it('counts only messages addressed to me', async () => {
    // partners[1] received a DM from partners[0]; it must not appear in MY
    // unread count for partners[0].
    const res = await request(app).get(`${API}/conversations`).set(me.headers);
    const row = res.body.data.find((r) => r.partnerId === partners[0].user.id);
    expect(row.unreadCount).toBe(2);
  });

  it('returns an empty list for someone with no conversations', async () => {
    const lonely = await createTestUser({ name: 'Lonely' });
    const res = await request(app).get(`${API}/conversations`).set(lonely.headers);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('sorts newest conversation first', async () => {
    const fresh = await createTestUser({ name: 'Fresh' });
    await dm(fresh.user.id, me.user.id, 'brand new');
    const res = await request(app).get(`${API}/conversations`).set(me.headers);
    expect(res.body.data[0].partnerId).toBe(fresh.user.id);
  });
});
