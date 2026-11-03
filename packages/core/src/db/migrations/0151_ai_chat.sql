-- Assistente (fase 3b): conversas e mensagens. Somem 30 dias depois da última mensagem.
CREATE TABLE ai_conversations (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  title TEXT NOT NULL
);
CREATE INDEX ai_conversations_updated ON ai_conversations (updated_at);

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  conversation_id TEXT NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  tools TEXT NOT NULL DEFAULT '[]',
  areas TEXT NOT NULL DEFAULT '',
  model TEXT
);
CREATE INDEX ai_messages_conversation ON ai_messages (conversation_id, created_at);
