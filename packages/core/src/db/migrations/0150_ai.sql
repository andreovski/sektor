-- IA (fase 3a): registro de cada chamada, insights guardados e a categoria sugerida pela IA no banco.
CREATE TABLE ai_calls (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  areas TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_micros INTEGER,
  duration_ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  content TEXT
);
CREATE INDEX ai_calls_created ON ai_calls (created_at);

CREATE TABLE ai_insights (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  feature TEXT NOT NULL,
  period TEXT NOT NULL,
  text TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  fingerprint TEXT NOT NULL
);
CREATE UNIQUE INDEX ai_insights_key ON ai_insights (feature, period) WHERE deleted_at IS NULL;

ALTER TABLE bank_movements ADD COLUMN suggestion_confidence REAL;
ALTER TABLE bank_movements ADD COLUMN ai_checked_at INTEGER;
