/**
 * Seed AnimalTrade listings — representative livestock across categories.
 *
 * Listings are attached to a REAL user (so they can manage them in the app).
 * Resolution order for the owner:
 *   1. CLI arg:          node prisma/seed-animals.js 9022959934
 *   2. Env var:          SEED_SELLER_PHONE=9022959934 node prisma/seed-animals.js
 *   3. Auto-fallback:    most recently active user in the DB
 *
 * Idempotent: matches by (sellerId, animal, breed, age). Re-running updates
 * existing rows in place.
 */
import prisma from '../src/config/db.js';

const ARG_PHONE = process.argv[2]?.trim() || null;
const ENV_PHONE = process.env.SEED_SELLER_PHONE?.trim() || null;
const REQUESTED_PHONE = ARG_PHONE || ENV_PHONE;

// ── Animal listings grouped by category (animal) ──────────────────────────────
const LISTINGS = [
  // ── Cows ──
  { category: 'Cow',
    items: [
      { breed: 'Gir', age: '4 years', gender: 'FEMALE', weight: '420 kg',
        price: 75000, milkYield: '12-15 L/day',
        description: 'Pure Gir cow, 2nd lactation. A2 milk. Vaccinated, healthy, calm temperament.',
        tags: ['cow', 'gir', 'a2-milk', 'dairy'], verified: true, sellerIdx: 0 },
      { breed: 'Sahiwal', age: '5 years', gender: 'FEMALE', weight: '450 kg',
        price: 82000, milkYield: '14-16 L/day',
        description: 'Sahiwal cow in 3rd lactation. Tick-resistant native breed. Pregnant, due in 2 months.',
        tags: ['cow', 'sahiwal', 'dairy', 'pregnant'], verified: true, sellerIdx: 1 },
      { breed: 'Holstein Friesian (HF) Cross', age: '3 years', gender: 'FEMALE', weight: '480 kg',
        price: 95000, milkYield: '20-22 L/day',
        description: 'HF crossbred, 1st lactation. High milk yield. AI-bred.',
        tags: ['cow', 'hf', 'crossbred', 'high-yield'], sellerIdx: 2 },
      { breed: 'Jersey Cross', age: '4 years', gender: 'FEMALE', weight: '380 kg',
        price: 68000, milkYield: '15-18 L/day',
        description: 'Jersey crossbred cow. Compact build, high fat content milk.',
        tags: ['cow', 'jersey', 'dairy'], sellerIdx: 0 },
    ]
  },
  // ── Buffalo ──
  { category: 'Buffalo',
    items: [
      { breed: 'Murrah', age: '5 years', gender: 'FEMALE', weight: '550 kg',
        price: 115000, milkYield: '16-20 L/day',
        description: 'Pedigree Murrah buffalo, 3rd lactation. Black colour, curled horns. Top-grade milk.',
        tags: ['buffalo', 'murrah', 'dairy'], verified: true, sellerIdx: 3 },
      { breed: 'Jaffrabadi', age: '6 years', gender: 'FEMALE', weight: '620 kg',
        price: 135000, milkYield: '18-22 L/day',
        description: 'Heavy-build Jaffrabadi buffalo. 4th lactation, calf with mother.',
        tags: ['buffalo', 'jaffrabadi', 'with-calf'], verified: true, sellerIdx: 4 },
      { breed: 'Mehsana', age: '4 years', gender: 'FEMALE', weight: '500 kg',
        price: 92000, milkYield: '12-15 L/day',
        description: 'Mehsana buffalo, 2nd lactation. Mix of Murrah & Surti characteristics.',
        tags: ['buffalo', 'mehsana', 'dairy'], sellerIdx: 1 },
      { breed: 'Surti', age: '5 years', gender: 'FEMALE', weight: '440 kg',
        price: 78000, milkYield: '10-12 L/day',
        description: 'Surti buffalo, high fat content (7-8%). Suited for ghee production.',
        tags: ['buffalo', 'surti', 'ghee'], sellerIdx: 2 },
    ]
  },
  // ── Goats ──
  { category: 'Goat',
    items: [
      { breed: 'Sirohi', age: '1.5 years', gender: 'FEMALE', weight: '35 kg',
        price: 12000, milkYield: '1.5-2 L/day',
        description: 'Sirohi doe — dual purpose (meat + milk). Vaccinated, dewormed.',
        tags: ['goat', 'sirohi', 'doe'], verified: true, sellerIdx: 0 },
      { breed: 'Boer', age: '1 year', gender: 'MALE', weight: '45 kg',
        price: 22000,
        description: 'Pure Boer buck — fast growth, top breeding stock. Imported lineage.',
        tags: ['goat', 'boer', 'buck', 'breeding'], verified: true, sellerIdx: 1 },
      { breed: 'Jamunapari', age: '2 years', gender: 'FEMALE', weight: '50 kg',
        price: 18000, milkYield: '2-3 L/day',
        description: 'Jamunapari doe — tall, long-eared. Excellent dairy goat.',
        tags: ['goat', 'jamunapari', 'dairy'], sellerIdx: 3 },
      { breed: 'Black Bengal', age: '1 year', gender: 'FEMALE', weight: '20 kg',
        price: 8500,
        description: 'Black Bengal doe — prolific breeder, high-quality skin & meat.',
        tags: ['goat', 'black-bengal', 'meat'], sellerIdx: 4 },
      { breed: 'Osmanabadi', age: '1.5 years', gender: 'MALE', weight: '40 kg',
        price: 15000,
        description: 'Osmanabadi buck — native Maharashtra breed, hardy, drought-tolerant.',
        tags: ['goat', 'osmanabadi', 'native'], sellerIdx: 2 },
    ]
  },
  // ── Sheep ──
  { category: 'Sheep',
    items: [
      { breed: 'Deccani', age: '2 years', gender: 'FEMALE', weight: '35 kg',
        price: 9500,
        description: 'Deccani ewe — coarse wool & mutton breed. Adapted to dry zones.',
        tags: ['sheep', 'deccani', 'ewe'], sellerIdx: 3 },
      { breed: 'Nellore', age: '1.5 years', gender: 'MALE', weight: '45 kg',
        price: 14000,
        description: 'Nellore ram — tall, hair sheep, premium mutton.',
        tags: ['sheep', 'nellore', 'ram', 'meat'], sellerIdx: 4 },
      { breed: 'Mandya', age: '2 years', gender: 'FEMALE', weight: '30 kg',
        price: 8500,
        description: 'Mandya ewe — compact mutton breed from Karnataka.',
        tags: ['sheep', 'mandya'], sellerIdx: 0 },
    ]
  },
  // ── Poultry ──
  { category: 'Poultry',
    items: [
      { breed: 'Kadaknath (Black Chicken) — 10 birds', age: '3 months', gender: 'FEMALE', weight: '1.2 kg each',
        price: 8500,
        description: 'Pack of 10 Kadaknath chicks — premium black-meat breed, high protein & iron.',
        tags: ['poultry', 'kadaknath', 'native', 'pack-10'], verified: true, sellerIdx: 1 },
      { breed: 'Broiler (Cobb 500) — 50 chicks', age: '1 week', gender: 'MALE', weight: '50 g each',
        price: 4500,
        description: 'Day-old broiler chicks, vaccinated. Marek\'s + IBD vaccines done.',
        tags: ['poultry', 'broiler', 'chicks', 'pack-50'], sellerIdx: 2 },
      { breed: 'BV-300 Layer — 20 birds', age: '18 weeks', gender: 'FEMALE', weight: '1.4 kg each',
        price: 7200,
        description: 'Pre-lay BV-300 layer pullets. ~300 eggs/year per bird.',
        tags: ['poultry', 'layer', 'eggs', 'pack-20'], sellerIdx: 3 },
      { breed: 'Desi (Country) Chicken — 5 birds', age: '6 months', gender: 'FEMALE', weight: '1.6 kg each',
        price: 3500,
        description: 'Free-range desi hens. Excellent for backyard poultry.',
        tags: ['poultry', 'desi', 'backyard'], sellerIdx: 0 },
    ]
  },
  // ── Bulls & Oxen ──
  { category: 'Bull',
    items: [
      { breed: 'Khillar', age: '4 years', gender: 'MALE', weight: '550 kg',
        price: 95000,
        description: 'Khillar bullock pair available — traditional draught breed. Trained for ploughing.',
        tags: ['bull', 'khillar', 'draught'], verified: true, sellerIdx: 4 },
      { breed: 'Gir Bull', age: '3 years', gender: 'MALE', weight: '600 kg',
        price: 125000,
        description: 'Pure Gir breeding bull — semen quality verified. AI-station eligible.',
        tags: ['bull', 'gir', 'breeding'], verified: true, sellerIdx: 0 },
      { breed: 'Murrah Bull', age: '3.5 years', gender: 'MALE', weight: '700 kg',
        price: 145000,
        description: 'Premium Murrah breeding bull, parents from elite dairy farm.',
        tags: ['bull', 'murrah', 'breeding'], sellerIdx: 3 },
    ]
  },
  // ── Calf ──
  { category: 'Calf',
    items: [
      { breed: 'HF Cross Calf', age: '4 months', gender: 'FEMALE', weight: '85 kg',
        price: 18000,
        description: 'HF crossbred female calf — healthy, weaned. From high-yielding dam (24 L/day).',
        tags: ['calf', 'hf', 'female'], sellerIdx: 1 },
      { breed: 'Murrah Calf', age: '3 months', gender: 'FEMALE', weight: '70 kg',
        price: 22000,
        description: 'Murrah buffalo calf — pedigree dam. Drinking milk.',
        tags: ['calf', 'murrah', 'female'], sellerIdx: 2 },
    ]
  },
  // ── Pig ──
  { category: 'Pig',
    items: [
      { breed: 'Yorkshire (Large White)', age: '6 months', gender: 'FEMALE', weight: '80 kg',
        price: 18000,
        description: 'Yorkshire sow — high prolificacy, fast growth. Ready for breeding.',
        tags: ['pig', 'yorkshire', 'sow'], sellerIdx: 4 },
      { breed: 'Hampshire Cross', age: '4 months', gender: 'MALE', weight: '60 kg',
        price: 12000,
        description: 'Hampshire crossbred — lean meat, suited for pork production.',
        tags: ['pig', 'hampshire', 'meat'], sellerIdx: 1 },
    ]
  },
  // ── Duck ──
  { category: 'Duck',
    items: [
      { breed: 'Khaki Campbell — 10 birds', age: '5 months', gender: 'FEMALE', weight: '1.8 kg each',
        price: 4500,
        description: 'Khaki Campbell laying ducks — ~280 eggs/year. Ideal for paddy-duck integrated farming.',
        tags: ['duck', 'khaki-campbell', 'eggs', 'pack-10'], sellerIdx: 3 },
      { breed: 'Indian Runner — 6 birds', age: '4 months', gender: 'FEMALE', weight: '1.5 kg each',
        price: 2800,
        description: 'Indian Runner ducks — upright stance, great foragers, lay 200+ eggs/year.',
        tags: ['duck', 'indian-runner', 'eggs'], sellerIdx: 0 },
    ]
  },
  // ── Camel & Horse (specialty) ──
  { category: 'Camel',
    items: [
      { breed: 'Bikaneri', age: '6 years', gender: 'MALE', weight: '650 kg',
        price: 85000,
        description: 'Bikaneri male camel — trained for cart pulling & farm work.',
        tags: ['camel', 'bikaneri', 'draught'], sellerIdx: 2 },
    ]
  },
  { category: 'Horse',
    items: [
      { breed: 'Marwari', age: '5 years', gender: 'MALE', weight: '420 kg',
        price: 185000,
        description: 'Marwari stallion — distinctive inward-curved ears. Trained for riding.',
        tags: ['horse', 'marwari', 'riding'], verified: true, sellerIdx: 4 },
      { breed: 'Kathiawari', age: '4 years', gender: 'FEMALE', weight: '380 kg',
        price: 145000,
        description: 'Kathiawari mare — hardy breed, suited for endurance riding.',
        tags: ['horse', 'kathiawari', 'mare'], sellerIdx: 0 },
    ]
  },
];

async function resolveOwner() {
  const USER_FIELDS = {
    id: true, phone: true, name: true,
    state: true, district: true, city: true, lat: true, lng: true,
  };

  if (REQUESTED_PHONE) {
    const user = await prisma.user.findUnique({
      where: { phone: REQUESTED_PHONE },
      select: USER_FIELDS,
    });
    if (!user) {
      throw new Error(
        `User with phone ${REQUESTED_PHONE} not found. Log in once via the app to create the user, then re-run.`
      );
    }
    return user;
  }

  // Auto-fallback: most recently active real user (any role).
  const user = await prisma.user.findFirst({
    where: { isActive: true },
    orderBy: [{ lastActiveAt: 'desc' }, { updatedAt: 'desc' }, { createdAt: 'desc' }],
    select: USER_FIELDS,
  });
  if (!user) {
    throw new Error(
      'No users exist in the database. Log in via the app first, or pass a phone: node prisma/seed-animals.js <phone>'
    );
  }
  return user;
}

async function main() {
  console.log('Seeding animal listings...');

  const owner = await resolveOwner();
  const seller = {
    state:    owner.state    || 'Maharashtra',
    district: owner.district || 'Pune',
    city:     owner.city     || 'Pune',
    lat:      owner.lat ?? 18.5204,
    lng:      owner.lng ?? 73.8567,
  };
  const sellerLocation = `${seller.city}, ${seller.district}, ${seller.state}`;
  console.log(`  Owner: ${owner.name || owner.phone} (${owner.phone}) — all listings attached to this user`);

  let created = 0, updated = 0;

  for (const group of LISTINGS) {
    for (const item of group.items) {
      const sellerId = owner.id;

      const data = {
        sellerId,
        animal: group.category,
        breed: item.breed,
        age: item.age,
        gender: item.gender,
        weight: item.weight,
        price: item.price,
        milkYield: item.milkYield ?? null,
        description: item.description ?? null,
        images: item.images ?? [],
        tags: item.tags ?? [],
        verified: item.verified ?? false,
        status: 'ACTIVE',
        sellerLocation,
        lat: seller.lat,
        lng: seller.lng,
      };

      const existing = await prisma.animalListing.findFirst({
        where: { sellerId, animal: group.category, breed: item.breed, age: item.age },
        select: { id: true },
      });

      if (existing) {
        await prisma.animalListing.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.animalListing.create({ data });
        created++;
      }
    }
  }

  console.log(`Done — created: ${created}, updated: ${updated}`);
}

main()
  .catch(err => { console.error('❌ Seed failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
