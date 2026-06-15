-- Admin panel v2 (WI-1…WI-10) — additive schema, applied MANUALLY.
--
-- WHY MANUAL: the Railway deploy runs `prisma db push`, which makes the DB match
-- schema.prisma EXACTLY — so it tries to DROP tables it doesn't know about
-- (FastAPI's ai_scan_diagnoses, its feedback table, etc.). Once those tables hold
-- data, db push aborts ("data loss") and NONE of the schema applies — which is why
-- `users.adminScopes` was missing and every login 500'd (P2022). NEVER add
-- --accept-data-loss to the deploy: it would let db push drop those FastAPI tables
-- (incl. mandi_prices). This script applies only the additive admin changes.
--
-- Generated drop-free via:
--   prisma migrate diff --from-schema-datamodel <pre-WI-1> --to-schema-datamodel <current> --script
--
-- APPLY (any one):
--   cd backend && DATABASE_URL=<prod> npx prisma db execute --file prisma/manual/admin_v2_additive.sql --schema prisma/schema.prisma
--   psql "$DATABASE_URL" -f backend/prisma/manual/admin_v2_additive.sql
--   Railway → Postgres service → Data/Query tab → paste + run
--
-- Idempotent-ish: safe to re-run after the first apply only if you remove already-
-- created objects, OR just run the single ALTER below first to unblock login.

BEGIN;

-- ── LOGIN UNBLOCK (the one line that fixes verify-otp 500s) ───────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "adminScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- ── Enums ─────────────────────────────────────────────────────────────────────
CREATE TYPE "AppSettingType" AS ENUM ('STRING', 'NUMBER', 'BOOL', 'JSON', 'ENUM');
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'REJECTED', 'REFUNDED', 'COMPLETED');
CREATE TYPE "LedgerEntryType" AS ENUM ('SALE', 'COMMISSION', 'REFUND', 'PAYOUT', 'ADJUSTMENT');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED');
CREATE TYPE "DisputeType" AS ENUM ('ANIMAL_TRADE', 'RENT_BOOKING', 'ORDER');
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'INVESTIGATING', 'RESOLVED', 'CLOSED');

-- ── Tables ────────────────────────────────────────────────────────────────────
CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "type" "AppSettingType" NOT NULL DEFAULT 'STRING',
    "category" TEXT NOT NULL DEFAULT 'general',
    "label" TEXT,
    "description" TEXT,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "return_requests" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderItemId" TEXT,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "refundAmount" DECIMAL(12,2),
    "resolvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "seller_ledger_entries" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "type" "LedgerEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "orderId" TEXT,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "seller_ledger_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "sellerId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "reference" TEXT,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "processedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "disputes" (
    "id" TEXT NOT NULL,
    "type" "DisputeType" NOT NULL,
    "refId" TEXT NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "againstUser" TEXT,
    "reason" TEXT NOT NULL,
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "notification_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "titleI18n" JSONB NOT NULL,
    "bodyI18n" JSONB NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "broadcast_logs" (
    "id" TEXT NOT NULL,
    "sentBy" TEXT,
    "filters" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "templateKey" TEXT,
    "estimated" INTEGER NOT NULL DEFAULT 0,
    "sent" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "broadcast_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'error',
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "app_settings_key_key" ON "app_settings"("key");
CREATE INDEX "app_settings_category_idx" ON "app_settings"("category");
CREATE INDEX "return_requests_status_idx" ON "return_requests"("status");
CREATE INDEX "return_requests_orderId_idx" ON "return_requests"("orderId");
CREATE INDEX "return_requests_userId_idx" ON "return_requests"("userId");
CREATE INDEX "return_requests_createdAt_idx" ON "return_requests"("createdAt");
CREATE INDEX "seller_ledger_entries_sellerId_createdAt_idx" ON "seller_ledger_entries"("sellerId", "createdAt" DESC);
CREATE INDEX "seller_ledger_entries_orderId_idx" ON "seller_ledger_entries"("orderId");
CREATE INDEX "seller_ledger_entries_type_idx" ON "seller_ledger_entries"("type");
CREATE INDEX "payouts_sellerId_createdAt_idx" ON "payouts"("sellerId", "createdAt" DESC);
CREATE INDEX "payouts_status_createdAt_idx" ON "payouts"("status", "createdAt" DESC);
CREATE INDEX "disputes_status_idx" ON "disputes"("status");
CREATE INDEX "disputes_type_idx" ON "disputes"("type");
CREATE INDEX "disputes_createdAt_idx" ON "disputes"("createdAt");
CREATE UNIQUE INDEX "notification_templates_key_key" ON "notification_templates"("key");
CREATE INDEX "notification_templates_category_idx" ON "notification_templates"("category");
CREATE INDEX "notification_templates_isActive_idx" ON "notification_templates"("isActive");
CREATE INDEX "notification_templates_createdAt_idx" ON "notification_templates"("createdAt");
CREATE INDEX "broadcast_logs_sentBy_idx" ON "broadcast_logs"("sentBy");
CREATE INDEX "broadcast_logs_templateKey_idx" ON "broadcast_logs"("templateKey");
CREATE INDEX "broadcast_logs_createdAt_idx" ON "broadcast_logs"("createdAt");

COMMIT;
