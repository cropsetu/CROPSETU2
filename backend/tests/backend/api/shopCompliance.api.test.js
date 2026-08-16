/**
 * Agri-chemical compliance — the sale gate.
 *
 * Before this work a pesticide was sold by exactly the same code path as a hand
 * trowel: no licence check, no batch, no expiry, no recall, no way to stop a sale
 * in one state. These tests assert that each of those refusals actually refuses,
 * and — just as important — that an unregulated product is NOT caught by any of
 * them, because a compliance layer that blocks trowels is a compliance layer that
 * gets switched off.
 */
import request from 'supertest';
import {
  getApp, createTestUser, createTestSeller, createTestCategory,
  createTestCatalogProduct, createTestListing, cleanupTestData, prisma,
} from '../../fixtures/setup.js';

const API = '/api/v1/agristore';
const SELLER_API = '/api/v1/agristore/seller-compliance';

let app; let farmer; let seller; let category;

const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000);

/** A regulated product + one seller's live offer, wired together. */
async function makeRegulatedProduct({
  name, kind = 'INSECTICIDE', complianceStatus = 'APPROVED',
  requiresBatch = true, requiresExpiry = true, minShelfLifeDays = 30,
} = {}) {
  const product = await createTestCatalogProduct(category.id, { name });
  const listing = await createTestListing(seller.user.id, product.variants[0].id, {
    sellingPrice: 450, stockQty: 20, district: 'Pune', state: 'Maharashtra',
  });
  await prisma.productCompliance.create({
    data: {
      productId: product.id,
      regulatedKind: kind,
      status: complianceStatus,
      registrationNumber: 'CIR-12345/2024',
      registrationAuthority: 'CIB&RC',
      activeIngredient: 'Imidacloprid',
      formulation: 'SL',
      concentration: '17.8% SL',
      approvedCrops: ['Cotton'],
      targetPests: ['Aphid'],
      safetyEquipment: ['Gloves', 'Mask'],
      firstAidText: 'From the approved label.',
      labelVersion: 'v1',
      requiresBatch,
      requiresExpiry,
      minShelfLifeDays,
    },
  });
  return { product, listing };
}

/** Grant the seller a live licence for a class. */
function licence(kind, { status = 'APPROVED', validTo = daysFromNow(365) } = {}) {
  return prisma.sellerLicence.upsert({
    where: { sellerId_kind: { sellerId: seller.user.id, kind } },
    create: { sellerId: seller.user.id, kind, licenceNumber: 'LIC-1', status, validTo },
    update: { status, validTo },
  });
}

const addToCart = (listingId, quantity = 1) =>
  request(app).post(`${API}/cart`).set(farmer.headers).send({ listingId, quantity });

beforeAll(async () => {
  app = await getApp();
  farmer = await createTestUser({ district: 'Pune', state: 'Maharashtra' });
  seller = await createTestSeller({ district: 'Pune', state: 'Maharashtra' });
  category = await createTestCategory({ isRegulated: true });
});

beforeEach(async () => {
  await prisma.cartItem.deleteMany({ where: { userId: farmer.user.id } });
  await prisma.saleBlock.deleteMany();
  await prisma.productRecall.deleteMany();
});

afterAll(async () => { await cleanupTestData(); });

describe('Seller licence gate', () => {
  test('refuses an unlicensed seller and names the reason', async () => {
    await prisma.sellerLicence.deleteMany({ where: { sellerId: seller.user.id } });
    const { listing } = await makeRegulatedProduct({ name: 'Unlicensed Imida 17.8 SL' });
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'B1', expiryDate: daysFromNow(400), quantity: 20 },
    });

    const res = await addToCart(listing.id);

    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SELLER_UNLICENSED');
    // A refusal a farmer can act on, not a generic error.
    expect(res.body.error.message).toMatch(/another seller/i);
  });

  test('refuses a seller whose licence has expired', async () => {
    await licence('INSECTICIDE', { validTo: daysFromNow(-1) });
    const { listing } = await makeRegulatedProduct({ name: 'Expired Licence Imida' });
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'B1', expiryDate: daysFromNow(400), quantity: 20 },
    });

    const res = await addToCart(listing.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SELLER_LICENCE_EXPIRED');
  });

  test('allows a licensed seller with in-date stock', async () => {
    await licence('INSECTICIDE');
    const { listing } = await makeRegulatedProduct({ name: 'Licensed Imida 17.8 SL' });
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'B-OK', expiryDate: daysFromNow(400), quantity: 20 },
    });

    const res = await addToCart(listing.id);
    expect(res.status).toBe(201);
  });
});

describe('Expiry gate', () => {
  beforeAll(async () => { await licence('FUNGICIDE'); });

  test('refuses stock whose only batch has expired', async () => {
    const { listing } = await makeRegulatedProduct({ name: 'Expired Mancozeb 75 WP', kind: 'FUNGICIDE' });
    await prisma.productBatch.create({
      data: {
        listingId: listing.id, sellerId: seller.user.id, batchNumber: 'OLD-1',
        expiryDate: daysFromNow(-10), quantity: 20, status: 'EXPIRED',
      },
    });

    const res = await addToCart(listing.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('EXPIRED_STOCK');
  });

  test('refuses stock that expires inside the minimum shelf life', async () => {
    const { listing } = await makeRegulatedProduct({
      name: 'Short Dated Mancozeb', kind: 'FUNGICIDE', minShelfLifeDays: 60,
    });
    // In date, but only just — a farmer buying this has effectively bought nothing.
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'SHORT-1', expiryDate: daysFromNow(10), quantity: 20 },
    });

    const res = await addToCart(listing.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SHELF_LIFE_TOO_SHORT');
  });

  test('refuses a regulated offer with no batch recorded at all', async () => {
    const { listing } = await makeRegulatedProduct({ name: 'Batchless Mancozeb', kind: 'FUNGICIDE' });
    const res = await addToCart(listing.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('BATCH_REQUIRED');
  });

  test('allocates the EARLIEST-expiring sellable lot to the order (FEFO)', async () => {
    const { product, listing } = await makeRegulatedProduct({ name: 'FEFO Mancozeb', kind: 'FUNGICIDE' });
    await prisma.productBatch.createMany({
      data: [
        { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'LATE', expiryDate: daysFromNow(500), quantity: 10 },
        { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'EARLY', expiryDate: daysFromNow(200), quantity: 10 },
      ],
    });

    await addToCart(listing.id, 1);
    const res = await request(app).post(`${API}/orders`).set(farmer.headers).send({
      deliveryAddress: {
        type: 'HOME', name: 'F', phone: '9876543210', flat: '1', street: 'S',
        city: 'Pune', state: 'Maharashtra', pincode: '411001',
      },
      paymentMethod: 'cod',
    });

    expect(res.status).toBe(201);
    const item = await prisma.orderItem.findFirst({ where: { orderId: res.body.data.id } });
    // Short-dated stock clears first, instead of ageing into a write-off.
    expect(item.batchNumber).toBe('EARLY');
    // And the label revision shown at purchase is frozen with it.
    expect(item.labelVersion).toBe('v1');
    expect(item.productId).toBe(product.id);
  });
});

describe('Compliance approval gate', () => {
  test('refuses a product whose compliance record is still under review', async () => {
    await licence('HERBICIDE');
    const { listing } = await makeRegulatedProduct({
      name: 'Unreviewed Glyphosate', kind: 'HERBICIDE', complianceStatus: 'PENDING_REVIEW',
    });
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'B1', expiryDate: daysFromNow(400), quantity: 20 },
    });

    const res = await addToCart(listing.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('COMPLIANCE_NOT_APPROVED');
  });
});

describe('Recalls and administrative sale blocks', () => {
  beforeAll(async () => { await licence('PESTICIDE'); });

  test('an active recall stops the sale', async () => {
    const { product, listing } = await makeRegulatedProduct({ name: 'Recalled Chlorpyriphos', kind: 'PESTICIDE' });
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'RC-1', expiryDate: daysFromNow(400), quantity: 20 },
    });
    await prisma.productRecall.create({
      data: { productId: product.id, reason: 'Contamination found in QC testing', severity: 'HIGH' },
    });

    const res = await addToCart(listing.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('PRODUCT_RECALLED');
  });

  test('a recall narrowed to one batch stops only that batch', async () => {
    const { product, listing } = await makeRegulatedProduct({ name: 'Batch Recall Chlorpyriphos', kind: 'PESTICIDE' });
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'CLEAN-1', expiryDate: daysFromNow(400), quantity: 20 },
    });
    // The recall names a batch this seller does not hold.
    await prisma.productRecall.create({
      data: { productId: product.id, batchNumber: 'DIRTY-9', reason: 'Batch contamination', severity: 'HIGH' },
    });

    const res = await addToCart(listing.id);
    expect(res.status).toBe(201);
  });

  test('a STATE sale block stops the sale for a buyer in that state', async () => {
    const { product, listing } = await makeRegulatedProduct({ name: 'State Blocked Monocrotophos', kind: 'PESTICIDE' });
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'SB-1', expiryDate: daysFromNow(400), quantity: 20 },
    });
    await prisma.saleBlock.create({
      data: {
        scope: 'STATE', state: 'Maharashtra', productId: product.id,
        reason: 'State restriction order',
        publicMessage: 'This product cannot be sold in your state right now.',
      },
    });

    // buyerScope reads the query params the apps already send.
    const res = await request(app)
      .post(`${API}/cart?state=Maharashtra&district=Pune`)
      .set(farmer.headers)
      .send({ listingId: listing.id, quantity: 1 });

    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SALE_BLOCKED');
    // The buyer sees the public message, never the internal enforcement note.
    expect(res.body.error.message).not.toMatch(/restriction order/i);
  });

  test('a sale block applies to an UNREGULATED product too — that is what a block is', async () => {
    const plain = await createTestCatalogProduct(category.id, { name: 'Blocked Hand Trowel' });
    const plainListing = await createTestListing(seller.user.id, plain.variants[0].id, { sellingPrice: 90, stockQty: 5 });
    await prisma.saleBlock.create({
      data: { scope: 'PRODUCT', productId: plain.id, reason: 'Counterfeit reports' },
    });

    const res = await addToCart(plainListing.id);
    expect(res.status).toBe(409);
    expect(res.body.error.details.reason).toBe('SALE_BLOCKED');
  });
});

describe('The gate leaves ordinary products alone', () => {
  test('an unregulated product with no compliance record sells normally', async () => {
    const plain = await createTestCatalogProduct(category.id, { name: 'Plain Khurpi' });
    const plainListing = await createTestListing(seller.user.id, plain.variants[0].id, { sellingPrice: 120, stockQty: 10 });

    const res = await addToCart(plainListing.id);
    expect(res.status).toBe(201);
  });
});

describe('The product page shows only approved-label information', () => {
  test('returns the label panel for a regulated product, with its provenance flagged', async () => {
    await licence('INSECTICIDE');
    const { product, listing } = await makeRegulatedProduct({ name: 'Panel Imidacloprid' });
    await prisma.productBatch.create({
      data: { listingId: listing.id, sellerId: seller.user.id, batchNumber: 'P-1', expiryDate: daysFromNow(400), quantity: 20 },
    });

    const res = await request(app).get(`${API}/products/${product.id}`);

    expect(res.status).toBe(200);
    const safety = res.body.data.safety;
    expect(safety).toBeTruthy();
    expect(safety.activeIngredient).toBe('Imidacloprid');
    expect(safety.registrationNumber).toBe('CIR-12345/2024');
    expect(safety.approvedCrops).toEqual(['Cotton']);
    expect(safety.safetyEquipment).toEqual(['Gloves', 'Mask']);
    // The app must be able to say "this came from the approved label", and there
    // must be a standing notice pointing at a qualified professional.
    expect(safety.sourcedFromApprovedLabel).toBe(true);
    expect(safety.safetyNotice).toMatch(/label/i);
  });

  test('a missing label section stays NULL — no generated substitute', async () => {
    const product = await createTestCatalogProduct(category.id, { name: 'Sparse Label Product' });
    await createTestListing(seller.user.id, product.variants[0].id, { sellingPrice: 200, stockQty: 5 });
    await prisma.productCompliance.create({
      data: { productId: product.id, regulatedKind: 'FERTILIZER', status: 'APPROVED', requiresBatch: false },
    });

    const res = await request(app).get(`${API}/products/${product.id}`);
    const safety = res.body.data.safety;

    // The platform never authors dosage or first-aid text. Absent means absent.
    expect(safety.dosageText).toBeNull();
    expect(safety.firstAidText).toBeNull();
    expect(safety.storageInstructions).toBeNull();
    expect(safety.approvedCrops).toBeNull();
  });

  test('returns no safety panel at all for an unregulated product', async () => {
    const plain = await createTestCatalogProduct(category.id, { name: 'No Panel Bucket' });
    await createTestListing(seller.user.id, plain.variants[0].id, { sellingPrice: 80, stockQty: 5 });

    const res = await request(app).get(`${API}/products/${plain.id}`);
    expect(res.body.data.safety).toBeNull();
  });

  test('surfaces an active recall on the product page, not only at add-to-cart', async () => {
    const { product } = await makeRegulatedProduct({ name: 'Page Recall Product', kind: 'PESTICIDE' });
    await prisma.productRecall.create({
      data: { productId: product.id, reason: 'Manufacturer recall notice', advice: 'Return unused stock to the seller.', severity: 'HIGH' },
    });

    const res = await request(app).get(`${API}/products/${product.id}`);
    expect(res.body.data.recall.active).toBe(true);
    expect(res.body.data.recall.advice).toBe('Return unused stock to the seller.');
  });
});

describe('A seller cannot approve their own compliance', () => {
  test('403 — submitting status: APPROVED is rejected outright', async () => {
    const product = await createTestCatalogProduct(category.id, {
      name: 'Self Approve Attempt', createdBySellerId: seller.user.id,
    });

    const res = await request(app)
      .put(`${SELLER_API}/products/${product.id}/compliance`)
      .set(seller.headers)
      .send({ regulatedKind: 'INSECTICIDE', registrationNumber: 'X-1', status: 'APPROVED' });

    expect(res.status).toBe(403);
    expect(res.body.error.details.rejectedFields).toContain('status');
  });

  test('a legitimate submission lands in PENDING_REVIEW, never APPROVED', async () => {
    const product = await createTestCatalogProduct(category.id, {
      name: 'Honest Submission', createdBySellerId: seller.user.id,
    });

    const res = await request(app)
      .put(`${SELLER_API}/products/${product.id}/compliance`)
      .set(seller.headers)
      .send({
        regulatedKind: 'INSECTICIDE',
        registrationNumber: 'CIR-999/2025',
        activeIngredient: 'Thiamethoxam',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING_REVIEW');
  });

  test("403 — a seller cannot rewrite the label on another seller's catalog entry", async () => {
    const other = await createTestSeller();
    const product = await createTestCatalogProduct(category.id, {
      name: 'Someone Elses Product', createdBySellerId: other.user.id,
    });

    const res = await request(app)
      .put(`${SELLER_API}/products/${product.id}/compliance`)
      .set(seller.headers)
      .send({ regulatedKind: 'INSECTICIDE', activeIngredient: 'Tampered' });

    expect(res.status).toBe(403);
  });

  test('403 — a seller cannot self-approve a licence', async () => {
    const res = await request(app)
      .post(`${SELLER_API}/licences`)
      .set(seller.headers)
      .send({ kind: 'PESTICIDE', licenceNumber: 'L-1', validTo: daysFromNow(365), status: 'APPROVED' });

    expect(res.status).toBe(403);
  });

  test('a submitted licence is PENDING and an expired one is refused up front', async () => {
    const fresh = await createTestSeller();

    const ok = await request(app).post(`${SELLER_API}/licences`).set(fresh.headers)
      .send({ kind: 'PESTICIDE', licenceNumber: 'L-2', validTo: daysFromNow(200) });
    expect(ok.status).toBe(201);
    expect(ok.body.data.status).toBe('PENDING');

    const expired = await request(app).post(`${SELLER_API}/licences`).set(fresh.headers)
      .send({ kind: 'FUNGICIDE', licenceNumber: 'L-3', validTo: daysFromNow(-1) });
    expect(expired.status).toBe(400);
  });

  test('401 — the seller compliance surface is not public', async () => {
    const res = await request(app).get(`${SELLER_API}/licences`);
    expect(res.status).toBe(401);
  });

  test('403 — a plain farmer cannot reach the seller compliance surface', async () => {
    const res = await request(app).get(`${SELLER_API}/licences`).set(farmer.headers);
    expect(res.status).toBe(403);
  });
});

describe('Seller delivery areas', () => {
  test('re-saving the same area UPDATES it instead of creating a duplicate', async () => {
    const s = await createTestSeller();

    const first = await request(app).post(`${SELLER_API}/service-areas`).set(s.headers)
      .send({ pincodePrefix: '413', etaMinDays: 2, etaMaxDays: 4 });
    expect(first.status).toBe(201);

    // The obvious constraint — @@unique([sellerId, pincode, pincodePrefix]) —
    // could not do this job: Postgres treats NULLs as DISTINCT so it permitted
    // unlimited duplicates, and Prisma refuses a null inside a compound-unique
    // WHERE so the upsert could not even be expressed. Hence `matchKey`.
    const second = await request(app).post(`${SELLER_API}/service-areas`).set(s.headers)
      .send({ pincodePrefix: '413', etaMinDays: 1, etaMaxDays: 9 });
    expect(second.status).toBe(201);

    const rows = await prisma.sellerServiceArea.findMany({ where: { sellerId: s.user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].etaMaxDays).toBe(9);
  });

  test('an exact pincode and a prefix are different areas, not a collision', async () => {
    const s = await createTestSeller();
    await request(app).post(`${SELLER_API}/service-areas`).set(s.headers)
      .send({ pincode: '413102', etaMinDays: 1, etaMaxDays: 2 });
    await request(app).post(`${SELLER_API}/service-areas`).set(s.headers)
      .send({ pincodePrefix: '413', etaMinDays: 3, etaMaxDays: 6 });

    const rows = await prisma.sellerServiceArea.findMany({ where: { sellerId: s.user.id } });
    expect(rows).toHaveLength(2);
  });

  test('the MOST SPECIFIC area wins the delivery promise', async () => {
    const s = await createTestSeller();
    // A seller who wrote a slow, deliberate rule for one pincode meant it —
    // silently upgrading them to their own broader rule would quote a date they
    // never promised.
    await request(app).post(`${SELLER_API}/service-areas`).set(s.headers)
      .send({ pincodePrefix: '413', etaMinDays: 1, etaMaxDays: 2 });
    await request(app).post(`${SELLER_API}/service-areas`).set(s.headers)
      .send({ pincode: '413102', etaMinDays: 6, etaMaxDays: 9 });

    const { resolveServiceability } = await import('../../../src/services/serviceability.service.js');
    const map = await resolveServiceability({ sellerIds: [s.user.id], pincode: '413102' });

    expect(map.get(s.user.id).source).toBe('exact');
    expect(map.get(s.user.id).etaMaxDays).toBe(9);
  });

  test('a seller with NO configured areas stays serviceable everywhere', async () => {
    const s = await createTestSeller();
    const { resolveServiceability } = await import('../../../src/services/serviceability.service.js');
    const map = await resolveServiceability({ sellerIds: [s.user.id], pincode: '413102' });

    // The compatibility guarantee: today no seller has rows, and none of them
    // may go offline because of it.
    expect(map.get(s.user.id).serviceable).toBe(true);
    expect(map.get(s.user.id).source).toBe('unconfigured');
  });

  test('400 — an invalid PIN code is refused up front', async () => {
    const s = await createTestSeller();
    const res = await request(app).post(`${SELLER_API}/service-areas`).set(s.headers)
      .send({ pincode: '000000', etaMinDays: 1, etaMaxDays: 2 });
    expect(res.status).toBe(400);
  });

  test("403 — a seller cannot delete another seller's delivery area", async () => {
    const owner = await createTestSeller();
    const other = await createTestSeller();
    const created = await request(app).post(`${SELLER_API}/service-areas`).set(owner.headers)
      .send({ pincode: '413102', etaMinDays: 1, etaMaxDays: 2 });

    const res = await request(app)
      .delete(`${SELLER_API}/service-areas/${created.body.data.id}`)
      .set(other.headers);

    expect(res.status).toBe(403);
    expect(await prisma.sellerServiceArea.count({ where: { sellerId: owner.user.id } })).toBe(1);
  });
});
