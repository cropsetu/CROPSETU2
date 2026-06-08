/**
 * Field-encryption key rotation runner.
 *
 * Re-encrypts every field-encrypted column under the current active key
 * (FIELD_ENCRYPTION_ACTIVE_KEY_ID). The old key must still be present in
 * FIELD_ENCRYPTION_KEYS for decryption to succeed during the sweep.
 *
 * Usage:
 *   node scripts/rotate-encryption-key.js            # perform rotation
 *   node scripts/rotate-encryption-key.js --dry-run  # report only, no writes
 *
 * Zero-downtime rotation procedure:
 *   1. Generate a new key:  openssl rand -hex 32
 *   2. Deploy with FIELD_ENCRYPTION_KEYS="<newId>:<newHex>" (old key stays under
 *      id "0") and FIELD_ENCRYPTION_ACTIVE_KEY_ID="<newId>". New writes now use
 *      the new key; old rows still decrypt with the legacy key.
 *   3. Run this script to re-encrypt all existing rows under the new key.
 *   4. Once it reports 0 remaining, you may retire the old key in a later deploy.
 */
import 'dotenv/config';
import { reEncryptAll } from '../src/services/keyRotation.service.js';
import { ENV } from '../src/config/env.js';
import prisma from '../src/config/db.js';

const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`[rotate] Active key id: ${ENV.FIELD_ENCRYPTION_ACTIVE_KEY_ID}`);
  console.log(`[rotate] Known key ids: ${['0', ...Object.keys(ENV.FIELD_ENCRYPTION_KEYS)].join(', ')}`);
  console.log(`[rotate] Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);

  const summary = await reEncryptAll({ dryRun });
  console.log('[rotate] Summary:');
  console.log(JSON.stringify(summary, null, 2));

  const skipped = Object.values(summary.models).reduce((n, m) => n + (m.skipped || 0), 0);
  if (skipped > 0) {
    console.warn(`[rotate] WARNING: ${skipped} value(s) could not be decrypted (retired/missing key) and were left unchanged.`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[rotate] FAILED:', err);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });
