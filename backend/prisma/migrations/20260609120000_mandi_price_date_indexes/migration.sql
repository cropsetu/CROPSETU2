-- Date-window indexes for mandi_prices (DS-3).
-- All read paths prefilter by `priceDate >= since` and sort newest-first, while
-- commodity/state/district use ILIKE `contains` (not btree-usable). Without an
-- index leading with priceDate, those queries fall back to a full table scan
-- that degrades as the table grows.

-- Serves the dominant commodity+state date-window queries (queryDB,
-- getPriceTrend, MSP single-fetch): index range-scan over the window + ORDER BY
-- priceDate DESC.
CREATE INDEX "mandi_prices_priceDate_idx" ON "mandi_prices"("priceDate" DESC);

-- Serves /nearby: `market IN (...)` (equality) within a date window, ordered by
-- (market, priceDate).
CREATE INDEX "mandi_prices_market_priceDate_idx" ON "mandi_prices"("market", "priceDate" DESC);
