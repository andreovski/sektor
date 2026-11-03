import { eq } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { appMeta } from '../../db/schema';
import type { Ctx } from '../../services/context';

export const PROVIDERS = ['ollama', 'openrouter', 'anthropic', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Áreas que a IA pode ler. `journal` é o texto da Revisão (o que foi bem, o que travou). */
export const AREAS = ['finance', 'tasks', 'agenda', 'projects', 'habits', 'focus', 'health', 'journal'] as const;
export type Area = (typeof AREAS)[number];

/** O que usa IA. Cada um pode ter o seu modelo; sem escolha, vai o padrão. */
export const USES = ['weekly', 'financeChanges', 'bankCategory'] as const;
export type Use = (typeof USES)[number];

/** Para modelo na nuvem, saúde e diário nascem desligados. */
const CLOUD_DEFAULT_OFF: Area[] = ['health', 'journal'];

/** Um modelo configurado. Vários podem conviver: o Ollama local e o Claude, por exemplo. */
export interface ModelConfig {
  id: string;
  provider: Provider;
  model: string;
  /** Só do Ollama: outro endereço que não o padrão. */
  baseUrl: string | null;
}

export interface AiSettings {
  models: ModelConfig[];
  defaultModelId: string | null;
  /** O modelo de cada uso; ausente ou nulo, o padrão. */
  uses: Partial<Record<Use, string | null>>;
  areas: Record<Area, boolean>;
  /** O aviso de privacidade aceito, por provedor (e pelo Jev). */
  noticeAccepted: (Provider | 'jev')[];
  /** Categoria por IA na revisão do banco: `ask` até a pessoa responder na primeira vez. */
  bankCategory: 'ask' | 'on' | 'off';
  /** Guarda o conteúdo enviado e recebido no registro. */
  debug: boolean;
  /** Mostra tokens e custo. */
  devMode: boolean;
}

const KEY = 'ai.settings';

export const DEFAULT_SETTINGS: AiSettings = {
  models: [],
  defaultModelId: null,
  uses: {},
  areas: Object.fromEntries(AREAS.map((a) => [a, !CLOUD_DEFAULT_OFF.includes(a)])) as Record<Area, boolean>,
  noticeAccepted: [],
  bankCategory: 'ask',
  debug: false,
  devMode: false,
};

/** O formato da primeira versão tinha um modelo só, solto nos ajustes. */
interface LegacySettings {
  provider?: Provider | null;
  model?: string;
  baseUrl?: string | null;
}

export function readSettings(ctx: Ctx): AiSettings {
  const row = ctx.db.select().from(appMeta).where(eq(appMeta.key, KEY)).get();
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const saved = JSON.parse(row.value) as Partial<AiSettings> & LegacySettings;
  const { provider, model, baseUrl, ...rest } = saved;
  const settings: AiSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    ...rest,
    areas: { ...DEFAULT_SETTINGS.areas, ...saved.areas },
    uses: { ...saved.uses },
  };
  if (!saved.models && provider && model) {
    // Id fixo: a leitura não grava, e o id precisa ser o mesmo até a próxima escrita.
    const id = 'legado';
    settings.models = [{ id, provider, model, baseUrl: baseUrl ?? null }];
    settings.defaultModelId = id;
  }
  return settings;
}

export function writeSettings(ctx: Ctx, settings: AiSettings) {
  const value = JSON.stringify(settings);
  const updatedAt = Date.now();
  ctx.db
    .insert(appMeta)
    .values({ key: KEY, value, updatedAt })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt } })
    .run();
}

/** O modelo de um uso: o escolhido nele (ou na hora), senão o padrão. */
export function modelFor(settings: AiSettings, use?: Use | null, override?: string | null) {
  const id = override ?? (use ? settings.uses[use] : null) ?? settings.defaultModelId;
  return settings.models.find((m) => m.id === id) ?? null;
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** Local é o Ollama neste computador. Um Ollama em outro endereço conta como nuvem. */
export function isLocal(config: Pick<ModelConfig, 'provider' | 'baseUrl'> | null) {
  if (config?.provider !== 'ollama') return false;
  if (!config.baseUrl) return true;
  try {
    return LOOPBACK.has(new URL(config.baseUrl).hostname);
  } catch {
    return false;
  }
}

/** O modelo local lê tudo: nada sai da máquina. Na nuvem, valem as chaves de cada área. */
export function allowedAreas(settings: AiSettings, config: ModelConfig | null): Area[] {
  if (isLocal(config)) return [...AREAS];
  return AREAS.filter((a) => settings.areas[a]);
}

/** O Ollama atende em `/v1`; quem digita o endereço quase sempre esquece. */
export function normalizeOllamaUrl(url: string | null) {
  if (!url) return null;
  const trimmed = url.replace(/\/+$/, '');
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

export const needsKey = (provider: Provider) => provider !== 'ollama';

const keyName = (provider: Provider | 'jev') => `ai.key.${provider}`;

export const readKey = (ctx: AppCtx, provider: Provider | 'jev') => ctx.secrets.get(keyName(provider));

export const writeKey = (ctx: AppCtx, provider: Provider | 'jev', key: string | null) =>
  ctx.secrets.set(keyName(provider), key);

/** O que falta para usar o modelo, em palavras para a pessoa; `null` quando está pronto. */
export function problemOf(ctx: AppCtx, settings: AiSettings, config: ModelConfig | null): string | null {
  if (!config) return 'Escolha um modelo de IA em Ajustes › IA.';
  if (needsKey(config.provider) && !readKey(ctx, config.provider)) {
    return 'Falta a chave do provedor de IA em Ajustes › IA.';
  }
  if (!isLocal(config) && !settings.noticeAccepted.includes(config.provider)) {
    return 'Confirme o aviso de privacidade da IA em Ajustes › IA.';
  }
  return null;
}
