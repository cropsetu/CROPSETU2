/**
 * Government Schemes Routes (Sarkari Yojana)
 *
 * GET  /api/v1/schemes                        — list all active schemes (filterable)
 * GET  /api/v1/schemes/eligible               — schemes the authenticated farmer qualifies for
 * GET  /api/v1/schemes/:id                    — single scheme detail
 * POST /api/v1/schemes/ask                    — AI (Claude) answers a scheme eligibility question
 * GET  /api/v1/schemes/applications           — farmer's tracked applications
 * POST /api/v1/schemes/applications           — track/update application status
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { callClaude } from '../services/claude.service.js';
import prisma from '../config/db.js';

const router = Router();

// ── Per-user cooldown for AI scheme Q&A (max 1 every 10 s) ───────────────────
const lastSchemeAsk = new Map();
const SCHEME_ASK_GAP_MS = 10_000;

// ── GET /api/v1/schemes ───────────────────────────────────────────────────────
// Query params: type=central|state, state=Maharashtra, benefitType=cash|subsidy|etc.
router.get('/', authenticate, async (req, res) => {
  const { type, state, benefitType } = req.query;

  const where = { isActive: true };
  if (type)        where.type        = type;
  if (benefitType) where.benefitType = benefitType;
  if (state)       where.OR = [{ state }, { state: null }]; // null = all-India

  const schemes = await prisma.governmentScheme.findMany({
    where,
    orderBy: [{ type: 'asc' }, { schemeName: 'asc' }],
    select: {
      id: true, schemeCode: true, schemeName: true, schemeNameHi: true, schemeNameMr: true,
      type: true, state: true, benefitsSummary: true, benefitAmount: true,
      benefitType: true, deadline: true, helpline: true, applicationUrl: true,
    },
  });

  return sendSuccess(res, schemes);
});

// ── GET /api/v1/schemes/eligible ──────────────────────────────────────────────
// Returns schemes the farmer qualifies for based on their profile.
router.get('/eligible', authenticate, async (req, res) => {
  const farmer = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { farmDetail: true },
  });

  const allSchemes = await prisma.governmentScheme.findMany({
    where: { isActive: true },
    select: {
      id: true, schemeCode: true, schemeName: true, schemeNameHi: true, schemeNameMr: true,
      type: true, state: true, benefitsSummary: true, benefitAmount: true,
      benefitType: true, eligibility: true, deadline: true, helpline: true, applicationUrl: true,
    },
  });

  // Simple eligibility rule engine
  const landAcres  = farmer.farmDetail?.landAcres ?? null;
  const farmerState = farmer.state || 'Maharashtra';

  const eligible = allSchemes.filter(scheme => {
    const e = scheme.eligibility;

    // State check: include all-India (state=null) + farmer's own state
    if (scheme.state && scheme.state !== farmerState) return false;

    // Land size check
    if (e?.landSizeMaxAcres && landAcres && landAcres > e.landSizeMaxAcres) return false;

    // Farming type check
    const farmerFarmingType = farmer.farmDetail?.soilType ? 'conventional' : 'any';
    if (e?.farmingTypes?.length && !e.farmingTypes.includes('any') && !e.farmingTypes.includes(farmerFarmingType)) {
      return false;
    }

    return true;
  });

  return sendSuccess(res, eligible, 200, { total: eligible.length });
});

// ── GET /api/v1/schemes/applications ─────────────────────────────────────────
router.get('/applications', authenticate, async (req, res) => {
  const applications = await prisma.schemeApplication.findMany({
    where: { userId: req.user.id },
    include: {
      scheme: {
        select: {
          id: true, schemeName: true, schemeNameHi: true, benefitType: true, benefitAmount: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });
  return sendSuccess(res, applications);
});

// ── GET /api/v1/schemes/:id ───────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const scheme = await prisma.governmentScheme.findUnique({
    where: { id: req.params.id },
  });
  if (!scheme) return sendError(res, 'Scheme not found', 404);

  // Also include farmer's application status for this scheme
  const application = await prisma.schemeApplication.findUnique({
    where: { userId_schemeId: { userId: req.user.id, schemeId: scheme.id } },
  });

  return sendSuccess(res, { ...scheme, myApplication: application || null });
});

// ── POST /api/v1/schemes/ask ──────────────────────────────────────────────────
// Claude AI answers a natural-language question about government schemes.
router.post('/ask', authenticate, async (req, res) => {
  const { question, language } = req.body;
  if (!question?.trim()) return sendError(res, 'question is required', 400);
  if (question.length > 500) return sendError(res, 'question too long (max 500 chars)', 400);

  // Rate limit
  const last = lastSchemeAsk.get(req.user.id) || 0;
  const wait = Math.ceil((SCHEME_ASK_GAP_MS - (Date.now() - last)) / 1000);
  if (wait > 0) return sendError(res, `Please wait ${wait}s before asking again.`, 429);
  lastSchemeAsk.set(req.user.id, Date.now());

  // Fetch relevant schemes as context for Claude
  const schemes = await prisma.governmentScheme.findMany({
    where: { isActive: true },
    select: {
      schemeCode: true, schemeName: true, benefitsSummary: true,
      eligibility: true, benefitAmount: true, benefitType: true,
      documentsReq: true, applicationUrl: true, helpline: true, deadline: true,
      type: true, state: true,
    },
    take: 20,
  });

  const farmer = await prisma.user.findUnique({
    where: { id: req.user.id },
    include: { farmDetail: true },
  });

  const schemeContext = schemes.map(s =>
    `[${s.schemeCode}] ${s.schemeName}\n  Benefit: ${s.benefitsSummary}\n  Amount: ${s.benefitAmount ? `₹${s.benefitAmount}` : 'Varies'} (${s.benefitType})\n  Eligibility: ${JSON.stringify(s.eligibility)}\n  Documents: ${s.documentsReq.join(', ')}\n  Apply: ${s.applicationUrl || 'Local office'}\n  Helpline: ${s.helpline || 'N/A'}`
  ).join('\n\n');

  const systemPrompt = `You are a government scheme advisor for Indian farmers.
Answer ONLY questions about agricultural government schemes (PM-KISAN, PMFBY, KCC, PKVY, etc.)
Keep responses concise and practical. Always mention: eligibility, benefit amount, how to apply, documents needed.

Farmer Profile:
- Name: ${farmer.name || 'Farmer'}
- State: ${farmer.state || 'Maharashtra'}
- Land: ${farmer.farmDetail?.landAcres || 'Unknown'} acres
- Crops: ${farmer.farmDetail?.cropTypes?.join(', ') || 'Mixed crops'}

Available Schemes Database:
${schemeContext}

Respond in ${language === 'hi' ? 'Hindi' : language === 'mr' ? 'Marathi' : 'English'}.
If the question is not about government schemes or farming, say you can only help with government agricultural schemes.`;

  try {
    const answer = await callClaude({
      systemPrompt,
      userMessage: question.trim(),
      maxTokens: 600,
    });

    return sendSuccess(res, { answer, question: question.trim() });
  } catch (err) {
    console.error('[Schemes AI]', err.message);
    return sendError(res, 'AI service unavailable. Please try again.', 503);
  }
});

// ── POST /api/v1/schemes/applications ────────────────────────────────────────
// Track or update a farmer's scheme application status.
router.post('/applications', authenticate, async (req, res) => {
  const { schemeId, status, notes } = req.body;
  if (!schemeId) return sendError(res, 'schemeId is required', 400);

  const validStatuses = ['interested', 'in_progress', 'submitted', 'approved', 'rejected'];
  if (status && !validStatuses.includes(status)) {
    return sendError(res, `status must be one of: ${validStatuses.join(', ')}`, 400);
  }

  const scheme = await prisma.governmentScheme.findUnique({ where: { id: schemeId } });
  if (!scheme) return sendError(res, 'Scheme not found', 404);

  const application = await prisma.schemeApplication.upsert({
    where: { userId_schemeId: { userId: req.user.id, schemeId } },
    create: {
      userId:   req.user.id,
      schemeId,
      status:   status || 'interested',
      notes:    notes  || null,
      appliedAt: status === 'submitted' ? new Date() : null,
    },
    update: {
      status:   status || 'interested',
      notes:    notes  !== undefined ? notes : undefined,
      appliedAt: status === 'submitted' ? new Date() : undefined,
    },
  });

  return sendSuccess(res, application, 200);
});

export default router;
