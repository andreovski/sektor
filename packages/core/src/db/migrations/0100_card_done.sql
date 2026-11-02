-- A fatura cobra todo lançamento do cartão, mas saldo e relatórios só contam os efetivados.
UPDATE transactions
SET status = 'DONE', updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE status = 'PLANNED'
  AND deleted_at IS NULL
  AND account_id IN (SELECT id FROM accounts WHERE type = 'CREDIT_CARD');

-- Conta pagadora já apagada deixava o cartão com um id morto.
UPDATE accounts
SET payment_account_id = NULL, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE payment_account_id IN (SELECT id FROM accounts WHERE deleted_at IS NOT NULL);

-- Categoria já apagada continuava no modelo das recorrências.
UPDATE recurrences
SET template = json_set(template, '$.categoryId', NULL),
    updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE json_extract(template, '$.categoryId') IN
  (SELECT id FROM categories WHERE deleted_at IS NOT NULL);
