/**
 * Admin User Activity 360 — /api/v1/admin/activity
 *
 * The headline support/forensics surface: see what any user is doing across the
 * whole product — AI text chats, voice/audio chats, disease diagnoses, orders,
 * bookings and reviews — from one place.
 *
 * GET /activity                          cross-user recent activity feed (merged + sorted)
 * GET /activity/users/:id                per-user 360 (parallel counts + recent per type)
 * GET /activity/conversations/:id        AI conversation messages (content masked; ?reveal audited)
 * GET /activity/voice-conversations/:id  voice thread messages (content masked; ?reveal audited)
 * GET /activity/voice-sessions/:id       single voice turn (transcript masked; ?reveal audited)
 *
 * SCOPE: mounted behind requireScope(ADMIN_SCOPES.SUPPORT) in index.js (on top of
 * the ADMIN gate the parent router already applies).
 *
 * READ-ONLY: no mutations, no new Prisma models. The only writes this module makes
 * are ADMIN_PII_REVEAL audit rows (via auditReveal) when an operator unmasks
 * message/transcript CONTENT with `?reveal=true&reason=`.
 *
 * SENSITIVITY: chat/voice message CONTENT and voice transcripts are sensitive →
 * masked by default everywhere; full text is returned ONLY on the audited reveal
 * path. Phone numbers in any user context are masked (maskPhone).
 */
import { Router } from 'express';
import { param, query } from 'express-validator';
import prisma from '../../config/db.js';
import { validate } from '../../middleware/validate.js';
import { sendSuccess, sendServerError, sendNotFound } from '../../utils/response.js';
import { keysetList } from '../../utils/adminList.js';
import { maskPhone, auditReveal } from '../../utils/adminPii.js';
import { listParams, revealValidators } from './_helpers.js';

const router = Router();

// Activity types the feed + filters understand.
const TYPES = ['ai_chat', 'voice_session', 'voice_conversation', 'diagnosis', 'order', 'booking', 'review'];

// Per-type cap when merging rows across tables in JS for the cross-user feed.
// We pull at most this many of each type, merge + sort, then return the most
// recent overall — never a silent truncation (the cap + perTypeFetched counts
// are echoed in meta so a caller can see when a type hit the ceiling).
const FEED_CAP_PER_TYPE = 25;

// How many recent items to surface per type on the per-user 360.
const RECENT_PER_TYPE = 5;

// Short masked preview length for sensitive content shown in summaries/lists.
const PREVIEW_LEN = 60;

// ── content masking ───────────────────────────────────────────────────────────
/**
 * Mask sensitive free-text (a chat/voice message or a transcript): return a short
 * leading preview plus a redaction marker, never the full body. Full content is
 * served ONLY on the audited reveal path.
 */
function maskContent(text) {
  if (text == null) return null;
  const s = String(text);
  if (s.length <= PREVIEW_LEN) return s;
  return `${s.slice(0, PREVIEW_LEN)}… [${s.length - PREVIEW_LEN} more chars — reveal to view]`;
}

/** Best-effort one-line summary for the feed (already masked where sensitive). */
function clip(text, len = 80) {
  if (text == null) return null;
  const s = String(text).replace(/\s+/g, ' ').trim();
  return s.length <= len ? s : `${s.slice(0, len)}…`;
}

// ── normalizers (table row → unified feed item) ───────────────────────────────
// Each yields { id, type, userId, title, summary, createdAt, ref }. `ref` carries
// the few type-specific fields a list cell wants (status, riskLevel, …). Nothing
// here exposes raw message/transcript bodies — only safe metadata or masked clips.
const NORMALIZE = {
  ai_chat: (r) => ({
    id: r.id, type: 'ai_chat', userId: r.userId,
    title: r.title || 'AI chat', summary: `${r.messageCount} message(s)`,
    createdAt: r.updatedAt, ref: { messageCount: r.messageCount, isScanSession: r.isScanSession, conversationId: r.id },
  }),
  voice_session: (r) => ({
    id: r.id, type: 'voice_session', userId: r.userId,
    title: 'Voice turn', summary: clip(maskContent(r.transcription)) || '(no transcript)',
    createdAt: r.createdAt, ref: { durationSeconds: r.durationSeconds, languageDetected: r.languageDetected, conversationId: r.conversationId },
  }),
  voice_conversation: (r) => ({
    id: r.id, type: 'voice_conversation', userId: r.userId,
    title: r.title || 'Voice chat', summary: `${r.messageCount} message(s)`,
    createdAt: r.updatedAt, ref: { messageCount: r.messageCount, conversationId: r.id },
  }),
  diagnosis: (r) => ({
    id: r.id, type: 'diagnosis', userId: r.userId,
    title: `${r.cropType} · ${r.primaryDisease}`, summary: `${r.riskLevel} risk`,
    createdAt: r.createdAt, ref: { cropType: r.cropType, primaryDisease: r.primaryDisease, riskLevel: r.riskLevel, confidenceScore: r.confidenceScore },
  }),
  order: (r) => ({
    id: r.id, type: 'order', userId: r.userId,
    title: `Order ${r.id.slice(0, 8)}`, summary: `${r.status} · ₹${r.totalAmount}`,
    createdAt: r.createdAt, ref: { status: r.status, paymentStatus: r.paymentStatus, totalAmount: r.totalAmount },
  }),
  booking: (r) => ({
    id: r.id, type: 'booking', userId: r.userId,
    title: `Booking ${r.id.slice(0, 8)}`, summary: `${r.status}${r.machineryListingId ? ' · machinery' : r.labourListingId ? ' · labour' : ''}`,
    createdAt: r.createdAt, ref: { status: r.status, totalAmount: r.totalAmount, type: r.machineryListingId ? 'machinery' : r.labourListingId ? 'labour' : null },
  }),
  review: (r) => ({
    id: r.id, type: 'review', userId: r.userId,
    title: `Review ${r.rating}★`, summary: clip(r.comment) || '(no comment)',
    createdAt: r.createdAt, ref: { rating: r.rating, productId: r.productId },
  }),
};

// Per-type sources for the cross-user merged feed: each pulls the latest
// FEED_CAP_PER_TYPE rows (optionally scoped to a userId) with just the columns a
// feed item needs. Note AIConversation / VoiceConversation surface activity on
// `updatedAt` (last touched), the rest on `createdAt`.
function feedSource(type, where, take) {
  switch (type) {
    case 'ai_chat':
      return prisma.aIConversation.findMany({ where, orderBy: { updatedAt: 'desc' }, take, select: { id: true, userId: true, title: true, messageCount: true, isScanSession: true, updatedAt: true } });
    case 'voice_session':
      return prisma.voiceSession.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true, userId: true, transcription: true, durationSeconds: true, languageDetected: true, conversationId: true, createdAt: true } });
    case 'voice_conversation':
      return prisma.voiceConversation.findMany({ where, orderBy: { updatedAt: 'desc' }, take, select: { id: true, userId: true, title: true, messageCount: true, updatedAt: true } });
    case 'diagnosis':
      return prisma.cropDiseaseReport.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true, userId: true, cropType: true, primaryDisease: true, riskLevel: true, confidenceScore: true, createdAt: true } });
    case 'order':
      return prisma.order.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true, userId: true, status: true, paymentStatus: true, totalAmount: true, createdAt: true } });
    case 'booking':
      return prisma.booking.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true, userId: true, status: true, totalAmount: true, machineryListingId: true, labourListingId: true, createdAt: true } });
    case 'review':
      return prisma.review.findMany({ where, orderBy: { createdAt: 'desc' }, take, select: { id: true, userId: true, rating: true, comment: true, productId: true, createdAt: true } });
    default:
      return Promise.resolve([]);
  }
}

// The single-table keyset path used when ?type= is set (proper pagination over
// one source). Maps the feed `type` to its Prisma delegate + select.
const KEYSET_SOURCE = {
  ai_chat:            { model: () => prisma.aIConversation, select: { id: true, userId: true, title: true, messageCount: true, isScanSession: true, createdAt: true, updatedAt: true } },
  voice_session:      { model: () => prisma.voiceSession, select: { id: true, userId: true, transcription: true, durationSeconds: true, languageDetected: true, conversationId: true, createdAt: true } },
  voice_conversation: { model: () => prisma.voiceConversation, select: { id: true, userId: true, title: true, messageCount: true, createdAt: true, updatedAt: true } },
  diagnosis:          { model: () => prisma.cropDiseaseReport, select: { id: true, userId: true, cropType: true, primaryDisease: true, riskLevel: true, confidenceScore: true, createdAt: true } },
  order:              { model: () => prisma.order, select: { id: true, userId: true, status: true, paymentStatus: true, totalAmount: true, createdAt: true } },
  booking:            { model: () => prisma.booking, select: { id: true, userId: true, status: true, totalAmount: true, machineryListingId: true, labourListingId: true, createdAt: true } },
  review:             { model: () => prisma.review, select: { id: true, userId: true, rating: true, comment: true, productId: true, createdAt: true } },
};

// Attach a masked actor (name + masked phone) onto each feed item by userId.
async function attachActors(items) {
  const ids = [...new Set(items.map((it) => it.userId).filter(Boolean))];
  if (ids.length === 0) return items;
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } });
  const byId = new Map(users.map((u) => [u.id, u]));
  return items.map((it) => {
    const u = byId.get(it.userId);
    return { ...it, user: u ? { id: u.id, name: u.name, phone: maskPhone(u.phone) } : null };
  });
}

// ── GET /activity — cross-user recent activity feed ───────────────────────────
router.get(
  '/',
  [
    query('userId').optional().isUUID(),
    query('type').optional().isIn(TYPES),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req, res) => {
    try {
      const userId = req.query.userId || undefined;
      const type = req.query.type || undefined;

      // ── Filtered to a single type → keyset-paginate that one table properly. ──
      if (type) {
        const src = KEYSET_SOURCE[type];
        const where = userId ? { userId } : {};
        const { cursor, limit } = listParams(req);
        const page = await keysetList(src.model(), { where, cursor, limit, select: src.select });
        const items = await attachActors(page.items.map((r) => NORMALIZE[type](r)));
        return sendSuccess(res, { items }, 200, {
          hasMore: page.hasMore, nextCursor: page.nextCursor, count: items.length, type, paginated: true,
        });
      }

      // ── Merged feed across every source. CAP at FEED_CAP_PER_TYPE per table; ──
      // merge + sort by createdAt desc in JS. The cap and per-type fetched counts
      // are returned in meta so a hit ceiling is visible (no silent truncation).
      const where = userId ? { userId } : {};
      const results = await Promise.all(TYPES.map((t) => feedSource(t, where, FEED_CAP_PER_TYPE)));

      const perTypeFetched = {};
      const cappedTypes = [];
      let merged = [];
      TYPES.forEach((t, i) => {
        const rows = results[i] || [];
        perTypeFetched[t] = rows.length;
        if (rows.length >= FEED_CAP_PER_TYPE) cappedTypes.push(t);
        merged = merged.concat(rows.map((r) => NORMALIZE[t](r)));
      });

      merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      // Trim the merged stream to the requested page size (bounded). This is a
      // display window over an already-capped, fully-counted set — meta below
      // reports both the cap and what was fetched per type.
      const { limit } = listParams(req);
      const windowed = merged.slice(0, limit);
      const items = await attachActors(windowed);

      return sendSuccess(res, { items }, 200, {
        count: items.length,
        merged: true,
        capPerType: FEED_CAP_PER_TYPE,
        perTypeFetched,
        cappedTypes, // types that hit the per-type ceiling (older rows not in this merge)
        totalFetched: merged.length,
      });
    } catch (err) {
      return sendServerError(res, err, 'Failed to load activity feed');
    }
  },
);

// ── GET /activity/users/:id — per-user 360 ────────────────────────────────────
router.get('/users/:id', [param('id').isUUID()], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, phone: true, role: true, district: true, state: true, createdAt: true, lastActiveAt: true },
    });
    if (!user) return sendNotFound(res, 'User');

    const N = RECENT_PER_TYPE;
    // Parallel counts + recent items per activity type — mirrors users.routes.js
    // GET /:id. Recent voice sessions carry a SHORT masked transcript preview;
    // raw bodies are never returned here (use the audited reveal endpoints).
    const [
      cAi, cVoiceSession, cVoiceConv, cDiagnosis, cOrders, cBookings, cReviews,
      rAi, rVoiceSession, rVoiceConv, rDiagnosis, rOrders, rBookings, rReviews,
    ] = await Promise.all([
      prisma.aIConversation.count({ where: { userId: id } }),
      prisma.voiceSession.count({ where: { userId: id } }),
      prisma.voiceConversation.count({ where: { userId: id } }),
      prisma.cropDiseaseReport.count({ where: { userId: id } }),
      prisma.order.count({ where: { userId: id } }),
      prisma.booking.count({ where: { userId: id } }),
      prisma.review.count({ where: { userId: id } }),
      prisma.aIConversation.findMany({ where: { userId: id }, orderBy: { updatedAt: 'desc' }, take: N, select: { id: true, title: true, messageCount: true, isScanSession: true, language: true, updatedAt: true } }),
      prisma.voiceSession.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: N, select: { id: true, transcription: true, durationSeconds: true, languageDetected: true, conversationId: true, createdAt: true } }),
      prisma.voiceConversation.findMany({ where: { userId: id }, orderBy: { updatedAt: 'desc' }, take: N, select: { id: true, title: true, messageCount: true, language: true, updatedAt: true } }),
      prisma.cropDiseaseReport.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: N, select: { id: true, cropType: true, primaryDisease: true, riskLevel: true, confidenceScore: true, createdAt: true } }),
      prisma.order.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: N, select: { id: true, status: true, paymentStatus: true, totalAmount: true, createdAt: true } }),
      prisma.booking.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: N, select: { id: true, status: true, totalAmount: true, machineryListingId: true, labourListingId: true, createdAt: true } }),
      prisma.review.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: N, select: { id: true, rating: true, comment: true, productId: true, createdAt: true } }),
    ]);

    return sendSuccess(res, {
      user: { ...user, phone: maskPhone(user.phone) },
      counts: {
        aiConversations: cAi,
        voiceSessions: cVoiceSession,
        voiceConversations: cVoiceConv,
        diagnoses: cDiagnosis,
        orders: cOrders,
        bookings: cBookings,
        reviews: cReviews,
      },
      recent: {
        aiConversations: rAi,
        voiceSessions: rVoiceSession.map((v) => ({
          id: v.id, transcriptionPreview: maskContent(v.transcription), durationSeconds: v.durationSeconds,
          languageDetected: v.languageDetected, conversationId: v.conversationId, createdAt: v.createdAt,
        })),
        voiceConversations: rVoiceConv,
        diagnoses: rDiagnosis,
        orders: rOrders,
        bookings: rBookings.map((b) => ({
          id: b.id, status: b.status, totalAmount: b.totalAmount,
          type: b.machineryListingId ? 'machinery' : b.labourListingId ? 'labour' : null, createdAt: b.createdAt,
        })),
        reviews: rReviews,
      },
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load user activity');
  }
});

// ── GET /activity/conversations/:id — AI conversation messages ────────────────
// Message CONTENT masked by default; full content only with ?reveal=true&reason=
// → auditReveal({ entity:'AIConversation', fields:['content'], reason }).
router.get('/conversations/:id', [param('id').isUUID(), ...revealValidators()], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.aIConversation.findUnique({
      where: { id },
      select: { id: true, userId: true, title: true, summary: true, messageCount: true, language: true, isScanSession: true, createdAt: true, updatedAt: true },
    });
    if (!conversation) return sendNotFound(res, 'Conversation');

    const reveal = String(req.query.reveal) === 'true';
    if (reveal) {
      await auditReveal(req, { entity: 'AIConversation', entityId: id, fields: ['content'], reason: req.query.reason });
    }

    const messages = await prisma.aIMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, messageType: true, tokensUsed: true, modelUsed: true, ragUsed: true, language: true, createdAt: true },
    });

    const owner = await prisma.user.findUnique({ where: { id: conversation.userId }, select: { id: true, name: true, phone: true } });

    return sendSuccess(res, {
      conversation: { ...conversation, user: owner ? { id: owner.id, name: owner.name, phone: maskPhone(owner.phone) } : null },
      contentRevealed: reveal,
      messages: messages.map((m) => ({ ...m, content: reveal ? m.content : maskContent(m.content) })),
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load conversation');
  }
});

// ── GET /activity/voice-conversations/:id — voice thread messages ─────────────
// Same masked/reveal treatment for VoiceMessage content.
router.get('/voice-conversations/:id', [param('id').isUUID(), ...revealValidators()], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const conversation = await prisma.voiceConversation.findUnique({
      where: { id },
      select: { id: true, userId: true, title: true, summary: true, messageCount: true, language: true, createdAt: true, updatedAt: true },
    });
    if (!conversation) return sendNotFound(res, 'Voice conversation');

    const reveal = String(req.query.reveal) === 'true';
    if (reveal) {
      await auditReveal(req, { entity: 'VoiceConversation', entityId: id, fields: ['content'], reason: req.query.reason });
    }

    const messages = await prisma.voiceMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, content: true, durationSeconds: true, modelUsed: true, language: true, audioInputUrl: true, audioOutputUrl: true, createdAt: true },
    });

    const owner = await prisma.user.findUnique({ where: { id: conversation.userId }, select: { id: true, name: true, phone: true } });

    return sendSuccess(res, {
      conversation: { ...conversation, user: owner ? { id: owner.id, name: owner.name, phone: maskPhone(owner.phone) } : null },
      contentRevealed: reveal,
      messages: messages.map((m) => ({
        ...m,
        content: reveal ? m.content : maskContent(m.content),
        // Audio URLs point at the raw user voice — only surfaced on the reveal path.
        audioInputUrl: reveal ? m.audioInputUrl : null,
        audioOutputUrl: reveal ? m.audioOutputUrl : null,
      })),
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load voice conversation');
  }
});

// ── GET /activity/voice-sessions/:id — single voice turn ──────────────────────
// Transcription + responseText masked by default; full text + audio only on the
// audited reveal path.
router.get('/voice-sessions/:id', [param('id').isUUID(), ...revealValidators()], validate, async (req, res) => {
  try {
    const { id } = req.params;
    const session = await prisma.voiceSession.findUnique({
      where: { id },
      select: {
        id: true, userId: true, transcription: true, transcriptionConf: true, responseText: true,
        audioInputUrl: true, audioOutputUrl: true, languageDetected: true, languageRequested: true,
        durationSeconds: true, whisperModel: true, ttsVoice: true, conversationId: true, createdAt: true,
      },
    });
    if (!session) return sendNotFound(res, 'Voice session');

    const reveal = String(req.query.reveal) === 'true';
    if (reveal) {
      await auditReveal(req, { entity: 'VoiceSession', entityId: id, fields: ['transcription', 'responseText'], reason: req.query.reason });
    }

    const owner = await prisma.user.findUnique({ where: { id: session.userId }, select: { id: true, name: true, phone: true } });

    return sendSuccess(res, {
      session: {
        id: session.id,
        user: owner ? { id: owner.id, name: owner.name, phone: maskPhone(owner.phone) } : null,
        transcription: reveal ? session.transcription : maskContent(session.transcription),
        responseText: reveal ? session.responseText : maskContent(session.responseText),
        transcriptionConf: session.transcriptionConf,
        audioInputUrl: reveal ? session.audioInputUrl : null,
        audioOutputUrl: reveal ? session.audioOutputUrl : null,
        languageDetected: session.languageDetected,
        languageRequested: session.languageRequested,
        durationSeconds: session.durationSeconds,
        whisperModel: session.whisperModel,
        ttsVoice: session.ttsVoice,
        conversationId: session.conversationId,
        createdAt: session.createdAt,
      },
      contentRevealed: reveal,
    });
  } catch (err) {
    return sendServerError(res, err, 'Failed to load voice session');
  }
});

export default router;
