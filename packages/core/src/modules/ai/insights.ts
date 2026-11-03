import { addMonthsToMonth } from '@sektor/finance-engine';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import type { AppCtx } from '../../app';
import { categories } from '../../db/schema';
import { AppError, type Ctx, stamp, todayIn } from '../../services/context';
import { monthSummary } from '../../services/reports';
import { periodOf } from '../review/period';
import { reviews } from '../review/schema';
import { stats } from '../review/service';

import { ask } from './run';
import { aiInsights } from './schema';
import { allowedAreas, type Area, readSettings } from './settings';

export const INSIGHTS = ['weekly', 'financeChanges'] as const;
export type InsightKind = (typeof INSIGHTS)[number];

/** Dinheiro vai ao modelo e volta como `[[centavos]]`: a tela formata e oculta como o resto. */
const cents = (value: number) => `[[${Math.round(value)}]]`;

const STYLE = `Escreva em português do Brasil, para a própria pessoa, em segunda pessoa ("você").
Texto corrido, de 3 a 5 frases curtas, sem título, sem listas e sem markdown.
Valores em dinheiro: escreva exatamente como vierem, no formato [[centavos]], sem converter.
Diga só o que os dados mostram. Não invente causas, não dê conselho financeiro nem de saúde.
Se faltar dado de uma área, não comente essa área.`;

interface Payload {
  areas: Area[];
  data: Record<string, unknown>;
}

function categoryNames(ctx: Ctx) {
  const rows = ctx.db
    .select({ id: categories.id, name: categories.name, parentId: categories.parentId })
    .from(categories)
    .where(isNull(categories.deletedAt))
    .all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  return (id: string | null) => {
    if (!id) return 'Sem categoria';
    const row = byId.get(id);
    if (!row) return 'Sem categoria';
    const parent = row.parentId ? byId.get(row.parentId) : null;
    return parent ? `${parent.name} › ${row.name}` : row.name;
  };
}

function expensesByCategory(ctx: Ctx, from: string, to: string) {
  const name = categoryNames(ctx);
  return ctx.db
    .all<{ categoryId: string | null; total: number }>(
      sql`SELECT category_id AS categoryId, SUM(amount_cents) AS total FROM transactions
          WHERE kind = 'EXPENSE' AND status = 'DONE' AND deleted_at IS NULL
            AND date BETWEEN ${from} AND ${to}
          GROUP BY category_id ORDER BY total DESC LIMIT 6`
    )
    .map((row) => ({ categoria: name(row.categoryId), total: cents(row.total) }));
}

function weeklyPayload(ctx: Ctx, key: string | undefined, areas: Area[]): Payload & { period: string } {
  const today = todayIn(ctx);
  const period = periodOf('week', key, today);
  const previous = periodOf('week', period.previous, today);
  const now = stats(ctx, period, today);
  const before = stats(ctx, previous, today);
  const has = (area: Area) => areas.includes(area);
  const used: Area[] = [];
  const data: Record<string, unknown> = { semana: `${period.from} a ${period.to}`, hoje: today };
  const pair = (current: unknown, last: unknown) => ({ estaSemana: current, semanaPassada: last });

  if (has('tasks') && now.available.tasks) {
    data.tarefasConcluidas = pair(now.totals.tasks, before.totals.tasks);
    used.push('tasks');
  }
  // Quem não usa o Foco teria zeros mandados toda semana.
  if (has('focus') && (now.totals.focusSeconds > 0 || before.totals.focusSeconds > 0)) {
    data.minutosDeFoco = pair(
      Math.round(now.totals.focusSeconds / 60),
      Math.round(before.totals.focusSeconds / 60)
    );
    used.push('focus');
  }
  if (has('habits') && now.available.habits) {
    data.habitosMarcados = pair(now.totals.habits, before.totals.habits);
    used.push('habits');
  }
  if (has('health') && now.available.mood) {
    const mood = (value: number | null) => (value === null ? null : Number(value.toFixed(1)));
    data.humorMedioDe1a5 = pair(mood(now.totals.mood), mood(before.totals.mood));
    used.push('health');
  }
  if (has('finance') && now.available.expenses) {
    data.gastos = pair(cents(now.totals.expenseCents ?? 0), cents(before.totals.expenseCents ?? 0));
    data.gastosPorCategoria = expensesByCategory(ctx, period.from, period.to);
    used.push('finance');
  }
  if (has('journal')) {
    const review = ctx.db
      .select()
      .from(reviews)
      .where(and(eq(reviews.weekStart, period.key), isNull(reviews.deletedAt)))
      .get();
    if (review && (review.wentWell || review.blocked)) {
      data.revisao = { oQueFoiBem: review.wentWell, oQueTravou: review.blocked };
      used.push('journal');
    }
  }
  return { period: period.key, areas: used, data };
}

function financePayload(ctx: Ctx, month: string | undefined, areas: Area[]): Payload & { period: string } {
  if (!areas.includes('finance')) {
    throw new AppError(409, 'Finanças está desligada para a IA em Ajustes › IA.');
  }
  const key = month ?? todayIn(ctx).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(key)) throw new AppError(400, 'Mês inválido.');
  const summary = monthSummary(ctx, key);
  const name = categoryNames(ctx);
  const previous = new Map(summary.previous.expenseByCategory.map((c) => [c.categoryId, c.totalCents]));
  const ids = new Set([...summary.expenseByCategory.map((c) => c.categoryId), ...previous.keys()]);
  const current = new Map(summary.expenseByCategory.map((c) => [c.categoryId, c.totalCents]));
  const changes = [...ids]
    .map((id) => ({ id, now: current.get(id) ?? 0, before: previous.get(id) ?? 0 }))
    .sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before))
    .slice(0, 8)
    .map((c) => ({ categoria: name(c.id), esteMes: cents(c.now), mesPassado: cents(c.before) }));
  const day = key === todayIn(ctx).slice(0, 7) ? Number(todayIn(ctx).slice(8, 10)) : null;
  return {
    period: key,
    areas: ['finance'],
    data: {
      mes: key,
      mesPassado: addMonthsToMonth(key, -1),
      // No mês corrente, a comparação é de um mês pela metade com um inteiro.
      diaDeHojeNoMesCorrente: day,
      entradas: { esteMes: cents(summary.incomeCents), mesPassado: cents(summary.previous.incomeCents) },
      gastos: { esteMes: cents(summary.expenseCents), mesPassado: cents(summary.previous.expenseCents) },
      maioresMudancasPorCategoria: changes,
    },
  };
}

const SYSTEM: Record<InsightKind, string> = {
  weekly: `Você escreve o resumo da semana no Sektor, um app pessoal de organização.
Compare esta semana com a passada nos números que vierem e aponte o que mais chama atenção.
${STYLE}`,
  financeChanges: `Você explica o que mudou nas finanças pessoais de um mês para o outro no Sektor.
Diga quais categorias mais subiram ou caíram e o efeito no total. Se for o mês corrente, lembre que ele ainda não acabou.
${STYLE}`,
};

function payloadOf(ctx: AppCtx, kind: InsightKind, period: string | undefined) {
  const areas = allowedAreas(readSettings(ctx));
  return kind === 'weekly' ? weeklyPayload(ctx, period, areas) : financePayload(ctx, period, areas);
}

/** Campos de data que mudam todo dia sem os números mudarem: ficam fora da comparação. */
const VOLATILE = new Set(['hoje', 'diaDeHojeNoMesCorrente']);

const fingerprintOf = (payload: Payload) => {
  const data = Object.fromEntries(Object.entries(payload.data).filter(([key]) => !VOLATILE.has(key)));
  return createHash('sha256')
    .update(JSON.stringify({ areas: payload.areas, data }))
    .digest('hex')
    .slice(0, 16);
};

const findSaved = (ctx: Ctx, kind: InsightKind, period: string) =>
  ctx.db
    .select()
    .from(aiInsights)
    .where(
      and(eq(aiInsights.feature, kind), eq(aiInsights.period, period), isNull(aiInsights.deletedAt))
    )
    .get();

export interface InsightResponse {
  period: string;
  text: string | null;
  createdAt: number | null;
  /** Os dados mudaram desde que o texto foi gerado. */
  stale: boolean;
  /** Nenhuma área liberada tem dado neste período. */
  empty: boolean;
}

/** O texto guardado, sem chamar o modelo. */
export function getInsight(ctx: AppCtx, kind: InsightKind, period?: string): InsightResponse {
  const payload = payloadOf(ctx, kind, period);
  const saved = findSaved(ctx, kind, payload.period);
  return {
    period: payload.period,
    text: saved?.text ?? null,
    createdAt: saved?.updatedAt ?? null,
    stale: Boolean(saved && saved.fingerprint !== fingerprintOf(payload)),
    empty: payload.areas.length === 0,
  };
}

/** Gera de novo e guarda, substituindo o anterior do mesmo período. */
export async function generateInsight(
  ctx: AppCtx,
  kind: InsightKind,
  period?: string
): Promise<InsightResponse> {
  const payload = payloadOf(ctx, kind, period);
  if (payload.areas.length === 0) {
    throw new AppError(409, 'Nenhuma área liberada para a IA tem dados neste período.');
  }
  const text = await ask(ctx, {
    feature: `insight.${kind}`,
    system: SYSTEM[kind],
    prompt: JSON.stringify(payload.data),
    areas: payload.areas,
    maxOutputTokens: 600,
  });
  const settings = readSettings(ctx);
  const values = {
    text,
    provider: settings.provider!,
    model: settings.model,
    fingerprint: fingerprintOf(payload),
    updatedAt: Date.now(),
  };
  // Dois "Gerar" ao mesmo tempo: vale o último.
  ctx.db
    .insert(aiInsights)
    .values({ ...stamp(), feature: kind, period: payload.period, ...values })
    .onConflictDoUpdate({
      target: [aiInsights.feature, aiInsights.period],
      targetWhere: sql`deleted_at IS NULL`,
      set: values,
    })
    .run();
  return getInsight(ctx, kind, payload.period);
}
