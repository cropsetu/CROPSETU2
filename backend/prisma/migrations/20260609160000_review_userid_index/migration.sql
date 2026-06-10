-- Index Review.userId for buyer review-history lookups (WHERE userId = ?).
-- Dedicated single-column index, narrower than the [userId, productId] unique.
CREATE INDEX "reviews_userId_idx" ON "reviews"("userId");
