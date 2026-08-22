/**
 * A comment thread must be bounded (§21/§47).
 *
 * GET /community/posts/:id/comments returned an ENTIRE thread — every top-level
 * comment, each with every nested reply — with no `take` anywhere, on a public
 * route with no authentication. One popular post is unbounded work and an
 * unbounded payload.
 *
 * Capping only the outer level would not have been enough: one comment with a
 * thousand replies reintroduces the same unbounded read one level down, which is
 * why the reply preview is capped too and both are asserted here.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import { getApp, createTestUser, cleanupTestData, prisma } from '../../fixtures/setup.js';

const API = '/api/v1/community';
const TOP_LEVEL = 60;   // more than the 50 default page
const REPLIES   = 25;   // more than the 10 preview

let app; let author; let postId;

beforeAll(async () => {
  app = await getApp();
  author = await createTestUser({ name: 'Commenter' });
  const post = await prisma.post.create({
    data: { authorId: author.user.id, title: 'Busy thread', description: 'Busy thread', category: 'general' },
  });
  postId = post.id;

  let clock = Date.UTC(2026, 0, 1);
  const parents = [];
  for (let i = 0; i < TOP_LEVEL; i++) {
    parents.push(await prisma.comment.create({
      data: {
        postId, authorId: author.user.id, text: `top ${i}`,
        createdAt: new Date((clock += 1000)),
      },
    }));
  }
  for (let r = 0; r < REPLIES; r++) {
    await prisma.comment.create({
      data: {
        postId, authorId: author.user.id, parentId: parents[0].id,
        text: `reply ${r}`, createdAt: new Date((clock += 1000)),
      },
    });
  }
});

afterAll(async () => { await cleanupTestData(); });

describe('GET /community/posts/:id/comments', () => {
  it('caps the top level instead of returning the whole thread', async () => {
    const res = await request(app).get(`${API}/posts/${postId}/comments`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(50);       // not 60
    expect(res.body.meta.total).toBe(TOP_LEVEL); // and says so honestly
    expect(res.body.meta.hasMore).toBe(true);
  });

  it('caps nested replies too, so one hot comment cannot reopen the hole', async () => {
    const res = await request(app).get(`${API}/posts/${postId}/comments`);
    const hot = res.body.data.find((c) => c.text === 'top 0');
    expect(hot.replies.length).toBe(10);         // not 25
    expect(hot._count.replies).toBe(REPLIES);    // full count still available
  });

  it('the response is still a bare array, so existing clients are unaffected', async () => {
    // The counts went into `meta`, a separate envelope field. A client that
    // ignores meta behaves exactly as it did before.
    const res = await request(app).get(`${API}/posts/${postId}/comments`);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0]).toHaveProperty('author.name');
  });

  it('pages without repeating or skipping a comment', async () => {
    const seen = new Set();
    for (const page of [1, 2]) {
      const res = await request(app).get(`${API}/posts/${postId}/comments?page=${page}&limit=30`);
      res.body.data.forEach((c) => seen.add(c.id));
    }
    expect(seen.size).toBe(TOP_LEVEL);
  });

  it('reports hasMore false on the last page', async () => {
    const res = await request(app).get(`${API}/posts/${postId}/comments?page=2&limit=50`);
    expect(res.body.data.length).toBe(10);
    expect(res.body.meta.hasMore).toBe(false);
  });
});
