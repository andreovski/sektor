import { addDays, dateStringInZone, startOfDayInZone } from '@sektor/finance-engine';
import { and, eq, inArray, isNull, lte } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { AppError, notFound, stamp } from '../../services/context';
import { type Range, expandSeries, startOf } from '../agenda/expand';
import { alertLabel } from '../agenda/form';
import { type EventRow, events } from '../agenda/schema';
import { timeOf, wallInstant } from '../agenda/view';

import type { CustomReminder } from './contract';
import {
  describeSchedule,
  leadText,
  nextScheduleFire,
  type ScheduleRule,
} from './schedule';
import { type ReminderRow, reminders } from './schema';
import { readTask, taskSeries } from './tasks';

/** Atrasou mais que isto (app fechado): não avisa, só agenda o próximo. */
const STALE_MS = 60 * 60_000;
/** Folga para o job, que roda de minuto em minuto. */
const GRACE_MS = 60_000;
/** Tarefa só com data avisa neste horário local. */
const DATE_ONLY_TASK_TIME = '09:00';
const SEARCH_DAYS = 400;
const DAY = 86_400_000;

type Ctx = Pick<AppCtx, 'db' | 'timeZone'>;

const alive = and(isNull(reminders.deletedAt));

export function taskAnchor(dueDate: string, dueTime: string | null, timeZone: string) {
  return wallInstant(dueDate, dueTime ?? DATE_ONLY_TASK_TIME, timeZone);
}

/**
 * Início da próxima ocorrência do evento cujo aviso ainda não passou. Lê as ocorrências já com as
 * exceções: a cancelada não avisa e a movida avisa no horário novo. No dia inteiro o "início" é a
 * meia-noite no fuso.
 */
export function nextEventStart(
  event: EventRow,
  overrides: EventRow[],
  minutesBefore: number,
  now: Date,
  timeZone: string,
  lastFiredFor: number | null
): Date | null {
  const offset = minutesBefore * 60_000;
  const anchor = (start: string, allDay: boolean) =>
    allDay ? startOfDayInZone(start.slice(0, 10), timeZone) : new Date(start);
  const pending = (start: Date) => start.getTime() - offset > now.getTime() - GRACE_MS;

  if (!event.rrule) {
    const start = anchor(startOf(event), event.allDay);
    return start.getTime() !== lastFiredFor && pending(start) ? start : null;
  }

  const from = new Date(now.getTime() + offset - GRACE_MS - DAY);
  const to = new Date(from.getTime() + SEARCH_DAYS * DAY);
  const range: Range = {
    from,
    to,
    fromDay: addDays(dateStringInZone(from, timeZone), -1),
    toDay: addDays(dateStringInZone(to, timeZone), 1),
  };
  const starts = expandSeries(event, overrides, range, timeZone)
    .map((occurrence) => anchor(occurrence.startAt, occurrence.allDay))
    .sort((a, b) => a.getTime() - b.getTime());
  return (
    starts.find(
      (start) => pending(start) && (lastFiredFor === null || start.getTime() > lastFiredFor)
    ) ?? null
  );
}

function customRule(row: ReminderRow): ScheduleRule {
  return {
    schedule: row.schedule!,
    startDate: row.startDate!,
    time: row.time,
    intervalHours: row.intervalHours,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
  };
}

function eventRows(ctx: Ctx, id: string) {
  const event = ctx.db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .get();
  if (!event || event.status === 'CANCELLED') return null;
  const overrides = ctx.db
    .select()
    .from(events)
    .where(and(eq(events.recurringEventId, id), isNull(events.deletedAt)))
    .all();
  return { event, overrides };
}

/** Quando o lembrete toca, ou null se não há próximo. */
export function computeNextFire(ctx: Ctx, row: ReminderRow, now: Date): number | null {
  if (row.pausedAt) return null;
  const offset = row.minutesBefore * 60_000;

  if (row.kind === 'CUSTOM') {
    return nextScheduleFire(customRule(row), now, ctx.timeZone)?.getTime() ?? null;
  }
  if (row.kind === 'EVENT') {
    const found = eventRows(ctx, row.ownerId!);
    if (!found) return null;
    const start = nextEventStart(
      found.event,
      found.overrides,
      row.minutesBefore,
      now,
      ctx.timeZone,
      row.lastFiredFor
    );
    return start ? start.getTime() - offset : null;
  }
  if (!row.taskDueDate) return null;
  const anchor = taskAnchor(row.taskDueDate, row.taskDueTime, ctx.timeZone).getTime();
  if (anchor === row.lastFiredFor) return null;
  const fireAt = anchor - offset;
  return fireAt > now.getTime() - GRACE_MS ? fireAt : null;
}

function save(ctx: Ctx, id: string, data: Partial<ReminderRow>) {
  ctx.db
    .update(reminders)
    .set({ ...data, updatedAt: Date.now() })
    .where(eq(reminders.id, id))
    .run();
}

/** Recalcula os lembretes de um evento ou tarefa, depois de criar, editar ou concluir. */
export function refreshOwner(ctx: Ctx, kind: 'EVENT' | 'TASK', ownerId: string, now = new Date()) {
  const rows = ctx.db
    .select()
    .from(reminders)
    .where(and(eq(reminders.kind, kind), eq(reminders.ownerId, ownerId), alive))
    .all();
  const title =
    kind === 'EVENT' ? eventRows(ctx, ownerId)?.event.title : undefined;
  for (const row of rows) {
    save(ctx, row.id, {
      nextFireAt: computeNextFire(ctx, row, now),
      ...(title ? { title } : {}),
    });
  }
}

/** Os alertas de um evento são a lista de minutos que vem do formulário. */
export function setEventReminders(ctx: Ctx, eventId: string, title: string, minutes: number[]) {
  const wanted = new Set(minutes);
  const rows = ctx.db
    .select()
    .from(reminders)
    .where(and(eq(reminders.kind, 'EVENT'), eq(reminders.ownerId, eventId), alive))
    .all();
  for (const row of rows) {
    if (!wanted.delete(row.minutesBefore)) {
      save(ctx, row.id, { deletedAt: Date.now(), nextFireAt: null });
    }
  }
  for (const minutesBefore of wanted) {
    ctx.db
      .insert(reminders)
      .values({ ...stamp(), kind: 'EVENT', ownerId: eventId, title, minutesBefore })
      .run();
  }
  refreshOwner(ctx, 'EVENT', eventId);
}

export function remindersByEvent(ctx: Ctx, ids: string[]) {
  const map = new Map<string, number[]>();
  if (!ids.length) return map;
  const rows = ctx.db
    .select({ ownerId: reminders.ownerId, minutes: reminders.minutesBefore })
    .from(reminders)
    .where(and(eq(reminders.kind, 'EVENT'), inArray(reminders.ownerId, ids), alive))
    .all();
  for (const row of rows) {
    const list = map.get(row.ownerId!) ?? [];
    list.push(row.minutes);
    map.set(
      row.ownerId!,
      list.sort((a, b) => a - b)
    );
  }
  return map;
}

export function deleteOwnerReminders(ctx: Ctx, kind: 'EVENT' | 'TASK', ids: string[]) {
  if (!ids.length) return;
  ctx.db
    .update(reminders)
    .set({ deletedAt: Date.now(), updatedAt: Date.now(), nextFireAt: null })
    .where(and(eq(reminders.kind, kind), inArray(reminders.ownerId, ids), alive))
    .run();
}

// ---------------------------------------------------------------- tela

export type ReminderState = 'ACTIVE' | 'PAUSED' | 'DONE';

function toResponse(row: ReminderRow) {
  const state: ReminderState = row.pausedAt ? 'PAUSED' : row.nextFireAt ? 'ACTIVE' : 'DONE';
  return {
    id: row.id,
    kind: row.kind,
    ownerId: row.ownerId,
    title: row.title,
    notes: row.notes,
    minutesBefore: row.minutesBefore,
    schedule: row.schedule,
    startDate: row.startDate,
    time: row.time,
    intervalHours: row.intervalHours,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    description:
      row.kind === 'CUSTOM' ? describeSchedule(customRule(row)) : alertLabel(row.minutesBefore),
    nextFireAt: row.nextFireAt ? new Date(row.nextFireAt).toISOString() : null,
    lastFiredFor: row.lastFiredFor ? new Date(row.lastFiredFor).toISOString() : null,
    state,
  };
}

export type ReminderResponse = ReturnType<typeof toResponse>;

export function listReminders(ctx: Ctx) {
  const rank = { ACTIVE: 0, PAUSED: 1, DONE: 2 };
  return ctx.db
    .select()
    .from(reminders)
    .where(alive)
    .all()
    .map(toResponse)
    .sort(
      (a, b) =>
        rank[a.state] - rank[b.state] ||
        (a.nextFireAt ?? '').localeCompare(b.nextFireAt ?? '') ||
        a.title.localeCompare(b.title, 'pt-BR')
    );
}

function find(ctx: Ctx, id: string) {
  const row = ctx.db
    .select()
    .from(reminders)
    .where(and(eq(reminders.id, id), alive))
    .get();
  if (!row) throw notFound('Lembrete não encontrado.');
  return row;
}

const customValues = (body: CustomReminder) => ({
  title: body.title,
  notes: body.notes ?? null,
  schedule: body.schedule,
  startDate: body.startDate,
  time: body.time ?? null,
  intervalHours: body.intervalHours ?? null,
  windowStart: body.windowStart ?? null,
  windowEnd: body.windowEnd ?? null,
});

function reschedule(ctx: Ctx, id: string) {
  const row = find(ctx, id);
  const nextFireAt = computeNextFire(ctx, row, new Date());
  save(ctx, id, { nextFireAt });
  return toResponse({ ...row, nextFireAt });
}

/** Lembrete que nunca tocaria não chega a existir: o erro desfaz a linha. */
function insertScheduled(ctx: Ctx, values: typeof reminders.$inferInsert & { id: string }) {
  return ctx.db.transaction(() => {
    ctx.db.insert(reminders).values(values).run();
    const created = reschedule(ctx, values.id);
    if (!created.nextFireAt) throw new AppError(400, 'Esse horário já passou.');
    return created;
  });
}

export function createCustom(ctx: Ctx, body: CustomReminder) {
  return insertScheduled(ctx, { ...stamp(), kind: 'CUSTOM', ...customValues(body) });
}

function assertFree(ctx: Ctx, kind: 'EVENT' | 'TASK', ownerId: string, minutes: number) {
  const taken = ctx.db
    .select({ id: reminders.id })
    .from(reminders)
    .where(
      and(
        eq(reminders.kind, kind),
        eq(reminders.ownerId, ownerId),
        eq(reminders.minutesBefore, minutes),
        alive
      )
    )
    .get();
  if (taken) throw new AppError(409, 'Já existe esse lembrete.');
}

export function createForEvent(ctx: Ctx, body: { eventId: string; minutesBefore: number }) {
  const found = eventRows(ctx, body.eventId);
  if (!found) throw notFound('Evento não encontrado.');
  assertFree(ctx, 'EVENT', body.eventId, body.minutesBefore);
  return insertScheduled(ctx, {
    ...stamp(),
    kind: 'EVENT',
    ownerId: body.eventId,
    title: found.event.title,
    minutesBefore: body.minutesBefore,
  });
}

export function createForTask(
  ctx: Ctx,
  body: {
    taskId: string;
    title: string;
    dueDate: string;
    dueTime?: string | null;
    minutesBefore: number;
  }
) {
  assertFree(ctx, 'TASK', body.taskId, body.minutesBefore);
  return insertScheduled(ctx, {
    ...stamp(),
    kind: 'TASK',
    ownerId: body.taskId,
    title: body.title,
    minutesBefore: body.minutesBefore,
    taskDueDate: body.dueDate,
    taskDueTime: body.dueTime ?? null,
  });
}

export function updateCustom(ctx: Ctx, id: string, body: CustomReminder) {
  const row = find(ctx, id);
  if (row.kind !== 'CUSTOM') throw new AppError(400, 'Esse lembrete segue o evento ou a tarefa.');
  save(ctx, id, customValues(body));
  return reschedule(ctx, id);
}

export function pauseReminder(ctx: Ctx, id: string) {
  find(ctx, id);
  save(ctx, id, { pausedAt: Date.now(), nextFireAt: null });
  return toResponse(find(ctx, id));
}

export function resumeReminder(ctx: Ctx, id: string) {
  find(ctx, id);
  save(ctx, id, { pausedAt: null });
  return reschedule(ctx, id);
}

export function deleteReminder(ctx: Ctx, id: string) {
  find(ctx, id);
  save(ctx, id, { deletedAt: Date.now(), nextFireAt: null });
}

// ---------------------------------------------------------------- job

function messageFor(ctx: Ctx, row: ReminderRow, start: Date) {
  if (row.kind === 'CUSTOM') {
    return { title: row.title, body: row.notes ?? 'Lembrete' };
  }
  if (row.kind === 'TASK') {
    return {
      title: row.title,
      body: row.taskDueTime
        ? `Tarefa para ${timeOf(start.toISOString(), ctx.timeZone)}`
        : 'Tarefa para hoje',
    };
  }
  const found = eventRows(ctx, row.ownerId!);
  if (!found) return null;
  const { event } = found;
  const lead = leadText(row.minutesBefore);
  return {
    title: event.title,
    body: event.allDay
      ? `Dia inteiro, ${lead}`
      : `${timeOf(start.toISOString(), ctx.timeZone)} · ${lead}${event.location ? ` · ${event.location}` : ''}`,
  };
}

/**
 * Tarefa recorrente concluída passa o lembrete à próxima da série, e a reaberta o recebe de volta
 * quando a próxima sai. Devolve `null` se a tarefa de destino já tem esse lembrete.
 */
function followSeries(ctx: AppCtx, row: ReminderRow): ReminderRow | null {
  let ownerId = row.ownerId!;
  let task = readTask(ctx, ownerId);
  if (task === 'gone') {
    ownerId = taskSeries(ctx, ownerId).previousTaskId ?? ownerId;
    task = readTask(ctx, ownerId);
  }
  while (task && task !== 'gone' && task.done) {
    const next = taskSeries(ctx, ownerId).nextTaskId;
    const following = next ? readTask(ctx, next) : 'gone';
    if (!following || following === 'gone') break;
    ownerId = next!;
    task = following;
  }
  if (ownerId === row.ownerId) return row;
  const taken = ctx.db
    .select({ id: reminders.id })
    .from(reminders)
    .where(
      and(
        eq(reminders.kind, 'TASK'),
        eq(reminders.ownerId, ownerId),
        eq(reminders.minutesBefore, row.minutesBefore),
        alive
      )
    )
    .get();
  if (taken) {
    save(ctx, row.id, { deletedAt: Date.now(), nextFireAt: null });
    return null;
  }
  save(ctx, row.id, { ownerId });
  return { ...row, ownerId };
}

/**
 * O módulo de Tarefas não avisa quando uma tarefa muda: a cada passada, os lembretes de tarefa
 * conferem a cópia do prazo. Tarefa apagada leva o lembrete junto.
 */
function syncTaskReminders(ctx: AppCtx, now: Date) {
  const rows = ctx.db
    .select()
    .from(reminders)
    .where(and(eq(reminders.kind, 'TASK'), isNull(reminders.pausedAt), alive))
    .all();
  for (const original of rows) {
    const row = followSeries(ctx, original);
    if (!row) continue;
    const task = readTask(ctx, row.ownerId!);
    if (task === undefined) continue;
    if (task === 'gone') {
      save(ctx, row.id, { deletedAt: Date.now(), nextFireAt: null });
      continue;
    }
    if (task.done || !task.dueDate) {
      if (row.nextFireAt) save(ctx, row.id, { nextFireAt: null });
      continue;
    }
    const moved = task.dueDate !== row.taskDueDate || task.dueTime !== row.taskDueTime;
    if (!moved && task.title === row.title && row.nextFireAt) continue;
    const updated = {
      ...row,
      title: task.title,
      taskDueDate: task.dueDate,
      taskDueTime: task.dueTime,
    };
    // Sem mudança de prazo, o horário marcado segue valendo, mesmo já vencido.
    const nextFireAt = moved || !row.nextFireAt ? computeNextFire(ctx, updated, now) : row.nextFireAt;
    save(ctx, row.id, {
      title: task.title,
      taskDueDate: task.dueDate,
      taskDueTime: task.dueTime,
      nextFireAt,
    });
  }
}

/**
 * Marca antes de avisar: o aviso que falha não fica repetindo a cada minuto, e a marca e o próximo
 * horário entram na mesma escrita, para um lembrete nunca ficar sem próximo.
 */
export function runReminders(ctx: AppCtx, now = new Date()) {
  syncTaskReminders(ctx, now);
  const due = ctx.db
    .select()
    .from(reminders)
    .where(and(lte(reminders.nextFireAt, now.getTime()), isNull(reminders.pausedAt), alive))
    .limit(200)
    .all();
  let sent = 0;

  for (const row of due) {
    const fireAt = row.nextFireAt!;
    const start = new Date(fireAt + row.minutesBefore * 60_000);
    const marked = { ...row, lastFiredFor: start.getTime() };
    save(ctx, row.id, {
      lastFiredFor: marked.lastFiredFor,
      nextFireAt: computeNextFire(ctx, marked, new Date(now.getTime() + 1000)),
    });

    if (now.getTime() - fireAt > STALE_MS) continue;
    const message = messageFor(ctx, row, start);
    if (!message) continue;
    try {
      ctx.notify(message.title, message.body);
      sent++;
    } catch (error) {
      console.error('[lembretes] aviso falhou', error);
    }
  }
  return sent;
}
