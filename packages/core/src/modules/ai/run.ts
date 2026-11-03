import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
  RetryError,
} from 'ai';
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
      // Folga para os modelos que pensam antes: o pensamento conta no limite.
      maxOutputTokens: request.maxOutputTokens ?? 4000,
      abortSignal: AbortSignal.timeout(isLocal(config) ? TIMEOUT_MS.local : TIMEOUT_MS.cloud),
      ...(request.schema ? { output: Output.object({ schema: request.schema }) } : {}),
    });
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    const value = (request.schema ? result.output : result.text.trim()) as T;
    if (value === '') throw new NoOutputGeneratedError({ message: 'Resposta vazia.' });
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
    // Muitos modelos devolvem o JSON certo dentro de ```json ou com texto em volta.
    const noObject = NoObjectGeneratedError.isInstance(error) ? error : null;
    const rescued = request.schema && noObject ? rescueJson(noObject.text, request.schema) : undefined;
    if (rescued !== undefined) {
      const inputTokens = noObject?.usage?.inputTokens ?? 0;
      const outputTokens = noObject?.usage?.outputTokens ?? 0;
      log({
        ok: true,
        inputTokens,
        outputTokens,
        costMicros: costMicros(provider, config.model, inputTokens, outputTokens),
        content: settings.debug ? JSON.stringify({ system: request.system, prompt, answer: rescued }) : null,
      });
      return rescued;
    }
    const message = scrub(error instanceof Error ? error.message : String(error));
    log({
      error: message,
      // Com a depuração ligada, a resposta fora do formato fica no registro para ver o que veio.
      content: settings.debug ? JSON.stringify({ prompt, answer: noObject?.text ?? null }) : null,
    });
    if (error instanceof AppError) throw error;
    console.error(`[ai] ${request.feature}`, message);
    throw new AppError(502, explain(error, provider));
  }
}

/** O primeiro objeto JSON do texto, validado pelo schema; `undefined` se não houver. */
export function rescueJson<T>(text: string | undefined, schema: ZodType<T>): T | undefined {
  if (!text) return undefined;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidates = [fenced, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)];
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      const parsed = schema.safeParse(JSON.parse(candidate));
      if (parsed.success) return parsed.data;
    } catch {
      // tenta o próximo
    }
  }
  return undefined;
}

/** Alguns provedores repetem parte da chave na mensagem de erro. */
export const scrub = (message: string) =>
  message.replace(/\b(sk|sk-ant|sk-or)-[\w*.-]+/g, '[chave]').slice(0, 300);

/** O motivo, em palavras para a pessoa, pelo código que o provedor devolveu. */
export function explain(error: unknown, provider: string) {
  // Depois das novas tentativas, o SDK embrulha o último erro.
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (NoOutputGeneratedError.isInstance(last)) {
    return 'O modelo não respondeu nada: pode ter gastado o limite pensando. Tente de novo ou use outro modelo.';
  }
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
