import { eq } from 'drizzle-orm';
import { z } from 'zod';

import type { AppCtx } from '../../app';
import { appMeta } from '../../db/schema';
import type { Ctx } from '../../services/context';
import { parse } from '../finance';
import type { Area } from '../ai/settings';

/** Módulos que a pessoa pode desligar. Início e Ajustes ficam sempre. */
export const MODULE_IDS = [
  'tasks',
  'projects',
  'agenda',
  'finance',
  'habits',
  'goals',
  'health',
  'focus',
  'review',
  'reminders',
  'assistant',
] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** De que módulo vem cada área que a IA lê. O diário é o texto da Revisão. */
const AREA_MODULE: Record<Area, ModuleId> = {
  finance: 'finance',
  tasks: 'tasks',
  agenda: 'agenda',
  projects: 'projects',
  habits: 'habits',
  focus: 'focus',
  health: 'health',
  journal: 'review',
};

// Guarda os desligados: módulo novo nasce ligado para quem já usa o app.
const KEY = 'modules.disabled';

export function disabledModules(ctx: Ctx): ModuleId[] {
  const row = ctx.db.select().from(appMeta).where(eq(appMeta.key, KEY)).get();
  if (!row) return [];
  const saved = JSON.parse(row.value) as string[];
  return MODULE_IDS.filter((id) => saved.includes(id));
}

export const moduleOn = (ctx: Ctx, id: ModuleId) => !disabledModules(ctx).includes(id);

/** Área de módulo desligado some para a IA, mesmo com o modelo local. */
export const areaOn = (ctx: Ctx, area: Area) => moduleOn(ctx, AREA_MODULE[area]);

const setInput = z.object({ id: z.enum(MODULE_IDS), enabled: z.boolean() });

export const handlers = (ctx: AppCtx) => ({
  'modules.get': () => ({ disabled: disabledModules(ctx) }),
  /** Desligar só esconde: nenhum dado é apagado. */
  'modules.set': (input: z.input<typeof setInput>) => {
    const { id, enabled } = parse(setInput as never, input) as z.output<typeof setInput>;
    const rest = disabledModules(ctx).filter((other) => other !== id);
    const value = JSON.stringify(enabled ? rest : [...rest, id]);
    const updatedAt = Date.now();
    ctx.db
      .insert(appMeta)
      .values({ key: KEY, value, updatedAt })
      .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt } })
      .run();
    return { disabled: disabledModules(ctx) };
  },
});

