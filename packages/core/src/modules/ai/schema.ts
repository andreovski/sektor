import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

/** Cada chamada a um modelo ou ao Jev. O conteúdo só fica com a depuração ligada. */
export const aiCalls = sqliteTable('ai_calls', {
  ...base,
  feature: text('feature').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  /** Áreas cujos dados foram enviados, separadas por vírgula. */
  areas: text('areas').notNull().default(''),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  /** Custo estimado em milionésimos de dólar; nulo quando o preço do modelo não é conhecido. */
  costMicros: integer('cost_micros'),
  durationMs: integer('duration_ms').notNull(),
  ok: integer('ok', { mode: 'boolean' }).notNull(),
  error: text('error'),
  content: text('content'),
});

/** O último texto gerado de cada insight, por período. `fingerprint` diz de que dados ele saiu. */
export const aiInsights = sqliteTable('ai_insights', {
  ...base,
  feature: text('feature').notNull(),
  period: text('period').notNull(),
  text: text('text').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  fingerprint: text('fingerprint').notNull(),
});

export const aiConversations = sqliteTable('ai_conversations', {
  ...base,
  title: text('title').notNull(),
});

/** `tools` são os nomes das consultas que a resposta fez, para a tela mostrar. */
export const aiMessages = sqliteTable('ai_messages', {
  ...base,
  conversationId: text('conversation_id').notNull(),
  role: text('role', { enum: ['user', 'assistant'] }).notNull(),
  text: text('text').notNull(),
  tools: text('tools', { mode: 'json' }).$type<string[]>().notNull().default([]),
  model: text('model'),
});
