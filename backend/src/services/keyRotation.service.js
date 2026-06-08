/**
 * Key Rotation Service — re-encrypt field-level ciphertext under the active key.
 *
 * After a new FIELD_ENCRYPTION_ACTIVE_KEY_ID is deployed (with the old key still
 * present in FIELD_ENCRYPTION_KEYS for decryption), run reEncryptAll() to migrate
 * existing rows. It only touches values that need rotation (encrypted under a
 * non-active key), so it is idempotent, resumable, and safe to run while the app
 * serves traffic — decrypt() understands every key version throughout.
 *
 * Invoke via: node scripts/rotate-encryption-key.js [--dry-run]
 */
import prisma from '../config/db.js';
import logger from '../utils/logger.js';
import { needsRotation, rotateCiphertext, activeKeyId } from '../utils/encrypt.js';

// Inventory of every field-encrypted column, keyed by Prisma delegate name.
// Keep this in sync when new fields are encrypted.
export const ENCRYPTED_COLUMNS = {
  user:          ['gstNumber', 'lat', 'lng', 'annualHouseholdIncome'],
  sellerProfile: ['bankHolderName', 'bankName', 'bankAccountNumber', 'bankIfsc', 'aadharNumber', 'panNumber'],
};

async function reEncryptModel(model, fields, { batchSize, dryRun }) {
  const where = { OR: fields.map((f) => ({ [f]: { not: null } })) };
  const select = Object.fromEntries([['id', true], ...fields.map((f) => [f, true])]);

  let cursor = null;
  let scanned = 0;
  let rotated = 0;
  let skipped = 0; // values that needed rotation but could not be decrypted

  for (;;) {
    const rows = await prisma[model].findMany({
      where,
      select,
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned++;
      const data = {};
      for (const f of fields) {
        const val = row[f];
        if (val == null || !needsRotation(val)) continue;
        const next = rotateCiphertext(val);
        if (next === val) { skipped++; continue; } // undecryptable — left intact
        data[f] = next;
      }
      if (Object.keys(data).length) {
        rotated++;
        if (!dryRun) await prisma[model].update({ where: { id: row.id }, data });
      }
    }

    cursor = rows[rows.length - 1].id;
    if (rows.length < batchSize) break;
  }

  return { scanned, rotated, skipped };
}

/**
 * Re-encrypt every field-encrypted column under the active key.
 * @param {object}  [opts]
 * @param {number}  [opts.batchSize=200]
 * @param {boolean} [opts.dryRun=false] — report what would change without writing
 * @returns {Promise<{activeKeyId:string, models:object}>}
 */
export async function reEncryptAll({ batchSize = 200, dryRun = false } = {}) {
  const models = {};
  for (const [model, fields] of Object.entries(ENCRYPTED_COLUMNS)) {
    models[model] = await reEncryptModel(model, fields, { batchSize, dryRun });
  }
  const summary = { activeKeyId: activeKeyId(), dryRun, models };
  logger.info({ summary }, '[KeyRotation] re-encryption sweep complete');
  return summary;
}
