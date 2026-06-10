-- Composite indexes matching common filter+sort patterns on high-growth tables.
-- Each targets a query where the filter column differs from the sort column, so
-- without a composite the planner filters via a single-column index (or seq
-- scan) and then performs a separate sort that degrades as the table grows.

-- Seller's product list: WHERE sellerId ORDER BY createdAt DESC.
CREATE INDEX "products_sellerId_createdAt_idx" ON "products"("sellerId", "createdAt" DESC);

-- Order history: WHERE userId ORDER BY createdAt DESC (paginated).
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt" DESC);

-- Seller's animal listings: WHERE sellerId (+ status inequality) ORDER BY createdAt DESC.
CREATE INDEX "animal_listings_sellerId_createdAt_idx" ON "animal_listings"("sellerId", "createdAt" DESC);

-- My-bookings (no status filter): WHERE userId ORDER BY createdAt DESC.
CREATE INDEX "bookings_userId_createdAt_idx" ON "bookings"("userId", "createdAt" DESC);

-- Login-risk lookback (runs on every login, high-volume table):
-- WHERE userId AND action AND createdAt >= since ORDER BY createdAt DESC.
CREATE INDEX "audit_logs_userId_action_createdAt_idx" ON "audit_logs"("userId", "action", "createdAt" DESC);
