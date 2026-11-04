-- Assistente (fase 3d): a miniatura das fotos mandadas e se a pergunta veio falada.
ALTER TABLE ai_messages ADD COLUMN images TEXT NOT NULL DEFAULT '[]';
ALTER TABLE ai_messages ADD COLUMN source TEXT NOT NULL DEFAULT 'text';
