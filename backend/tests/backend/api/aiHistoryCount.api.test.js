/**
 * AI history message counts must be scoped to the page.
 *
 * Prisma compiles `_count: { select: { messages: true } }` into
 *
 *   LEFT JOIN (SELECT "conversationId", COUNT(*) FROM ai_messages
 *              WHERE 1=1 GROUP BY "conversationId") …
 *
 * — literally `WHERE 1=1`. The aggregate is not correlated to the page, so it
 * groups every message on the platform and the join throws away the ones
 * belonging to other people. Cost is a function of total platform messages, not
 * of the requesting user: measured on a 20k-conversation / 400k-message probe,
 * GET /ai/conversations took 134 ms and 29,369 shared buffers to return 4 rows.
 *
 * The counts it returns are CORRECT. That is the whole difficulty — every
 * value-level assertion passes identically before and after the fix, so no
 * behavioural test could ever have caught this. The assertion that distinguishes
 * the two implementations is a query-SHAPE one, so that is what is asserted
 * here, alongside behavioural guards for the contract the fix must not break.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { getApp, createTestUser, cleanupTestData, prisma } from '../../fixtures/setup.js';

const API = '/api/v1/ai';
let app; let userA; let userB;

// Per-request recorder. It must NOT be a shared module-level array: site C
// (/ai/conversations/:id) still emits the uncorrelated shape deliberately, so a
// shared buffer would make these assertions depend on test order.
async function sqlFor(fn) {
  const seen = [];
  const listener = (e) => seen.push(e.query);
  prisma.$on('query', listener);
  const res = await fn();
  await new Promise((r) => setTimeout(r, 150)); // query events are async
  return { res, sql: seen };
}

const uncorrelated = (sql) => sql.some((q) => /WHERE 1=1\s+GROUP BY/i.test(q));

beforeAll(async () => {
  app = await getApp();
  userA = await createTestUser();
  userB = await createTestUser();

  // A: one conversation with 3 messages, one with none.
  const a1 = await prisma.aIConversation.create({
    data: { userId: userA.user.id, title: 'A has messages' },
  });
  await prisma.aIMessage.createMany({
    data: [1, 2, 3].map((i) => ({
      conversationId: a1.id, role: 'user', content: `m${i}`, messageType: 'text',
    })),
  });
  await prisma.aIConversation.create({
    data: { userId: userA.user.id, title: 'A is empty' },
  });

  // B: a much busier conversation, so a leaking aggregate would be visible.
  const b1 = await prisma.aIConversation.create({
    data: { userId: userB.user.id, title: 'B is busy' },
  });
  await prisma.aIMessage.createMany({
    data: Array.from({ length: 50 }, (_, i) => ({
      conversationId: b1.id, role: 'user', content: `b${i}`, messageType: 'text',
    })),
  });
});

afterAll(async () => { await cleanupTestData(); });

describe('GET /ai/conversations', () => {
  it('does not emit an uncorrelated aggregate over every message', async () => {
    // The only assertion that separates the two implementations.
    const { sql } = await sqlFor(() =>
      request(app).get(`${API}/conversations`).set(userA.headers));
    expect(uncorrelated(sql)).toBe(false);
  });

  it('scopes the aggregate to the ids on the page', async () => {
    const { sql } = await sqlFor(() =>
      request(app).get(`${API}/conversations`).set(userA.headers));
    expect(sql.some((q) => /GROUP BY/i.test(q) && /"conversationId" IN \(/i.test(q))).toBe(true);
  });

  it('counts only this user’s messages, whatever anyone else has', async () => {
    const res = await request(app).get(`${API}/conversations`).set(userA.headers);
    expect(res.status).toBe(200);
    const withMsgs = res.body.data.find((c) => c.title === 'A has messages');
    expect(withMsgs._count.messages).toBe(3);
  });

  it('reports zero as zero, not as a missing field', async () => {
    // The load-bearing `?? 0`. groupBy returns NO ROW for a conversation with no
    // messages, where Prisma's _count emitted COALESCE(…, 0). Empty
    // conversations are reachable: message persistence is best-effort and
    // wrapped in try/catch.
    const res = await request(app).get(`${API}/conversations`).set(userA.headers);
    const empty = res.body.data.find((c) => c.title === 'A is empty');
    expect(empty._count).toEqual({ messages: 0 });
  });

  it('keeps the _count.messages wire shape the shipped apps read', async () => {
    // AIChatScreen reads `item._count?.messages`. Flattening this to a plain
    // field would make every row in the shipped app read "0 msgs" until users
    // update — so the shape is pinned, not just the number.
    const res = await request(app).get(`${API}/conversations`).set(userA.headers);
    for (const row of res.body.data) {
      expect(row).toHaveProperty('_count.messages');
      expect(typeof row._count.messages).toBe('number');
    }
  });
});

describe('GET /ai/scan/sessions', () => {
  it('is page-scoped too', async () => {
    const { res, sql } = await sqlFor(() =>
      request(app).get(`${API}/scan/sessions`).set(userA.headers));
    expect(res.status).toBe(200);
    expect(uncorrelated(sql)).toBe(false);
  });
});

describe('GET /ai/voice/conversations', () => {
  it('is page-scoped too', async () => {
    const { res, sql } = await sqlFor(() =>
      request(app).get(`${API}/voice/conversations`).set(userA.headers));
    expect(res.status).toBe(200);
    expect(uncorrelated(sql)).toBe(false);
  });
});

describe('GET /ai/conversations/:id — deliberately NOT converted', () => {
  it('still returns its message total', async () => {
    // Pinned so a future cleanup that "finishes the job" has to notice this
    // route is a considered exception, not an oversight. Its `_count` emits the
    // same uncorrelated SQL but the planner pushes the qualifier down for a
    // single-PK outer row (measured 0.176 ms, 7 buffers) — which is a property
    // of the PLAN, not of the query.
    const convo = await prisma.aIConversation.findFirst({
      where: { userId: userA.user.id, title: 'A has messages' },
    });
    const res = await request(app).get(`${API}/conversations/${convo.id}`).set(userA.headers);
    expect(res.status).toBe(200);
    // Note this route does NOT expose `_count` — it reads the aggregate, then
    // deletes it and republishes it as `totalMessages` alongside
    // `messagesTruncated`, because the nested `messages` are capped at 100.
    // Pinning the field the client actually receives, not the internal one.
    expect(res.body.data.totalMessages).toBe(3);
    expect(res.body.data.messagesTruncated).toBe(false);
    expect(res.body.data._count).toBeUndefined();
  });
});
