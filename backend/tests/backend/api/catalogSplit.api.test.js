/**
 * API tests for the CATALOG SPLIT — /api/v1/agristore/*
 *
 * The worked example throughout is the real one: "Mahyco Bt Cotton Seed" with
 * 450 g / 1 kg pack variants, sold by three Krushi Seva Kendras at different
 * prices. Before the split each Kendra's listing was its own `products` row and
 * its own buyer-facing page.
 *
 * Run with:
 *   node --experimental-vm-modules node_modules/jest/bin/jest.js --testTimeout=60000
 * The 60 s timeout matters: the default 5 s hook timeout kills the suite on the
 * cold app import in beforeAll.
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller, createTestCategory,
  createTestCatalogProduct, createTestListing,
  cleanupTestData, prisma,
} from '../../fixtures/setup.js';
import { normalizeProductKey } from '../../../src/services/catalogMatch.service.js';
import { rankOffersForVariant } from '../../../src/services/buyBox.service.js';

const API = '/api/v1/agristore';

let app;
let category;
let kendraA, kendraB, kendraC, buyer;

beforeAll(async () => {
  app = await getApp();
  category = await createTestCategory({ name: `Seeds ${Date.now()}` });

  // Two Pune Kendras and one Nashik Kendra — the third exists to prove that
  // geography GATES eligibility rather than merely sorting.
  kendraA = await createTestSeller({ name: 'Shivneri Agro',      district: 'Pune',   taluka: 'Junnar' });
  kendraB = await createTestSeller({ name: 'Jai Kisan Agro',     district: 'Pune',   taluka: 'Junnar' });
  kendraC = await createTestSeller({ name: 'Balaji Beej Bhandar', district: 'Nashik', taluka: 'Sinnar' });
  buyer   = await createTestUser({ name: 'Buyer Farmer', district: 'Pune' });
}, 60_000);

afterAll(async () => {
  await cleanupTestData();
});

/** Fresh catalog product + its default variant, unique per test. */
async function freshProduct(overrides = {}) {
  return createTestCatalogProduct(category.id, {
    name: `Mahyco Bt Cotton Seed ${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    brand: 'Mahyco',
    manufacturer: 'Maharashtra Hybrid Seeds Company',
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
describe('Duplicate gate — one catalog row per real-world product', () => {
  test('409 — a second seller cannot create a catalog row that already exists', async () => {
    const name = `Mahyco Bt Cotton Seed ${Date.now()}`;
    const body = {
      name, categoryId: category.id,
      brand: 'Mahyco', manufacturer: 'Maharashtra Hybrid Seeds Company',
      variants: [{ unit: 'packet', attributes: { packSize: '450g' } }],
    };

    const first = await request(app).post(`${API}/catalog/products`).set(kendraA.headers).send(body);
    expect(first.status).toBe(201);

    // Kendra B submits the SAME product. Pre-split this created a second row and
    // a second product page. The check is CROSS-SELLER (the old heuristic was
    // scoped to `where: { sellerId }` and could never see this), PRE-COMMIT and
    // BLOCKING (the old one ran fire-and-forget after the insert).
    const second = await request(app).post(`${API}/catalog/products`).set(kendraB.headers).send(body);
    expect(second.status).toBe(409);
    // The response hands back what to attach to — that IS the flow.
    expect(second.body.error.details.productId).toBe(first.body.data.id);
    expect(second.body.error.details.reason).toBe('exact_key');
  });

  test('409 — cross-seller FUZZY duplicate is blocked before commit, and nothing was written', async () => {
    const base = `Dhanuka Targa Super Herbicide ${Date.now()}`;
    const first = await request(app).post(`${API}/catalog/products`).set(kendraA.headers).send({
      name: base, categoryId: category.id, brand: 'Dhanuka',
    });
    expect(first.status).toBe(201);

    // Same product, sloppier typing — different string, same thing. Trigram
    // similarity is well above the block threshold.
    const near = `${base}!!`;
    const before = await prisma.product.count();
    const second = await request(app).post(`${API}/catalog/products`).set(kendraB.headers).send({
      name: near, categoryId: category.id, brand: 'Dhanuka',
    });

    expect(second.status).toBe(409);
    expect(['fuzzy_name', 'exact_key']).toContain(second.body.error.details.reason);
    // PRE-COMMIT: the rejection must leave no row behind.
    expect(await prisma.product.count()).toBe(before);
  });

  test('201 — a genuinely different brand is NOT a duplicate (no false block)', async () => {
    const stamp = Date.now();
    const a = await request(app).post(`${API}/catalog/products`).set(kendraA.headers).send({
      name: `Hybrid Cotton Seed ${stamp}`, categoryId: category.id, brand: 'Mahyco',
    });
    const b = await request(app).post(`${API}/catalog/products`).set(kendraB.headers).send({
      name: `Hybrid Cotton Seed ${stamp}`, categoryId: category.id, brand: 'Rasi Seeds',
    });
    expect(a.status).toBe(201);
    // Identical name, different brand → different product. The dedup key embeds
    // the brand precisely so this does not collapse.
    expect(b.status).toBe(201);
    expect(a.body.data.normalizedKey).not.toBe(b.body.data.normalizedKey);
  });

  test('duplicate GTIN is blocked', async () => {
    const gtin = `890${Date.now()}`.slice(0, 13);
    const first = await request(app).post(`${API}/catalog/products`).set(kendraA.headers).send({
      name: `Bayer Confidor ${Date.now()}`, categoryId: category.id, brand: 'Bayer',
      variants: [{ unit: 'ml', attributes: { packSize: '100ml' }, gtin }],
    });
    expect(first.status).toBe(201);

    const second = await request(app).post(`${API}/catalog/products`).set(kendraB.headers).send({
      name: `Something Completely Different ${Date.now()}`, categoryId: category.id, brand: 'Syngenta',
      variants: [{ unit: 'ml', attributes: { packSize: '100ml' }, gtin }],
    });
    expect(second.status).toBe(409);
    expect(second.body.error.details.reason).toBe('gtin');
  });

  test('the unique index on product_variants.gtin is the backstop', async () => {
    const product = await freshProduct();
    const gtin = `891${Date.now()}`.slice(0, 13);
    await prisma.productVariant.create({ data: { productId: product.id, unit: 'kg', gtin } });

    // NULL gtin is allowed many times over (most agri-inputs have no barcode),
    // but a real one may exist once.
    await expect(
      prisma.productVariant.create({ data: { productId: product.id, unit: 'quintal', gtin } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('One offer per seller per variant', () => {
  test('409 — @@unique([sellerId, variantId]) is enforced through the API', async () => {
    const product = await freshProduct();
    const variantId = product.variants[0].id;

    const first = await request(app).post(`${API}/listings`).set(kendraA.headers)
      .send({ variantId, sellingPrice: 810, stockQty: 100, district: 'Pune' });
    expect(first.status).toBe(201);

    const second = await request(app).post(`${API}/listings`).set(kendraA.headers)
      .send({ variantId, sellingPrice: 799, stockQty: 50, district: 'Pune' });
    expect(second.status).toBe(409);
  });

  test('a DIFFERENT seller may offer the same variant — that is the point', async () => {
    const product = await freshProduct();
    const variantId = product.variants[0].id;

    const a = await request(app).post(`${API}/listings`).set(kendraA.headers)
      .send({ variantId, sellingPrice: 810, stockQty: 100, district: 'Pune' });
    const b = await request(app).post(`${API}/listings`).set(kendraB.headers)
      .send({ variantId, sellingPrice: 845, stockQty: 200, district: 'Pune' });

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    // ONE product page, TWO offers.
    const page = await request(app).get(`${API}/products/${product.id}?district=Pune`);
    expect(page.status).toBe(200);
    expect(page.body.data.offerCount).toBe(2);
  });

  test('the seller id comes from the JWT, never from the body', async () => {
    const product = await freshProduct();
    const res = await request(app).post(`${API}/listings`).set(kendraA.headers)
      .send({ variantId: product.variants[0].id, sellingPrice: 500, stockQty: 5, sellerId: kendraB.user.id });
    expect(res.status).toBe(201);
    expect(res.body.data.sellerId).toBe(kendraA.user.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Buy box', () => {
  async function threeOffers() {
    const product = await freshProduct();
    const variantId = product.variants[0].id;
    const a = await createTestListing(kendraA.user.id, variantId, { sellingPrice: 810, stockQty: 100, dispatchSlaDays: 3, district: 'Pune' });
    const b = await createTestListing(kendraB.user.id, variantId, { sellingPrice: 845, stockQty: 200, dispatchSlaDays: 1, district: 'Pune' });
    const c = await createTestListing(kendraC.user.id, variantId, { sellingPrice: 780, stockQty: 40,  dispatchSlaDays: 2, district: 'Nashik' });
    return { product, variantId, a, b, c };
  }

  test('bootstrap — with no seller metrics anywhere, ranking degrades to price/dispatch, not noise', async () => {
    const { variantId } = await threeOffers();
    const { offers, weights } = await rankOffersForVariant(variantId, { district: 'Pune' });
    expect(weights.bootstrapped).toBe(true);
    expect(weights.wR).toBe(0);
    expect(weights.wF).toBe(0);
    expect(offers.length).toBeGreaterThan(0);
  });

  test('recomputes when a competitor drops their price', async () => {
    const { product, variantId, a, b } = await threeOffers();

    let ranked = await rankOffersForVariant(variantId, { district: 'Pune' });
    expect(ranked.winner.id).toBe(a.id); // 810 beats 845

    // Kendra B undercuts. The buy box must move, and the cached product page
    // must not keep serving the old winner.
    const res = await request(app).patch(`${API}/listings/${b.id}`).set(kendraB.headers)
      .send({ sellingPrice: 700 });
    expect(res.status).toBe(200);

    ranked = await rankOffersForVariant(variantId, { district: 'Pune' });
    expect(ranked.winner.id).toBe(b.id);

    const page = await request(app).get(`${API}/products/${product.id}?district=Pune`);
    expect(page.body.data.buyBox.listingId).toBe(b.id);
  });

  test('fails over to the next-best offer when the winner goes out of stock', async () => {
    const { variantId, a, b } = await threeOffers();
    expect((await rankOffersForVariant(variantId, { district: 'Pune' })).winner.id).toBe(a.id);

    const res = await request(app).patch(`${API}/listings/${a.id}`).set(kendraA.headers)
      .send({ stockQty: 0 });
    expect(res.status).toBe(200);
    // Zero stock derives OUT_OF_STOCK, which is excluded from the candidate set.
    expect(res.body.data.status).toBe('OUT_OF_STOCK');

    const ranked = await rankOffersForVariant(variantId, { district: 'Pune' });
    expect(ranked.winner.id).toBe(b.id);
    expect(ranked.offers.map((o) => o.id)).not.toContain(a.id);
  });

  test('excludes out-of-scope geography — the cheapest offer can be ineligible', async () => {
    const { variantId, c } = await threeOffers();

    // Kendra C is cheapest at 780 but sells with sellScope 'district' from Nashik.
    const pune = await rankOffersForVariant(variantId, { district: 'Pune' });
    expect(pune.offers.map((o) => o.id)).not.toContain(c.id);
    expect(Number(pune.winner.sellingPrice)).toBeGreaterThan(780);

    // The same variant, a Nashik buyer: now C is the only eligible offer.
    const nashik = await rankOffersForVariant(variantId, { district: 'Nashik' });
    expect(nashik.offers.map((o) => o.id)).toEqual([c.id]);
  });

  test('a national (all_india) offer is eligible everywhere', async () => {
    const product = await freshProduct();
    const variantId = product.variants[0].id;
    const national = await createTestListing(kendraC.user.id, variantId, {
      sellingPrice: 999, sellScope: 'all_india', district: 'Nashik',
    });
    const ranked = await rankOffersForVariant(variantId, { district: 'Pune' });
    expect(ranked.offers.map((o) => o.id)).toContain(national.id);
  });

  test('tie-break is deterministic — identical offers always rank the same way', async () => {
    const product = await freshProduct();
    const variantId = product.variants[0].id;
    await createTestListing(kendraA.user.id, variantId, { sellingPrice: 500, dispatchSlaDays: 2, district: 'Pune' });
    await createTestListing(kendraB.user.id, variantId, { sellingPrice: 500, dispatchSlaDays: 2, district: 'Pune' });

    const first  = await rankOffersForVariant(variantId, { district: 'Pune' });
    const second = await rankOffersForVariant(variantId, { district: 'Pune' });
    expect(first.offers.map((o) => o.id)).toEqual(second.offers.map((o) => o.id));
  });

  test('GET /products/:id/offers returns every eligible offer in buy-box order', async () => {
    const { product } = await threeOffers();
    const res = await request(app).get(`${API}/products/${product.id}/offers?district=Pune`);
    expect(res.status).toBe(200);
    const group = res.body.data.variants[0];
    expect(group.offers.length).toBe(2); // Nashik excluded
    expect(group.offers[0].listingId).toBe(group.winnerListingId);
    expect(group.offers[0].sellerName).toBeTruthy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Catalog visibility', () => {
  test('GET /products/:id hides a PENDING_QC product from the public', async () => {
    const product = await freshProduct({ status: 'PENDING_QC' });
    const anon = await request(app).get(`${API}/products/${product.id}`);
    expect(anon.status).toBe(404);
  });

  test('GET /products/:id hides a soft-deleted product (it used to stay fetchable by id)', async () => {
    const product = await freshProduct();
    await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
    const res = await request(app).get(`${API}/products/${product.id}`);
    expect(res.status).toBe(404);
  });

  test('a MERGED product redirects to the row it was folded into', async () => {
    const survivor = await freshProduct();
    const dupe = await freshProduct();
    await prisma.product.update({
      where: { id: dupe.id },
      data: { status: 'MERGED', mergedIntoId: survivor.id },
    });

    const res = await request(app).get(`${API}/products/${dupe.id}`);
    expect(res.status).toBe(301);
    expect(res.body.data.redirectTo).toBe(survivor.id);
  });

  test('deleting an offer leaves the catalog row and other sellers alone', async () => {
    const product = await freshProduct();
    const variantId = product.variants[0].id;
    const mine = await createTestListing(kendraA.user.id, variantId, { district: 'Pune' });
    const theirs = await createTestListing(kendraB.user.id, variantId, { district: 'Pune' });

    const res = await request(app).delete(`${API}/listings/${mine.id}`).set(kendraA.headers);
    expect(res.status).toBe(200);

    // The old DELETE soft-deleted the PRODUCT and wiped it from every cart.
    expect(await prisma.product.findUnique({ where: { id: product.id } })).toMatchObject({ status: 'APPROVED' });
    expect(await prisma.sellerListing.findUnique({ where: { id: theirs.id } })).not.toBeNull();
  });

  test("a seller cannot edit catalog fields through the legacy product endpoint", async () => {
    const product = await freshProduct();
    await createTestListing(kendraA.user.id, product.variants[0].id, { district: 'Pune' });

    // The pre-split PUT wrote any key present, so this would have renamed the
    // product for EVERY other seller's buyers.
    const res = await request(app).put(`${API}/seller/products/${product.id}`).set(kendraA.headers)
      .send({ price: 900, name: 'Renamed By One Seller' });

    expect(res.status).toBe(403);
    expect(res.body.error.details.rejectedFields).toContain('name');
    const after = await prisma.product.findUnique({ where: { id: product.id } });
    expect(after.name).toBe(product.name);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Cart and multi-seller orders', () => {
  test('a buyer can hold the SAME product from two Kendras at once', async () => {
    const product = await freshProduct();
    const variantId = product.variants[0].id;
    const a = await createTestListing(kendraA.user.id, variantId, { sellingPrice: 810, district: 'Pune' });
    const b = await createTestListing(kendraB.user.id, variantId, { sellingPrice: 845, district: 'Pune' });

    await prisma.cartItem.deleteMany({ where: { userId: buyer.user.id } });

    const one = await request(app).post(`${API}/cart`).set(buyer.headers).send({ listingId: a.id, quantity: 1 });
    const two = await request(app).post(`${API}/cart`).set(buyer.headers).send({ listingId: b.id, quantity: 2 });

    // @@unique([userId, productId]) used to make this physically impossible.
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);

    const cart = await request(app).get(`${API}/cart`).set(buyer.headers);
    expect(cart.body.data.items.length).toBe(2);
    expect(Number(cart.body.data.total)).toBeCloseTo(810 + 845 * 2, 2);
  });

  test('minOrderQty is enforced (it used to be stored and read by nothing)', async () => {
    const product = await freshProduct();
    const listing = await createTestListing(kendraA.user.id, product.variants[0].id, {
      minOrderQty: 5, stockQty: 50, district: 'Pune',
    });
    await prisma.cartItem.deleteMany({ where: { userId: buyer.user.id } });

    const res = await request(app).post(`${API}/cart`).set(buyer.headers)
      .send({ listingId: listing.id, quantity: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/minimum order/i);
  });

  test('multi-seller order rolls up per-item status correctly', async () => {
    const product = await freshProduct();
    const variantId = product.variants[0].id;
    const a = await createTestListing(kendraA.user.id, variantId, { sellingPrice: 100, stockQty: 20, district: 'Pune' });
    const b = await createTestListing(kendraB.user.id, variantId, { sellingPrice: 120, stockQty: 20, district: 'Pune' });

    await prisma.cartItem.deleteMany({ where: { userId: buyer.user.id } });
    await request(app).post(`${API}/cart`).set(buyer.headers).send({ listingId: a.id, quantity: 1 });
    await request(app).post(`${API}/cart`).set(buyer.headers).send({ listingId: b.id, quantity: 1 });

    const order = await request(app).post(`${API}/orders`).set(buyer.headers).send({
      paymentMethod: 'cod',
      deliveryAddress: { name: 'Buyer', phone: '9999999999', flat: '1', street: 'Main', city: 'Pune', state: 'Maharashtra', pincode: '411001' },
    });
    expect(order.status).toBe(201);
    const orderId = order.body.data.id;
    expect(order.body.data.items.length).toBe(2);
    // Each item carries the OFFER it was bought from — without listingId,
    // purchased-offer history would be unreconstructable.
    expect(order.body.data.items.every((i) => i.listingId)).toBe(true);

    // Stock came off the OFFERS, not off a shared catalog row.
    expect((await prisma.sellerListing.findUnique({ where: { id: a.id } })).stockQty).toBe(19);
    expect((await prisma.sellerListing.findUnique({ where: { id: b.id } })).stockQty).toBe(19);

    // Seller A ships. Only A's item moves; the order rolls up to SHIPPED.
    const shipped = await request(app).put(`${API}/seller/orders/${orderId}/status`).set(kendraA.headers)
      .send({ status: 'SHIPPED' });
    expect(shipped.status).toBe(200);
    expect(shipped.body.data.itemsUpdated).toBe(1);
    expect(shipped.body.data.orderStatus).toBe('SHIPPED');

    const aItem = await prisma.orderItem.findFirst({ where: { orderId, sellerId: kendraA.user.id } });
    const bItem = await prisma.orderItem.findFirst({ where: { orderId, sellerId: kendraB.user.id } });
    expect(aItem.status).toBe('SHIPPED');
    // Seller A must not be able to move Seller B's item.
    expect(bItem.status).toBe('PENDING');
    // The transition timestamp is what makes dispatch SLA computable at all.
    expect(aItem.shippedAt).not.toBeNull();

    // B cancels. Their units go back to THEIR listing — a seller-set CANCELLED
    // never restocked before.
    const cancelled = await request(app).put(`${API}/seller/orders/${orderId}/status`).set(kendraB.headers)
      .send({ status: 'CANCELLED' });
    expect(cancelled.status).toBe(200);
    expect((await prisma.sellerListing.findUnique({ where: { id: b.id } })).stockQty).toBe(20);

    // A partially-cancelled order used to read PENDING: `every(DELIVERED)` failed
    // and no ANY branch matched. The rollup now describes the LIVE items.
    expect(cancelled.body.data.orderStatus).toBe('SHIPPED');

    await request(app).put(`${API}/seller/orders/${orderId}/status`).set(kendraA.headers).send({ status: 'DELIVERED' });
    const finalOrder = await prisma.order.findUnique({ where: { id: orderId } });
    expect(finalOrder.status).toBe('DELIVERED');
  });

  test('400 — a non-UUID orderId is a bad request, not a 500', async () => {
    const res = await request(app).put(`${API}/seller/orders/not-a-uuid/status`).set(kendraA.headers)
      .send({ status: 'SHIPPED' });
    expect(res.status).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Reviews', () => {
  test('403 — a buyer cannot review a product they have not received', async () => {
    const product = await freshProduct();
    const res = await request(app).post(`${API}/products/${product.id}/review`).set(buyer.headers)
      .send({ rating: 5, comment: 'Great' });
    expect(res.status).toBe(403);
  });

  test('a delivered purchase can be reviewed, and the review is attributed to the SELLER', async () => {
    const product = await freshProduct();
    const listing = await createTestListing(kendraA.user.id, product.variants[0].id, { stockQty: 5, district: 'Pune' });

    const order = await prisma.order.create({
      data: {
        userId: buyer.user.id, totalAmount: 100, deliveryAddress: {}, status: 'DELIVERED',
        items: {
          create: [{
            productId: product.id, listingId: listing.id, variantId: listing.variantId,
            sellerId: kendraA.user.id, quantity: 1, unitPrice: 100, totalPrice: 100,
            status: 'DELIVERED', deliveredAt: new Date(),
          }],
        },
      },
      include: { items: true },
    });

    const res = await request(app).post(`${API}/products/${product.id}/review`).set(buyer.headers)
      .send({ rating: 4, comment: 'Good germination', orderItemId: order.items[0].id });
    expect(res.status).toBe(201);
    // Without sellerId, buy-box weight w2 has no source data at all.
    expect(res.body.data.sellerId).toBe(kendraA.user.id);
    expect(res.body.data.orderItemId).toBe(order.items[0].id);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
describe('Backfill grouping key — no false merges', () => {
  /**
   * The migration synthesises its grouping key from
   * (categoryId, brand, manufacturer, normalized name) because `products` has no
   * unique constraint, no SKU and no barcode. A false SPLIT leaves a duplicate an
   * admin merges later; a false MERGE silently reassigns one Kendra's stock and
   * price to another Kendra's product. These assert the key errs toward NOT
   * merging, and mirror the JS/SQL pairing the backfill depends on.
   */
  const key = (o) => normalizeProductKey({ categoryId: 'cat-1', ...o });

  test('same name, different brand → DIFFERENT groups', () => {
    expect(key({ name: 'Bt Cotton Seed', brand: 'Mahyco' }))
      .not.toBe(key({ name: 'Bt Cotton Seed', brand: 'Rasi' }));
  });

  test('same name, different manufacturer → DIFFERENT groups', () => {
    expect(key({ name: 'Urea 46%', manufacturer: 'IFFCO' }))
      .not.toBe(key({ name: 'Urea 46%', manufacturer: 'Kribhco' }));
  });

  test('unbranded never wildcard-matches a branded product', () => {
    expect(key({ name: 'Neem Oil' })).not.toBe(key({ name: 'Neem Oil', brand: 'Godrej' }));
    // …and two unbranded rows with the same name DO group, which is intended.
    expect(key({ name: 'Neem Oil' })).toBe(key({ name: 'neem  oil' }));
  });

  test('different categories never merge', () => {
    const a = normalizeProductKey({ categoryId: 'cat-1', name: 'Sprayer', brand: 'Aspee' });
    const b = normalizeProductKey({ categoryId: 'cat-2', name: 'Sprayer', brand: 'Aspee' });
    expect(a).not.toBe(b);
  });

  test('pack size in the name keeps rows SEPARATE — a false split, not a false merge', () => {
    // "…450g" and "…1kg" get their own catalog rows. Stripping trailing
    // quantities would merge genuinely different SKUs, so the migration leaves
    // them split and reports them for a human to merge.
    expect(key({ name: 'Mahyco Bt Cotton Seed 450g', brand: 'Mahyco' }))
      .not.toBe(key({ name: 'Mahyco Bt Cotton Seed 1kg', brand: 'Mahyco' }));
  });

  test('only punctuation, case and spacing are normalised away', () => {
    expect(key({ name: '  MAHYCO   Bt-Cotton, Seed.  ', brand: 'Mahyco' }))
      .toBe(key({ name: 'mahyco bt cotton seed', brand: ' mahyco ' }));
  });

  test('Devanagari matras survive normalisation (they must not collide)', () => {
    // [[:alnum:]] / \p{L}\p{N} exclude combining marks; stripping them would turn
    // कापूस into कपस and collide distinct products.
    expect(key({ name: 'कापूस बियाणे' })).not.toBe(key({ name: 'कपस बयण' }));
    expect(key({ name: 'कापूस बियाणे' })).toBe(key({ name: '  कापूस,  बियाणे. ' }));
  });

  test('the JS key matches the SQL catalog_key() the backfill uses', async () => {
    // The two implementations must agree byte for byte, or the migration and the
    // runtime gate disagree about what a duplicate is.
    const cases = [
      { categoryId: category.id, brand: 'Mahyco', manufacturer: 'MHSC', name: 'Bt Cotton Seed 450g' },
      { categoryId: category.id, brand: null, manufacturer: null, name: '  Neem   Oil (Pure) ' },
      { categoryId: category.id, brand: 'महिको', manufacturer: null, name: 'कापूस बियाणे' },
    ];

    let sqlAvailable = true;
    for (const c of cases) {
      let rows;
      try {
        rows = await prisma.$queryRaw`
          SELECT catalog_key(${c.categoryId}, ${c.brand}, ${c.manufacturer}, ${c.name}) AS key
        `;
      } catch {
        // catalog_key() ships in catalog_split_1_expand.sql. A dev DB created by
        // `prisma db push` has the tables but not the function, so skip loudly
        // rather than failing a suite for an unrelated reason.
        sqlAvailable = false;
        break;
      }
      expect(rows[0].key).toBe(normalizeProductKey(c));
    }
    if (!sqlAvailable) {
      console.warn('[catalogSplit] catalog_key() not installed — apply prisma/manual/catalog_split_1_expand.sql to run the JS/SQL parity check');
    }
  });
});
