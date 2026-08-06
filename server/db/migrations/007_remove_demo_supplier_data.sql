-- Supplier commerce data must come from G-Link / F-Link in every non-test runtime.
-- Remove only records that were inserted by the bundled demo seed.
DELETE FROM orders
WHERE product_snapshot_json = '{"seeded":true}';

DELETE FROM hotel_offers
WHERE id IN ('HTL-SHA-001', 'HTL-SHA-002', 'HTL-SHA-003');

DELETE FROM flight_offers
WHERE id IN ('FLT-001', 'FLT-002', 'FLT-003');
