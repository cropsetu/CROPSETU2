/**
 * Daily Planner Routes
 * GET  /api/v1/planner/tasks          — Today's tasks
 * POST /api/v1/planner/tasks          — Create a manual task
 * PUT  /api/v1/planner/tasks/:id      — Update task (mark done, etc.)
 * DELETE /api/v1/planner/tasks/:id   — Delete a task
 * POST /api/v1/planner/generate      — AI generate tasks for today
 */
import { Router } from 'express';
import { body, query } from 'express-validator';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { uuidParamGuard } from '../middleware/uuidParams.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';
import { generatePlannerTasks, getCurrentSeason } from '../services/ai.chat.service.js';
import { reserveCredits, settleCredits, releaseCredits } from '../services/aiCredit.service.js';
import { requireFeature } from '../middleware/requireFeature.js';
import { BoundedMap } from '../utils/boundedMap.js';
import logger from '../utils/logger.js';
import prisma from '../config/db.js';

// Per-user cooldown for planner generate (min 60s between AI calls).
// Bounded (LRU + TTL) so it can't grow without limit as new users hit it — a
// stale/evicted entry only ever costs one bypassed cooldown, which is harmless.
const PLANNER_MIN_GAP_MS = 60 * 1000;
const lastPlannerGen = new BoundedMap({ maxSize: 20_000, ttlMs: PLANNER_MIN_GAP_MS });

const router = Router();
router.param('id', uuidParamGuard); // reject non-UUID :id (task) with 400 before Prisma

// ── Validation rules ──────────────────────────────────────────────────────────
const PRIORITIES = ['urgent', 'today', 'plan'];
const listTasksRules = [
  query('date').optional({ checkFalsy: true }).isISO8601().withMessage('date must be a valid date (YYYY-MM-DD)'),
];
export const createTaskRules = [
  body('title').trim().notEmpty().withMessage('title is required').isLength({ max: 200 }),
  body('description').optional({ checkFalsy: true }).isString().isLength({ max: 2000 }),
  body('crop').optional({ checkFalsy: true }).isString().trim().isLength({ max: 100 }),
  body('field').optional({ checkFalsy: true }).isString().trim().isLength({ max: 100 }),
  body('priority').optional({ checkFalsy: true }).isIn(PRIORITIES),
  body('icon').optional({ checkFalsy: true }).isString().isLength({ max: 50 }),
  body('color').optional({ checkFalsy: true }).matches(/^#[0-9A-Fa-f]{3,8}$/).withMessage('color must be a hex code'),
  body('scheduledFor').optional({ checkFalsy: true }).isISO8601().withMessage('scheduledFor must be a valid date'),
];
const updateTaskRules = [
  body('done').optional().isBoolean().withMessage('done must be a boolean'),
  body('title').optional({ checkFalsy: true }).trim().isLength({ max: 200 }),
  body('description').optional().isString().isLength({ max: 2000 }),
  body('priority').optional({ checkFalsy: true }).isIn(PRIORITIES),
];
const generateTasksRules = [
  body('crop').optional({ checkFalsy: true }).isString().trim().isLength({ max: 100 }),
  body('state').optional({ checkFalsy: true }).isString().trim().isLength({ max: 100 }),
  body('dayOfSeason').optional({ checkFalsy: true }).isInt({ min: 0, max: 400 }).withMessage('dayOfSeason must be 0-400').toInt(),
];

// ── GET /api/v1/planner/tasks ─────────────────────────────────────────────────
router.get('/tasks', authenticate, listTasksRules, validate, async (req, res) => {
  const dateStr = req.query.date || new Date().toISOString().split('T')[0];
  const date    = new Date(dateStr);
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);

  const tasks = await prisma.plannerTask.findMany({
    where: {
      userId: req.user.id,
      scheduledFor: { gte: date, lt: nextDay },
    },
    orderBy: [
      { doneAt: 'asc' },    // undone first
      { priority: 'asc' },  // urgent → today → plan
      { createdAt: 'asc' },
    ],
  });

  return sendSuccess(res, tasks);
});

// ── POST /api/v1/planner/tasks ────────────────────────────────────────────────
router.post('/tasks', authenticate, createTaskRules, validate, async (req, res) => {
  const { title, description, crop, field, priority, icon, color, scheduledFor } = req.body;

  const task = await prisma.plannerTask.create({
    data: {
      userId:       req.user.id,
      title:        stripHtml(title.trim()),
      description:  description ? stripHtml(description) : null,
      crop:         crop        || null,
      field:        field       || null,
      priority:     ['urgent', 'today', 'plan'].includes(priority) ? priority : 'today',
      icon:         icon        || 'calendar-outline',
      color:        color       || '#F39C12',
      scheduledFor: scheduledFor ? new Date(scheduledFor) : new Date(),
      aiGenerated:  false,
    },
  });

  return sendSuccess(res, task, 201);
});

// ── PUT /api/v1/planner/tasks/:id ─────────────────────────────────────────────
router.put('/tasks/:id', authenticate, updateTaskRules, validate, async (req, res) => {
  const task = await prisma.plannerTask.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!task) return sendError(res, 'Task not found', 404);

  const { done, title, description, priority } = req.body;
  const update = {};

  if (typeof done === 'boolean') update.doneAt = done ? new Date() : null;
  if (title)       update.title       = title.trim();
  if (description !== undefined) update.description = description;
  if (priority && ['urgent', 'today', 'plan'].includes(priority)) update.priority = priority;

  const updated = await prisma.plannerTask.update({
    where: { id: task.id },
    data: update,
  });

  return sendSuccess(res, updated);
});

// ── DELETE /api/v1/planner/tasks/:id ─────────────────────────────────────────
router.delete('/tasks/:id', authenticate, async (req, res) => {
  const task = await prisma.plannerTask.findFirst({
    where: { id: req.params.id, userId: req.user.id },
  });
  if (!task) return sendError(res, 'Task not found', 404);
  await prisma.plannerTask.delete({ where: { id: task.id } });
  return sendSuccess(res, { deleted: true });
});

// ── POST /api/v1/planner/generate ─────────────────────────────────────────────
// AI generates tasks for today based on farm context
router.post('/generate', authenticate, requireFeature('ai_planner'), generateTasksRules, validate, async (req, res) => {
  // Enforce per-user cooldown to avoid hammering Gemini
  const last = lastPlannerGen.get(req.user.id) || 0;
  const diff = Date.now() - last;
  if (diff < PLANNER_MIN_GAP_MS) {
    const wait = Math.ceil((PLANNER_MIN_GAP_MS - diff) / 1000);
    return sendError(res, `Please wait ${wait}s before regenerating tasks.`, 429);
  }
  lastPlannerGen.set(req.user.id, Date.now());

  const { crop, state, dayOfSeason } = req.body;

  // Build farm context
  const farmContext = {
    crop:        crop        || req.user.farmDetail?.cropTypes?.[0] || 'Tomato',
    state:       state       || req.user.state  || 'Maharashtra',
    district:    req.user.district  || 'Nashik',
    dayOfSeason: dayOfSeason || 45,
    season:      getCurrentSeason(),
    month:       new Date().toLocaleString('en-IN', { month: 'long' }),
    farmerName:  req.user.name || 'Farmer',
  };

  // RESERVE before the Gemini call. This route used to reach the LLM with no
  // balance check, no debit and no AIUsage row — free, unmetered spend that also
  // never showed up in the admin Usage & Cost page. Same atomic reserve/settle/
  // release triple every other AI route uses, so concurrent calls can't overspend.
  const hold = await reserveCredits(req.user.id, 'ai_planner');
  if (!hold.ok) {
    return sendError(res, 'You’ve used all your AI credits for this month. They refill on the 1st.', 402);
  }
  // releaseCredits is NOT idempotent — it unconditionally re-credits `reserved`. Once
  // the hold is finalised (settled OR released) the catch must not touch it again, or
  // a failure while persisting the tasks would hand back credits that were already
  // refunded. Same guard the scan path uses.
  let holdFinalised = false;

  try {
    const { tasks: aiTasks, tokensUsed, model } = await generatePlannerTasks(farmContext);

    if (!aiTasks.length) {
      // The tokens were still spent, but a planner that produced nothing is not
      // worth charging for — refund and surface the failure.
      holdFinalised = true;
      await releaseCredits(req.user.id, 'ai_planner', { reserved: hold.reserved, holdId: hold.holdId }).catch(() => {});
      return sendError(res, 'AI could not generate tasks. Try again.', 500);
    }

    // Track usage for the admin roll-up (non-blocking), then settle the hold
    // against the real token count.
    const usageDay = new Date(); usageDay.setUTCHours(0, 0, 0, 0);
    prisma.aIUsage.upsert({
      where:  { userId_date: { userId: req.user.id, date: usageDay } },
      create: { userId: req.user.id, date: usageDay, totalTokens: tokensUsed, monthlyTokens: tokensUsed },
      update: { totalTokens: { increment: tokensUsed }, monthlyTokens: { increment: tokensUsed } },
    }).catch(() => {});
    holdFinalised = true;   // from here on the catch must NOT refund
    const settled = await settleCredits(req.user.id, 'ai_planner', {
      reserved: hold.reserved, holdId: hold.holdId, tokensUsed, model,
      description: 'Daily planner generation',
    });
    if (settled?.error) logger.warn('[Planner] credit settle failed for user=%s: %s', req.user.id, settled.error);

    // Delete existing AI-generated tasks for today (replace with fresh ones)
    const today   = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

    await prisma.plannerTask.deleteMany({
      where: {
        userId:       req.user.id,
        aiGenerated:  true,
        scheduledFor: { gte: today, lt: tomorrow },
      },
    });

    // Create new AI tasks
    const tasks = await prisma.plannerTask.createManyAndReturn({
      data: aiTasks.map(t => ({
        userId:      req.user.id,
        title:       t.title,
        description: t.description || null,
        crop:        t.crop        || farmContext.crop,
        field:       t.field       || null,
        priority:    ['urgent', 'today', 'plan'].includes(t.priority) ? t.priority : 'today',
        icon:        t.icon        || 'leaf-outline',
        color:       t.color       || '#2ECC71',
        aiGenerated: true,
        aiReason:    t.aiReason    || null,
        scheduledFor: new Date(),
      })),
    }).catch(async () => {
      // createManyAndReturn not available in older Prisma — fallback
      await prisma.plannerTask.createMany({
        data: aiTasks.map(t => ({
          userId:      req.user.id,
          title:       t.title,
          description: t.description || null,
          crop:        t.crop        || farmContext.crop,
          field:       t.field       || null,
          priority:    ['urgent', 'today', 'plan'].includes(t.priority) ? t.priority : 'today',
          icon:        t.icon        || 'leaf-outline',
          color:       t.color       || '#2ECC71',
          aiGenerated: true,
          aiReason:    t.aiReason    || null,
          scheduledFor: new Date(),
        })),
      });
      return prisma.plannerTask.findMany({
        where: { userId: req.user.id, aiGenerated: true, scheduledFor: { gte: today, lt: tomorrow } },
        orderBy: { createdAt: 'asc' },
      });
    });

    return sendSuccess(res, tasks);
  } catch (err) {
    // Refund only if the hold is still open — i.e. the failure was at or before the
    // LLM call. A throw AFTER settle (persisting the tasks) leaves the charge in
    // place: the Gemini spend was real, and re-crediting here would double-refund.
    if (!holdFinalised) {
      await releaseCredits(req.user.id, 'ai_planner', { reserved: hold.reserved, holdId: hold.holdId }).catch(() => {});
    }
    console.error('[Planner Generate]', err.message);
    if (err.status === 429) return sendError(res, 'AI rate limit. Try again in 30 seconds.', 429);
    return sendError(res, 'AI task generation failed. Please try again.', 500);
  }
});

export default router;
