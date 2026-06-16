-- Optional contact email for users. Nullable + unique: Postgres permits many
-- NULLs under a UNIQUE index, so farmers who never add an email don't collide.
-- Purely additive (no drops) — safe alongside the FastAPI tables that make
-- `prisma db push` abort on data-loss. See prisma/manual/user_email_additive.sql
-- for the prod-apply (db push) variant.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "email" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
