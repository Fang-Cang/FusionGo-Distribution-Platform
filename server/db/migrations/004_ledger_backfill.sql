INSERT OR IGNORE INTO ledger_entries(
  id, tenant_id, order_id, entry_type, amount, currency, status, reference, created_at
)
SELECT
  'LEDGER-' || payments.id,
  orders.tenant_id,
  payments.order_id,
  'PAYMENT',
  -ABS(payments.amount),
  payments.currency,
  CASE WHEN payments.status = 'CAPTURED' THEN 'POSTED' ELSE payments.status END,
  'PAYMENT:' || payments.order_id,
  payments.created_at
FROM payments
JOIN orders ON orders.id = payments.order_id;
