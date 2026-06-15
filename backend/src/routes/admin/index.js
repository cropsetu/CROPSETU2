/**
 * Admin API router — /api/v1/admin/*
 *
 * Composes every admin module under one router and applies the security boundary
 * ONCE here: `authenticate` (JWT → req.user) then `requireAdmin` (role === ADMIN).
 * A non-ADMIN is rejected with 403 before any sub-route handler runs — the SPA's
 * role check is cosmetic; THIS is the enforcement.
 *
 * Sub-paths here are disjoint from the pre-existing admin routers mounted in
 * app.js (/admin/incidents, /admin/fraud, /admin/moderation, /admin/features,
 * /admin/health/apis), so nothing is shadowed — those extend Trust & Safety / Ops
 * and this fills in the rest of the surface.
 */
import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { requireAdmin, loadAdminContext, requireScope, ADMIN_SCOPES } from '../../middleware/admin.js';

import metricsRoutes from './metrics.routes.js';
import usersRoutes from './users.routes.js';
import kycRoutes from './kyc.routes.js';
import { categoriesRouter, productsRouter, reviewsRouter } from './catalog.routes.js';
import ordersRoutes from './orders.routes.js';
import returnsRoutes from './returns.routes.js';
import { animalsRouter, machineryRouter, labourRouter, bookingsRouter } from './listings.routes.js';
import { postsRouter, commentsRouter, groupsRouter } from './community.routes.js';
import aiRoutes from './ai.routes.js';
import { schemesRouter, mspRouter, cropMasterRouter, pestAlertsRouter, mandiRouter } from './cms.routes.js';
import broadcastRoutes from './broadcast.routes.js';
import { flagsRouter, healthRouter, queuesRouter } from './ops.routes.js';
import { consentsRouter, erasureRouter, auditRouter } from './compliance.routes.js';
import settingsRoutes from './settings.routes.js';
import { teamRouter, meRouter } from './team.routes.js';
import { sellersRouter, payoutsRouter } from './finance.routes.js';

const router = Router();

// ── Server-enforced ADMIN gate for the entire admin surface ──────────────────
router.use(authenticate, requireAdmin);
// Resolve the acting admin's RBAC scopes once (→ req.admin) for requireScope below.
// Backward-compatible: an ADMIN with no scopes is treated as SUPER_ADMIN.
router.use(loadAdminContext);

const S = ADMIN_SCOPES;

// Acting admin's own identity + scopes (any admin; drives the SPA's nav gating).
router.use('/me', meRouter);
// Team & access management (promote / scope / revoke admins) — SUPER_ADMIN only.
router.use('/team', requireScope(S.SUPER_ADMIN), teamRouter);

// Dashboard (any admin)
router.use('/metrics', metricsRoutes);
// Users & identity
router.use('/users', requireScope(S.SUPPORT), usersRoutes);
router.use('/kyc', requireScope(S.KYC_REVIEWER), kycRoutes);
// Commerce
router.use('/categories', requireScope(S.CMS_EDITOR), categoriesRouter);
router.use('/products', requireScope(S.CMS_EDITOR), productsRouter);
router.use('/reviews', requireScope(S.CONTENT_MODERATOR), reviewsRouter);
router.use('/orders', requireScope(S.SUPPORT), ordersRoutes);
// Returns / RMA + richer order ops (SUPPORT scope)
router.use('/returns', requireScope(S.SUPPORT), returnsRoutes);
// Rentals & trade
router.use('/animals', requireScope(S.CONTENT_MODERATOR), animalsRouter);
router.use('/machinery', requireScope(S.CONTENT_MODERATOR), machineryRouter);
router.use('/labour', requireScope(S.CONTENT_MODERATOR), labourRouter);
router.use('/bookings', requireScope(S.SUPPORT), bookingsRouter);
// Community
router.use('/posts', requireScope(S.CONTENT_MODERATOR), postsRouter);
router.use('/comments', requireScope(S.CONTENT_MODERATOR), commentsRouter);
router.use('/groups', requireScope(S.CONTENT_MODERATOR), groupsRouter);
// Finance — seller settlement ledger & payouts
router.use('/sellers', requireScope(S.FINANCE), sellersRouter);
router.use('/payouts', requireScope(S.FINANCE), payoutsRouter);
// AI operations
router.use('/ai', requireScope(S.OPS), aiRoutes);
// CMS
router.use('/schemes', requireScope(S.CMS_EDITOR), schemesRouter);
router.use('/msp', requireScope(S.CMS_EDITOR), mspRouter);
router.use('/crop-master', requireScope(S.CMS_EDITOR), cropMasterRouter);
router.use('/pest-alerts', requireScope(S.CMS_EDITOR), pestAlertsRouter);
router.use('/mandi', requireScope(S.CMS_EDITOR), mandiRouter);
// Broadcast
router.use('/notifications', requireScope(S.CONTENT_MODERATOR), broadcastRoutes);
// Ops
router.use('/flags', requireScope(S.OPS), flagsRouter);
router.use('/health', requireScope(S.OPS), healthRouter);
router.use('/queues', requireScope(S.OPS), queuesRouter);
// Compliance (DPDP) — most sensitive, SUPER_ADMIN only
router.use('/consents', requireScope(S.SUPER_ADMIN), consentsRouter);
router.use('/erasure-requests', requireScope(S.SUPER_ADMIN), erasureRouter);
router.use('/audit', requireScope(S.SUPER_ADMIN), auditRouter);
// Settings (runtime config + AI model routing + env-status + AI budget) — SUPER_ADMIN only
router.use('/settings', requireScope(S.SUPER_ADMIN), settingsRoutes);

export default router;
