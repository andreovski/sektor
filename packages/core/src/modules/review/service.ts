import { addDays } from '@sektor/finance-engine';
import { and, eq, isNull } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { appMeta } from '../../db/schema';
import { AppError, type Ctx, notFound, stamp, todayIn } from '../../services/context';
import { mondayOf, secondsByDay } from '../focus/service';

import { type Period, type PeriodKind, periodOf } from './period';
import { type Priority, reviews } from './schema';
import * as sources from './sources';

export interface Bucket {
  key: string;
  future: boolean;
  tasks: number;
  focusSeconds: number;
  habits: number;
  mood: number | null;
  expenseCents: number;
}

/** Mesmos números na semana, no mês e no ano; no ano, cada linha é um mês. */
export function stats(ctx: Ctx, period: Period, today: string) {
  const { from, to } = period;
  const tasks = sources.tasksDone(ctx, from, to);
  const focus = secondsByDay(ctx, from, to);
  const habits = sources.habitsDone(ctx, from, to);
  const moods = sources.moods(ctx, from, to);
  const expenses = sources.expenses(ctx, from, to);

  const buckets = new Map<string, Bucket & { moodSum: number; moodCount: number }>();
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const key = period.kind === 'year' ? date.slice(0, 7) : date;
    const bucket =
      buckets.get(key) ??
      buckets
        .set(key, {
          key,
          future: key > today.slice(0, key.length),
          tasks: 0,
          focusSeconds: 0,
          habits: 0,
          mood: null,
          expenseCents: 0,
          moodSum: 0,
          moodCount: 0,
        })
        .get(key)!;
    bucket.tasks += tasks?.get(date) ?? 0;
    bucket.focusSeconds += focus.get(date) ?? 0;
    bucket.habits += habits?.get(date) ?? 0;
    bucket.expenseCents += expenses?.get(date) ?? 0;
    bucket.moodSum += moods?.sum.get(date) ?? 0;
    bucket.moodCount += moods?.count.get(date) ?? 0;
  }

  const rows = [...buckets.values()];
  const total = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((sum, row) => sum + pick(row), 0);
  const moodCount = total((row) => row.moodCount);
  return {
    totals: {
      tasks: tasks && total((row) => row.tasks),
      focusSeconds: total((row) => row.focusSeconds),
      habits: habits && total((row) => row.habits),
      mood: moods && (moodCount ? total((row) => row.moodSum) / moodCount : null),
      expenseCents: expenses && total((row) => row.expenseCents),
    },
    available: {
      tasks: tasks !== null,
      habits: habits !== null,
      mood: moods !== null,
      expenses: expenses !== null,
    },
    days: rows.map(({ moodSum, moodCount: count, ...row }): Bucket => ({
      ...row,
      mood: count ? moodSum / count : null,
    })),
  };
}

const findReview = (ctx: Ctx, weekStart: string) =>
  ctx.db
    .select()
    .from(reviews)
    .where(and(eq(reviews.weekStart, weekStart), isNull(reviews.deletedAt)))
    .get();

export function getPeriod(ctx: Ctx, kind: PeriodKind, key?: string) {
  const today = todayIn(ctx);
  const period = periodOf(kind, key, today);
  return {
    period,
    ...stats(ctx, period, today),
    review: kind === 'week' ? (findReview(ctx, period.key) ?? null) : null,
  };
}

export function saveReview(
  ctx: Ctx,
  input: { weekStart: string; wentWell: string; blocked: string; priorities: string[] }
) {
  const weekStart = periodOf('week', input.weekStart, todayIn(ctx)).key;
  const saved = findReview(ctx, weekStart);
  // A prioridade que já virou tarefa continua ligada a ela enquanto o texto for o mesmo.
  const priorities: Priority[] = input.priorities
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => ({
      text,
      taskId: saved?.priorities.find((p) => p.text === text)?.taskId ?? null,
    }));
  const values = { wentWell: input.wentWell.trim(), blocked: input.blocked.trim(), priorities };
  if (saved) {
    return ctx.db
      .update(reviews)
      .set({ ...values, updatedAt: Date.now() })
      .where(eq(reviews.id, saved.id))
      .returning()
      .get();
  }
  return ctx.db
    .insert(reviews)
    .values({ ...stamp(), weekStart, ...values })
    .returning()
    .get();
}

/** Marca a tarefa criada: "Virar tarefas" de novo não duplica, e uma falha no meio retoma dali. */
export function linkPriority(ctx: Ctx, weekStart: string, text: string, taskId: string) {
  const saved = findReview(ctx, weekStart);
  if (!saved) throw notFound('Revisão não encontrada.');
  if (!saved.priorities.some((p) => p.text === text)) {
    throw new AppError(409, 'Essa prioridade mudou. Salve a revisão de novo.');
  }
  return ctx.db
    .update(reviews)
    .set({
      priorities: saved.priorities.map((p) => (p.text === text ? { ...p, taskId } : p)),
      updatedAt: Date.now(),
    })
    .where(eq(reviews.id, saved.id))
    .returning()
    .get();
}

const REMINDER_KEY = 'review.remindedWeek';
const REMINDER_HOUR = 18;

function weekdayAndHour(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(now);
  return {
    weekday: parts.find((part) => part.type === 'weekday')!.value,
    hour: Number(parts.find((part) => part.type === 'hour')!.value),
  };
}

export function remind(ctx: AppCtx) {
  const now = new Date();
  const { weekday, hour } = weekdayAndHour(now, ctx.timeZone);
  if (weekday !== 'Sun' || hour < REMINDER_HOUR) return;
  const weekStart = mondayOf(todayIn(ctx, now));
  const stored = ctx.db.select().from(appMeta).where(eq(appMeta.key, REMINDER_KEY)).get();
  if (stored?.value === weekStart || findReview(ctx, weekStart)) return;
  ctx.notify('Revisão da semana', 'Reserve uns minutos para fechar a semana.');
  const updatedAt = Date.now();
  ctx.db
    .insert(appMeta)
    .values({ key: REMINDER_KEY, value: weekStart, updatedAt })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: weekStart, updatedAt } })
    .run();
}
