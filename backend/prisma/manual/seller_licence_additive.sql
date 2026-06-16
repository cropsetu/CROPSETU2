-- Krushi Seva Kendra licence — additive schema, safe to apply MANUALLY in prod.
--
-- WHY MANUAL: the Railway deploy runs `prisma db push`, which makes the DB match
-- schema.prisma EXACTLY and therefore tries to DROP the FastAPI-owned tables it
-- doesn't know about (ai_scan_diagnoses, mandi_prices, …). Once those hold data,
-- db push aborts ("data loss") and NONE of the schema applies — so these new
-- seller_profiles.licence* columns would silently never land. This script applies
-- only the additive licence change. NEVER add --accept-data-loss to the deploy.
--
-- APPLY (any one):
--   cd backend && DATABASE_URL=<prod> npx prisma db execute --file prisma/manual/seller_licence_additive.sql --schema prisma/schema.prisma
--   psql "$DATABASE_URL" -f backend/prisma/manual/seller_licence_additive.sql
--   Railway -> Postgres service -> Data/Query tab -> paste + run
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "licenceNumber" TEXT;
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "licenceType" TEXT;
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "licenceIssuingState" TEXT;
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "licenceExpiry" TIMESTAMP(3);
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "licenceDocUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "seller_profiles" ADD COLUMN IF NOT EXISTS "licenceVerifiedAt" TIMESTAMP(3);

COMMIT;
