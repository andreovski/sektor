-- Assistente (fase 3c): o que ele propõe fazer, com o antes e o depois, até a pessoa confirmar.
CREATE TABLE ai_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
  message_id TEXT,
  kind TEXT NOT NULL,
  area TEXT NOT NULL,
  payload TEXT NOT NULL,
  before TEXT,
  card TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPLIED', 'DISCARDED', 'UNDONE', 'FAILED')),
  result TEXT,
  auto INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX ai_proposals_conversation ON ai_proposals (conversation_id);
CREATE INDEX ai_proposals_message ON ai_proposals (message_id);
