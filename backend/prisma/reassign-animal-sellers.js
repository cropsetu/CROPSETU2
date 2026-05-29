/**
 * One-shot fix: reassign EVERY animal_listings.sellerId to a single real user.
 *
 * Use this when:
 *   - Seed data left listings under demo accounts you can't log in as.
 *   - You want every listing visible on your "My Listings" page so you can
 *     manage them.
 *
 * Run (PowerShell):
 *   $env:SEED_SELLER_PHONE="9022959934"; node prisma/reassign-animal-sellers.js
 * Run (bash):
 *   SEED_SELLER_PHONE=9022959934 node prisma/reassign-animal-sellers.js
 * Run (positional arg):
 *   node prisma/reassign-animal-sellers.js 9022959934
 */
import prisma from '../src/config/db.js';

const PHONE = (process.argv[2] || process.env.SEED_SELLER_PHONE || '').trim();

async function main() {
  if (!PHONE) {
    console.error('Usage: node prisma/reassign-animal-sellers.js <phone>');
    console.error('   or: SEED_SELLER_PHONE=<phone> node prisma/reassign-animal-sellers.js');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { phone: PHONE },
    select: { id: true, name: true, phone: true },
  });
  if (!user) {
    console.error(`User with phone ${PHONE} not found. Log in via the app first.`);
    process.exit(1);
  }

  const before = await prisma.animalListing.count();
  const alreadyMine = await prisma.animalListing.count({ where: { sellerId: user.id } });

  console.log(`Reassigning ${before} animal_listings to ${user.name || user.phone} (id=${user.id})`);
  console.log(`  ${alreadyMine} already belong to this user — ${before - alreadyMine} will be updated`);

  const result = await prisma.animalListing.updateMany({
    data: { sellerId: user.id },
  });

  console.log(`Done — ${result.count} row(s) updated.`);
}

main()
  .catch(err => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
