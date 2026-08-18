/**
 * The saved-address book — the data checkout actually delivers against.
 *
 * Until this pass the Account tab's "Saved Addresses" row opened the profile
 * location editor, so this API had no management surface at all: a farmer could
 * create an address during checkout and then never edit or delete it. These
 * tests cover the two invariants that make the new screen safe to ship.
 *
 *   1. ISOLATION — one farmer can never read, edit or delete another's address.
 *      A delivery address is a home location; a leak here is a physical-safety
 *      problem, not a privacy footnote.
 *   2. EXACTLY ONE DEFAULT — checkout preselects the default. Zero defaults
 *      means an empty checkout for someone who has addresses saved; two means
 *      an arbitrary pick. Both are reachable through create and delete, so both
 *      are tested through those paths.
 */
import request from 'supertest';
import { getApp, createTestUser, cleanupTestData, prisma } from '../../fixtures/setup.js';

const API = '/api/v1/addresses';

let app; let alice; let bob;

const addr = (over = {}) => ({
  type: 'HOME', name: 'Test Farmer', phone: '9876543210',
  flat: '1A', street: 'Main Road', city: 'Pune', state: 'Maharashtra',
  pincode: '411001', ...over,
});

const create = (user, body) => request(app).post(API).set(user.headers).send(addr(body));
const list   = (user) => request(app).get(API).set(user.headers);

const defaultsOf = async (userId) =>
  prisma.savedAddress.count({ where: { userId, isDefault: true } });

beforeAll(async () => {
  app   = await getApp();
  alice = await createTestUser();
  bob   = await createTestUser();
});

afterAll(async () => { await cleanupTestData(); });

beforeEach(async () => {
  await prisma.savedAddress.deleteMany({
    where: { userId: { in: [alice.user.id, bob.user.id] } },
  });
});

describe('isolation between accounts', () => {
  test("a farmer's list contains only their own addresses", async () => {
    await create(alice, { name: 'Alice Farm' });
    await create(bob,   { name: 'Bob Farm' });

    const res = await list(alice);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('Alice Farm');
  });

  test("another farmer's address cannot be edited", async () => {
    const mine = await create(alice, { name: 'Alice Farm' });
    const res = await request(app)
      .put(`${API}/${mine.body.data.id}`).set(bob.headers).send({ city: 'Nagpur' });

    expect(res.status).toBe(404);   // not 403 — Bob is not told it exists
    const after = await prisma.savedAddress.findUnique({ where: { id: mine.body.data.id } });
    expect(after.city).toBe('Pune');
  });

  test("another farmer's address cannot be deleted", async () => {
    const mine = await create(alice, { name: 'Alice Farm' });
    const res = await request(app).delete(`${API}/${mine.body.data.id}`).set(bob.headers);

    expect(res.status).toBe(404);
    expect(await prisma.savedAddress.count({ where: { id: mine.body.data.id } })).toBe(1);
  });

  test("another farmer's address cannot be made default", async () => {
    const mine = await create(alice, { name: 'Alice Farm' });
    const res = await request(app)
      .patch(`${API}/${mine.body.data.id}/default`).set(bob.headers);
    expect(res.status).toBe(404);
  });
});

describe('exactly one default', () => {
  test('creating a second default demotes the first', async () => {
    await create(alice, { name: 'First',  isDefault: true });
    await create(alice, { name: 'Second', isDefault: true });

    expect(await defaultsOf(alice.user.id)).toBe(1);
    const rows = await prisma.savedAddress.findMany({
      where: { userId: alice.user.id, isDefault: true },
    });
    expect(rows[0].name).toBe('Second');
  });

  test('deleting the default promotes another, never leaving zero', async () => {
    await create(alice, { name: 'Keeper' });
    const def = await create(alice, { name: 'Default', isDefault: true });

    const res = await request(app).delete(`${API}/${def.body.data.id}`).set(alice.headers);
    expect(res.status).toBe(200);

    // The whole point: checkout must still have something preselected.
    expect(await defaultsOf(alice.user.id)).toBe(1);
    const rows = await prisma.savedAddress.findMany({ where: { userId: alice.user.id } });
    expect(rows[0].name).toBe('Keeper');
    expect(rows[0].isDefault).toBe(true);
  });

  test('deleting the only address leaves none, not an orphaned default', async () => {
    const only = await create(alice, { name: 'Only', isDefault: true });
    await request(app).delete(`${API}/${only.body.data.id}`).set(alice.headers);

    expect(await prisma.savedAddress.count({ where: { userId: alice.user.id } })).toBe(0);
  });

  test('deleting a NON-default leaves the existing default alone', async () => {
    const def   = await create(alice, { name: 'Default', isDefault: true });
    const other = await create(alice, { name: 'Other' });

    await request(app).delete(`${API}/${other.body.data.id}`).set(alice.headers);

    const rows = await prisma.savedAddress.findMany({ where: { userId: alice.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(def.body.data.id);
    expect(rows[0].isDefault).toBe(true);
  });
});

describe('input the server refuses', () => {
  test('a malformed PIN code is rejected', async () => {
    const res = await create(alice, { pincode: '41A10' });
    expect(res.status).toBe(400);
  });

  test('a non-Indian-mobile phone is rejected', async () => {
    const res = await create(alice, { phone: '1234567890' });
    expect(res.status).toBe(400);
  });

  test('a non-UUID id is rejected before it reaches the database', async () => {
    const res = await request(app).delete(`${API}/not-a-uuid`).set(alice.headers);
    expect(res.status).toBe(400);
  });

  test('unauthenticated requests are refused', async () => {
    expect((await request(app).get(API)).status).toBe(401);
  });
});
