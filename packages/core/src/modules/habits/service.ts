import { addDays, type DateString, diffInDays } from '@sektor/finance-engine';
import { and, asc, eq, isNull, max } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { appMeta } from '../../db/schema';
import { AppError, type Ctx, notFound, stamp, todayIn } from '../../services/context';

import { habitChecks, habits } from './schema';
import {
  challengeProgress,
  completionRate,
  currentStreak,
  type Frequency,
  isAtRisk,
  isDue,
  isScheduled,
  longestStreak,
  RATE_DAYS,
} from './streaks';

type HabitRow = typeof habits.$inferSelect;

export interface HabitBody {
  name: string;
  kind: HabitRow['kind'];
  frequency: HabitRow['frequency'];
  timesPerWeek?: number | null;
  endOn?: string | null;
  color: HabitRow['color'];
}

export const frequencyOf = (row: Pick<HabitRow, 'frequency' | 'timesPerWeek'>): Frequency =>
  row.frequency === 'TIMES' ? { type: 'TIMES', times: row.timesPerWeek ?? 1 } : { type: row.frequency };

const liveHabit = isNull(habits.deletedAt);
const liveCheck = isNull(habitChecks.deletedAt);

function ownedHabit(ctx: Ctx, id: string) {
  const row = ctx.db
    .select()
    .from(habits)
    .where(and(eq(habits.id, id), liveHabit))
    .get();
  if (!row) throw notFound('Hábito');
  return row;
}

function marksByHabit(ctx: Ctx) {
  const map = new Map<string, Set<DateString>>();
  for (const { habitId, date } of ctx.db
    .select({ habitId: habitChecks.habitId, date: habitChecks.date })
    .from(habitChecks)
    .where(liveCheck)
    .all()) {
    if (!map.has(habitId)) map.set(habitId, new Set());
    map.get(habitId)!.add(date);
  }
  return map;
}

function view(row: HabitRow, marks: Set<DateString>, today: DateString) {
  const frequency = frequencyOf(row);
  const ended = Boolean(row.endOn && row.endOn < today);
  const asOf = ended ? row.endOn! : today;
  const grid = Array.from({ length: RATE_DAYS }, (_, i) => {
    const date = addDays(today, i + 1 - RATE_DAYS);
    return {
      date,
      done: marks.has(date),
      scheduled: isScheduled(frequency, date),
      locked: Boolean(row.endOn && date > row.endOn),
    };
  });
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    frequency: row.frequency,
    timesPerWeek: row.timesPerWeek,
    startOn: row.startOn,
    endOn: row.endOn,
    color: row.color,
    position: row.position,
    ended,
    doneToday: marks.has(today),
    due: !ended && isDue(frequency, marks, today),
    atRisk: !ended && isAtRisk(frequency, marks, today),
    streak: currentStreak(frequency, marks, asOf),
    longestStreak: longestStreak(frequency, marks, asOf),
    rate: completionRate(frequency, marks, { today, start: row.startOn, end: row.endOn }),
    challenge: row.endOn
      ? {
          ...challengeProgress(frequency, marks, row.startOn, row.endOn),
          daysLeft: Math.max(0, diffInDays(today, row.endOn)),
        }
      : null,
    grid,
  };
}

export function listHabits(ctx: Ctx) {
  const today = todayIn(ctx);
  const marks = marksByHabit(ctx);
  return ctx.db
    .select()
    .from(habits)
    .where(liveHabit)
    .orderBy(asc(habits.position), asc(habits.id))
    .all()
    .map((row) => view(row, marks.get(row.id) ?? new Set(), today));
}

/** Resumo do dia para a tela Início: só o que vale para hoje. */
export function habitsToday(ctx: Ctx) {
  const list = listHabits(ctx)
    .filter((habit) => !habit.ended && (habit.due || habit.doneToday))
    .map(({ id, name, color, doneToday, atRisk, streak }) => ({
      id,
      name,
      color,
      doneToday,
      atRisk,
      streak,
    }));
  return {
    date: todayIn(ctx),
    done: list.filter((habit) => habit.doneToday).length,
    total: list.length,
    habits: list,
  };
}

function checkPeriod(body: HabitBody, today: DateString) {
  if (body.kind === 'CHALLENGE' && !body.endOn) {
    throw new AppError(400, 'Escolha o prazo do desafio.');
  }
  if (body.kind === 'CHALLENGE' && body.endOn! < today) {
    throw new AppError(400, 'O prazo do desafio já passou.');
  }
}

const columns = (body: HabitBody) => ({
  name: body.name,
  kind: body.kind,
  frequency: body.frequency,
  timesPerWeek: body.frequency === 'TIMES' ? (body.timesPerWeek ?? 1) : null,
  endOn: body.kind === 'CHALLENGE' ? body.endOn! : null,
  color: body.color,
});

function habitView(ctx: Ctx, id: string) {
  return listHabits(ctx).find((habit) => habit.id === id)!;
}

export function createHabit(ctx: Ctx, body: HabitBody) {
  const today = todayIn(ctx);
  checkPeriod(body, today);
  const last = ctx.db.select({ value: max(habits.position) }).from(habits).where(liveHabit).get();
  const { id } = ctx.db
    .insert(habits)
    .values({ ...stamp(), ...columns(body), startOn: today, position: (last?.value ?? -1) + 1 })
    .returning()
    .get();
  return habitView(ctx, id);
}

export function updateHabit(ctx: Ctx, id: string, body: HabitBody) {
  const row = ownedHabit(ctx, id);
  // Desafio encerrado continua editável sem precisar empurrar o prazo.
  if (body.endOn !== row.endOn) checkPeriod(body, todayIn(ctx));
  ctx.db
    .update(habits)
    .set({ ...columns(body), updatedAt: Date.now() })
    .where(eq(habits.id, id))
    .run();
  return habitView(ctx, id);
}

export function deleteHabit(ctx: Ctx, id: string) {
  ownedHabit(ctx, id);
  const now = Date.now();
  ctx.db.transaction((tx) => {
    tx.update(habitChecks)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(habitChecks.habitId, id), liveCheck))
      .run();
    tx.update(habits).set({ deletedAt: now, updatedAt: now }).where(eq(habits.id, id)).run();
  });
  return { id };
}

export function toggleCheck(ctx: Ctx, id: string, date: DateString) {
  const row = ownedHabit(ctx, id);
  if (date > todayIn(ctx)) throw new AppError(400, 'Ainda não chegou esse dia.');
  if (row.endOn && date > row.endOn) throw new AppError(400, 'Esse dia fica depois do fim do desafio.');
  const existing = ctx.db
    .select({ id: habitChecks.id })
    .from(habitChecks)
    .where(and(eq(habitChecks.habitId, id), eq(habitChecks.date, date), liveCheck))
    .get();
  const now = Date.now();
  if (existing) {
    ctx.db
      .update(habitChecks)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(habitChecks.id, existing.id))
      .run();
  } else {
    ctx.db.insert(habitChecks).values({ ...stamp(), habitId: id, date }).run();
  }
  return habitView(ctx, id);
}

export function reorderHabits(ctx: Ctx, ids: string[]) {
  const live = ctx.db.select({ id: habits.id }).from(habits).where(liveHabit).all();
  const known = new Set(live.map((row) => row.id));
  if (new Set(ids).size !== ids.length || ids.length !== known.size || ids.some((id) => !known.has(id))) {
    throw new AppError(409, 'A lista mudou. Tente de novo.');
  }
  const now = Date.now();
  ctx.db.transaction((tx) => {
    ids.forEach((id, position) => {
      tx.update(habits).set({ position, updatedAt: now }).where(eq(habits.id, id)).run();
    });
  });
  return listHabits(ctx);
}

const NOTICE_KEY = 'habits:risk-notice';
const NOTICE_HOUR = 20;

function localHour(now: Date, timeZone: string) {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit' }).format(now)
  );
}

function noticeBody(risky: { name: string; streak: number }[]) {
  if (risky.length === 1) {
    const [{ name, streak }] = risky as [{ name: string; streak: number }];
    return `Marque "${name}" hoje para manter ${streak} ${streak === 1 ? 'dia' : 'dias'} de sequência.`;
  }
  return `${risky.length} hábitos ainda sem marca hoje: ${risky.map((h) => h.name).join(', ')}.`;
}

/** Uma vez por dia, a partir das 20h locais. Depois disso recupera o atraso ao abrir o app. */
export function riskNotice(ctx: AppCtx, now = new Date()) {
  if (localHour(now, ctx.timeZone) < NOTICE_HOUR) return;
  const today = todayIn(ctx, now);
  const sent = ctx.db.select().from(appMeta).where(eq(appMeta.key, NOTICE_KEY)).get();
  if (sent?.value === today) return;
  const risky = listHabits(ctx).filter((habit) => habit.atRisk);
  if (risky.length > 0) ctx.notify('Sequência em risco', noticeBody(risky));
  ctx.db
    .insert(appMeta)
    .values({ key: NOTICE_KEY, value: today, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: today, updatedAt: Date.now() } })
    .run();
}
