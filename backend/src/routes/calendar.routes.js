/**
 * Crop Calendar Routes
 *
 * POST   /api/v1/calendar/generate            — generate calendar for a crop + sowing date
 * GET    /api/v1/calendar                     — farmer's active calendars (summary)
 * GET    /api/v1/calendar/:id                 — calendar detail with all tasks
 * GET    /api/v1/calendar/today               — today's + overdue tasks across all calendars
 * PATCH  /api/v1/calendar/tasks/:taskId       — mark task complete / skipped
 * DELETE /api/v1/calendar/:id                 — delete calendar
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { sendSuccess, sendError } from '../utils/response.js';
import { isEnabled } from '../services/featureFlag.service.js';
import { generateCalendar, getTodaysTasks } from '../services/cropCalendar.service.js';
import prisma from '../config/db.js';

const router = Router();

// ── POST /api/v1/calendar/generate ───────────────────────────────────────────
router.post('/generate', authenticate, async (req, res) => {
  if (!await isEnabled('crop_calendar')) return sendError(res, 'फसल कैलेंडर सेवा अभी उपलब्ध नहीं है।', 503);

  const { crop, season, sowingDate, fieldName } = req.body;
  if (!crop || !sowingDate)      return sendError(res, 'crop and sowingDate are required', 400);
  if (!Date.parse(sowingDate))   return sendError(res, 'Invalid sowingDate format (use YYYY-MM-DD)', 400);

  const validSeasons = ['kharif', 'rabi', 'zaid'];
  const resolvedSeason = validSeasons.includes(season) ? season : 'kharif';

  try {
    const calendar = await generateCalendar({
      userId:    req.user.id,
      cropName:  crop.trim(),
      season:    resolvedSeason,
      year:      String(new Date(sowingDate).getFullYear()),
      sowingDate,
      state:     req.user.state    || 'Maharashtra',
      district:  req.user.district || '',
      fieldName: fieldName?.trim() || null,
    });

    return sendSuccess(res, calendar, 201);
  } catch (err) {
    if (err.message.includes('not found in master')) return sendError(res, err.message, 404);
    console.error('[Calendar Generate]', err.message);
    return sendError(res, 'Calendar generation failed. Please try again.', 500);
  }
});

// ── GET /api/v1/calendar/today ────────────────────────────────────────────────
router.get('/today', authenticate, async (req, res) => {
  if (!await isEnabled('crop_calendar')) return sendError(res, 'फसल कैलेंडर सेवा अभी उपलब्ध नहीं है।', 503);

  const { today, overdue } = await getTodaysTasks(req.user.id);
  return sendSuccess(res, { today, overdue });
});

// ── GET /api/v1/calendar ──────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  if (!await isEnabled('crop_calendar')) return sendError(res, 'फसल कैलेंडर सेवा अभी उपलब्ध नहीं है।', 503);

  const calendars = await prisma.cropCalendar.findMany({
    where:   { userId: req.user.id },
    orderBy: { sowingDate: 'desc' },
    include: {
      tasks: {
        select: { id: true, status: true, scheduledDate: true },
      },
    },
  });

  const withStats = calendars.map(cal => {
    const total     = cal.tasks.length;
    const completed = cal.tasks.filter(t => t.status === 'completed').length;
    const overdue   = cal.tasks.filter(t => t.status === 'overdue').length;
    const upcoming  = cal.tasks.filter(t => ['upcoming', 'due'].includes(t.status)).length;
    return { ...cal, tasks: undefined, stats: { total, completed, overdue, upcoming } };
  });

  return sendSuccess(res, withStats);
});

// ── GET /api/v1/calendar/:id ──────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res) => {
  const calendar = await prisma.cropCalendar.findFirst({
    where:   { id: req.params.id, userId: req.user.id },
    include: { tasks: { orderBy: { scheduledDate: 'asc' } } },
  });
  if (!calendar) return sendError(res, 'Calendar not found', 404);

  // Sync overdue status in real-time
  const now = new Date();
  for (const task of calendar.tasks) {
    if (task.status === 'upcoming' && new Date(task.scheduledDate) < now) {
      await prisma.cropCalendarTask.update({
        where: { id: task.id },
        data:  { status: 'overdue' },
      }).catch(() => {});
      task.status = 'overdue';
    }
  }

  return sendSuccess(res, calendar);
});

// ── PATCH /api/v1/calendar/tasks/:taskId ──────────────────────────────────────
router.patch('/tasks/:taskId', authenticate, async (req, res) => {
  const task = await prisma.cropCalendarTask.findFirst({
    where:   { id: req.params.taskId },
    include: { calendar: { select: { userId: true } } },
  });
  if (!task)                           return sendError(res, 'Task not found', 404);
  if (task.calendar.userId !== req.user.id) return sendError(res, 'Forbidden', 403);

  const { status } = req.body;
  const validStatuses = ['upcoming', 'due', 'completed', 'skipped'];
  if (!validStatuses.includes(status)) return sendError(res, `status must be one of: ${validStatuses.join(', ')}`, 400);

  const updated = await prisma.cropCalendarTask.update({
    where: { id: task.id },
    data:  {
      status,
      completedDate: status === 'completed' ? new Date() : null,
    },
  });

  return sendSuccess(res, updated);
});

// ── DELETE /api/v1/calendar/:id ───────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res) => {
  const calendar = await prisma.cropCalendar.findFirst({ where: { id: req.params.id, userId: req.user.id } });
  if (!calendar) return sendError(res, 'Calendar not found', 404);
  await prisma.cropCalendar.delete({ where: { id: calendar.id } });
  return sendSuccess(res, { deleted: true });
});

export default router;
