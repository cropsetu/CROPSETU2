/**
 * Seed UI-demo data — realistic Pune-district users that exercise every
 * marketplace screen end-to-end:
 *
 *   • 10 farmer users   (role FARMER)          + farm details
 *   • 10 sellers        (role SELLER)          + seller profiles → own the products
 *   • 10 animal sellers (role FARMER)          + 17 livestock listings
 *   • 10 machinery owners (role MACHINERY_OWNER) + 10 rental listings
 *   • 10 labour providers (role LABOUR_PROVIDER) + 10 farm-labour listings
 *   • 20 agri-store products (with images, spread across categories)
 *
 * The CREATIVE content (names, descriptions, prices, breeds, image keywords)
 * lives in prisma/data/ui-demo-content.json. This script WIRES the deterministic
 * identifiers — unique phone numbers, avatar photos, topical listing images,
 * and seller→product ownership — and inserts everything.
 *
 * Images:
 *   • avatars            → randomuser.me portraits (stable, realistic)
 *   • listings/products  → loremflickr keyword photos, lock-seeded so each URL
 *                          resolves to the SAME real, topical photo every render.
 *
 * Idempotent: users matched by phone, listings/products by a natural key.
 * Re-running updates rows in place — safe on a fresh DB or on top of existing data.
 *
 * Prereq: product categories must exist. Run first:
 *   node prisma/seed-categories.js     (npm run db:seed:categories isn't defined;
 *                                        seed-categories is run by this repo's tooling)
 * Then:
 *   node prisma/seed-ui-demo.js        (npm run db:seed:ui-demo)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import prisma from '../src/config/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const content = JSON.parse(
  readFileSync(join(__dirname, 'data', 'ui-demo-content.json'), 'utf8')
);

// ── Pune geo anchor ──────────────────────────────────────────────────────────
const PUNE = { lat: 18.5204, lng: 73.8567, district: 'Pune', state: 'Maharashtra' };

// Pre-existing users + the explicit demo number must never be re-minted.
const RESERVED = new Set(['9970014674', '9955588888', '9970842248']);

// Pune-district taluka → representative pincode.
const PINCODE = {
  Haveli: '411028', Mulshi: '412108', Maval: '410507', Junnar: '410502',
  Baramati: '413102', Daund: '413801', Shirur: '412210', Khed: '410501',
  Bhor: '412206', Indapur: '413106', Purandar: '412301', Velhe: '412212',
  Ambegaon: '410503',
};
const pincode = (taluka) => PINCODE[taluka] || '411001';

// ── Deterministic generators (no RNG — stable across runs) ───────────────────

// Unique 10-digit mobile: 2-digit group prefix + sequential 8-digit body,
// skipping reserved/used numbers.
function phoneFactory() {
  const used = new Set(RESERVED);
  return (prefix, seed) => {
    let body = (seed * 97 + 100003) % 100000000;
    let phone;
    do {
      phone = prefix + String(body).padStart(8, '0');
      body = (body + 1) % 100000000;
    } while (used.has(phone));
    used.add(phone);
    return phone;
  };
}

// Avatar portraits — separate male/female counters so faces don't repeat.
let menIdx = 3, womenIdx = 6;
function avatar(gender) {
  const female = gender === 'female';
  const n = (female ? womenIdx++ : menIdx++) % 100;
  return `https://randomuser.me/api/portraits/${female ? 'women' : 'men'}/${n}.jpg`;
}

// Topical, stable listing/product photos via loremflickr. Keywords are
// sanitised to single-word / hyphenated tags (the only form loremflickr serves).
let lockSeq = 1000;
function sanitizeKw(kw) {
  const tags = String(kw || 'agriculture,india,farm')
    .split(',')
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .slice(0, 3);
  return tags.length ? tags.join(',') : 'agriculture,farm';
}
function images(kw, count = 2) {
  const tags = sanitizeKw(kw);
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(`https://loremflickr.com/800/600/${tags}/all?lock=${lockSeq++}`);
  }
  return out;
}

// Small deterministic geo jitter around Pune so listings spread on the map.
const jitter = (i, base) => +(base + ((i % 10) - 5) * 0.02 + (i % 4) * 0.004).toFixed(6);

// Decode the few HTML entities the generated content carries (e.g. "&amp;").
const decode = (s) =>
  String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const toGender = (g) => (g === 'female' ? 'FEMALE' : 'MALE');

// Plausible Maharashtra GSTIN (27 = state code). Demo-only, not validated.
const gstin = (i) => `27ABCDE${String(1000 + i).slice(-4)}F1Z${i % 10}`;

// Machinery category → the lowercase chip keys the Rent UI filters on.
const MACH_CAT = {
  tractor: 'tractor', harvester: 'harvester', sprayer: 'sprayer',
  rotavator: 'rotavator', thresher: 'thresher', transplanter: 'transplanter',
  truck: 'truck', tempo: 'tempo',
  tiller: 'rotavator', baler: 'other', trailer: 'tempo', trolley: 'tempo',
  plough: 'other', seeder: 'other', cultivator: 'rotavator', drill: 'other',
};
const machCat = (c) => MACH_CAT[String(c || '').trim().toLowerCase()] || 'other';

// Animal type → the AnimalTrade chip keys (Bull → Bullock for the chip filter).
const animalCat = (a) => (/^bull$/i.test(String(a || '').trim()) ? 'Bullock' : String(a || '').trim());

const nextPhone = phoneFactory();

// ── 1. Farmer users ──────────────────────────────────────────────────────────
async function seedFarmers() {
  // Honour the explicit example: first user is Mangal Yeljale / 9970842248.
  const farmers = content.farmers.map((f, i) =>
    i === 0 ? { ...f, name: 'Mangal Yeljale', gender: 'male' } : f
  );

  let n = 0;
  for (let i = 0; i < farmers.length; i++) {
    const f = farmers[i];
    const phone = i === 0 ? '9970842248' : nextPhone('98', i + 1);
    const data = {
      phone,
      name: decode(f.name),
      role: 'FARMER',
      avatar: avatar(f.gender),
      gender: toGender(f.gender),
      language: f.language || 'mr',
      statusQuote: decode(f.statusQuote),
      state: PUNE.state, district: PUNE.district, city: 'Pune',
      taluka: f.taluka, village: f.village, pincode: pincode(f.taluka),
      farmingExperienceYrs: f.farmingExperienceYrs ?? null,
      totalLandAcres: f.landAcres ?? 0,
      totalFarms: 1,
      kycStatus: 'VERIFIED',
      onboardingStep: 'COMPLETE',
      profileCompletion: 95,
      isActive: true,
    };
    const user = await prisma.user.upsert({ where: { phone }, update: data, create: data });

    const farm = {
      village: f.village, district: PUNE.district, state: PUNE.state, pincode: pincode(f.taluka),
      landAcres: f.landAcres ?? null, cropTypes: f.cropTypes ?? [],
      soilType: f.soilType ?? null, irrigationType: f.irrigationType ?? null,
    };
    await prisma.farmDetail.upsert({
      where: { userId: user.id },
      update: farm,
      create: { userId: user.id, ...farm },
    });
    n++;
  }
  console.log(`  ✓ farmers: ${n}`);
}

// ── 2. Sellers (own the products) ────────────────────────────────────────────
const sellerIds = [];
async function seedSellers() {
  let n = 0;
  for (let i = 0; i < content.sellers.length; i++) {
    const s = content.sellers[i];
    const phone = nextPhone('90', i + 1);
    const data = {
      phone,
      name: decode(s.businessName),          // the shop is the marketplace "seller"
      role: 'SELLER',
      avatar: avatar(s.gender),
      gender: toGender(s.gender),
      language: 'mr',
      businessType: decode(s.businessType),
      gstNumber: gstin(i),
      statusQuote: decode(s.statusQuote),
      state: PUNE.state, district: PUNE.district, city: 'Pune',
      taluka: s.taluka, village: decode(s.area), pincode: pincode(s.taluka),
      kycStatus: 'VERIFIED',
      onboardingStep: 'COMPLETE',
      profileCompletion: 100,
      isActive: true,
    };
    const user = await prisma.user.upsert({ where: { phone }, update: data, create: data });

    const profile = {
      bankHolderName: decode(s.name),
      bankName: decode(s.bankName),
      bankAccountNumber: `XXXXXXXX${String(2000 + i).slice(-4)}`,
      bankIfsc: `MAHB000${String(1000 + i).slice(-4)}`,
      panNumber: `ABCPE${String(1000 + i).slice(-4)}F`,
      aadharNumber: `XXXX XXXX ${String(1000 + i).slice(-4)}`,
      kycVerifiedAt: new Date(),
    };
    await prisma.sellerProfile.upsert({
      where: { userId: user.id },
      update: profile,
      create: { userId: user.id, ...profile },
    });
    sellerIds.push(user.id);
    n++;
  }
  console.log(`  ✓ sellers: ${n}`);
}

// ── 3. Animal sellers + livestock listings ───────────────────────────────────
async function seedAnimalSellers() {
  let users = 0, listings = 0, li = 0;
  for (let i = 0; i < content.animalSellers.length; i++) {
    const s = content.animalSellers[i];
    const phone = nextPhone('70', i + 1);
    const data = {
      phone,
      name: decode(s.name),
      role: 'FARMER',
      avatar: avatar(s.gender),
      gender: toGender(s.gender),
      language: 'mr',
      statusQuote: decode(s.statusQuote),
      state: PUNE.state, district: PUNE.district, city: 'Pune',
      taluka: s.taluka, village: s.village, pincode: pincode(s.taluka),
      kycStatus: 'VERIFIED',
      onboardingStep: 'COMPLETE',
      profileCompletion: 90,
      isActive: true,
    };
    const user = await prisma.user.upsert({ where: { phone }, update: data, create: data });
    users++;

    const sellerLocation = `${s.village}, ${s.taluka}, Pune, Maharashtra`;
    for (const l of s.listings) {
      const animal = animalCat(l.animal);
      const row = {
        sellerId: user.id,
        animal, breed: l.breed, age: l.age, gender: l.gender, weight: l.weight,
        price: l.price,
        milkYield: l.milkYield ?? null,
        description: decode(l.description),
        images: images(l.imageKeywords),
        tags: l.tags ?? [],
        verified: li % 2 === 0,
        status: 'ACTIVE',
        sellerLocation,
        lat: jitter(li, PUNE.lat),
        lng: jitter(li, PUNE.lng),
      };
      const existing = await prisma.animalListing.findFirst({
        where: { sellerId: user.id, animal, breed: l.breed, age: l.age },
        select: { id: true },
      });
      if (existing) await prisma.animalListing.update({ where: { id: existing.id }, data: row });
      else await prisma.animalListing.create({ data: row });
      listings++; li++;
    }
  }
  console.log(`  ✓ animal sellers: ${users}, listings: ${listings}`);
}

// ── 4. Machinery owners + rental listings ────────────────────────────────────
async function seedMachineryOwners() {
  let users = 0, listings = 0;
  for (let i = 0; i < content.machineryOwners.length; i++) {
    const o = content.machineryOwners[i];
    const phone = nextPhone('88', i + 1);
    const data = {
      phone,
      name: decode(o.name),
      role: 'MACHINERY_OWNER',
      avatar: avatar(o.gender),
      gender: toGender(o.gender),
      language: 'mr',
      statusQuote: decode(o.statusQuote),
      state: PUNE.state, district: PUNE.district, city: 'Pune',
      taluka: o.taluka, village: decode(o.area), pincode: pincode(o.taluka),
      kycStatus: 'VERIFIED',
      onboardingStep: 'COMPLETE',
      profileCompletion: 90,
      isActive: true,
    };
    const user = await prisma.user.upsert({ where: { phone }, update: data, create: data });
    users++;

    const L = o.listing;
    const row = {
      ownerId: user.id,
      name: decode(L.name),
      category: machCat(L.category),
      brand: decode(L.brand) || null,
      description: decode(L.description),
      pricePerDay: L.pricePerDay,
      pricePerHour: L.pricePerHour ?? null,
      pricePerAcre: L.pricePerAcre ?? null,
      horsePower: L.horsePower || null,
      fuelType: L.fuelType || null,
      ageYears: L.ageYears ?? null,
      features: L.features ?? [],
      images: images(L.imageKeywords),
      location: `${decode(o.area)}, ${o.taluka}`,
      district: PUNE.district,
      state: PUNE.state,
      available: true,
      status: 'ACTIVE',
      ownerName: decode(o.name),
      ownerPhone: phone,
      rating: +(4 + (i % 10) / 10).toFixed(1),
      ratingCount: 5 + i,
      lat: jitter(i, PUNE.lat),
      lng: jitter(i, PUNE.lng),
    };
    const existing = await prisma.machineryListing.findFirst({
      where: { ownerId: user.id, name: row.name },
      select: { id: true },
    });
    if (existing) await prisma.machineryListing.update({ where: { id: existing.id }, data: row });
    else await prisma.machineryListing.create({ data: row });
    listings++;
  }
  console.log(`  ✓ machinery owners: ${users}, listings: ${listings}`);
}

// ── 4b. Labour providers + farm-labour listings ──────────────────────────────
async function seedLabourProviders() {
  if (!content.labour?.length) return;
  let users = 0, listings = 0;
  for (let i = 0; i < content.labour.length; i++) {
    const w = content.labour[i];
    const phone = nextPhone('72', i + 1);
    const data = {
      phone,
      name: decode(w.name),
      role: 'LABOUR_PROVIDER',
      avatar: avatar(w.gender),
      gender: toGender(w.gender),
      language: 'mr',
      statusQuote: decode(w.statusQuote),
      state: PUNE.state, district: PUNE.district, city: 'Pune',
      taluka: w.taluka, village: decode(w.area), pincode: pincode(w.taluka),
      kycStatus: 'VERIFIED',
      onboardingStep: 'COMPLETE',
      profileCompletion: 90,
      isActive: true,
    };
    const user = await prisma.user.upsert({ where: { phone }, update: data, create: data });
    users++;

    const isGroup = w.type === 'group';
    const listingName = decode(isGroup ? (w.groupName || w.name) : w.name);
    const imgs = images(w.imageKeywords);
    const row = {
      providerId: user.id,
      name: listingName,
      skills: w.skills ?? [],
      pricePerDay: w.pricePerDay,
      pricePerHour: w.pricePerHour ?? null,
      groupSize: w.groupSize ?? 1,
      experience: w.experience || null,
      languages: w.languages ?? [],
      description: decode(w.description),
      groupName: isGroup ? decode(w.groupName) : null,
      leader: isGroup ? decode(w.leader) : decode(w.name),
      image: imgs[0],
      images: imgs,
      location: `${decode(w.area)}, ${w.taluka}`,
      district: PUNE.district,
      state: PUNE.state,
      available: true,
      status: 'ACTIVE',
      phone,
      rating: +(4 + (i % 10) / 10).toFixed(1),
      ratingCount: 4 + i,
      lat: jitter(i, PUNE.lat),
      lng: jitter(i, PUNE.lng),
    };
    const existing = await prisma.labourListing.findFirst({
      where: { providerId: user.id, name: listingName },
      select: { id: true },
    });
    if (existing) await prisma.labourListing.update({ where: { id: existing.id }, data: row });
    else await prisma.labourListing.create({ data: row });
    listings++;
  }
  console.log(`  ✓ labour providers: ${users}, listings: ${listings}`);
}

// ── 5. Products (owned by the sellers) ───────────────────────────────────────
async function seedProducts() {
  const cats = await prisma.category.findMany({ select: { id: true, name: true } });
  const catByName = Object.fromEntries(cats.map((c) => [c.name, c.id]));
  if (!cats.length) {
    console.warn('  ⚠ No categories found — run `node prisma/seed-categories.js` first. Skipping products.');
    return;
  }

  let created = 0, updated = 0, skipped = 0;
  for (let i = 0; i < content.products.length; i++) {
    const p = content.products[i];
    const categoryId = catByName[p.category];
    if (!categoryId) {
      console.warn(`  ⚠ category not found: "${p.category}" — skipping "${p.name}"`);
      skipped++; continue;
    }
    const sellerId = sellerIds.length ? sellerIds[i % sellerIds.length] : null;
    const data = {
      categoryId, sellerId,
      name: p.name, nameHi: p.nameHi ?? null, nameMr: p.nameMr ?? null,
      description: p.description ?? null,
      price: p.price, mrp: p.mrp ?? null,
      unit: p.unit || 'unit', stock: p.stock ?? 0,
      images: images(p.imageKeywords),
      tags: p.tags ?? [], highlights: p.highlights ?? [],
      brand: p.brand ?? null, subcategory: p.subcategory ?? null,
      isActive: true, isFeatured: !!p.isFeatured,
      district: PUNE.district, state: PUNE.state, sellScope: 'state',
      minOrderQty: 1,
      rating: +(4 + (i % 10) / 10).toFixed(1),
      ratingCount: 3 + i,
    };
    const existing = await prisma.product.findFirst({
      where: { name: p.name, categoryId },
      select: { id: true },
    });
    if (existing) { await prisma.product.update({ where: { id: existing.id }, data }); updated++; }
    else { await prisma.product.create({ data }); created++; }
  }
  console.log(`  ✓ products — created: ${created}, updated: ${updated}, skipped: ${skipped}`);
}

async function main() {
  console.log('Seeding UI-demo data (Pune district)…');
  await seedFarmers();
  await seedSellers();
  await seedAnimalSellers();
  await seedMachineryOwners();
  await seedLabourProviders();
  await seedProducts();
  console.log('Done.');
}

main()
  .catch((err) => { console.error('❌ Seed failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
