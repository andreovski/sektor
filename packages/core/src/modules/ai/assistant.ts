import { generateText, isStepCount, type ModelMessage } from 'ai';
import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { AppError, notFound, stamp, todayIn } from '../../services/context';

import { costMicros, languageModel } from './providers';
import { redact } from './redact';
import { explain, resolveModel, scrub } from './run';
import { aiCalls, aiConversations, aiMessages } from './schema';
import { allowedAreas, type Area, isLocal, readSettings } from './settings';
import { buildTools, TOOL_LABELS } from './tools';

// O assistente da 3b: responde perguntas pelas consultas de cada módulo, só leitura. Nada aqui
// escreve fora das próprias conversas.

/** Mensagens anteriores que vão junto com a pergunta ("e no mês passado?"). */
const HISTORY = 12;
/** Passos do laço de consultas antes de o modelo ter de responder. */
const MAX_STEPS = 8;
export const RETENTION_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

const SYSTEM = (today: string, areas: Area[]) => `Você é o assistente do Sektor, um app pessoal de organização (finanças, tarefas, agenda, hábitos, foco, saúde, projetos). Responda perguntas sobre os dados da pessoa.

Hoje é ${today}. Datas relativas ("ontem", "mês passado", "essa semana") contam a partir de hoje; a semana começa na segunda.

Regras:
- Responda em português do Brasil, curto e direto, em segunda pessoa ("você").
- Use as consultas para buscar os números; nunca invente dado. Se a consulta não trouxer, diga que não encontrou.
- Dinheiro: escreva exatamente [[centavos]] com o número inteiro de centavos que a consulta devolveu (ex.: [[12345]]), sem converter para reais. Some você mesmo quando precisar de um total.
- Você só lê. Se pedirem para criar, mudar ou apagar algo, diga que isso ainda não é possível por aqui e que a pessoa pode fazer na tela do módulo.
- Áreas que você pode consultar agora: ${areas.length ? areas.join(', ') : 'nenhuma'}. Se perguntarem de outra, diga que ela está desligada para a IA em Ajustes › IA.
- Sem markdown pesado: no máximo uma lista curta quando ajudar.`;

export function listConversations(ctx: AppCtx) {
  return ctx.db
    .select({ id: aiConversations.id, title: aiConversations.title, updatedAt: aiConversations.updatedAt })
    .from(aiConversations)
    .where(isNull(aiConversations.deletedAt))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(100)
    .all();
}

function ownConversation(ctx: AppCtx, id: string) {
  const row = ctx.db
    .select()
    .from(aiConversations)
    .where(and(eq(aiConversations.id, id), isNull(aiConversations.deletedAt)))
    .get();
  if (!row) throw notFound('Conversa não encontrada.');
  return row;
}

const messagesOf = (ctx: AppCtx, conversationId: string) =>
  ctx.db
    .select()
    .from(aiMessages)
    .where(and(eq(aiMessages.conversationId, conversationId), isNull(aiMessages.deletedAt)))
    .orderBy(asc(aiMessages.createdAt))
    .all();

export function getConversation(ctx: AppCtx, id: string) {
  const conversation = ownConversation(ctx, id);
  return {
    ...conversation,
    messages: messagesOf(ctx, id).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text,
      createdAt: m.createdAt,
      model: m.model,
      tools: m.tools.map((name) => TOOL_LABELS[name] ?? name),
    })),
  };
}

export function deleteConversation(ctx: AppCtx, id: string) {
  ownConversation(ctx, id);
  // Apagar conversa é apagar de verdade: é conteúdo pessoal, não dado do app.
  ctx.db.delete(aiMessages).where(eq(aiMessages.conversationId, id)).run();
  ctx.db.delete(aiConversations).where(eq(aiConversations.id, id)).run();
}

/** Conversa parada há 30 dias some, mensagens junto. */
export function purgeOld(ctx: AppCtx, now = Date.now()) {
  const old = ctx.db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(lt(aiConversations.updatedAt, now - RETENTION_DAYS * DAY))
    .all();
  for (const { id } of old) {
    ctx.db.delete(aiMessages).where(eq(aiMessages.conversationId, id)).run();
    ctx.db.delete(aiConversations).where(eq(aiConversations.id, id)).run();
  }
  return old.length;
}

const titleOf = (text: string) => {
  const line = text.trim().replace(/\s+/g, ' ');
  return line.length > 60 ? `${line.slice(0, 57)}…` : line;
};

export async function send(
  ctx: AppCtx,
  input: { conversationId?: string | null; text: string; modelId?: string | null }
) {
  const text = input.text.trim();
  if (!text) throw new AppError(400, 'Escreva a pergunta.');
  if (text.length > 2000) throw new AppError(400, 'Pergunta longa demais.');
  const config = resolveModel(ctx, 'assistant', input.modelId);
  const settings = readSettings(ctx);

  const conversation = input.conversationId
    ? ownConversation(ctx, input.conversationId)
    : ctx.db.insert(aiConversations).values({ ...stamp(), title: titleOf(text) }).returning().get();
  const history = messagesOf(ctx, conversation.id).slice(-HISTORY);
  const now = Date.now();
  ctx.db
    .insert(aiMessages)
    .values({ ...stamp(), conversationId: conversation.id, role: 'user', text, tools: [] })
    .run();
  ctx.db.update(aiConversations).set({ updatedAt: now }).where(eq(aiConversations.id, conversation.id)).run();

  const used: string[] = [];
  const areasUsed = new Set<Area>();
  const tools = buildTools({
    app: ctx,
    allowed: () => allowedAreas(readSettings(ctx), config),
    used: (name, area) => {
      used.push(name);
      if (area) areasUsed.add(area);
    },
  });
  const messages: ModelMessage[] = [
    ...history.map((m) => ({ role: m.role, content: redact(m.text) }) as ModelMessage),
    { role: 'user', content: redact(text) },
  ];
  const started = Date.now();
  const log = (row: Partial<typeof aiCalls.$inferInsert>) =>
    ctx.db
      .insert(aiCalls)
      .values({
        ...stamp(),
        feature: 'assistant',
        provider: config.provider,
        model: config.model,
        areas: [...areasUsed].join(','),
        durationMs: Date.now() - started,
        ok: false,
        ...row,
      })
      .run();

  let answer: string;
  try {
    const result = await generateText({
      model: languageModel(ctx, config),
      system: SYSTEM(todayIn(ctx), allowedAreas(settings, config)),
      messages,
      tools,
      stopWhen: isStepCount(MAX_STEPS),
      maxOutputTokens: 6000,
      abortSignal: AbortSignal.timeout(isLocal(config) ? 180_000 : 90_000),
    });
    answer = result.text.trim();
    const inputTokens = result.totalUsage.inputTokens ?? 0;
    const outputTokens = result.totalUsage.outputTokens ?? 0;
    log({
      ok: Boolean(answer),
      inputTokens,
      outputTokens,
      costMicros: costMicros(config.provider, config.model, inputTokens, outputTokens),
      error: answer ? null : 'Resposta vazia.',
      content: settings.debug ? JSON.stringify({ messages, tools: used, answer }) : null,
    });
    if (!answer) {
      answer = used.length
        ? 'Consultei os dados, mas não consegui montar a resposta. Tente perguntar de outro jeito.'
        : 'Não consegui responder. Tente de novo ou use outro modelo.';
    }
  } catch (error) {
    const message = scrub(error instanceof Error ? error.message : String(error));
    log({ error: message });
    if (error instanceof AppError) throw error;
    console.error('[ai] assistant', message);
    throw new AppError(502, explain(error, config.provider));
  }

  ctx.db
    .insert(aiMessages)
    .values({
      ...stamp(),
      conversationId: conversation.id,
      role: 'assistant',
      text: answer,
      tools: [...new Set(used)],
      model: config.model,
    })
    .run();
  ctx.db
    .update(aiConversations)
    .set({ updatedAt: Date.now() })
    .where(eq(aiConversations.id, conversation.id))
    .run();
  return getConversation(ctx, conversation.id);
}
