/**
 * Bulk-add up to N shop products to the catalogue (defaults to the 10 below).
 *
 * HOW TO USE
 *   1. Edit the PRODUCTS array — fill in your 10 products.
 *      - `category` MUST match one of the valid category names (see VALID list).
 *      - `name` + `price` are the only truly required fields; the rest are optional.
 *      - `images` can be EITHER:
 *           a) public HTTPS URLs   -> stored as-is, e.g. 'https://res.cloudinary.com/.../x.jpg'
 *           b) local file paths    -> uploaded to Cloudinary, the returned URL is stored.
 *              (needs CLOUDINARY_* env vars; path is relative to this script or absolute)
 *      - Leave `images: []` to fall back to the in-app category placeholder.
 *   2. Run it (see "RUNNING AGAINST RAILWAY" below).
 *
 * Idempotent: matches by (name, categoryId). Re-running UPDATES the existing
 * product (price/stock/images/etc.) instead of creating a duplicate — safe to
 * run repeatedly. Admin-style catalogue products: sellerId = null, sellScope = 'state'.
 *
 * RUNNING LOCALLY:
 *   node prisma/add-products.js
 *
 * RUNNING AGAINST RAILWAY (production DB):
 *   Grab the Postgres connection string from the Railway dashboard
 *   (Postgres service -> Variables -> DATABASE_URL, the public proxy URL), then:
 *
 *     DATABASE_URL="postgresql://USER:PASS@HOST:PORT/railway" node prisma/add-products.js
 *
 *   Or from the Railway CLI (auto-injects the service vars):
 *     railway run node prisma/add-products.js
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import prisma from '../src/config/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Valid category names (must match exactly) ────────────────────────────────
const VALID_CATEGORIES = [
  'Seeds & Planting Material', 'Fertilizers & Soil Nutrition', 'Crop Protection',
  'Organic & Natural Farming', 'Plant Growth Regulators', 'Irrigation & Water Management',
  'Farm Machinery & Equipment', 'Hand Tools & Small Equipment', 'Protected Cultivation',
  'Micronutrients & Specialty Nutrition', 'Seeds Treatment & Additives', 'Livestock, Dairy & Poultry',
  'Fencing & Farm Protection', 'Storage & Packaging', 'Agri Technology & Smart Farming',
  'Solar & Energy', 'Safety & Protective Gear', 'Spraying Equipment', 'Harvesting & Post-Harvest',
  'Aquaculture & Fisheries', 'Horticulture & Nursery', 'Agri Inputs for Home & Kitchen Garden',
];

// ─────────────────────────────────────────────────────────────────────────────
// ✏️  EDIT BELOW — your 10 products. Replace names/prices/descriptions/images.
//     Only `category`, `name`, `price` are required; delete fields you don't need.
// ─────────────────────────────────────────────────────────────────────────────
const PRODUCTS = [
  {
    category: 'Seeds & Planting Material',
    name: 'PRODUCT 1 NAME',
    nameHi: '',                 // optional Hindi name
    nameMr: '',                 // optional Marathi name
    price: 0,                   // selling price (₹), > 0
    mrp: 0,                     // optional strike-through price
    unit: 'pack',               // kg | pack | bag | bottle | unit | piece | set | kit | roll
    stock: 100,
    brand: '',
    description: 'Full product description shown on the detail page.',
    highlights: ['Key point 1', 'Key point 2'],
    tags: ['seeds'],
    images: [],                 // 'https://...' URLs, or local file paths to upload
    isFeatured: false,
  },
  { category: 'Fertilizers & Soil Nutrition', name: 'PRODUCT 2 NAME', price: 0, unit: 'bag', stock: 100, description: '', highlights: [], tags: [], images: [] },
  { category: 'Crop Protection',              name: 'PRODUCT 3 NAME', price: 0, unit: 'bottle', stock: 100, description: '', highlights: [], tags: [], images: [] },
  { category: 'Hand Tools & Small Equipment', name: 'PRODUCT 4 NAME', price: 0, unit: 'piece', stock: 100, description: '', highlights: [], tags: [], images: [] },
  { category: 'Irrigation & Water Management',name: 'PRODUCT 5 NAME', price: 0, unit: 'kit',   stock: 100, description: '', highlights: [], tags: [], images: [] },
  { category: 'Organic & Natural Farming',    name: 'PRODUCT 6 NAME', price: 0, unit: 'bag',   stock: 100, description: '', highlights: [], tags: [], images: [] },
  { category: 'Spraying Equipment',           name: 'PRODUCT 7 NAME', price: 0, unit: 'unit',  stock: 100, description: '', highlights: [], tags: [], images: [] },
  { category: 'Solar & Energy',               name: 'PRODUCT 8 NAME', price: 0, unit: 'unit',  stock: 100, description: '', highlights: [], tags: [], images: [] },
  { category: 'Safety & Protective Gear',     name: 'PRODUCT 9 NAME', price: 0, unit: 'set',   stock: 100, description: '', highlights: [], tags: [], images: [] },
  { category: 'Horticulture & Nursery',       name: 'PRODUCT 10 NAME',price: 0, unit: 'pack',  stock: 100, description: '', highlights: [], tags: [], images: [] },
];
// ─────────────────────────────────────────────────────────────────────────────

const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s);

let _uploadBuffer = null; // lazy-loaded only if a local image path is used
async function resolveImages(images = [], productName) {
  const out = [];
  for (const img of images) {
    if (!img || typeof img !== 'string') continue;
    if (isUrl(img)) { out.push(img); continue; }

    // Local file path -> upload to Cloudinary
    if (!_uploadBuffer) {
      if (!process.env.CLOUDINARY_CLOUD_NAME) {
        console.warn(`  ⚠  "${img}" is a local path but CLOUDINARY_* is not configured — skipping this image`);
        continue;
      }
      ({ uploadBuffer: _uploadBuffer } = await import('../src/config/cloudinary.js'));
    }
    const abs = path.isAbsolute(img) ? img : path.resolve(__dirname, img);
    try {
      const buf = await readFile(abs);
      const url = await _uploadBuffer(buf, 'products');
      console.log(`  ⬆  uploaded ${path.basename(abs)} -> ${url}`);
      out.push(url);
    } catch (e) {
      console.warn(`  ⚠  failed to upload "${img}" for "${productName}": ${e.message}`);
    }
  }
  return out;
}

async function main() {
  console.log(`Adding ${PRODUCTS.length} products...\n`);

  // Resolve category name -> id once.
  const cats = await prisma.category.findMany({ select: { id: true, name: true } });
  const catByName = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  let created = 0, updated = 0, skipped = 0;

  for (const p of PRODUCTS) {
    // --- validation ---
    if (!p.name || p.name.startsWith('PRODUCT ')) { console.warn(`  ⚠  Skipping placeholder/empty name: "${p.name}"`); skipped++; continue; }
    if (!p.price || Number(p.price) <= 0)         { console.warn(`  ⚠  Skipping "${p.name}" — price must be > 0`); skipped++; continue; }
    if (!VALID_CATEGORIES.includes(p.category))   { console.warn(`  ⚠  Skipping "${p.name}" — unknown category "${p.category}"`); skipped++; continue; }

    const categoryId = catByName[p.category];
    if (!categoryId) { console.warn(`  ⚠  Category "${p.category}" not in DB (run seed-categories first) — skipping "${p.name}"`); skipped++; continue; }

    const images = await resolveImages(p.images, p.name);

    const data = {
      categoryId,
      sellerId: null,            // admin/catalogue product — no seller
      name: p.name,
      nameHi: p.nameHi || null,
      nameMr: p.nameMr || null,
      description: p.description || null,
      price: Number(p.price),
      mrp: p.mrp ? Number(p.mrp) : null,
      unit: p.unit || 'kg',
      stock: p.stock ?? 0,
      images,
      tags: p.tags ?? [],
      highlights: p.highlights ?? [],
      brand: p.brand || null,
      minOrderQty: p.minOrderQty ?? 1,
      sellScope: p.sellScope || 'state',
      isActive: p.isActive ?? true,
      isFeatured: p.isFeatured ?? false,
    };

    const existing = await prisma.product.findFirst({ where: { name: p.name, categoryId }, select: { id: true } });
    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data });
      console.log(`  ✓ updated: ${p.name}`);
      updated++;
    } else {
      await prisma.product.create({ data });
      console.log(`  ✓ created: ${p.name}`);
      created++;
    }
  }

  console.log(`\nDone — created: ${created}, updated: ${updated}, skipped: ${skipped}`);
}

main()
  .catch((err) => { console.error('❌ Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
