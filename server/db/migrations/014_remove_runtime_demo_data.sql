-- Remove bundled runtime demo identities and commerce fixtures from existing
-- test/sandbox databases. Automated tests recreate fixtures in isolated DBs.

DELETE FROM booking_sessions
WHERE offer_id IN ('HTL-SHA-001', 'HTL-SHA-002', 'HTL-SHA-003', 'FLT-001', 'FLT-002', 'FLT-003');

DELETE FROM orders
WHERE product_snapshot_json = '{"seeded":true}';

DELETE FROM hotel_offers
WHERE id IN ('HTL-SHA-001', 'HTL-SHA-002', 'HTL-SHA-003');

DELETE FROM flight_offers
WHERE id IN ('FLT-001', 'FLT-002', 'FLT-003');

UPDATE orders SET user_id = NULL WHERE user_id = 'user-demo';
DELETE FROM user_profiles WHERE id = 'user-demo';

DELETE FROM customers WHERE id IN ('CUS-001', 'CUS-002', 'CUS-003');
DELETE FROM pricing_rules WHERE id IN ('PR-001', 'PR-002');

UPDATE tenants SET name = 'FusionGo' WHERE id = 'tenant-demo' AND name = 'Universal Travel';
