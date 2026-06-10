-- Add the SELLER_ONBOARDING consent purpose (DPDP §5).
-- A FARMER is promoted to SELLER only after an explicit, recorded opt-in for
-- this purpose; setting a businessType alone no longer escalates the role.
ALTER TYPE "ConsentPurpose" ADD VALUE IF NOT EXISTS 'SELLER_ONBOARDING';
