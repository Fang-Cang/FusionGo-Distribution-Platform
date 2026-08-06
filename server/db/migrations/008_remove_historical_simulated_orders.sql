DELETE FROM ledger_entries
WHERE order_id IN (
  SELECT id
  FROM orders
  WHERE supplier = 'GLINK'
    AND supplier_order_no LIKE 'FCG-H-%'
    AND subtitle LIKE '%模拟房态%'
);

DELETE FROM orders
WHERE supplier = 'GLINK'
  AND supplier_order_no LIKE 'FCG-H-%'
  AND subtitle LIKE '%模拟房态%';
