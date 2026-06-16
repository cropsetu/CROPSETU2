/**
 * generate-products.js — create 20 AgriStore products with AI-generated images.
 *
 * For each product it generates 3 photorealistic images with OpenAI gpt-image-1
 * (studio shot + in-field shot + close-up), uploads each to Cloudinary, and
 * upserts the product (admin catalogue: sellerId = null, sellScope = 'state').
 *
 * NOTE: images are AI-generated and GENERIC — they intentionally do NOT depict
 * real brand logos/packaging (brand names live only in the text fields).
 *
 * Idempotent: matches by (name, categoryId). A product that already has images
 * is SKIPPED (no re-spend) unless FORCE=yes.
 *
 * Env required: OPENAI_API_KEY, CLOUDINARY_CLOUD_NAME/_API_KEY/_API_SECRET, DATABASE_URL
 * Env optional: LIMIT (process only first N), QUALITY (low|medium|high, default medium),
 *               SIZE (default 1024x1024), FORCE=yes (regenerate even if images exist)
 *
 * Run (see run command in chat — pulls secrets from Railway services).
 */
import { PrismaClient } from '@prisma/client';
import { v2 as cloudinary } from 'cloudinary';

const prisma = new PrismaClient();
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const QUALITY = process.env.QUALITY || 'medium';
const SIZE = process.env.SIZE || '1024x1024';
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const FORCE = process.env.FORCE === 'yes';

// ── 20 products. `subject` = generic visual for image-gen (no brand logos). ───
const PRODUCTS = [
  { category: 'Farm Machinery & Equipment', name: 'Mahindra 575 DI XP Plus Tractor (47 HP)', brand: 'Mahindra', price: 785000, mrp: 820000, unit: 'unit', stock: 5,
    description: '47 HP, 4-cylinder diesel tractor with 1600 kg lift capacity. Ideal for ploughing, haulage and rotavator work on medium farms.',
    highlights: ['47 HP engine', '1600 kg hydraulic lift', '8 forward + 2 reverse gears'], tags: ['tractor', 'machinery'], isFeatured: true,
    subject: 'a modern red 47-horsepower farm tractor, full side view' },
  { category: 'Farm Machinery & Equipment', name: 'John Deere 5050D Tractor (50 HP)', brand: 'John Deere', price: 845000, mrp: 890000, unit: 'unit', stock: 4,
    description: '50 HP 3-cylinder tractor with collar-shift transmission and 1800 kg lift. Fuel-efficient for diverse field operations.',
    highlights: ['50 HP', '1800 kg lift', 'Collar-shift transmission'], tags: ['tractor', 'machinery'],
    subject: 'a green and yellow 50-horsepower agricultural tractor, three-quarter front view' },
  { category: 'Farm Machinery & Equipment', name: 'Honda Power Tiller F300 (7 HP)', brand: 'Honda', price: 78000, mrp: 85000, unit: 'unit', stock: 10,
    description: 'Compact 7 HP power tiller for small farms and orchards. Fuel-efficient GX-series petrol engine, easy to manoeuvre.',
    highlights: ['7 HP petrol engine', 'Compact & light', 'Subsidy eligible'], tags: ['tiller', 'machinery'],
    subject: 'a small two-wheel walk-behind power tiller with rotary blades' },
  { category: 'Harvesting & Post-Harvest', name: 'Kubota Combine Harvester DC-70 Plus', brand: 'Kubota', price: 2450000, mrp: 2600000, unit: 'unit', stock: 2,
    description: 'Track-type combine harvester for paddy and wheat. High-capacity grain tank with low grain loss.',
    highlights: ['Paddy & wheat', 'Rubber tracks', 'Low grain loss'], tags: ['harvester', 'machinery'], isFeatured: true,
    subject: 'a large orange track-type combine harvester machine in a wheat field' },
  { category: 'Harvesting & Post-Harvest', name: 'VST Shakti Power Reaper (4-Stroke)', brand: 'VST Shakti', price: 38500, mrp: 42000, unit: 'unit', stock: 12,
    description: 'Walk-behind petrol reaper for harvesting paddy and wheat. Cuts and windrows crop in a single pass.',
    highlights: ['4-stroke petrol', 'Walk-behind', 'Paddy & wheat'], tags: ['reaper', 'harvest'],
    subject: 'a small walk-behind crop reaper harvester machine with cutting blades' },
  { category: 'Seeds & Planting Material', name: 'Mahyco Hybrid Tomato Seeds (10g)', brand: 'Mahyco', price: 195, mrp: 240, unit: 'pack', stock: 200,
    description: 'High-yield hybrid tomato seeds with strong disease resistance and >90% germination. Suited for kharif and rabi.',
    highlights: ['90%+ germination', 'Disease resistant', '4-5 kg/plant'], tags: ['seeds', 'vegetable'], isFeatured: true,
    subject: 'a sealed foil seed packet of hybrid tomato seeds with plain agricultural packaging and tomato illustration, no brand logo' },
  { category: 'Seeds & Planting Material', name: 'Nuziveedu BT Cotton Seeds (450g)', brand: 'Nuziveedu', price: 850, mrp: 920, unit: 'pack', stock: 120,
    description: 'BT cotton hybrid resistant to American bollworm, GEAC approved. High lint quality, 160-180 day duration.',
    highlights: ['Bollworm resistant', 'High lint quality', 'GEAC approved'], tags: ['seeds', 'cotton'],
    subject: 'a sealed packet of cotton seeds with plain agricultural packaging and cotton boll illustration, no brand logo' },
  { category: 'Crop Protection', name: 'Bayer Confidor Insecticide (Imidacloprid 17.8% SL, 500ml)', brand: 'Bayer', price: 480, mrp: 560, unit: 'bottle', stock: 150,
    description: 'Systemic insecticide for sucking pests — aphids, jassids, whitefly. Long residual action, wide-spectrum.',
    highlights: ['Systemic action', 'Controls sucking pests', '7-day residual'], tags: ['insecticide', 'pesticide'], isFeatured: true,
    subject: 'a generic plastic agrochemical insecticide bottle with plain blue and white label, no brand logo, on white background' },
  { category: 'Crop Protection', name: 'Syngenta Amistar Fungicide (Azoxystrobin 23% SC, 250ml)', brand: 'Syngenta', price: 720, mrp: 850, unit: 'bottle', stock: 100,
    description: 'Broad-spectrum systemic fungicide controlling blast, blight and sheath rot. Preventive and curative action.',
    highlights: ['Broad-spectrum', 'Preventive + curative', 'Systemic'], tags: ['fungicide', 'pesticide'],
    subject: 'a generic plastic agrochemical fungicide bottle with plain green and white label, no brand logo, on white background' },
  { category: 'Crop Protection', name: 'UPL Saaf Fungicide (Carbendazim 12% + Mancozeb 63% WP, 1kg)', brand: 'UPL', price: 380, mrp: 440, unit: 'pack', stock: 180,
    description: 'Contact + systemic combination fungicide for blight, rust and downy mildew across crops.',
    highlights: ['Dual action', 'Rain-fast', 'Wide crop range'], tags: ['fungicide', 'pesticide'],
    subject: 'a generic foil pack of yellow agricultural fungicide powder with plain label, no brand logo, on white background' },
  { category: 'Crop Protection', name: 'Tata Rallis Tafgor Insecticide (Dimethoate 30% EC, 1L)', brand: 'Tata Rallis', price: 540, mrp: 620, unit: 'bottle', stock: 120,
    description: 'Systemic and contact organophosphate insecticide for aphids, mites and shoot borers.',
    highlights: ['Systemic + contact', 'Fast knockdown', 'Wide-spectrum'], tags: ['insecticide', 'pesticide'],
    subject: 'a generic one-litre agrochemical insecticide bottle with plain orange label, no brand logo, on white background' },
  { category: 'Irrigation & Water Management', name: 'Kirloskar 5 HP Monoblock Water Pump', brand: 'Kirloskar', price: 14500, mrp: 16500, unit: 'unit', stock: 25,
    description: 'Single-phase 5 HP monoblock centrifugal pump for irrigation. High head and discharge, cast-iron body.',
    highlights: ['5 HP', 'High head & discharge', 'Cast-iron body'], tags: ['motor', 'pump', 'irrigation'], isFeatured: true,
    subject: 'a green cast-iron electric monoblock water pump motor, product shot on white background' },
  { category: 'Irrigation & Water Management', name: 'Crompton 1 HP Submersible Pump (V4)', brand: 'Crompton', price: 9800, mrp: 11200, unit: 'unit', stock: 30,
    description: '4-inch borewell submersible pump, 1 HP, with stainless-steel body for deep-well irrigation.',
    highlights: ['Borewell submersible', 'Stainless steel', '1 HP'], tags: ['motor', 'pump', 'irrigation'],
    subject: 'a long cylindrical stainless-steel borewell submersible water pump, product shot on white background' },
  { category: 'Irrigation & Water Management', name: 'Jain Irrigation HDPE Pipe 63mm (100m Roll)', brand: 'Jain Irrigation', price: 6800, mrp: 7600, unit: 'roll', stock: 40,
    description: 'UV-stabilised HDPE pipe roll for irrigation mainlines. Corrosion-free, flexible, long service life.',
    highlights: ['UV-stabilised', 'Corrosion-free', '100m roll'], tags: ['pipe', 'irrigation'],
    subject: 'a large coiled roll of black HDPE irrigation pipe, product shot on white background' },
  { category: 'Irrigation & Water Management', name: 'Finolex PVC Pipes 4-inch (Pack of 6, 3m each)', brand: 'Finolex', price: 4200, mrp: 4800, unit: 'pack', stock: 50,
    description: 'Rigid PVC pipes for water conveyance and drainage. ISI-marked, leak-proof socket joints.',
    highlights: ['ISI marked', 'Leak-proof joints', '4-inch diameter'], tags: ['pipe', 'irrigation'],
    subject: 'a bundle of grey rigid PVC water pipes stacked together, product shot on white background' },
  { category: 'Solar & Energy', name: 'Tata Power Solar Panel 330W Polycrystalline', brand: 'Tata Power Solar', price: 8900, mrp: 10500, unit: 'unit', stock: 35,
    description: '330W polycrystalline solar panel with anti-reflective tempered glass. 25-year performance warranty.',
    highlights: ['330W output', 'Tempered glass', '25-yr warranty'], tags: ['solar', 'panel'], isFeatured: true,
    subject: 'a blue polycrystalline solar panel with aluminium frame, product shot on white background' },
  { category: 'Solar & Energy', name: 'Luminous Solar Water Pump 3 HP (DC)', brand: 'Luminous', price: 145000, mrp: 165000, unit: 'unit', stock: 6,
    description: 'PM-KUSUM eligible DC submersible solar pump set with panels and controller. 5-year warranty.',
    highlights: ['PM-KUSUM eligible', '3 HP DC', '5-yr warranty'], tags: ['solar', 'pump'],
    subject: 'a solar powered water pump system with solar panels and a submersible pump, in a farm field' },
  { category: 'Spraying Equipment', name: 'Aspee Battery Knapsack Sprayer 16L', brand: 'Aspee', price: 2350, mrp: 2800, unit: 'unit', stock: 100,
    description: 'Rechargeable 16L knapsack sprayer with ~6 hr runtime per charge. Adjustable nozzles, comfortable straps.',
    highlights: ['16L tank', '6 hr battery', 'Adjustable nozzle'], tags: ['sprayer', 'battery'],
    subject: 'a blue 16-litre battery-powered knapsack agricultural sprayer with shoulder straps, product shot on white background' },
  { category: 'Hand Tools & Small Equipment', name: 'Falcon Garden Hand Tool Set (Khurpi, Sickle, Trowel)', brand: 'Falcon', price: 650, mrp: 780, unit: 'set', stock: 150,
    description: 'Forged-steel hand tool set with wooden handles — khurpi, sickle and trowel for weeding and harvesting.',
    highlights: ['Forged steel', 'Wooden handles', '3-piece set'], tags: ['tools', 'hand'],
    subject: 'a set of three forged-steel farming hand tools — a hand weeder, a sickle and a trowel — with wooden handles, on white background' },
  { category: 'Agri Technology & Smart Farming', name: 'Digital Soil Moisture & pH Meter (4-in-1)', brand: 'AgriTech', price: 1850, mrp: 2200, unit: 'unit', stock: 40,
    description: 'Handheld 4-in-1 meter measuring soil moisture, pH, temperature and light. Battery-free probe with LCD display.',
    highlights: ['4-in-1 readings', 'No battery probe', 'LCD display'], tags: ['instrument', 'sensor'], isFeatured: true,
    subject: 'a handheld digital soil testing meter instrument with two metal probes and an LCD screen, product shot on white background' },
];

// How many images to generate per product (aligned to PRODUCTS order above).
// Varied on purpose — not every product gets 3. Big-ticket/visual items get
// more angles; simple consumables (packets, bottles, pipes, tools) get 1.
const IMG_COUNTS = [
  3, 3, 3, 3, 2,   // tractors, tiller, harvester, reaper
  1, 1, 2, 2, 1,   // seeds, insecticide/fungicide
  1, 2, 2, 1, 1,   // insecticide, pumps, pipes
  3, 2, 2, 1, 2,   // solar panel, solar pump, sprayer, tools, soil meter
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildPrompts(p) {
  return [
    `${p.subject}. Professional e-commerce product photography, centered on a clean white studio background, soft even lighting, sharp focus, high detail, photorealistic, 4k.`,
    `${p.subject}. Photographed in a realistic Indian agricultural setting with natural daylight, fields in the background, photorealistic, high detail.`,
    `${p.subject}. Close-up detail shot emphasising texture, material and build quality, shallow depth of field, photorealistic, high resolution.`,
  ];
}

async function genImage(prompt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 150000); // 150s safety timeout per image
  try {
    const res = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model: 'gpt-image-1', prompt, n: 1, size: SIZE, quality: QUALITY }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 300)}`);
    }
    const json = await res.json();
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image data returned');
    return b64;
  } finally {
    clearTimeout(timer);
  }
}

async function uploadToCloudinary(b64, name) {
  const r = await cloudinary.uploader.upload(`data:image/png;base64,${b64}`, {
    folder: 'products', resource_type: 'image',
  });
  return r.secure_url;
}

async function main() {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not set');
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error('CLOUDINARY_* not set');

  const cats = await prisma.category.findMany({ select: { id: true, name: true } });
  const catByName = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  const todo = PRODUCTS.slice(0, LIMIT);
  console.log(`Generating ${todo.length} products  (quality=${QUALITY}, size=${SIZE}, varied image count)\n`);

  let created = 0, updated = 0, skipped = 0, imgFails = 0;

  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    const nImages = IMG_COUNTS[i] ?? 3;
    const categoryId = catByName[p.category];
    if (!categoryId) { console.warn(`  ⚠  unknown category "${p.category}" — skipping ${p.name}`); skipped++; continue; }

    const existing = await prisma.product.findFirst({
      where: { name: p.name, categoryId }, select: { id: true, images: true },
    });
    if (existing && existing.images.length > 0 && !FORCE) {
      console.log(`  ⏭  already has images, skipping: ${p.name}  (FORCE=yes to regenerate)`);
      skipped++; continue;
    }

    // Generate nImages images concurrently, then upload.
    console.log(`  🎨 generating ${nImages} image(s): ${p.name}`);
    const prompts = buildPrompts(p).slice(0, nImages);
    const results = await Promise.allSettled(prompts.map((pr) => genImage(pr)));
    const images = [];
    for (const r of results) {
      if (r.status === 'fulfilled') {
        try { images.push(await uploadToCloudinary(r.value, p.name)); }
        catch (e) { imgFails++; console.warn(`     ⚠ upload failed: ${e.message}`); }
      } else { imgFails++; console.warn(`     ⚠ image gen failed: ${r.reason.message}`); }
    }
    console.log(`     → ${images.length}/${nImages} images ready`);

    const data = {
      categoryId, sellerId: null,
      name: p.name, description: p.description || null,
      price: Number(p.price), mrp: p.mrp ? Number(p.mrp) : null,
      unit: p.unit || 'unit', stock: p.stock ?? 0,
      images, tags: p.tags ?? [], highlights: p.highlights ?? [],
      brand: p.brand || null, minOrderQty: 1, sellScope: 'state',
      isActive: true, isFeatured: p.isFeatured ?? false,
    };

    if (existing) {
      await prisma.product.update({ where: { id: existing.id }, data });
      console.log(`     ✓ updated: ${p.name}`); updated++;
    } else {
      await prisma.product.create({ data });
      console.log(`     ✓ created: ${p.name}`); created++;
    }
    await sleep(500); // gentle pacing for OpenAI rate limits
  }

  console.log(`\nDone — created: ${created}, updated: ${updated}, skipped: ${skipped}, image failures: ${imgFails}`);
}

main()
  .catch((err) => { console.error('❌ Failed:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
