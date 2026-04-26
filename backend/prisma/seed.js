/**
 * Master seed — runs MSP + schemes seeds.
 * Called by package.json "db:seed" script and start:prod for production.
 *
 * Safe to run repeatedly — every seed file uses upsert.
 */

import { seedMSP } from './seed-msp.js';
import { seedSchemes } from './seed-schemes.js';

async function main() {
  console.log('🌱 Running seed scripts...\n');
  await seedMSP();
  console.log('');
  await seedSchemes();
  console.log('\n✓ All seeds complete.');
}

main()
  .catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  });
