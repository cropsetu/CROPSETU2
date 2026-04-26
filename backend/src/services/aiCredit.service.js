/**
 * AI Credit Service — Future-proof credit-based AI access system
 *
 * Credit costs per AI feature:
 *   Rule-based (pest/weather):  0 credits  (free, no LLM)
 *   Haiku enhancement:          1 credit   (~500 tokens, ~$0.002)
 *   Chat message (Groq):        1 credit   (free model, nominal cost)
 *   Chat message (Claude):      2 credits  (~1000 tokens)
 *   Crop scan (Gemini):         3 credits  (~2000 tokens + vision)
 *   Crop scan (Claude):         5 credits  (~3000 tokens + vision)
 *   Pest prediction (Sonnet):   5 credits  (~3000 tokens, agentic loop)
 *   Voice chat:                 2 credits  (STT + TTS + LLM)
 *
 * Free tier: 100 credits/month (auto-refill on 1st of month)
 * Credits never expire (purchased ones). Free credits refill monthly.
 */
import prisma from '../config/db.js';

// ── Credit cost table ────────────────────────────────────────────────────────
export const CREDIT_COSTS = {
  // Feature name → credits consumed
  ai_scan_gemini:     3,
  ai_scan_claude:     5,
  ai_chat_groq:       1,
  ai_chat_claude:     2,
  ai_pest_rule:       0,   // free — no LLM used
  ai_pest_haiku:      1,   // Haiku enhancement
  ai_pest_sonnet:     5,   // Full agentic loop
  ai_voice:           2,
  ai_translate:       1,
  ai_planner:         1,
  ai_soil:            1,
  ai_calendar:        2,
  ai_irrigation:      1,
};

// ── Tier limits ──────────────────────────────────────────────────────────────
export const TIER_CONFIG = {
  free:       { monthlyCredits: 100,   maxDailyTokens: 50_000,  label: 'Free' },
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
  const cost = CREDIT_COSTS[featureType] ?? 1;

  // Rule-based = free, no deduction needed
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
