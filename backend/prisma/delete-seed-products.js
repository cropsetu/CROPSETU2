/**
 * Deletes catalogue (sellerId = null) products that are NOT referenced by any
 * order — i.e. the seed-bighaat.js test catalogue. Products tied to a real order
 * are skipped to preserve order history. Cart entries cascade-delete automatically.
 * Seller-owned products (sellerId != null) are never touched.
 *
 * SAFE BY DEFAULT: dry-run unless CONFIRM=yes is set.
 *
 *   Dry run : DATABASE_URL="..." node prisma/delete-seed-products.js
 *   Execute : DATABASE_URL="..." CONFIRM=yes node prisma/delete-seed-products.js
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM === 'yes';

const TARGET = { sellerId: null, orderItems: { none: {} } };

async function main() {
  const target = await prisma.product.count({ where: TARGET });
  const blocked = await prisma.product.count({ where: { sellerId: null, orderItems: { some: {} } } });
  const sellerOwned = await prisma.product.count({ where: { NOT: { sellerId: null } } });

  console.log(`\nTo delete (catalogue, no orders) : ${target}`);
  console.log(`Skipped (referenced by an order) : ${blocked}`);
  console.log(`Seller-owned (untouched)         : ${sellerOwned}`);

  if (!CONFIRM) {
    console.log('\n[DRY RUN] Nothing deleted. Re-run with CONFIRM=yes to execute.');
    return;
  }

  const { count } = await prisma.product.deleteMany({ where: TARGET });
  const remaining = await prisma.product.count();
  console.log(`\n✅ Deleted ${count} catalogue products. Products remaining in DB: ${remaining}`);
}

main()
  .catch((err) => { console.error('❌ Failed:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
