import { eq } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { appMeta } from '../../db/schema';
import type { Ctx } from '../../services/context';

export const PROVIDERS = ['ollama', 'openrouter', 'anthropic', 'openai'] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Áreas que a IA pode ler. `journal` é o texto da Revisão (o que foi bem, o que travou). */
export const AREAS = ['finance', 'tasks', 'agenda', 'projects', 'habits', 'focus', 'health', 'journal'] as const;
export type Area = (typeof AREAS)[number];

/** Para modelo na nuvem, saúde e diário nascem desligados. */
const CLOUD_DEFAULT_OFF: Area[] = ['health', 'journal'];

export interface AiSettings {
  provider: Provider | null;
  model: string;
  /** Só do Ollama: outro endereço que não o padrão. */
  baseUrl: string | null;
  areas: Record<Area, boolean>;
  /** O aviso de privacidade aceito, por provedor. Trocar de provedor pede o aviso de novo. */
  noticeAccepted: Provider[];
  /** Categoria por IA na revisão do banco: `ask` até a pessoa responder na primeira vez. */
  bankCategory: 'ask' | 'on' | 'off';
  /** Guarda o conteúdo enviado e recebido no registro. */
  debug: boolean;
  /** Mostra tokens e custo. */
  devMode: boolean;
}

const KEY = 'ai.settings';

export const DEFAULT_SETTINGS: AiSettings = {
  provider: null,
  model: '',
  baseUrl: null,
  areas: Object.fromEntries(AREAS.map((a) => [a, !CLOUD_DEFAULT_OFF.includes(a)])) as Record<Area, boolean>,
  noticeAccepted: [],
  bankCategory: 'ask',
  debug: false,
  devMode: false,
};

export function readSettings(ctx: Ctx): AiSettings {
  const row = ctx.db.select().from(appMeta).where(eq(appMeta.key, KEY)).get();
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  const saved = JSON.parse(row.value) as Partial<AiSettings>;
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    areas: { ...DEFAULT_SETTINGS.areas, ...saved.areas },
  };
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

export const isLocal = (provider: Provider | null) => provider === 'ollama';

/** O modelo local lê tudo: nada sai da máquina. */
export function allowedAreas(settings: AiSettings): Area[] {
  if (isLocal(settings.provider)) return [...AREAS];
  return AREAS.filter((a) => settings.areas[a]);
}

export const needsKey = (provider: Provider) => provider !== 'ollama';

const keyName = (provider: Provider | 'jev') => `ai.key.${provider}`;

export const readKey = (ctx: AppCtx, provider: Provider | 'jev') => ctx.secrets.get(keyName(provider));

export const writeKey = (ctx: AppCtx, provider: Provider | 'jev', key: string | null) =>
  ctx.secrets.set(keyName(provider), key);
