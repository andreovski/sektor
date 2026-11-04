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
  /** Áreas cujos dados a resposta usou: um modelo na nuvem não recebe a que não pode ler. */
  areas: text('areas').notNull().default(''),
  model: text('model'),
  /** Miniaturas (data URL) das fotos da pergunta. A foto inteira vai ao modelo e não fica. */
  images: text('images', { mode: 'json' }).$type<string[]>().notNull().default([]),
  /** A pergunta foi digitada ou falada. */
  source: text('source', { enum: ['text', 'voice'] }).notNull().default('text'),
});

export interface ProposalCard {
  /** "Tarefa", "Lançamento · Despesa", "Apagar evento". */
  kind: string;
  title: string;
  /** Valor em destaque (dinheiro em centavos), quando há. */
  amountCents?: number | null;
  amountTone?: 'income' | 'expense' | null;
  rows: { label: string; value: string; before?: string | null }[];
}

/** O que o assistente propõe fazer: só vira escrita quando a pessoa confirma (ou o Jev, seguro). */
export const aiProposals = sqliteTable('ai_proposals', {
  ...base,
  conversationId: text('conversation_id').notNull(),
  messageId: text('message_id'),
  kind: text('kind').notNull(),
  area: text('area').notNull(),
  /** O modelo que propôs: as áreas que ele pode ler valem também para gravar. */
  modelId: text('model_id'),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  before: text('before', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  card: text('card', { mode: 'json' }).$type<ProposalCard>().notNull(),
  status: text('status', { enum: ['PENDING', 'APPLYING', 'APPLIED', 'DISCARDED', 'UNDONE', 'FAILED'] }).notNull(),
  result: text('result', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  auto: integer('auto', { mode: 'boolean' }).notNull().default(false),
  error: text('error'),
});
