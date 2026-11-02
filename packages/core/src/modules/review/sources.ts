import { addDays, dateStringInZone, dateStringToUtc } from '@sektor/finance-engine';
import { sql } from 'drizzle-orm';

import type { Ctx } from '../../services/context';
import { columnsOf } from '../focus/sql';

export type DayCounts = Map<string, number>;
export interface DayAverages {
  sum: Map<string, number>;
  count: Map<string, number>;
}

/** `null` quer dizer que a fonte ainda não existe, o que a tela mostra diferente de zero. */
export function tasksDone(ctx: Ctx, from: string, to: string): DayCounts | null {
  if (!columnsOf(ctx, 'tasks').has('completed_at')) return null;
  // Folga de um dia nas pontas: o corte certo depende do fuso e é feito abaixo.
  const after = dateStringToUtc(addDays(from, -1)).getTime();
  const before = dateStringToUtc(addDays(to, 2)).getTime();
  const rows = ctx.db.all<{ at: number }>(
    sql`SELECT completed_at AS at FROM tasks
        WHERE deleted_at IS NULL AND completed_at >= ${after} AND completed_at < ${before}`
  );
  const days: DayCounts = new Map();
  for (const { at } of rows) {
    const day = dateStringInZone(new Date(at), ctx.timeZone);
    if (day >= from && day <= to) days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}

export function expenses(ctx: Ctx, from: string, to: string): DayCounts | null {
  if (columnsOf(ctx, 'transactions').size === 0) return null;
  const rows = ctx.db.all<{ date: string; cents: number }>(
    sql`SELECT date, SUM(amount_cents) AS cents FROM transactions
        WHERE kind = 'EXPENSE' AND status = 'DONE' AND deleted_at IS NULL
          AND date BETWEEN ${from} AND ${to}
        GROUP BY date`
  );
  return new Map(rows.map((row) => [row.date, row.cents]));
}

export function habitsDone(ctx: Ctx, from: string, to: string): DayCounts | null {
  if (!columnsOf(ctx, 'habit_checks').has('date')) return null;
  const rows = ctx.db.all<{ date: string; total: number }>(
    sql`SELECT date, COUNT(*) AS total FROM habit_checks
        WHERE deleted_at IS NULL AND date BETWEEN ${from} AND ${to} GROUP BY date`
  );
  return new Map(rows.map((row) => [row.date, row.total]));
}

export function moods(ctx: Ctx, from: string, to: string): DayAverages | null {
  if (!columnsOf(ctx, 'health_days').has('mood')) return null;
  const rows = ctx.db.all<{ date: string; total: number; entries: number }>(
    sql`SELECT date, SUM(mood) AS total, COUNT(mood) AS entries FROM health_days
        WHERE deleted_at IS NULL AND mood IS NOT NULL AND date BETWEEN ${from} AND ${to}
        GROUP BY date`
  );
  return {
    sum: new Map(rows.map((row) => [row.date, row.total])),
    count: new Map(rows.map((row) => [row.date, row.entries])),
  };
}
