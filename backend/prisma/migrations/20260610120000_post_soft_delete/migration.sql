-- Soft-delete support for community posts (REV-12).
-- Non-null deletedAt marks a post as removed; all reads filter deletedAt IS NULL.
ALTER TABLE "posts" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Partial-friendly index for the deletedAt IS NULL filter applied to every list/detail read.
CREATE INDEX "posts_deletedAt_idx" ON "posts"("deletedAt");
