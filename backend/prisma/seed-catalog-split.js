/**
 * Seed the worked example for the CATALOG SPLIT.
 *
 *   ONE catalog product     "Mahyco Bt Cotton Seed"
 *   TWO variants            450 g pack, 1 kg pack
 *   THREE Krushi Seva Kendras, each with its own offer at its own price
 *
 * Before the split this was three separate `products` rows and three separate
 * product pages, because `products` fused catalog identity with one seller's
 * offer and carried no unique constraint of any kind. After it: one page, three
 * offers, one buy-box winner per pack size.
 *
 *   node prisma/seed-catalog-split.js            seed + print the buy box
 *   node prisma/seed-catalog-split.js --clean    remove everything it created
 *
 * Idempotent: users match on phone, the product on its normalizedKey, variants on
 * (productId, sku), offers on the (sellerId, variantId) unique. Re-running
 * updates in place.
 *
 * The three prices are chosen so the buy box is NOT a pure price sort: Shivneri
 * is ₹40 cheaper than Jai Kisan on the 1 kg pack but promises 5-day dispatch
 * against 1-day, which is what makes the dispatch term visible in the output.
 */
import prisma from '../src/config/db.js';
import { normalizeProductKey } from '../src/services/catalogMatch.service.js';
import { rankOffersForVariant } from '../src/services/buyBox.service.js';

const CATEGORY_NAME = 'Seeds';

const KENDRAS = [
  {
    phone: '+919000000101',
    name: 'Krushi Seva Kendra — Shivneri Agro',
    district: 'Pune', taluka: 'Junnar', village: 'Narayangaon', state: 'Maharashtra',
    licenceNumber: 'MH/PUN/SEED/2019/0412',
    offers: {
      '450g': { sellingPrice: 810,  mrp: 930,  stockQty: 120, dispatchSlaDays: 3 },
      '1kg':  { sellingPrice: 1560, mrp: 1800, stockQty: 60,  dispatchSlaDays: 5 },
    },
  },
  {
    phone: '+919000000102',
    name: 'Krushi Seva Kendra — Jai Kisan Agro',
    district: 'Pune', taluka: 'Junnar', village: 'Otur', state: 'Maharashtra',
    licenceNumber: 'MH/PUN/SEED/2021/1188',
    offers: {
      '450g': { sellingPrice: 845,  mrp: 930,  stockQty: 200, dispatchSlaDays: 1 },
      '1kg':  { sellingPrice: 1600, mrp: 1800, stockQty: 90,  dispatchSlaDays: 1 },
    },
  },
  {
    phone: '+919000000103',
    name: 'Krushi Seva Kendra — Balaji Beej Bhandar',
    district: 'Nashik', taluka: 'Sinnar', village: 'Sinnar', state: 'Maharashtra',
    licenceNumber: 'MH/NAS/SEED/2020/0777',
    offers: {
      // Deliberately the cheapest 450 g offer, but in a DIFFERENT district with
      // sellScope 'district' — so a Pune buyer must NOT see it win the buy box.
      '450g': { sellingPrice: 780,  mrp: 930,  stockQty: 40, dispatchSlaDays: 2 },
    },
  },
];

const VARIANTS = [
  { sku: 'MAHYCO-BT-450G', packSize: '450g', unit: 'packet', gtin: '8901234567895', isDefault: true },
  { sku: 'MAHYCO-BT-1KG',  packSize: '1kg',  unit: 'packet', gtin: '8901234567901', isDefault: false },
];

const PRODUCT = {
  name: 'Mahyco Bt Cotton Seed',
  nameHi: 'महिको बीटी कपास बीज',
  nameMr: 'महिको बीटी कापूस बियाणे',
  brand: 'Mahyco',
  manufacturer: 'Maharashtra Hybrid Seeds Company Pvt. Ltd.',
  modelNumber: 'MRC-7351-BGII',
  countryOfOrigin: 'India',
  subcategory: 'Cotton',
  description:
    'Bollgard II Bt cotton hybrid suited to rainfed and irrigated conditions in Maharashtra. '
    + 'Tolerant to bollworm complex; 160–180 day duration. Sow at 90x60 cm spacing after the first '
    + 'monsoon showers. Treat with recommended seed protectant before sowing.',
  highlights: [
    'Bollgard II (BGII) bollworm protection',
    '160–180 day duration',
    'Suited to rainfed + irrigated Maharashtra conditions',
    'Truthfully labelled — licenced dealer supply only',
  ],
  tags: ['cotton', 'bt cotton', 'seed', 'kharif', 'mahyco'],
  images: [
    'https://res.cloudinary.com/demo/image/upload/v1/krushisarva/seeds/mahyco-bt-cotton-1.jpg',
    'https://res.cloudinary.com/demo/image/upload/v1/krushisarva/seeds/mahyco-bt-cotton-2.jpg',
  ],
  specifications: {
    'Crop': 'Cotton',
    'Hybrid': 'MRC 7351 BGII',
    'Technology': 'Bollgard II',
    'Duration': '160–180 days',
    'Spacing': '90 x 60 cm',
    'Germination': 'Min 75%',
  },
};

async function ensureCategory() {
  const existing = await prisma.category.findFirst({ where: { name: CATEGORY_NAME } });
  if (existing) return existing;
  return prisma.category.create({
    data: {
      name: CATEGORY_NAME, nameHi: 'बीज', nameMr: 'बियाणे',
      icon: 'seed', color: '#176B43', sortOrder: 1, isActive: true,
    },
  });
}

async function ensureKendra(k) {
  const user = await prisma.user.upsert({
    where: { phone: k.phone },
    update: { name: k.name, district: k.district, taluka: k.taluka, village: k.village, state: k.state },
    create: {
      phone: k.phone, name: k.name, role: 'SELLER', kycStatus: 'VERIFIED',
      district: k.district, taluka: k.taluka, village: k.village, state: k.state,
      language: 'mr', isActive: true,
    },
  });

  await prisma.sellerProfile.upsert({
    where: { userId: user.id },
    update: { licenceNumber: k.licenceNumber, licenceVerifiedAt: new Date() },
    create: {
      userId: user.id,
      licenceNumber: k.licenceNumber,
      licenceType: 'Seed Dealer',
      licenceIssuingState: 'Maharashtra',
      licenceVerifiedAt: new Date(),
      kycVerifiedAt: new Date(),
      // metricsUpdatedAt is deliberately left NULL — this is the day-one
      // bootstrap case, so the buy box drops w2/w4 and ranks on price + dispatch.
    },
  });

  return user;
}

async function seed() {
  const category = await ensureCategory();

  const normalizedKey = normalizeProductKey({
    categoryId: category.id,
    brand: PRODUCT.brand,
    manufacturer: PRODUCT.manufacturer,
    name: PRODUCT.name,
  });

  // ── ONE catalog row ────────────────────────────────────────────────────────
  const existing = await prisma.product.findFirst({ where: { normalizedKey } });
  const product = existing
    ? await prisma.product.update({ where: { id: existing.id }, data: { ...PRODUCT, status: 'APPROVED', isActive: true } })
    : await prisma.product.create({
        data: {
          ...PRODUCT,
          categoryId: category.id,
          normalizedKey,
          status: 'APPROVED',
          // DUAL-READ columns — no price, because a catalog row has none.
          isActive: true,
          price: null,
          stock: 0,
        },
      });

  // ── TWO variants ───────────────────────────────────────────────────────────
  const variants = {};
  for (const v of VARIANTS) {
    const row = await prisma.productVariant.upsert({
      where: { productId_sku: { productId: product.id, sku: v.sku } },
      update: { unit: v.unit, attributes: { packSize: v.packSize }, gtin: v.gtin, isDefault: v.isDefault },
      create: {
        productId: product.id, sku: v.sku, unit: v.unit,
        attributes: { packSize: v.packSize }, gtin: v.gtin, isDefault: v.isDefault,
      },
    });
    variants[v.packSize] = row;
  }

  // ── THREE Kendras, one offer each per pack they stock ──────────────────────
  const sellers = [];
  for (const k of KENDRAS) {
    const user = await ensureKendra(k);
    sellers.push({ k, user });

    for (const [packSize, offer] of Object.entries(k.offers)) {
      const variant = variants[packSize];
      if (!variant) continue;
      await prisma.sellerListing.upsert({
        where: { sellerId_variantId: { sellerId: user.id, variantId: variant.id } },
        update: { ...offer, status: offer.stockQty > 0 ? 'ACTIVE' : 'OUT_OF_STOCK' },
        create: {
          ...offer,
          sellerId: user.id,
          variantId: variant.id,
          condition: 'NEW',
          minOrderQty: 1,
          // 'district' is the schema default and the whole point of the Nashik
          // seller: geography GATES buy-box eligibility, it does not just sort.
          sellScope: 'district',
          district: k.district, taluka: k.taluka, village: k.village, state: k.state,
          harvestDate: '2026-04',
          status: offer.stockQty > 0 ? 'ACTIVE' : 'OUT_OF_STOCK',
        },
      });
    }
  }

  return { product, variants, sellers, category };
}

function inr(n) { return `₹${Number(n).toLocaleString('en-IN')}`; }

async function report({ product, variants, sellers }) {
  const nameById = new Map(sellers.map((s) => [s.user.id, s.k.name]));

  console.log(`\n  ONE catalog product:  ${product.name}  [${product.status}]`);
  console.log(`  ${product.brand} · ${product.manufacturer} · ${product.modelNumber}`);
  console.log(`  id: ${product.id}\n`);

  for (const buyer of [
    { label: 'Buyer in Pune',   scope: { district: 'Pune',   state: 'Maharashtra' } },
    { label: 'Buyer in Nashik', scope: { district: 'Nashik', state: 'Maharashtra' } },
  ]) {
    console.log(`  ── ${buyer.label} ${'─'.repeat(52 - buyer.label.length)}`);
    for (const [packSize, variant] of Object.entries(variants)) {
      const { offers, weights } = await rankOffersForVariant(variant.id, buyer.scope);
      console.log(`   ${packSize} pack — ${offers.length} eligible offer(s)${weights.bootstrapped ? '  [bootstrap: w2/w4 dropped, no seller metrics yet]' : ''}`);
      if (!offers.length) { console.log('     (none — no seller can deliver to this district)'); continue; }
      offers.forEach((o, i) => {
        const tag = i === 0 ? 'BUY BOX' : '       ';
        console.log(
          `     ${tag}  ${inr(o.sellingPrice).padEnd(8)} ${String(o.dispatchSlaDays).padStart(2)}d  `
          + `stock ${String(o.stockQty).padStart(3)}  score ${o.buyBoxScore.toFixed(3)}  ${nameById.get(o.sellerId) || o.sellerId}`,
        );
      });
    }
    console.log('');
  }

  const pune = await rankOffersForVariant(variants['450g'].id, { district: 'Pune', state: 'Maharashtra' });
  const nashikSeller = sellers.find((s) => s.k.district === 'Nashik');
  const leaked = pune.offers.some((o) => o.sellerId === nashikSeller.user.id);
  console.log(`  Geography gate: the cheapest 450g offer (${inr(780)}, Nashik) is `
    + `${leaked ? 'VISIBLE — BUG' : 'correctly EXCLUDED'} for a Pune buyer.\n`);
}

async function clean() {
  const phones = KENDRAS.map((k) => k.phone);
  const users = await prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true } });
  const ids = users.map((u) => u.id);

  await prisma.cartItem.deleteMany({ where: { listing: { sellerId: { in: ids } } } });
  await prisma.sellerListing.deleteMany({ where: { sellerId: { in: ids } } });

  const category = await prisma.category.findFirst({ where: { name: CATEGORY_NAME } });
  if (category) {
    const key = normalizeProductKey({
      categoryId: category.id, brand: PRODUCT.brand,
      manufacturer: PRODUCT.manufacturer, name: PRODUCT.name,
    });
    const product = await prisma.product.findFirst({ where: { normalizedKey: key } });
    if (product) {
      // Only safe when nothing was ordered — orderItems.productId is RESTRICT.
      const ordered = await prisma.orderItem.count({ where: { productId: product.id } });
      if (ordered) {
        console.log(`  Product has ${ordered} order item(s); deactivating instead of deleting.`);
        await prisma.product.update({ where: { id: product.id }, data: { status: 'REJECTED', isActive: false } });
      } else {
        await prisma.productVariant.deleteMany({ where: { productId: product.id } });
        await prisma.product.delete({ where: { id: product.id } });
      }
    }
  }

  await prisma.sellerProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`  Removed ${ids.length} Kendra(s) and the seeded catalog entry.`);
}

async function main() {
  if (process.argv.includes('--clean')) {
    await clean();
    return;
  }
  const result = await seed();
  await report(result);
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
