-- Add the FRAUD incident category for fraud/abuse detection events (FRAUD-1,
-- FRAUD-2 / COMP-5): refund-chargeback abuse, velocity-limit blocks, and other
-- abuse signals that are not an access/PII/account-takeover incident. It is NOT a
-- breach-notification category (no DPDP §8(6) notify duty by itself).
ALTER TYPE "IncidentCategory" ADD VALUE IF NOT EXISTS 'FRAUD';
