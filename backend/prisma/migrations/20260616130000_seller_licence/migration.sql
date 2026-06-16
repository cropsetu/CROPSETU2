-- Krushi Seva Kendra licence on the seller profile. Purely additive (no drops):
-- a Kendra onboards on the dedicated website with its agri-input dealer licence,
-- and an admin verifies the licence + documents before approval. Number / type /
-- state / expiry are business-registration data (plaintext); the licence document
-- scans are stored PRIVATELY in Cloudinary (public_ids only) like KYC docs.
-- See prisma/manual/seller_licence_additive.sql for the prod-apply (db push) variant.

-- AlterTable
ALTER TABLE "seller_profiles" ADD COLUMN "licenceNumber" TEXT;
ALTER TABLE "seller_profiles" ADD COLUMN "licenceType" TEXT;
ALTER TABLE "seller_profiles" ADD COLUMN "licenceIssuingState" TEXT;
ALTER TABLE "seller_profiles" ADD COLUMN "licenceExpiry" TIMESTAMP(3);
ALTER TABLE "seller_profiles" ADD COLUMN "licenceDocUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "seller_profiles" ADD COLUMN "licenceVerifiedAt" TIMESTAMP(3);
