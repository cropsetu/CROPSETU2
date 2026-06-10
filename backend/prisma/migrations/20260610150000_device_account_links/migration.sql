-- Device fingerprinting & multi-account detection (FRAUD-3): persist (device,
-- account) links observed at login/order so one device backing many distinct
-- accounts can surface for review. `fingerprint` is a hashed strong device id
-- (X-Device-Id), not the coarse User-Agent fingerprint used for velocity.
CREATE TABLE "device_account_links" (
    "id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "lastIp" TEXT,
    "lastContext" TEXT,

    CONSTRAINT "device_account_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "device_account_links_fingerprint_userId_key" ON "device_account_links"("fingerprint", "userId");

CREATE INDEX "device_account_links_fingerprint_lastSeenAt_idx" ON "device_account_links"("fingerprint", "lastSeenAt");

CREATE INDEX "device_account_links_userId_idx" ON "device_account_links"("userId");

ALTER TABLE "device_account_links" ADD CONSTRAINT "device_account_links_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
