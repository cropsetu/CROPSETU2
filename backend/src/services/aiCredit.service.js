/**
 * AI Credit Service — Future-proof credit-based AI access system
 *
 * Credit costs per AI feature (Gemini-only; legacy provider keys kept for
 * back-compat with historical ledger rows):
 *   Rule-based (pest/weather):  0 credits  (free, no LLM)
 *   Chat message (Gemini):      1 credit   (text Q&A, scales with tokens)
 *   Crop scan (Gemini):         3 credits  (~2000 tokens + vision)
 *   Voice chat:                 2 credits  (Sarvam STT + Gemini reply + Sarvam TTS)
 *   TTS (Sarvam):               1 credit
 *
 * Free tier: 100 credits/month (auto-refill on 1st of month)
 * Credits never expire (purchased ones). Free credits refill monthly.
 */
import prisma from '../config/db.js';
import { ENV } from '../config/env.js';

// ── Token → credit policy (configurable via .env — see config/env.js) ────────
// Debit = max(per-feature floor, ceil(actualTokens / TOKENS_PER_CREDIT)).
// Company can change pricing/free-grant in .env without touching code.
const TOKENS_PER_CREDIT    = ENV.AI_TOKENS_PER_CREDIT    || 1000;  // 100 credits ≈ 1 lakh tokens
const FREE_MONTHLY_CREDITS = ENV.AI_FREE_MONTHLY_CREDITS || 100;
const MIN_CREDITS_PER_CALL = ENV.AI_MIN_CREDITS_PER_CALL || 1;

// ── Credit cost table ────────────────────────────────────────────────────────
// These are now the per-feature MINIMUM (floor). Actual debit scales with tokens.
export const CREDIT_COSTS = {
  // Feature name → credits consumed (floor; actual scales with tokens)
  ai_scan_gemini:     3,
  ai_chat_gemini:     1,   // text chat (Gemini Flash)
  ai_pest_rule:       0,   // free — no LLM used
  ai_pest_gemini:     1,   // Gemini pest enhancement
  ai_voice:           2,   // Sarvam STT + Gemini reply + Sarvam TTS
  ai_tts:             1,   // Sarvam text-to-speech
  ai_translate:       1,
  ai_planner:         1,
  ai_soil:            1,
  ai_soil_ocr:        3,   // Soil Health Card OCR (vision call — parity with scan)
  ai_calendar:        2,
  ai_irrigation:      1,

  // ── Legacy keys (pre-Gemini consolidation) — retained so old ledger rows and
  //    any in-flight callers still resolve a floor. Do not use in new code.
  ai_scan_claude:     5,
  ai_chat_groq:       1,
  ai_chat_claude:     2,
  ai_pest_haiku:      1,
  ai_pest_sonnet:     5,
};

// ── Universal token → credit meter ───────────────────────────────────────────
// ONE function used by every AI service (chat, voice, scan, …) to convert the
// actual tokens a call consumed into credits to debit. Free features (floor 0)
// stay free; everything else costs at least its floor, more for big responses.
export function creditsForUsage(featureType, tokensUsed = 0) {
  const floor = CREDIT_COSTS[featureType] ?? MIN_CREDITS_PER_CALL;
  if (floor === 0) return 0;                                   // rule-based / free
  const tokens = Number(tokensUsed) || 0;
  if (tokens <= 0) return floor;                               // no token data → floor
  return Math.max(floor, Math.ceil(tokens / TOKENS_PER_CREDIT));
}

// ── Tier limits ──────────────────────────────────────────────────────────────
export const TIER_CONFIG = {
  free:       { monthlyCredits: FREE_MONTHLY_CREDITS, maxDailyTokens: 50_000,  label: 'Free' },
  basic:      { monthlyCredits: 500,   maxDailyTokens: 200_000, label: 'Basic' },
  pro:        { monthlyCredits: 2000,  maxDailyTokens: 500_000, label: 'Pro' },
  enterprise: { monthlyCredits: 10000, maxDailyTokens: 2_000_000, label: 'Enterprise' },
};

// ── Credit pack prices (for future payment integration) ──────────────────────
export const CREDIT_PACKS = [
  { id: 'pack_100',  credits: 100,  priceInr: 49,   label: '100 Credits' },
  { id: 'pack_500',  credits: 500,  priceInr: 199,  label: '500 Credits' },
  { id: 'pack_1000', credits: 1000, priceInr: 349,  label: '1000 Credits' },
  { id: 'pack_5000', credits: 5000, priceInr: 1499, label: '5000 Credits' },
];

/**
 * Get or create user's credit record.
 * Auto-creates with free tier balance on first access.
 */
export async function getOrCreateCredits(userId) {
  let credit = await prisma.aICredit.findUnique({
    where: { userId },
  });

  if (!credit) {
    credit = await prisma.aICredit.create({
      data: {
        userId,
        balance: TIER_CONFIG.free.monthlyCredits,
        lifetimeEarned: TIER_CONFIG.free.monthlyCredits,
        freeRefillDate: getNextRefillDate(),
        tier: 'free',
      },
    });
  }

  // Check if monthly free refill is due
  if (new Date() >= new Date(credit.freeRefillDate)) {
    const tierConfig = TIER_CONFIG[credit.tier] || TIER_CONFIG.free;
    credit = await prisma.aICredit.update({
      where: { userId },
      data: {
        balance: { increment: tierConfig.monthlyCredits },
        lifetimeEarned: { increment: tierConfig.monthlyCredits },
        freeRefillDate: getNextRefillDate(),
      },
    });

    // Log the refill transaction
    await prisma.aICreditTransaction.create({
      data: {
        creditId: credit.id,
        amount: tierConfig.monthlyCredits,
        balanceAfter: credit.balance,
        type: 'free_refill',
        description: `Monthly ${tierConfig.label} refill: +${tierConfig.monthlyCredits} credits`,
      },
    }).catch(e => console.warn('[AICredit] Refill transaction log failed: %s', e.message));
  }

  return credit;
}

/**
 * Check if user has enough credits for an AI feature.
 * Returns { allowed, balance, cost, shortfall } or error message.
 */
export async function checkCredits(userId, featureType) {
  const cost = CREDIT_COSTS[featureType] ?? 1;

  // Rule-based features are always free
  if (cost === 0) {
    return { allowed: true, balance: null, cost: 0, shortfall: 0 };
  }

  const credit = await getOrCreateCredits(userId);

  if (credit.balance >= cost) {
    return { allowed: true, balance: credit.balance, cost, shortfall: 0 };
  }

  // PAY-11: surface rejected attempts so the audit trail covers denials, not
  // just successful debits.
  console.warn('[AICredit] REJECTED user=%s feature=%s need=%d have=%d', userId, featureType, cost, credit.balance);
  return {
    allowed: false,
    balance: credit.balance,
    cost,
    shortfall: cost - credit.balance,
    message: `Insufficient credits. Need ${cost}, have ${credit.balance}. Purchase more credits to continue.`,
  };
}

/**
 * Deduct credits after a successful AI call.
 * Records the transaction with full details for auditing.
 *
 * @param {string} userId
 * @param {string} featureType - key from CREDIT_COSTS
 * @param {object} details - { model, tokensUsed, costUsd, description, metadata }
 * @returns {{ balance, creditsUsed, transaction }}
 */
export async function deductCredits(userId, featureType, details = {}) {
  // Token-based debit: scales with what the AI actually consumed (details.tokensUsed),
  // never below the per-feature floor. Free features stay free.
  const cost = creditsForUsage(featureType, details.tokensUsed);

  if (cost === 0) {
    return { balance: null, creditsUsed: 0, transaction: null };
  }

  try {
    // Atomic: deduct balance + record transaction in a single DB round-trip.
    // Prevents race conditions where deduct succeeds but transaction log fails.
    const [credit, transaction] = await prisma.$transaction(async (tx) => {
      const c = await tx.aICredit.update({
        where: { userId },
        data: {
          balance: { decrement: cost },
          lifetimeSpent: { increment: cost },
        },
      });

      // Clamp to zero if overdraft (shouldn't happen if checkCredits is called first)
      if (c.balance < 0) {
        await tx.aICredit.update({ where: { userId }, data: { balance: 0 } });
        c.balance = 0;
      }

      const t = await tx.aICreditTransaction.create({
        data: {
          creditId: c.id,
          amount: -cost,
          balanceAfter: c.balance,
          type: featureType,
          description: details.description || `${featureType}: -${cost} credits`,
          aiModel: details.model || null,
          tokensUsed: details.tokensUsed || null,
          costUsd: details.costUsd || null,
          metadata: details.metadata || null,
        },
      });

      return [c, t];
    });

    return { balance: credit.balance, creditsUsed: cost, transaction };

  } catch (err) {
    console.warn('[AICredit] Deduction failed:', err.message);
    return { balance: null, creditsUsed: cost, transaction: null, error: err.message };
  }
}

// ── Reserve / settle / release (atomic, race-free) ────────────────────────────
// Prevents the concurrent-burst overspend: a single atomic conditional decrement
// holds an estimate BEFORE the LLM call; after success we reconcile to the actual
// token cost; on failure we refund. Each call keeps exactly ONE ledger row
// (HOLD → SETTLED / RELEASED) so credit summaries don't double-count.

/**
 * Atomically hold the per-feature floor estimate before the LLM call.
 * @returns {{ ok:boolean, reserved:number, holdId:string|null, balance:number|null, message?:string }}
 */
export async function reserveCredits(userId, featureType) {
  const estimate = CREDIT_COSTS[featureType] ?? MIN_CREDITS_PER_CALL;
  if (estimate === 0) return { ok: true, reserved: 0, holdId: null, balance: null }; // free feature

  await getOrCreateCredits(userId); // ensure row exists + monthly refill applied

  // The guard + decrement is ONE atomic op — concurrent requests can't all pass.
  const res = await prisma.aICredit.updateMany({
    where: { userId, balance: { gte: estimate } },
    data:  { balance: { decrement: estimate }, lifetimeSpent: { increment: estimate } },
  });
  if (res.count === 0) {
    const c = await prisma.aICredit.findUnique({ where: { userId } });
    // PAY-11: log the denied reservation for the audit trail.
    console.warn('[AICredit] RESERVE REJECTED user=%s feature=%s need=%d have=%d', userId, featureType, estimate, c?.balance ?? 0);
    return { ok: false, reserved: 0, holdId: null, balance: c?.balance ?? 0,
             message: `Insufficient credits. Need ${estimate}, have ${c?.balance ?? 0}.` };
  }

  const credit = await prisma.aICredit.findUnique({ where: { userId } });
  let holdId = null;
  try {
    const hold = await prisma.aICreditTransaction.create({
      data: {
        creditId: credit.id, amount: -estimate, balanceAfter: credit.balance,
        type: featureType, description: `${featureType}: pending`,
        metadata: { status: 'HOLD' },
      },
    });
    holdId = hold.id;
  } catch (e) { console.warn('[AICredit] hold-log failed:', e.message); }

  return { ok: true, reserved: estimate, holdId, balance: credit.balance };
}

/**
 * Reconcile a hold against ACTUAL token usage: charge the extra (clamped at 0)
 * or refund the difference, and finalize the single ledger row. Awaited.
 */
export async function settleCredits(userId, featureType, { reserved = 0, holdId = null, tokensUsed = 0, model, description, costUsd } = {}) {
  const actual = creditsForUsage(featureType, tokensUsed);
  const delta  = actual - reserved;          // >0 charge more, <0 refund
  try {
    const credit = await prisma.$transaction(async (tx) => {
      let c;
      if (delta > 0) {
        c = await tx.aICredit.update({ where: { userId },
          data: { balance: { decrement: delta }, lifetimeSpent: { increment: delta } } });
        if (c.balance < 0) c = await tx.aICredit.update({ where: { userId }, data: { balance: 0 } });
      } else if (delta < 0) {
        c = await tx.aICredit.update({ where: { userId },
          data: { balance: { increment: -delta }, lifetimeSpent: { decrement: -delta } } });
      } else {
        c = await tx.aICredit.findUnique({ where: { userId } });
      }
      const txnData = {
        amount: -actual, balanceAfter: c.balance, type: featureType,
        description: description || `${featureType}: ${actual} credits`,
        aiModel: model || null, tokensUsed: tokensUsed || null, costUsd: costUsd || null,
        metadata: { status: 'SETTLED' },
      };
      if (holdId) await tx.aICreditTransaction.update({ where: { id: holdId }, data: txnData });
      else        await tx.aICreditTransaction.create({ data: { creditId: c.id, ...txnData } });
      return c;
    });
    return { balance: credit.balance, creditsUsed: actual };
  } catch (err) {
    console.warn('[AICredit] Settle failed:', err.message);
    return { balance: null, creditsUsed: actual, error: err.message };
  }
}

/**
 * Refund a hold when the LLM call failed (no charge). Awaited.
 */
export async function releaseCredits(userId, featureType, { reserved = 0, holdId = null } = {}) {
  if (!reserved) return { balance: null, released: 0 };
  try {
    const credit = await prisma.$transaction(async (tx) => {
      const c = await tx.aICredit.update({ where: { userId },
        data: { balance: { increment: reserved }, lifetimeSpent: { decrement: reserved } } });
      if (holdId) {
        await tx.aICreditTransaction.update({ where: { id: holdId },
          data: { amount: 0, balanceAfter: c.balance, description: `${featureType}: released (failed)`,
                  metadata: { status: 'RELEASED' } } });
      }
      return c;
    });
    return { balance: credit.balance, released: reserved };
  } catch (err) {
    console.warn('[AICredit] Release failed:', err.message);
    return { balance: null, released: 0, error: err.message };
  }
}

/**
 * Add credits (purchase, admin grant, referral, etc.)
 */
export async function addCredits(userId, amount, type = 'purchase', description = '') {
  const credit = await getOrCreateCredits(userId);

  const updated = await prisma.aICredit.update({
    where: { userId },
    data: {
      balance: { increment: amount },
      lifetimeEarned: { increment: amount },
    },
  });

  const transaction = await prisma.aICreditTransaction.create({
    data: {
      creditId: credit.id,
      amount,
      balanceAfter: updated.balance,
      type,
      description: description || `+${amount} credits (${type})`,
    },
  });

  return { balance: updated.balance, transaction };
}

/**
 * Get user's credit balance + recent transactions.
 */
export async function getCreditSummary(userId) {
  const credit = await getOrCreateCredits(userId);
  const tierConfig = TIER_CONFIG[credit.tier] || TIER_CONFIG.free;

  const recentTransactions = await prisma.aICreditTransaction.findMany({
    where: { creditId: credit.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  // Today's spending
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todaySpent = recentTransactions
    .filter(t => new Date(t.createdAt) >= today && t.amount < 0)
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);

  return {
    balance: credit.balance,
    tier: credit.tier,
    tierLabel: tierConfig.label,
    monthlyAllowance: tierConfig.monthlyCredits,
    lifetimeEarned: credit.lifetimeEarned,
    lifetimeSpent: credit.lifetimeSpent,
    todaySpent,
    nextRefill: credit.freeRefillDate,
    tokensPerCredit: TOKENS_PER_CREDIT,   // e.g. 1000 → "1 credit = 1000 tokens"
    recentTransactions: recentTransactions.map(t => ({
      id: t.id,
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      type: t.type,
      description: t.description,
      model: t.aiModel,
      tokens: t.tokensUsed,
      cost: t.costUsd,
      date: t.createdAt,
    })),
    costs: CREDIT_COSTS,
    packs: CREDIT_PACKS,
  };
}

/**
 * Map pest prediction engine level to feature type for credit deduction.
 */
export function pestLevelToFeatureType(level) {
  if (level === 0) return 'ai_pest_rule';
  if (level === 1) return 'ai_pest_haiku';
  return 'ai_pest_sonnet';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getNextRefillDate() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return next;
}
