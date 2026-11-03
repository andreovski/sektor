import { generateText, Output } from 'ai';
import type { ZodType } from 'zod';

import type { AppCtx } from '../../app';
import { AppError, stamp } from '../../services/context';

import { costMicros, modelFor } from './providers';
import { redact } from './redact';
import { aiCalls } from './schema';
import { type AiSettings, type Area, isLocal, readSettings } from './settings';

const TIMEOUT_MS = { local: 120_000, cloud: 60_000 };

export interface AiRequest<T> {
  feature: string;
  system: string;
  prompt: string;
  /** Áreas cujos dados vão no pedido, para o registro. */
  areas: Area[];
  /** Com schema, devolve o objeto validado; sem, o texto. */
  schema?: ZodType<T>;
  maxOutputTokens?: number;
}

/** Pronto para chamar: modelo escolhido e, na nuvem, o aviso aceito. */
export function assertReady(settings: AiSettings) {
  if (!settings.provider || !settings.model) {
    throw new AppError(409, 'Escolha um modelo de IA em Ajustes › IA.');
  }
  if (!isLocal(settings.provider) && !settings.noticeAccepted.includes(settings.provider)) {
    throw new AppError(409, 'Confirme o aviso de privacidade da IA em Ajustes › IA.');
  }
}

export function isReady(settings: AiSettings) {
  try {
    assertReady(settings);
    return true;
  } catch {
    return false;
  }
}

/** Uma chamada ao modelo escolhido, com limpeza do texto e registro local. */
export async function ask<T = string>(ctx: AppCtx, request: AiRequest<T>): Promise<T> {
  const settings = readSettings(ctx);
  assertReady(settings);
  const model = modelFor(ctx, settings);
  const provider = settings.provider!;
  const prompt = redact(request.prompt);
  const started = Date.now();
  const log = (row: Partial<typeof aiCalls.$inferInsert>) =>
    ctx.db
      .insert(aiCalls)
      .values({
        ...stamp(),
        feature: request.feature,
        provider,
        model: settings.model,
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
      abortSignal: AbortSignal.timeout(isLocal(provider) ? TIMEOUT_MS.local : TIMEOUT_MS.cloud),
      ...(request.schema ? { output: Output.object({ schema: request.schema }) } : {}),
    });
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    const value = (request.schema ? result.output : result.text.trim()) as T;
    log({
      ok: true,
      inputTokens,
      outputTokens,
      costMicros: costMicros(provider, settings.model, inputTokens, outputTokens),
      content: settings.debug
        ? JSON.stringify({ system: request.system, prompt, answer: value })
        : null,
    });
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : String(error);
    log({ error: message, content: settings.debug ? JSON.stringify({ prompt }) : null });
    if (error instanceof AppError) throw error;
    console.error(`[ai] ${request.feature}`, message);
    throw new AppError(502, unavailable(provider));
  }
}

function unavailable(provider: string) {
  if (provider === 'ollama') {
    return 'O Ollama não respondeu. Confira se ele está aberto e se o modelo foi baixado.';
  }
  return 'O provedor de IA não respondeu. Confira a chave e tente de novo.';
}
