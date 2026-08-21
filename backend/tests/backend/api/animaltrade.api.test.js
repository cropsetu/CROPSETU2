/**
 * Animal Trade API — listing discovery, privacy, ownership, chat.
 *
 * The privacy assertions are the load-bearing ones: they encode that a seller's
 * phone number and exact coordinates must never appear in a public response, no
 * matter which endpoint is asked. If a future change re-adds `phone` to a
 * select, these fail.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import request from 'supertest';
import { getApp, createTestUser, cleanupTestData, prisma } from '../../fixtures/setup.js';

const API = '/api/v1/animals';

let app;

/** Pune-ish anchor; the offsets below are ~11 km per 0.1 degree of latitude. */
const PUNE = { lat: 18.5204, lng: 73.8567 };

async function makeListing(sellerId, overrides = {}) {
  const base = {
    sellerId,
    animal: 'Buffalo',
    breed: 'Murrah',
    age: '4 years',
    gender: 'FEMALE',
    weight: '520 kg',
    price: 85000,
    milkYield: '12 Litre/Day',
    description: 'Healthy milch buffalo',
    sellerLocation: 'Baramati, Pune, Maharashtra',
    images: ['https://res.cloudinary.com/demo/image/upload/v1/farmeasy/animals/a.jpg'],
    tags: ['Vaccinated'],
    status: 'ACTIVE',
    lat: PUNE.lat,
    lng: PUNE.lng,
    ageMonths: 48,
    weightKg: 520,
    milkYieldLpd: 12,
    vaccinated: true,
    searchText: 'buffalo murrah baramati pune maharashtra vaccinated म्हैस म्हशी भैंस mhais bhains',
    ...overrides,
  };
  return prisma.animalListing.create({ data: base });
}

beforeAll(async () => {
  app = await getApp();
});

afterAll(async () => {
  await cleanupTestData();
  await prisma.$disconnect();
});

beforeEach(async () => {
  await cleanupTestData();
});

/** A fresh seller + buyer, each with { user, token, headers }. */
async function actors() {
  const s = await createTestUser({ name: 'Seller' });
  const b = await createTestUser({ name: 'Buyer' });
  return { s, b };
}

describe('GET /animals — discovery', () => {
  it('returns ACTIVE listings with pagination meta', async () => {
    const { s } = await actors();
    await makeListing(s.user.id);
    await makeListing(s.user.id, { animal: 'Cow', breed: 'Gir', price: 60000 });

    const res = await request(app).get(API).query({ limit: 10 });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 10, total: 2, hasMore: false, sort: 'latest' });
  });

  it('hides soft-deleted (INACTIVE) listings', async () => {
    const { s } = await actors();
    await makeListing(s.user.id, { status: 'INACTIVE' });

    const res = await request(app).get(API);
    expect(res.body.data).toHaveLength(0);
  });

  it('NEVER exposes seller coordinates or phone in the list response', async () => {
    const { s } = await actors();
    await makeListing(s.user.id);

    const res = await request(app).get(API);
    const row = res.body.data[0];

    expect(row.lat).toBeUndefined();
    expect(row.lng).toBeUndefined();
    expect(row.seller.phone).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(s.user.phone);
    // The flag the UI needs is a boolean, not the coordinates themselves.
    expect(row.hasCoords).toBe(true);
  });

  it('serves card-sized Cloudinary thumbnails alongside the originals', async () => {
    const { s } = await actors();
    await makeListing(s.user.id);

    const res = await request(app).get(API);
    expect(res.body.data[0].thumbnails[0]).toContain('f_auto,q_auto:eco,w_320,c_limit');
  });

  it('filters by animal type, price range and vaccination', async () => {
    const { s } = await actors();
    await makeListing(s.user.id, { animal: 'Cow', price: 40000, vaccinated: false });
    await makeListing(s.user.id, { animal: 'Cow', price: 90000, vaccinated: true });
    await makeListing(s.user.id, { animal: 'Goat', price: 8000, vaccinated: true });

    const byType = await request(app).get(API).query({ animal: 'Cow' });
    expect(byType.body.data).toHaveLength(2);

    const byPrice = await request(app).get(API).query({ minPrice: 50000, maxPrice: 100000 });
    expect(byPrice.body.data).toHaveLength(1);
    expect(Number(byPrice.body.data[0].price)).toBe(90000);

    const byVacc = await request(app).get(API).query({ vaccinated: 'true' });
    expect(byVacc.body.data).toHaveLength(2);
  });

  it('filters by normalised age range', async () => {
    const { s } = await actors();
    await makeListing(s.user.id, { age: '1 year', ageMonths: 12 });
    await makeListing(s.user.id, { age: '6 years', ageMonths: 72 });

    const res = await request(app).get(API).query({ minAgeMonths: 24, maxAgeMonths: 120 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].ageMonths).toBe(72);
  });

  it('sorts by price in both directions, server-side', async () => {
    const { s } = await actors();
    await makeListing(s.user.id, { price: 30000 });
    await makeListing(s.user.id, { price: 70000 });
    await makeListing(s.user.id, { price: 50000 });

    const asc = await request(app).get(API).query({ sort: 'price_asc' });
    expect(asc.body.data.map((r) => Number(r.price))).toEqual([30000, 50000, 70000]);

    const desc = await request(app).get(API).query({ sort: 'price_desc' });
    expect(desc.body.data.map((r) => Number(r.price))).toEqual([70000, 50000, 30000]);
  });

  it('paginates without duplicating or skipping rows', async () => {
    const { s } = await actors();
    // Identical createdAt/price is exactly the tie the id tiebreaker fixes.
    const at = new Date();
    for (let i = 0; i < 6; i++) await makeListing(s.user.id, { price: 50000, createdAt: at });

    const p1 = await request(app).get(API).query({ page: 1, limit: 3, sort: 'price_asc' });
    const p2 = await request(app).get(API).query({ page: 2, limit: 3, sort: 'price_asc' });
    const ids = [...p1.body.data, ...p2.body.data].map((r) => r.id);

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(p1.body.meta.hasMore).toBe(true);
    expect(p2.body.meta.hasMore).toBe(false);
  });

  describe('search', () => {
    it('matches on breed and location', async () => {
      const { s } = await actors();
      await makeListing(s.user.id, { breed: 'Murrah', searchText: 'buffalo murrah baramati' });
      await makeListing(s.user.id, { breed: 'Gir', animal: 'Cow', searchText: 'cow gir nashik' });

      const res = await request(app).get(API).query({ search: 'nashik' });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].breed).toBe('Gir');
    });

    it('finds an English listing from a Marathi query', async () => {
      const { s } = await actors();
      await makeListing(s.user.id); // searchText carries the म्हैस aliases

      const res = await request(app).get(API).query({ search: 'म्हैस' });
      expect(res.body.data).toHaveLength(1);
    });

    it('ANDs multiple words instead of returning everything that matched one', async () => {
      const { s } = await actors();
      await makeListing(s.user.id, { animal: 'Cow', breed: 'Jersey', searchText: 'cow jersey pune गाय' });
      await makeListing(s.user.id, { animal: 'Cow', breed: 'Gir', searchText: 'cow gir pune गाय' });

      const res = await request(app).get(API).query({ search: 'jersey cow' });
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].breed).toBe('Jersey');
    });

    it('still finds rows that predate the searchText backfill', async () => {
      const { s } = await actors();
      await makeListing(s.user.id, { breed: 'Pandharpuri', searchText: null });

      const res = await request(app).get(API).query({ search: 'pandharpuri' });
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('radius', () => {
    it('excludes listings outside the radius and attaches a coarse distance', async () => {
      const { s } = await actors();
      await makeListing(s.user.id, { lat: PUNE.lat, lng: PUNE.lng });                 // ~0 km
      await makeListing(s.user.id, { lat: PUNE.lat + 1.5, lng: PUNE.lng });           // ~165 km

      const res = await request(app).get(API).query({ ...PUNE, radius: 25 });

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.meta.appliedRadiusKm).toBe(25);
      // Whole kilometres only — never a metre-precise distance.
      expect(Number.isInteger(res.body.data[0].distanceKm)).toBe(true);
    });

    it('drops coordinate-less listings from a radius query', async () => {
      const { s } = await actors();
      await makeListing(s.user.id, { lat: null, lng: null });

      const withRadius = await request(app).get(API).query({ ...PUNE, radius: 50 });
      expect(withRadius.body.data).toHaveLength(0);

      // …but keeps them when no radius is asked for.
      const noRadius = await request(app).get(API).query(PUNE);
      expect(noRadius.body.data).toHaveLength(1);
      expect(noRadius.body.data[0].distanceKm).toBeNull();
    });

    it('applies the chosen sort across the whole radius, not just one page', async () => {
      const { s } = await actors();
      // The cheapest listing is also the FARTHEST, so a distance-ordered page
      // that was then re-sorted in memory would put the wrong row first.
      await makeListing(s.user.id, { price: 90000, lat: PUNE.lat, lng: PUNE.lng });
      await makeListing(s.user.id, { price: 80000, lat: PUNE.lat + 0.05, lng: PUNE.lng });
      await makeListing(s.user.id, { price: 10000, lat: PUNE.lat + 0.15, lng: PUNE.lng });

      const res = await request(app).get(API).query({ ...PUNE, radius: 100, sort: 'price_asc', limit: 1 });
      expect(Number(res.body.data[0].price)).toBe(10000);
    });
  });
});

describe('GET /animals/:id — detail', () => {
  it('returns the listing without coordinates or a phone number', async () => {
    const { s } = await actors();
    const l = await makeListing(s.user.id);

    const res = await request(app).get(`${API}/${l.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data.lat).toBeUndefined();
    expect(res.body.data.description).toBe('Healthy milch buffalo');
    expect(JSON.stringify(res.body)).not.toContain(s.user.phone);
    expect(res.body.data.contactAvailable).toBe(true);
  });

  it('reports verification from the server row, never the client', async () => {
    const { s } = await actors();
    const l = await makeListing(s.user.id, { verified: true });

    const res = await request(app).get(`${API}/${l.id}`);
    expect(res.body.data.verification).toMatchObject({ listingVerified: true, level: 'VERIFIED' });
  });

  it('404s a soft-deleted listing for everyone but its owner', async () => {
    const { s, b } = await actors();
    const l = await makeListing(s.user.id, { status: 'INACTIVE' });

    expect((await request(app).get(`${API}/${l.id}`)).status).toBe(404);
    expect((await request(app).get(`${API}/${l.id}`).set(b.headers)).status).toBe(404);
    expect((await request(app).get(`${API}/${l.id}`).set(s.headers)).status).toBe(200);
  });

  it('does not count the owner\'s own views', async () => {
    const { s, b } = await actors();
    const l = await makeListing(s.user.id);

    await request(app).get(`${API}/${l.id}`).set(s.headers);
    await request(app).get(`${API}/${l.id}`).set(b.headers);
    // The increment is fire-and-forget; give it a tick to land.
    await new Promise((r) => setTimeout(r, 120));

    const after = await prisma.animalListing.findUnique({ where: { id: l.id }, select: { viewCount: true } });
    expect(after.viewCount).toBe(1);
  });
});

describe('GET /animals/:id/contact — phone reveal', () => {
  it('requires authentication', async () => {
    const { s } = await actors();
    const l = await makeListing(s.user.id);

    expect((await request(app).get(`${API}/${l.id}/contact`)).status).toBe(401);
  });

  it('returns the phone to a signed-in buyer and audits the reveal', async () => {
    const { s, b } = await actors();
    const l = await makeListing(s.user.id);

    const res = await request(app).get(`${API}/${l.id}/contact`).set(b.headers);

    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe(s.user.phone);
    expect(res.body.data.phoneLabel).toMatch(/^\+91 /);

    await new Promise((r) => setTimeout(r, 120));
    const audit = await prisma.auditLog.findFirst({
      where: { action: 'ANIMAL_CONTACT_REVEAL', entityId: l.id },
    });
    expect(audit).toBeTruthy();
    // The number itself must not be in the audit trail.
    expect(JSON.stringify(audit)).not.toContain(s.user.phone);
  });
});

describe('POST /animals — create', () => {
  const validAd = {
    animal: 'Cow', breed: 'Gir', age: '3 years', gender: 'FEMALE',
    weight: '400 kg', price: '65000', sellerLocation: 'Satara, Maharashtra',
  };

  it('requires authentication', async () => {
    expect((await request(app).post(API).field('animal', 'Cow')).status).toBe(401);
  });

  it('creates a listing and derives the normalised columns', async () => {
    const { s } = await actors();

    const res = await request(app).post(API).set(s.headers)
      .field('animal', validAd.animal).field('breed', validAd.breed)
      .field('age', validAd.age).field('gender', validAd.gender)
      .field('weight', validAd.weight).field('price', validAd.price)
      .field('milkYield', '10 Litre/Day')
      .field('sellerLocation', validAd.sellerLocation);

    expect(res.status).toBe(201);
    const row = await prisma.animalListing.findUnique({ where: { id: res.body.data.id } });
    expect(row.ageMonths).toBe(36);
    expect(row.weightKg).toBe(400);
    expect(row.milkYieldLpd).toBe(10);
    expect(row.searchText).toContain('गाय');   // Marathi alias for cow
    expect(row.expiresAt).toBeTruthy();
    expect(row.verified).toBe(false);
  });

  it('ignores a client-supplied verified flag (mass assignment)', async () => {
    const { s } = await actors();

    const res = await request(app).post(API).set(s.headers)
      .field('animal', validAd.animal).field('breed', validAd.breed)
      .field('age', validAd.age).field('gender', validAd.gender)
      .field('weight', validAd.weight).field('price', validAd.price)
      .field('verified', 'true').field('viewCount', '9999');

    const row = await prisma.animalListing.findUnique({ where: { id: res.body.data.id } });
    expect(row.verified).toBe(false);
    expect(row.viewCount).toBe(0);
  });

  it('suppresses an accidental duplicate re-post', async () => {
    const { s } = await actors();
    const post = () => request(app).post(API).set(s.headers)
      .field('animal', validAd.animal).field('breed', validAd.breed)
      .field('age', validAd.age).field('gender', validAd.gender)
      .field('weight', validAd.weight).field('price', validAd.price);

    const first = await post();
    const second = await post();

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.headers['x-duplicate-suppressed']).toBe('true');
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await prisma.animalListing.count({ where: { sellerId: s.user.id } })).toBe(1);
  });

  it('rejects a non-image upload whose bytes are not an image', async () => {
    const { s } = await actors();

    const res = await request(app).post(API).set(s.headers)
      .field('animal', validAd.animal).field('breed', validAd.breed)
      .field('age', validAd.age).field('gender', validAd.gender)
      .field('weight', validAd.weight).field('price', validAd.price)
      // Declared as a JPEG, actually a shell script.
      .attach('images', Buffer.from('#!/bin/sh\nrm -rf /\n'), { filename: 'evil.jpg', contentType: 'image/jpeg' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not a valid photo/i);
  });

  it('validates required fields', async () => {
    const { s } = await actors();
    const res = await request(app).post(API).set(s.headers).field('animal', 'Cow');
    expect(res.status).toBe(400);
  });
});

describe('ownership', () => {
  it('refuses to let a non-owner edit, restatus, renew or delete', async () => {
    const { s, b } = await actors();
    const l = await makeListing(s.user.id);

    expect((await request(app).put(`${API}/${l.id}`).set(b.headers).field('price', '1')).status).toBe(403);
    expect((await request(app).patch(`${API}/${l.id}/status`).set(b.headers).send({ status: 'SOLD' })).status).toBe(403);
    expect((await request(app).post(`${API}/${l.id}/renew`).set(b.headers)).status).toBe(403);
    expect((await request(app).delete(`${API}/${l.id}`).set(b.headers)).status).toBe(403);

    const unchanged = await prisma.animalListing.findUnique({ where: { id: l.id } });
    expect(Number(unchanged.price)).toBe(85000);
    expect(unchanged.status).toBe('ACTIVE');
  });

  it('lets the owner mark a listing sold in one call', async () => {
    const { s } = await actors();
    const l = await makeListing(s.user.id);

    const res = await request(app).patch(`${API}/${l.id}/status`).set(s.headers).send({ status: 'SOLD' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SOLD');
    // …and it leaves the public feed.
    expect((await request(app).get(API)).body.data).toHaveLength(0);
  });

  it('rejects an invalid status value', async () => {
    const { s } = await actors();
    const l = await makeListing(s.user.id);
    const res = await request(app).patch(`${API}/${l.id}/status`).set(s.headers).send({ status: 'DELETED' });
    expect(res.status).toBe(400);
  });

  it('recomputes the derived columns when the display strings are edited', async () => {
    const { s } = await actors();
    const l = await makeListing(s.user.id, { age: '4 years', ageMonths: 48 });

    await request(app).put(`${API}/${l.id}`).set(s.headers).field('age', '18 months');

    const row = await prisma.animalListing.findUnique({ where: { id: l.id } });
    expect(row.ageMonths).toBe(18);
  });
});

describe('report & block', () => {
  it('records one report per reporter, however many times they tap', async () => {
    const { s, b } = await actors();
    const l = await makeListing(s.user.id);

    await request(app).post(`${API}/${l.id}/report`).set(b.headers).send({ reason: 'ALREADY_SOLD' });
    const second = await request(app).post(`${API}/${l.id}/report`).set(b.headers).send({ reason: 'FRAUD' });

    expect(second.status).toBe(201);
    const reports = await prisma.listingReport.findMany({ where: { listingId: l.id } });
    expect(reports).toHaveLength(1);
    expect(reports[0].reason).toBe('FRAUD');
  });

  it('will not let a seller report their own listing', async () => {
    const { s } = await actors();
    const l = await makeListing(s.user.id);
    const res = await request(app).post(`${API}/${l.id}/report`).set(s.headers).send({ reason: 'SPAM' });
    expect(res.status).toBe(400);
  });

  it('hides a blocked seller\'s listings and closes the chat door', async () => {
    const { s, b } = await actors();
    const l = await makeListing(s.user.id);

    await request(app).post(`${API}/sellers/${s.user.id}/block`).set(b.headers).send({});

    expect((await request(app).get(API).set(b.headers)).body.data).toHaveLength(0);
    expect((await request(app).get(`${API}/${l.id}`).set(b.headers)).status).toBe(404);
    expect((await request(app).get(`${API}/${l.id}/contact`).set(b.headers)).status).toBe(403);
    expect((await request(app).post(`${API}/${l.id}/chat`).set(b.headers)).status).toBe(403);

    // Everyone else still sees it.
    expect((await request(app).get(API)).body.data).toHaveLength(1);

    // …and unblocking restores it.
    await request(app).delete(`${API}/sellers/${s.user.id}/block`).set(b.headers);
    expect((await request(app).get(API).set(b.headers)).body.data).toHaveLength(1);
  });
});

describe('chat', () => {
  async function openChat() {
    const { s, b } = await actors();
    const l = await makeListing(s.user.id);
    const res = await request(app).post(`${API}/${l.id}/chat`).set(b.headers);
    return { s, b, l, chatId: res.body.data.id };
  }

  it('opens one chat per (listing, buyer), idempotently', async () => {
    const { s, b, l, chatId } = await openChat();
    const again = await request(app).post(`${API}/${l.id}/chat`).set(b.headers);
    expect(again.body.data.id).toBe(chatId);
    expect(await prisma.chat.count({ where: { listingId: l.id } })).toBe(1);
    expect(s).toBeTruthy();
  });

  it('rejects a non-participant reading the history', async () => {
    const { chatId } = await openChat();
    const { user: nosy, headers } = await createTestUser({ name: 'Nosy' });
    expect(nosy).toBeTruthy();

    const res = await request(app).get(`${API}/chats/${chatId}/messages`).set(headers);
    expect(res.status).toBe(403);
  });

  it('deduplicates a retried send via clientMsgId', async () => {
    const { b, chatId } = await openChat();
    const body = { text: 'Is she still available?', clientMsgId: 'cmid-abc-123' };

    const first = await request(app).post(`${API}/chats/${chatId}/messages`).set(b.headers).send(body);
    const retry = await request(app).post(`${API}/chats/${chatId}/messages`).set(b.headers).send(body);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replay']).toBe('true');
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await prisma.chatMessage.count({ where: { chatId } })).toBe(1);
  });

  it('pages history newest-first with a cursor', async () => {
    const { b, chatId } = await openChat();
    for (let i = 0; i < 5; i++) {
      await request(app).post(`${API}/chats/${chatId}/messages`).set(b.headers)
        .send({ text: `msg ${i}`, clientMsgId: `c${i}` });
    }

    const p1 = await request(app).get(`${API}/chats/${chatId}/messages`).set(b.headers).query({ limit: 2 });
    expect(p1.body.data.map((m) => m.text)).toEqual(['msg 3', 'msg 4']); // ascending within the page
    expect(p1.body.meta.hasMore).toBe(true);

    const p2 = await request(app).get(`${API}/chats/${chatId}/messages`).set(b.headers)
      .query({ limit: 2, before: p1.body.meta.nextCursor });
    expect(p2.body.data.map((m) => m.text)).toEqual(['msg 1', 'msg 2']);
  });

  it('still honours the legacy ?page= shape', async () => {
    const { b, chatId } = await openChat();
    await request(app).post(`${API}/chats/${chatId}/messages`).set(b.headers).send({ text: 'hello' });

    const res = await request(app).get(`${API}/chats/${chatId}/messages`).set(b.headers).query({ page: 1, limit: 50 });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('does not put chat partners\' phone numbers in the inbox', async () => {
    const { s, b, chatId } = await openChat();
    await request(app).post(`${API}/chats/${chatId}/messages`).set(b.headers).send({ text: 'hi' });

    const res = await request(app).get(`${API}/chats/my`).set(b.headers);

    expect(res.status).toBe(200);
    expect(res.body.data[0].counterpart.phone).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain(s.user.phone);
  });

  // The inbox used to build these two fields with Prisma includes that did not
  // compile to bounded SQL: `messages: { take: 1 }` emitted no LIMIT and sliced
  // in JavaScript, and the unread `_count` aggregated the WHOLE chat_messages
  // table before joining. Both were rewritten; these pin the behaviour so a
  // future include cannot quietly reintroduce either.
  it('reports the newest message per chat, not the oldest or an arbitrary one', async () => {
    const { b, chatId } = await openChat();
    for (const text of ['first', 'second', 'third']) {
      await request(app).post(`${API}/chats/${chatId}/messages`).set(b.headers).send({ text });
    }

    const res = await request(app).get(`${API}/chats/my`).set(b.headers);
    expect(res.status).toBe(200);
    const row = res.body.data.find((r) => r.id === chatId);
    expect(row.lastMessage.text).toBe('third');
    expect(row.lastMessage.mine).toBe(true);
  });

  it('counts only the OTHER side\'s unread messages, and only for this chat', async () => {
    const { s, b, chatId } = await openChat();
    // A second, unrelated chat whose unread messages must not leak into the
    // first one's count — the old aggregate grouped the entire table.
    const { b: other, chatId: otherChat } = await openChat();
    await request(app).post(`${API}/chats/${otherChat}/messages`).set(other.headers).send({ text: 'elsewhere' });

    await request(app).post(`${API}/chats/${chatId}/messages`).set(s.headers).send({ text: 'from seller 1' });
    await request(app).post(`${API}/chats/${chatId}/messages`).set(s.headers).send({ text: 'from seller 2' });
    await request(app).post(`${API}/chats/${chatId}/messages`).set(b.headers).send({ text: 'from me' });

    const res = await request(app).get(`${API}/chats/my`).set(b.headers);
    const row = res.body.data.find((r) => r.id === chatId);
    // Two from the seller; the buyer's own message never counts as unread.
    expect(row.unreadCount).toBe(2);
  });

  it('reports zero unread and no last message for a chat with none', async () => {
    const { b, chatId } = await openChat();
    const res = await request(app).get(`${API}/chats/my`).set(b.headers);
    const row = res.body.data.find((r) => r.id === chatId);
    expect(row.unreadCount).toBe(0);
    expect(row.lastMessage).toBeNull();
  });

  it('sanitises HTML out of a message', async () => {
    const { b, chatId } = await openChat();
    const res = await request(app).post(`${API}/chats/${chatId}/messages`).set(b.headers)
      .send({ text: '<script>alert(1)</script>hello' });

    expect(res.body.data.text).not.toContain('<script>');
    expect(res.body.data.text).toContain('hello');
  });
});

describe('GET /animals/meta', () => {
  it('serves the animal-type and breed master data', async () => {
    const res = await request(app).get(`${API}/meta`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.types)).toBe(true);
    const cow = res.body.data.types.find((t) => t.key === 'Cow');
    expect(cow.breeds).toContain('Gir');
    // Milk yield is only asked for animals that produce milk.
    expect(cow.fields).toContain('milkYield');
    expect(res.body.data.types.find((t) => t.key === 'Bullock').fields).not.toContain('milkYield');
  });
});
