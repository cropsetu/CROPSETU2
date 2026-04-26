/**
 * Seed: MSP (Minimum Support Price) rates
 *
 * Source: CACP / Ministry of Agriculture & Farmers Welfare, Govt. of India.
 *         https://cacp.dacnet.nic.in/
 *
 * These are the government-announced MSPs for major crops. Update when a new
 * season's prices are announced (usually June for Kharif, October for Rabi).
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Prices in INR per quintal (100 kg).
const MSP_2025_26 = [
  // ── Rabi 2025-26 (sown Oct-Dec 2025, harvested Apr-May 2026) ──────────────
  { commodity: 'Wheat',       commodityHi: 'गेहूं',   season: 'rabi', year: '2025-26', mspPrice: 2425, previousYearMSP: 2275, bonusIfAny: 0 },
  { commodity: 'Barley',      commodityHi: 'जौ',      season: 'rabi', year: '2025-26', mspPrice: 1980, previousYearMSP: 1850, bonusIfAny: 0 },
  { commodity: 'Gram',        commodityHi: 'चना',     season: 'rabi', year: '2025-26', mspPrice: 5650, previousYearMSP: 5440, bonusIfAny: 0 },
  { commodity: 'Masur',       commodityHi: 'मसूर',    season: 'rabi', year: '2025-26', mspPrice: 6700, previousYearMSP: 6425, bonusIfAny: 0 },
  { commodity: 'Rapeseed',    commodityHi: 'सरसों',   season: 'rabi', year: '2025-26', mspPrice: 5950, previousYearMSP: 5650, bonusIfAny: 0 },
  { commodity: 'Safflower',   commodityHi: 'कुसुम',   season: 'rabi', year: '2025-26', mspPrice: 5940, previousYearMSP: 5800, bonusIfAny: 0 },

  // ── Kharif 2025-26 (sown Jun-Jul, harvested Oct-Nov) ──────────────────────
  { commodity: 'Paddy',       commodityHi: 'धान',           season: 'kharif', year: '2025-26', mspPrice: 2300, previousYearMSP: 2183, bonusIfAny: 0 },
  { commodity: 'Jowar',       commodityHi: 'ज्वार',         season: 'kharif', year: '2025-26', mspPrice: 3371, previousYearMSP: 3180, bonusIfAny: 0 },
  { commodity: 'Bajra',       commodityHi: 'बाजरा',         season: 'kharif', year: '2025-26', mspPrice: 2625, previousYearMSP: 2500, bonusIfAny: 0 },
  { commodity: 'Ragi',        commodityHi: 'रागी',          season: 'kharif', year: '2025-26', mspPrice: 4290, previousYearMSP: 3846, bonusIfAny: 0 },
  { commodity: 'Maize',       commodityHi: 'मक्का',         season: 'kharif', year: '2025-26', mspPrice: 2225, previousYearMSP: 2090, bonusIfAny: 0 },
  { commodity: 'Arhar/Tur',   commodityHi: 'अरहर/तूर',      season: 'kharif', year: '2025-26', mspPrice: 7550, previousYearMSP: 7000, bonusIfAny: 0 },
  { commodity: 'Moong',       commodityHi: 'मूंग',          season: 'kharif', year: '2025-26', mspPrice: 8682, previousYearMSP: 8558, bonusIfAny: 0 },
  { commodity: 'Urad',        commodityHi: 'उड़द',          season: 'kharif', year: '2025-26', mspPrice: 7400, previousYearMSP: 6950, bonusIfAny: 0 },
  { commodity: 'Groundnut',   commodityHi: 'मूंगफली',       season: 'kharif', year: '2025-26', mspPrice: 6783, previousYearMSP: 6377, bonusIfAny: 0 },
  { commodity: 'Sunflower Seed', commodityHi: 'सूरजमुखी',   season: 'kharif', year: '2025-26', mspPrice: 7280, previousYearMSP: 6760, bonusIfAny: 0 },
  { commodity: 'Soyabean',    commodityHi: 'सोयाबीन',       season: 'kharif', year: '2025-26', mspPrice: 4892, previousYearMSP: 4600, bonusIfAny: 0 },
  { commodity: 'Sesamum',     commodityHi: 'तिल',           season: 'kharif', year: '2025-26', mspPrice: 9846, previousYearMSP: 8717, bonusIfAny: 0 },
  { commodity: 'Niger seed',  commodityHi: 'रामतिल',        season: 'kharif', year: '2025-26', mspPrice: 8717, previousYearMSP: 7734, bonusIfAny: 0 },
  { commodity: 'Cotton',      commodityHi: 'कपास',          season: 'kharif', year: '2025-26', mspPrice: 7521, previousYearMSP: 7121, bonusIfAny: 0 },
];

function withIncrease(row) {
  if (row.previousYearMSP && row.previousYearMSP > 0) {
    row.increasePercent = Number((((row.mspPrice - row.previousYearMSP) / row.previousYearMSP) * 100).toFixed(2));
  }
  return row;
}

export async function seedMSP() {
  console.log('[Seed MSP] Upserting %d rates...', MSP_2025_26.length);
  for (const raw of MSP_2025_26) {
    const row = withIncrease({ ...raw });
    await prisma.mSPRate.upsert({
      where: {
        commodity_season_year: { commodity: row.commodity, season: row.season, year: row.year },
      },
      create: row,
      update: row,
    });
  }
  const total = await prisma.mSPRate.count();
  console.log('[Seed MSP] Done — %d rows total in db.', total);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedMSP()
    .catch(err => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
}
