import { desc, gte } from 'drizzle-orm';
import { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { AppError, newId } from '../../services/context';
import { parse } from '../finance';

import { pendingForAi, suggestCategories } from './bank-category';
import { generateInsight, getInsight, INSIGHTS, type InsightKind } from './insights';
import { hasJev, jevUsable } from './jev';
import { OLLAMA_URL, SUGGESTED_MODELS } from './providers';
import { ask } from './run';
import { aiCalls } from './schema';
import {
  type AiSettings,
  allowedAreas,
  AREAS,
  isLocal,
  type ModelConfig,
  modelFor,
  problemOf,
  USES,
  type Use,
  needsKey,
  normalizeOllamaUrl,
  PROVIDERS,
  type Provider,
  readKey,
  readSettings,
  writeKey,
  writeSettings,
} from './settings';

const baseUrlSchema = z
  .string()
  .trim()
  .max(300, 'Endereço longo demais.')
  .refine((v) => v === '' || /^https?:\/\//.test(v), 'Use um endereço http:// ou https://.')
  .nullable()
  .optional();

const modelSchema = z.object({
  provider: z.enum(PROVIDERS, { message: 'Provedor inválido.' }),
  model: z.string().trim().min(1, 'Diga o nome do modelo.').max(200, 'Nome de modelo longo demais.'),
  baseUrl: baseUrlSchema,
});
type ModelInput = z.infer<typeof modelSchema>;

const updateSchema = z.object({
  areas: z.record(z.enum(AREAS), z.boolean()).optional(),
  uses: z.record(z.enum(USES), z.string().nullable()).optional(),
  bankCategory: z.enum(['ask', 'on', 'off']).optional(),
  debug: z.boolean().optional(),
  devMode: z.boolean().optional(),
});
type UpdateInput = z.infer<typeof updateSchema>;

const keySchema = z.object({
  provider: z.enum([...PROVIDERS, 'jev'] as const),
  key: z.string().trim().max(500, 'Chave longa demais.').nullable(),
});
type KeyInput = z.infer<typeof keySchema>;

const insightSchema = z.object({
  kind: z.enum(INSIGHTS, { message: 'Insight inválido.' }),
  period: z.string().optional(),
  modelId: z.string().nullable().optional(),
});
type InsightInput = { kind: InsightKind; period?: string; modelId?: string | null };

const DAY = 24 * 60 * 60 * 1000;

export function status(ctx: AppCtx) {
  const settings = readSettings(ctx);
  const keys = Object.fromEntries(
    PROVIDERS.filter(needsKey).map((p) => [p, Boolean(readKey(ctx, p))])
  ) as Record<Exclude<Provider, 'ollama'>, boolean>;
  const models = settings.models.map((config) => ({
    ...config,
    local: isLocal(config),
    problem: problemOf(ctx, settings, config),
  }));
  const forUse = (use: Use) => modelFor(settings, use);
  return {
    ...settings,
    models,
    /** O modelo padrão está pronto para uso. */
    ready: problemOf(ctx, settings, modelFor(settings)) === null,
    /** O modelo que cada uso vai chamar agora, já com o padrão resolvido. */
    resolved: Object.fromEntries(
      USES.map((use) => {
        const config = forUse(use);
        return [
          use,
          {
            modelId: config?.id ?? null,
            local: isLocal(config),
            ready: problemOf(ctx, settings, config) === null,
            areas: allowedAreas(settings, config),
          },
        ];
      })
    ) as Record<Use, { modelId: string | null; local: boolean; ready: boolean; areas: string[] }>,
    keys,
    jev: hasJev(ctx),
    /** O Jev só entra com o aviso aceito e Finanças liberada. */
    jevReady: jevUsable(ctx),
    suggestedModels: SUGGESTED_MODELS,
    ollamaUrl: OLLAMA_URL,
    bankPending: pendingForAi(ctx),
  };
}

/** O registro dos últimos 30 dias e o total do mês por provedor. */
function calls(ctx: AppCtx, limit = 50) {
  const settings = readSettings(ctx);
  const since = Date.now() - 30 * DAY;
  const rows = ctx.db
    .select()
    .from(aiCalls)
    .where(gte(aiCalls.createdAt, since))
    .orderBy(desc(aiCalls.createdAt))
    .all();
  const month = new Date();
  month.setDate(1);
  month.setHours(0, 0, 0, 0);
  const totals = new Map<string, { calls: number; inputTokens: number; outputTokens: number; costMicros: number | null }>();
  for (const row of rows) {
    if (row.createdAt < month.getTime()) continue;
    const total = totals.get(row.provider) ?? { calls: 0, inputTokens: 0, outputTokens: 0, costMicros: 0 };
    total.calls++;
    total.inputTokens += row.inputTokens ?? 0;
    total.outputTokens += row.outputTokens ?? 0;
    total.costMicros =
      total.costMicros === null || (row.ok && row.costMicros === null)
        ? null
        : total.costMicros + (row.costMicros ?? 0);
    totals.set(row.provider, total);
  }
  return {
    month: settings.devMode
      ? [...totals.entries()].map(([provider, total]) => ({ provider, ...total }))
      : [],
    rows: rows.slice(0, Math.min(limit, 200)).map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      feature: row.feature,
      provider: row.provider,
      model: row.model,
      areas: row.areas ? row.areas.split(',') : [],
      ok: row.ok,
      error: row.error,
      durationMs: row.durationMs,
      // Tokens e custo só no modo dev; o conteúdo só com a depuração ligada.
      inputTokens: settings.devMode ? row.inputTokens : null,
      outputTokens: settings.devMode ? row.outputTokens : null,
      costMicros: settings.devMode ? row.costMicros : null,
      content: settings.debug ? row.content : null,
    })),
  };
}

/** Responde em português e devolve JSON válido: o mínimo que as próximas etapas pedem. */
async function testModel(ctx: AppCtx, modelId?: string) {
  const started = Date.now();
  const text = await ask(ctx, {
    feature: 'test.text',
    modelId,
    system: 'Responda em português do Brasil, numa frase curta.',
    prompt: 'Diga olá e o seu nome de modelo.',
    areas: [],
    maxOutputTokens: 100,
  });
  let json = false;
  try {
    const value = await ask(ctx, {
      feature: 'test.json',
      modelId,
      system: 'Responda só com o objeto pedido.',
      prompt: 'Devolva soma = 2 + 3 e capital = a capital do Brasil.',
      areas: [],
      schema: z.object({ soma: z.number(), capital: z.string() }),
      maxOutputTokens: 100,
    });
    json = value.soma === 5 && /bras[ií]lia/i.test(value.capital);
  } catch {
    json = false;
  }
  return { text, json, ms: Date.now() - started };
}

/** Os modelos já baixados no Ollama. */
async function ollamaModels(baseUrl?: string | null): Promise<string[]> {
  const base = (normalizeOllamaUrl(baseUrl || null) || OLLAMA_URL).replace(/\/v1\/?$/, '');
  if (!/^https?:\/\//.test(base)) return [];
  try {
    const response = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  } catch {
    return [];
  }
}

export const handlers = (ctx: AppCtx) => ({
  'ai.status': () => status(ctx),
  'ai.update': (input: UpdateInput) => {
    const body = parse<UpdateInput>(updateSchema as never, input);
    const settings = readSettings(ctx);
    for (const id of Object.values(body.uses ?? {})) {
      if (id && !settings.models.some((m) => m.id === id)) throw new AppError(404, 'Modelo não encontrado.');
    }
    writeSettings(ctx, {
      ...settings,
      ...body,
      areas: { ...settings.areas, ...body.areas },
      uses: { ...settings.uses, ...body.uses },
    });
    return status(ctx);
  },
  'ai.models.add': (input: ModelInput) => {
    const body = parse<ModelInput>(modelSchema as never, input);
    const settings = readSettings(ctx);
    const config: ModelConfig = {
      id: newId(),
      provider: body.provider,
      model: body.model,
      baseUrl: body.provider === 'ollama' ? normalizeOllamaUrl(body.baseUrl || null) : null,
    };
    const same = settings.models.find(
      (m) => m.provider === config.provider && m.model === config.model && m.baseUrl === config.baseUrl
    );
    if (same) throw new AppError(409, 'Esse modelo já está na lista.');
    if (settings.models.length >= 12) throw new AppError(409, 'São até 12 modelos.');
    writeSettings(ctx, {
      ...settings,
      models: [...settings.models, config],
      // O primeiro modelo vira o padrão.
      defaultModelId: settings.defaultModelId ?? config.id,
    });
    return { ...status(ctx), added: config.id };
  },
  'ai.models.remove': ({ id }: { id: string }) => {
    const settings = readSettings(ctx);
    const models = settings.models.filter((m) => m.id !== id);
    const uses = Object.fromEntries(
      Object.entries(settings.uses).filter(([, value]) => value !== id)
    ) as AiSettings['uses'];
    writeSettings(ctx, {
      ...settings,
      models,
      uses,
      defaultModelId: settings.defaultModelId === id ? (models[0]?.id ?? null) : settings.defaultModelId,
    });
    return status(ctx);
  },
  'ai.models.setDefault': ({ id }: { id: string }) => {
    const settings = readSettings(ctx);
    if (!settings.models.some((m) => m.id === id)) throw new AppError(404, 'Modelo não encontrado.');
    writeSettings(ctx, { ...settings, defaultModelId: id });
    return status(ctx);
  },
  'ai.acceptNotice': ({ provider }: { provider: Provider | 'jev' }) => {
    if (provider !== 'jev' && !PROVIDERS.includes(provider)) throw new AppError(400, 'Provedor inválido.');
    const settings = readSettings(ctx);
    if (!settings.noticeAccepted.includes(provider)) {
      writeSettings(ctx, { ...settings, noticeAccepted: [...settings.noticeAccepted, provider] });
    }
    return status(ctx);
  },
  'ai.setKey': (input: KeyInput) => {
    const { provider, key } = parse<KeyInput>(keySchema as never, input);
    writeKey(ctx, provider, key || null);
    return status(ctx);
  },
  'ai.test': (input?: { id?: string }) => testModel(ctx, input?.id),
  'ai.ollamaModels': (input?: { baseUrl?: string | null }) => ollamaModels(input?.baseUrl),
  'ai.calls': (input?: { limit?: number }) => calls(ctx, input?.limit),
  'ai.insight': (input: InsightInput) => {
    const { kind, period } = parse<InsightInput>(insightSchema as never, input);
    return getInsight(ctx, kind, period);
  },
  'ai.insight.generate': (input: InsightInput) => {
    const { kind, period, modelId } = parse<InsightInput>(insightSchema as never, input);
    return generateInsight(ctx, kind, period, modelId);
  },
  'ai.bankCategory.run': async () => ({ suggested: await suggestCategories(ctx) }),
});

export const jobs: Job[] = [
  { name: 'ai.bankCategory', everyMs: 15 * 60_000, run: (ctx) => suggestCategories(ctx) },
];
