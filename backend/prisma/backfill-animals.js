/**
 * Backfill the normalised AnimalListing columns added alongside the marketplace
 * rework: ageMonths, weightKg, milkYieldLpd, searchText, vaccinated,
 * healthCertificate, negotiable and expiresAt.
 *
 * The listing API is written to work WITHOUT this having run — search falls back
 * to the legacy per-column ILIKEs when `searchText` is null, and the numeric
 * filters simply skip rows they cannot judge. Running it turns those fallbacks
 * off and makes every existing listing filterable and searchable in Marathi.
 *
 * Safe to re-run: it is idempotent, processes in batches, and only writes rows
 * whose derived values would actually change.
 *
 *   node prisma/backfill-animals.js            # backfill
 *   node prisma/backfill-animals.js --dry-run  # report what would change
 */
import { PrismaClient } from '@prisma/client';
import { normalizedColumns } from '../src/utils/animalNormalize.js';
import { listingExpiry } from '../src/services/animalListing.service.js';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH = 200;

/** Legacy listings encoded health facts as free-text tags; read them back out. */
function flagsFromTags(tags = []) {
  const lower = (Array.isArray(tags) ? tags : []).map((t) => String(t).toLowerCase());
  return {
    vaccinated:        lower.some((t) => t.includes('vaccinat') || t.includes('लस')),
    healthCertificate: lower.some((t) => t.includes('health cert') || t.includes('certificate')),
    negotiable:        lower.some((t) => t.includes('negotiab')),
  };
}

async function main() {
  let cursor = null;
  let scanned = 0;
  let updated = 0;

  for (;;) {
    const rows = await prisma.animalListing.findMany({
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true, animal: true, breed: true, age: true, weight: true,
        milkYield: true, description: true, sellerLocation: true, tags: true,
        ageMonths: true, weightKg: true, milkYieldLpd: true, searchText: true,
        vaccinated: true, healthCertificate: true, negotiable: true,
        expiresAt: true, createdAt: true, status: true,
      },
    });
    if (rows.length === 0) break;
    cursor = rows[rows.length - 1].id;
    scanned += rows.length;

    for (const row of rows) {
      const derived = normalizedColumns(row);
      const flags = flagsFromTags(row.tags);
      const data = {};

      for (const [k, v] of Object.entries({ ...derived, ...flags })) {
        if (row[k] !== v) data[k] = v;
      }
      // Only ACTIVE rows get an expiry — a SOLD listing has no renewal clock.
      if (row.expiresAt == null && row.status === 'ACTIVE') {
        data.expiresAt = listingExpiry(row.createdAt);
      }

      if (Object.keys(data).length === 0) continue;
      updated++;
      if (DRY_RUN) {
        console.log(`[dry-run] ${row.id} ←`, data);
      } else {
        await prisma.animalListing.update({ where: { id: row.id }, data });
      }
    }

    console.log(`… scanned ${scanned}, ${DRY_RUN ? 'would update' : 'updated'} ${updated}`);
  }

  console.log(`\nDone. Scanned ${scanned} listings, ${DRY_RUN ? 'would update' : 'updated'} ${updated}.`);
}

main()
  .catch((err) => {
    console.error('[backfill-animals] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
