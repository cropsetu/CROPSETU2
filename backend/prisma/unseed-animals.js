/**
 * Unseed animals — wipes the AnimalTrade marketplace clean.
 *
 * Deletes (in order to respect FKs):
 *   1. chat_messages on chats tied to animal listings  (CASCADE handles this)
 *   2. chats         on animal listings
 *   3. animal_listings (ALL of them)
 *   4. (optional, with --drop-demo-sellers) the 5 demo seller users created
 *      by seed-animals.js when no SEED_SELLER_PHONE is set
 *      (phones 9000000101..9000000105)
 *
 * Safety: this is destructive. Pass --yes to actually run, otherwise it
 * prints what it WOULD do and exits.
 *
 * Run:
 *   node prisma/unseed-animals.js                    # dry run (preview)
 *   node prisma/unseed-animals.js --yes              # delete listings + chats
 *   node prisma/unseed-animals.js --yes --drop-demo-sellers
 */
import prisma from '../src/config/db.js';

const FLAGS = new Set(process.argv.slice(2));
const APPLY            = FLAGS.has('--yes');
const DROP_DEMO_SELLERS = FLAGS.has('--drop-demo-sellers');

const DEMO_SELLER_PHONES = ['9000000101', '9000000102', '9000000103', '9000000104', '9000000105'];

async function main() {
  const listingCount = await prisma.animalListing.count();
  const chatCount    = await prisma.chat.count();
  const msgCount     = await prisma.chatMessage.count();

  console.log('Animal marketplace contents:');
  console.log(`  animal_listings: ${listingCount}`);
  console.log(`  chats:           ${chatCount}`);
  console.log(`  chat_messages:   ${msgCount}`);

  let demoUsers = [];
  if (DROP_DEMO_SELLERS) {
    demoUsers = await prisma.user.findMany({
      where: { phone: { in: DEMO_SELLER_PHONES } },
      select: { id: true, phone: true, name: true },
    });
    console.log(`  demo seller users to drop: ${demoUsers.length}`);
    demoUsers.forEach(u => console.log(`    - ${u.phone}  ${u.name || ''}`));
  }

  if (!APPLY) {
    console.log('\nDry run — re-run with --yes to actually delete.');
    return;
  }

  console.log('\nDeleting...');

  // ChatMessage → Chat → AnimalListing
  // ChatMessage cascade-deletes when its Chat is deleted (schema sets it).
  const delChats   = await prisma.chat.deleteMany();
  const delListings = await prisma.animalListing.deleteMany();
  console.log(`  ✓ chats deleted:           ${delChats.count}`);
  console.log(`  ✓ animal_listings deleted: ${delListings.count}`);

  if (DROP_DEMO_SELLERS && demoUsers.length) {
    // Only delete users that have no other content — guard against wiping
    // a user who happens to have posts/orders/etc.
    let dropped = 0, skipped = 0;
    for (const u of demoUsers) {
      const refs = await prisma.user.findUnique({
        where: { id: u.id },
        select: {
          _count: {
            select: {
              orders: true, posts: true, comments: true, sellerProducts: true,
              machineryListings: true, labourListings: true, farms: true,
            },
          },
        },
      });
      const total = Object.values(refs._count).reduce((a, b) => a + b, 0);
      if (total > 0) {
        skipped++;
        console.log(`    skipped ${u.phone} — has ${total} non-animal record(s)`);
        continue;
      }
      await prisma.user.delete({ where: { id: u.id } });
      dropped++;
    }
    console.log(`  ✓ demo sellers dropped: ${dropped} (skipped: ${skipped})`);
  }

  console.log('\nDone. Animals marketplace is empty — real users can now post.');
}

main()
  .catch(err => { console.error('Failed:', err); process.exit(1); })
  .finally(() => prisma.$disconnect());
