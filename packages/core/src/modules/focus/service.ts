import { addDays, dateStringToUtc } from '@sektor/finance-engine';
import { and, between, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { appMeta } from '../../db/schema';
import { AppError, type Ctx, notFound, stamp, todayIn } from '../../services/context';

import { focusSecondsAt, isPaused, pauseSpentMs } from './clock';
import { type FocusSession, focusSessions } from './schema';
import { columnsOf, textList } from './sql';

export const MIN_SESSION_SECONDS = 30;
export const DEFAULT_GOAL_MINUTES = 240;
/** Sessão esquecida aberta: passa disso, fecha sozinha e não vira um dia de 20 horas. */
export const MAX_SESSION_SECONDS = 12 * 60 * 60;
const GOAL_KEY = 'focus.dailyGoalMinutes';

export type FocusMode = FocusSession['mode'];

export function mondayOf(date: string) {
  return addDays(date, -((dateStringToUtc(date).getUTCDay() + 6) % 7));
}

export function goalMinutes(ctx: Ctx) {
  const row = ctx.db.select().from(appMeta).where(eq(appMeta.key, GOAL_KEY)).get();
  return row ? Number(row.value) : DEFAULT_GOAL_MINUTES;
}

export function setGoalMinutes(ctx: Ctx, minutes: number) {
  const value = String(minutes);
  const updatedAt = Date.now();
  ctx.db
    .insert(appMeta)
    .values({ key: GOAL_KEY, value, updatedAt })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt } })
    .run();
  return { goalMinutes: minutes };
}

const openSession = (ctx: Ctx) =>
  ctx.db
    .select()
    .from(focusSessions)
    .where(and(isNull(focusSessions.endedAt), isNull(focusSessions.deletedAt)))
    .get();

function requireOpen(ctx: Ctx) {
  const session = openSession(ctx);
  if (!session) throw new AppError(409, 'Nenhuma sessão de foco em andamento.');
  return session;
}

const patch = (ctx: Ctx, id: string, values: Partial<FocusSession>) =>
  ctx.db
    .update(focusSessions)
    .set({ ...values, updatedAt: Date.now() })
    .where(eq(focusSessions.id, id))
    .returning()
    .get();

/** Soma a pausa em andamento ao acumulado; `pausedAt` volta a nulo. */
const settled = (session: FocusSession, now: number) => ({
  pausedMs: pauseSpentMs(session, now),
  pausedAt: null,
  pausedUntil: null,
});

function namesOf(ctx: Ctx, table: string, label: string, ids: string[]) {
  const names = new Map<string, string>();
  if (ids.length === 0 || !columnsOf(ctx, table).has(label)) return names;
  const rows = ctx.db.all<{ id: string; label: string }>(
    sql`SELECT id, ${sql.identifier(label)} AS label FROM ${sql.identifier(table)}
        WHERE id IN (${textList(ids)})`
  );
  for (const row of rows) names.set(row.id, row.label);
  return names;
}

function withLabels(ctx: Ctx, sessions: FocusSession[]) {
  const ids = (key: 'taskId' | 'projectId') =>
    [...new Set(sessions.map((s) => s[key]).filter((id): id is string => !!id))];
  const tasks = namesOf(ctx, 'tasks', 'title', ids('taskId'));
  const projects = namesOf(ctx, 'projects', 'name', ids('projectId'));
  const now = Date.now();
  return sessions.map((session) => ({
    ...session,
    elapsedSeconds: session.focusSeconds ?? focusSecondsAt(session, now),
    paused: isPaused(session, now),
    label:
      (session.taskId && tasks.get(session.taskId)) ||
      (session.projectId && projects.get(session.projectId)) ||
      null,
  }));
}

export const activeSession = (ctx: Ctx) => {
  const session = openSession(ctx);
  return session ? withLabels(ctx, [session])[0]! : null;
};

export function startSession(
  ctx: Ctx,
  input: {
    mode: FocusMode;
    plannedMinutes?: number | null;
    taskId?: string | null;
    projectId?: string | null;
  }
) {
  if (openSession(ctx)) throw new AppError(409, 'Já existe uma sessão de foco em andamento.');
  const fallback = input.mode === 'POMODORO' ? 25 : 90;
  const minutes = input.mode === 'FREE' ? null : (input.plannedMinutes ?? fallback);
  const now = new Date();
  ctx.db
    .insert(focusSessions)
    .values({
      ...stamp(),
      mode: input.mode,
      day: todayIn(ctx, now),
      startedAt: now.getTime(),
      plannedSeconds: minutes === null ? null : minutes * 60,
      taskId: input.taskId ?? null,
      projectId: input.projectId ?? null,
    })
    .run();
  return activeSession(ctx)!;
}

export function pauseSession(ctx: Ctx) {
  const session = requireOpen(ctx);
  const now = Date.now();
  if (session.pausedAt === null || session.pausedUntil !== null) {
    patch(ctx, session.id, { ...settled(session, now), pausedAt: now });
  }
  return activeSession(ctx)!;
}

export function breakSession(ctx: Ctx, minutes: number) {
  const session = requireOpen(ctx);
  const now = Date.now();
  patch(ctx, session.id, {
    ...settled(session, now),
    pausedAt: now,
    pausedUntil: now + minutes * 60_000,
  });
  return activeSession(ctx)!;
}

export function resumeSession(ctx: Ctx) {
  const session = requireOpen(ctx);
  patch(ctx, session.id, settled(session, Date.now()));
  return activeSession(ctx)!;
}

function close(ctx: Ctx, session: FocusSession, endedAt: number) {
  const ended = { ...session, ...settled(session, endedAt), endedAt };
  const focusSeconds = focusSecondsAt(ended, endedAt);
  const tooShort = focusSeconds < MIN_SESSION_SECONDS;
  patch(ctx, session.id, {
    ...settled(session, endedAt),
    endedAt,
    focusSeconds,
    deletedAt: tooShort ? endedAt : null,
  });
  return { id: session.id, focusSeconds, discarded: tooShort };
}

export const finishSession = (ctx: Ctx) => close(ctx, requireOpen(ctx), Date.now());

function requireFinished(ctx: Ctx, id: string) {
  const session = ctx.db
    .select()
    .from(focusSessions)
    .where(
      and(
        eq(focusSessions.id, id),
        isNotNull(focusSessions.endedAt),
        isNull(focusSessions.deletedAt)
      )
    )
    .get();
  if (!session) throw notFound('Sessão não encontrada.');
  return session;
}

export function noteSession(ctx: Ctx, id: string, note: string | null) {
  requireFinished(ctx, id);
  return withLabels(ctx, [patch(ctx, id, { note: note?.trim() || null })])[0]!;
}

export function deleteSession(ctx: Ctx, id: string) {
  requireFinished(ctx, id);
  patch(ctx, id, { deletedAt: Date.now() });
  return { id };
}

export function history(ctx: Ctx, limit = 12) {
  const rows = ctx.db
    .select()
    .from(focusSessions)
    .where(and(isNotNull(focusSessions.endedAt), isNull(focusSessions.deletedAt)))
    .orderBy(desc(focusSessions.startedAt))
    .limit(limit)
    .all();
  return withLabels(ctx, rows);
}

/** Tarefas abertas e projetos que a sessão pode apontar. Vazio enquanto os módulos não existem. */
export function linkables(ctx: Ctx) {
  const tasks: { id: string; label: string }[] = [];
  const projects: { id: string; label: string }[] = [];
  const taskColumns = columnsOf(ctx, 'tasks');
  if (taskColumns.has('title')) {
    const open = taskColumns.has('completed_at') ? sql`AND completed_at IS NULL` : sql``;
    tasks.push(
      ...ctx.db.all<{ id: string; label: string }>(
        sql`SELECT id, title AS label FROM tasks WHERE deleted_at IS NULL ${open}
            ORDER BY created_at DESC LIMIT 200`
      )
    );
  }
  const projectColumns = columnsOf(ctx, 'projects');
  if (projectColumns.has('name')) {
    const live = projectColumns.has('completed_at') ? sql`AND completed_at IS NULL` : sql``;
    projects.push(
      ...ctx.db.all<{ id: string; label: string }>(
        sql`SELECT id, name AS label FROM projects WHERE deleted_at IS NULL ${live}
            ORDER BY name LIMIT 200`
      )
    );
  }
  return { tasks, projects };
}

export function secondsByDay(ctx: Ctx, from: string, to: string) {
  const rows = ctx.db
    .select({
      day: focusSessions.day,
      seconds: sql<number>`SUM(${focusSessions.focusSeconds})`,
    })
    .from(focusSessions)
    .where(
      and(
        between(focusSessions.day, from, to),
        isNotNull(focusSessions.endedAt),
        isNull(focusSessions.deletedAt)
      )
    )
    .groupBy(focusSessions.day)
    .all();
  return new Map(rows.map((row) => [row.day, row.seconds]));
}

/** Soma por dia com a sessão aberta incluída: o painel anda junto com o relógio. */
function liveByDay(ctx: Ctx, from: string, to: string) {
  const days = secondsByDay(ctx, from, to);
  const open = openSession(ctx);
  if (open && open.day >= from && open.day <= to) {
    days.set(open.day, (days.get(open.day) ?? 0) + focusSecondsAt(open, Date.now()));
  }
  return days;
}

export function panel(ctx: Ctx) {
  const today = todayIn(ctx);
  const monday = mondayOf(today);
  const first = addDays(today, -13);
  const start = monday < first ? monday : first;
  const days = liveByDay(ctx, start, today);
  const last14 = Array.from({ length: 14 }, (_, index) => {
    const date = addDays(first, index);
    return { date, seconds: days.get(date) ?? 0 };
  });
  const week = [...days].filter(([date]) => date >= monday).reduce((sum, [, s]) => sum + s, 0);
  const best = last14.reduce((top, day) => (day.seconds > top.seconds ? day : top), {
    date: today,
    seconds: 0,
  });
  return {
    today,
    goalMinutes: goalMinutes(ctx),
    todaySeconds: days.get(today) ?? 0,
    weekSeconds: week,
    bestDay: best.seconds > 0 ? best : null,
    last14,
  };
}

/** Para a tela Início. */
export function summary(ctx: Ctx) {
  const { todaySeconds, weekSeconds, goalMinutes: goal } = panel(ctx);
  const open = activeSession(ctx);
  return {
    todaySeconds,
    weekSeconds,
    goalSeconds: goal * 60,
    goalProgress: Math.min(1, todaySeconds / (goal * 60)),
    active: open && {
      mode: open.mode,
      elapsedSeconds: open.elapsedSeconds,
      paused: open.paused,
      label: open.label,
    },
  };
}

export function runClock(ctx: AppCtx) {
  const session = openSession(ctx);
  if (!session) return;
  const now = Date.now();
  const elapsed = focusSecondsAt(session, now);
  const held = session.pausedAt !== null && session.pausedUntil === null;
  const forgotten = held
    ? now - session.pausedAt! >= MAX_SESSION_SECONDS * 1000
    : elapsed >= MAX_SESSION_SECONDS;
  if (forgotten) {
    // Ninguém viu passar do planejado: o que ficou contando depois disso não foi foco.
    const limit = Math.min(session.plannedSeconds ?? MAX_SESSION_SECONDS, MAX_SESSION_SECONDS);
    const paused = held ? session.pausedAt! : now;
    const spent = pauseSpentMs({ ...session, pausedUntil: null }, paused);
    const atLimit = session.startedAt + spent + limit * 1000;
    close(ctx, session, held ? Math.min(paused, atLimit) : atLimit);
    ctx.notify('Sessão de foco encerrada', 'Ela ficou aberta tempo demais e foi fechada sozinha.');
    return;
  }
  if (session.pausedUntil !== null && now >= session.pausedUntil) {
    patch(ctx, session.id, settled(session, now));
    ctx.notify('Pausa encerrada', 'O relógio do foco voltou a contar.');
  }
  if (
    session.plannedSeconds !== null &&
    session.plannedNotifiedAt === null &&
    elapsed >= session.plannedSeconds
  ) {
    patch(ctx, session.id, { plannedNotifiedAt: now });
    ctx.notify('Tempo concluído', 'A sessão de foco chegou ao tempo planejado.');
  }
}

