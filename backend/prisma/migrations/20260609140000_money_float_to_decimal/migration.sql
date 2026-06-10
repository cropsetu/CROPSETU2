-- Store monetary amounts as DECIMAL (fixed-point) instead of Float (binary
-- floating point), which cannot represent most decimal fractions exactly and
-- accumulates rounding drift across compute/store/round-trip.
--
-- INR amounts use DECIMAL(12,2) (or (14,2) for aggregates that can grow large);
-- USD AI costs use DECIMAL(14,6) to capture sub-cent token costs. The Float→
-- Decimal cast rounds any pre-existing stored drift to the nearest minor unit.
-- Non-money Floats (ratings, lat/lng, quantities, percentages, soil/weather
-- metrics) are intentionally left as Float.

ALTER TABLE "products"
  ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "mrp"   SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "orders"
  ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "order_items"
  ALTER COLUMN "unitPrice"  SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "totalPrice" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "animal_listings"
  ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "machinery_listings"
  ALTER COLUMN "pricePerDay"  SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "pricePerHour" SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "pricePerAcre" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "labour_listings"
  ALTER COLUMN "pricePerDay"  SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "pricePerHour" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "bookings"
  ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "government_schemes"
  ALTER COLUMN "benefitAmount" SET DATA TYPE DECIMAL(14,2);

ALTER TABLE "msp_rates"
  ALTER COLUMN "mspPrice"        SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "previousYearMSP" SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "bonusIfAny"      SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "mandi_prices"
  ALTER COLUMN "minPrice"   SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "maxPrice"   SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "modalPrice" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "price_alerts"
  ALTER COLUMN "targetPrice" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "ai_usage"
  ALTER COLUMN "totalCostUsd"   SET DATA TYPE DECIMAL(14,6),
  ALTER COLUMN "monthlyCostUsd" SET DATA TYPE DECIMAL(14,6);

ALTER TABLE "ai_credit_transactions"
  ALTER COLUMN "costUsd" SET DATA TYPE DECIMAL(14,6);

ALTER TABLE "farm_crop_cycles"
  ALTER COLUMN "seedCostPerKgInr"    SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "seedTotalCostInr"    SET DATA TYPE DECIMAL(14,2),
  ALTER COLUMN "salePricePerKgInr"   SET DATA TYPE DECIMAL(12,2),
  ALTER COLUMN "saleTotalRevenueInr" SET DATA TYPE DECIMAL(14,2),
  ALTER COLUMN "totalInputCostInr"   SET DATA TYPE DECIMAL(14,2),
  ALTER COLUMN "laborCostInr"        SET DATA TYPE DECIMAL(14,2),
  ALTER COLUMN "machineryCostInr"    SET DATA TYPE DECIMAL(14,2),
  ALTER COLUMN "otherCostInr"        SET DATA TYPE DECIMAL(14,2),
  ALTER COLUMN "grossIncomeInr"      SET DATA TYPE DECIMAL(14,2),
  ALTER COLUMN "netProfitInr"        SET DATA TYPE DECIMAL(14,2),
  ALTER COLUMN "profitPerAcreInr"    SET DATA TYPE DECIMAL(14,2);

ALTER TABLE "farmer_predictions"
  ALTER COLUMN "costInr" SET DATA TYPE DECIMAL(12,4);
