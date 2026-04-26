/**
 * Daily Planner Routes
 * GET  /api/v1/planner/tasks          — Today's tasks
 * POST /api/v1/planner/tasks          — Create a manual task
 * PUT  /api/v1/planner/tasks/:id      — Update task (mark done, etc.)
 * DELETE /api/v1/planner/tasks/:id   — Delete a task
 * POST /api/v1/planner/generate      — AI generate tasks for today
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { stripHtml } from '../utils/encrypt.js';
import { generatePlannerTasks, getCurrentSeason } from '../services/ai.chat.service.js';
import prisma from '../config/db.js';

// Per-user cooldown for planner generate (min 60s between AI calls)
const lastPlannerGen = new Map();
const PLANNER_MIN_GAP_MS = 60 * 1000;

const router = Router();

// ── GET /api/v1/planner/tasks ─────────────────────────────────────────────────
router.get('/tasks', authenticate, async (req, res) => {
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
router.post('/tasks', authenticate, async (req, res) => {
  const { title, description, crop, field, priority, icon, color, scheduledFor } = req.body;
  if (!title?.trim()) return sendError(res, 'title is required', 400);
  if (title.length > 200) return sendError(res, 'title too long (max 200 chars)', 400);
  if (description && description.length > 2000) return sendError(res, 'description too long (max 2000 chars)', 400);

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
router.put('/tasks/:id', authenticate, async (req, res) => {
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
router.post('/generate', authenticate, async (req, res) => {
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

  try {
    const aiTasks = await generatePlannerTasks(farmContext);

    if (!aiTasks.length) return sendError(res, 'AI could not generate tasks. Try again.', 500);

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
    console.error('[Planner Generate]', err.message);
    if (err.status === 429) return sendError(res, 'AI rate limit. Try again in 30 seconds.', 429);
    return sendError(res, 'AI task generation failed. Please try again.', 500);
  }
});

export default router;
