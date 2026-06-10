-- Content moderation queue for fake-review / fake-listing signals (FRAUD-5).
-- Suspicious reviews/listings are routed here for human review (REV-5) instead
-- of being auto-removed.

-- CreateEnum
CREATE TYPE "ModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "content_flags" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "authorId" TEXT,
    "reasons" TEXT[],
    "score" INTEGER NOT NULL DEFAULT 0,
    "status" "ModerationStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_flags_entityType_entityId_key" ON "content_flags"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "content_flags_status_createdAt_idx" ON "content_flags"("status", "createdAt");
