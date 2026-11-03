import { APICallError, generateText, NoObjectGeneratedError, Output, RetryError } from 'ai';
import type { ZodType } from 'zod';

import type { AppCtx } from '../../app';
import { AppError, stamp } from '../../services/context';

import { costMicros, languageModel } from './providers';
import { redact } from './redact';
import { aiCalls } from './schema';
import {
  allowedAreas,
  type Area,
  isLocal,
  type ModelConfig,
  modelFor as pickModel,
  problemOf,
  readSettings,
  type Use,
} from './settings';

const TIMEOUT_MS = { local: 120_000, cloud: 60_000 };

export interface AiRequest<T> {
  feature: string;
  /** O uso, para achar o modelo dele; sem uso, o padrão. */
  use?: Use;
  /** Um modelo escolhido na hora, por id. */
  modelId?: string | null;
  system: string;
  prompt: string;
  /** Áreas cujos dados vão no pedido, para o registro. */
  areas: Area[];
  /** Com schema, devolve o objeto validado; sem, o texto. */
  schema?: ZodType<T>;
  maxOutputTokens?: number;
}

/** O modelo que um uso vai chamar, já conferido (chave e aviso), ou o erro para a pessoa. */
export function resolveModel(ctx: AppCtx, use?: Use | null, modelId?: string | null): ModelConfig {
  const settings = readSettings(ctx);
  if (modelId && !settings.models.some((m) => m.id === modelId)) {
    throw new AppError(404, 'Esse modelo não está mais nos Ajustes.');
  }
  const config = pickModel(settings, use, modelId);
  const problem = problemOf(ctx, settings, config);
  if (problem) throw new AppError(409, problem);
  return config!;
}

export function isReadyFor(ctx: AppCtx, use?: Use | null) {
  const settings = readSettings(ctx);
  return problemOf(ctx, settings, pickModel(settings, use)) === null;
}

/** Uma chamada ao modelo do uso, com limpeza do texto e registro local. */
export async function ask<T = string>(ctx: AppCtx, request: AiRequest<T>): Promise<T> {
  const config = resolveModel(ctx, request.use, request.modelId);
  const settings = readSettings(ctx);
  // Lido a cada chamada: desligar uma área no meio de uma rodada para os envios seguintes.
  const allowed = allowedAreas(settings, config);
  const blocked = request.areas.find((area) => !allowed.includes(area));
  if (blocked) throw new AppError(409, 'Essa área está desligada para a IA em Ajustes › IA.');
  const model = languageModel(ctx, config);
  const provider = config.provider;
  const prompt = redact(request.prompt);
  const started = Date.now();
  const log = (row: Partial<typeof aiCalls.$inferInsert>) =>
    ctx.db
      .insert(aiCalls)
      .values({
        ...stamp(),
        feature: request.feature,
        provider,
        model: config.model,
        areas: request.areas.join(','),
        durationMs: Date.now() - started,
        ok: false,
        ...row,
      })
      .run();

  try {
    const result = await generateText({
      model,
      system: request.system,
      prompt,
      maxOutputTokens: request.maxOutputTokens ?? 1200,
      abortSignal: AbortSignal.timeout(isLocal(config) ? TIMEOUT_MS.local : TIMEOUT_MS.cloud),
      ...(request.schema ? { output: Output.object({ schema: request.schema }) } : {}),
    });
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    const value = (request.schema ? result.output : result.text.trim()) as T;
    log({
      ok: true,
      inputTokens,
      outputTokens,
      costMicros: costMicros(provider, config.model, inputTokens, outputTokens),
      content: settings.debug
        ? JSON.stringify({ system: request.system, prompt, answer: value })
        : null,
    });
    return value;
  } catch (error) {
    const message = scrub(error instanceof Error ? error.message : String(error));
    log({ error: message, content: settings.debug ? JSON.stringify({ prompt }) : null });
    if (error instanceof AppError) throw error;
    console.error(`[ai] ${request.feature}`, message);
    throw new AppError(502, explain(error, provider));
  }
}

/** Alguns provedores repetem parte da chave na mensagem de erro. */
export const scrub = (message: string) =>
  message.replace(/\b(sk|sk-ant|sk-or)-[\w*.-]+/g, '[chave]').slice(0, 300);

/** O motivo, em palavras para a pessoa, pelo código que o provedor devolveu. */
function explain(error: unknown, provider: string) {
  // Depois das novas tentativas, o SDK embrulha o último erro.
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (NoObjectGeneratedError.isInstance(last)) {
    return 'O modelo respondeu, mas fora do formato pedido. Tente outro modelo.';
  }
  if (APICallError.isInstance(last)) {
    const status = last.statusCode;
    if (status === 401 || status === 403) return 'O provedor recusou a chave. Confira se ela está certa e ativa.';
    if (status === 402) return 'A conta no provedor está sem crédito.';
    if (status === 404) return 'O provedor não tem um modelo com esse nome. Confira o nome em Ajustes › IA.';
    if (status === 429) {
      return 'O provedor está limitando os pedidos, o que é comum nos modelos grátis. Tente daqui a pouco.';
    }
  }
  return unavailable(provider);
}

function unavailable(provider: string) {
  if (provider === 'ollama') {
    return 'O Ollama não respondeu. Confira se ele está aberto e se o modelo foi baixado.';
  }
  return 'O provedor de IA não respondeu. Confira a chave e tente de novo.';
}
