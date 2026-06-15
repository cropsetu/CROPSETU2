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
import { requireAdmin } from '../../middleware/admin.js';

import metricsRoutes from './metrics.routes.js';
import usersRoutes from './users.routes.js';
import kycRoutes from './kyc.routes.js';
import { categoriesRouter, productsRouter, reviewsRouter } from './catalog.routes.js';
import ordersRoutes from './orders.routes.js';
import { animalsRouter, machineryRouter, labourRouter, bookingsRouter } from './listings.routes.js';
import { postsRouter, commentsRouter, groupsRouter } from './community.routes.js';
import aiRoutes from './ai.routes.js';
import { schemesRouter, mspRouter, cropMasterRouter, pestAlertsRouter, mandiRouter } from './cms.routes.js';
import broadcastRoutes from './broadcast.routes.js';
import { flagsRouter, healthRouter, queuesRouter } from './ops.routes.js';
import { consentsRouter, erasureRouter, auditRouter } from './compliance.routes.js';
import settingsRoutes from './settings.routes.js';

const router = Router();

// ── Server-enforced ADMIN gate for the entire admin surface ──────────────────
router.use(authenticate, requireAdmin);

// Dashboard
router.use('/metrics', metricsRoutes);
// Users & identity
router.use('/users', usersRoutes);
router.use('/kyc', kycRoutes);
// Commerce
router.use('/categories', categoriesRouter);
router.use('/products', productsRouter);
router.use('/reviews', reviewsRouter);
router.use('/orders', ordersRoutes);
// Rentals & trade
router.use('/animals', animalsRouter);
router.use('/machinery', machineryRouter);
router.use('/labour', labourRouter);
router.use('/bookings', bookingsRouter);
// Community
router.use('/posts', postsRouter);
router.use('/comments', commentsRouter);
router.use('/groups', groupsRouter);
// AI operations
router.use('/ai', aiRoutes);
// CMS
router.use('/schemes', schemesRouter);
router.use('/msp', mspRouter);
router.use('/crop-master', cropMasterRouter);
router.use('/pest-alerts', pestAlertsRouter);
router.use('/mandi', mandiRouter);
// Broadcast
router.use('/notifications', broadcastRoutes);
// Ops
router.use('/flags', flagsRouter);
router.use('/health', healthRouter);
router.use('/queues', queuesRouter);
// Compliance (DPDP)
router.use('/consents', consentsRouter);
router.use('/erasure-requests', erasureRouter);
router.use('/audit', auditRouter);
// Settings (runtime config + AI model routing + env-status + AI budget)
router.use('/settings', settingsRoutes);

export default router;
