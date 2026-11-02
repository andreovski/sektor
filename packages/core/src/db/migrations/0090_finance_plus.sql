CREATE TABLE plus_debts (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  name TEXT NOT NULL,
  balance_cents INTEGER NOT NULL,
  rate_bp INTEGER NOT NULL,
  min_payment_cents INTEGER NOT NULL,
  due_day INTEGER NOT NULL,
  CONSTRAINT plus_debts_balance CHECK (balance_cents >= 0),
  CONSTRAINT plus_debts_rate CHECK (rate_bp >= 0),
  CONSTRAINT plus_debts_due CHECK (due_day BETWEEN 1 AND 31)
);

CREATE TABLE plus_category_rules (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  pattern TEXT NOT NULL,
  pattern_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  category_id TEXT NOT NULL REFERENCES categories(id),
  CONSTRAINT plus_rules_kind CHECK (kind IN ('INCOME','EXPENSE'))
);
CREATE UNIQUE INDEX plus_rules_pattern ON plus_category_rules (kind, pattern_key)
  WHERE deleted_at IS NULL;

-- Liga cada linha de extrato ao lançamento que ela criou: é o que reconhece a mesma linha depois.
CREATE TABLE plus_import_lines (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  fingerprint TEXT NOT NULL,
  transaction_id TEXT NOT NULL REFERENCES transactions(id)
);
CREATE UNIQUE INDEX plus_import_lines_print ON plus_import_lines (account_id, fingerprint)
  WHERE deleted_at IS NULL;

CREATE TABLE plus_recurring_dismissals (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  key TEXT NOT NULL
);
CREATE UNIQUE INDEX plus_dismissals_key ON plus_recurring_dismissals (key)
  WHERE deleted_at IS NULL;
