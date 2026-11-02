import {
  addDays,
  diffInDays,
  eventOccurrences,
  startOfDayInZone,
} from '@sektor/finance-engine';
import { and, eq, inArray, isNotNull, isNull, or, gt, lt } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { AppError, notFound, stamp } from '../../services/context';
import {
  deleteOwnerReminders,
  refreshOwner,
  remindersByEvent,
  setEventReminders,
} from '../reminders/service';

import type { CreateEvent, EventScope, Tone, UpdateEvent } from './contract';
import { type Range, endOf, expandSeries, occurrenceOf, startOf } from './expand';
import { type CalendarRow, calendars, type EventRow, events } from './schema';
import { compareOccurrences, type EventOccurrence } from './view';

type Ctx = Pick<AppCtx, 'db' | 'timeZone'>;

export const readOnly = () =>
  new AppError(400, 'Esta agenda é só de leitura: mude o evento na agenda de origem.');

// ---------------------------------------------------------------- calendários

const liveCalendar = isNull(calendars.deletedAt);

/** O primeiro uso cria o calendário padrão: evento sempre mora em algum. */
export function ensureLocalCalendar(ctx: Ctx): CalendarRow {
  const existing = ctx.db
    .select()
    .from(calendars)
    .where(and(eq(calendars.source, 'LOCAL'), liveCalendar))
    .orderBy(calendars.createdAt)
    .get();
  if (existing) return existing;
  return ctx.db
    .insert(calendars)
    .values({ ...stamp(), name: 'Pessoal', color: 'blue', source: 'LOCAL' })
    .returning()
    .get();
}

function toCalendar(row: CalendarRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    source: row.source,
    host: row.host,
    selected: row.selected,
    syncedAt: row.syncedAt ? new Date(row.syncedAt).toISOString() : null,
    lastError: row.lastError,
    readOnly: row.source !== 'LOCAL',
  };
}

export type CalendarResponse = ReturnType<typeof toCalendar>;

export function listCalendars(ctx: Ctx) {
  ensureLocalCalendar(ctx);
  return ctx.db
    .select()
    .from(calendars)
    .where(liveCalendar)
    .orderBy(calendars.createdAt)
    .all()
    .map(toCalendar);
}

export function createCalendar(ctx: Ctx, body: { name: string; color: Tone }) {
  return toCalendar(
    ctx.db
      .insert(calendars)
      .values({ ...stamp(), ...body, source: 'LOCAL' })
      .returning()
      .get()
  );
}

export function findCalendar(ctx: Ctx, id: string) {
  const row = ctx.db
    .select()
    .from(calendars)
    .where(and(eq(calendars.id, id), liveCalendar))
    .get();
  if (!row) throw notFound('Calendário');
  return row;
}

export function updateCalendar(
  ctx: Ctx,
  id: string,
  body: { name?: string; color?: Tone; selected?: boolean }
) {
  findCalendar(ctx, id);
  ctx.db
    .update(calendars)
    .set({ ...body, updatedAt: Date.now() })
    .where(eq(calendars.id, id))
    .run();
  return toCalendar(findCalendar(ctx, id));
}

/** Apaga os eventos do calendário. Sobra a linha do calendário, para quem chama decidir. */
export function deleteCalendarEvents(ctx: Ctx, calendarId: string) {
  const ids = ctx.db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.calendarId, calendarId), isNull(events.deletedAt)))
    .all()
    .map((row) => row.id);
  deleteOwnerReminders(ctx, 'EVENT', ids);
  ctx.db
    .update(events)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(events.calendarId, calendarId), isNull(events.deletedAt)))
    .run();
}

export function deleteCalendar(ctx: Ctx, id: string) {
  const row = findCalendar(ctx, id);
  const locals = ctx.db
    .select({ id: calendars.id })
    .from(calendars)
    .where(and(eq(calendars.source, 'LOCAL'), liveCalendar))
    .all();
  if (row.source === 'LOCAL' && locals.length === 1) {
    throw new AppError(400, 'Fica pelo menos um calendário no Sektor.');
  }
  deleteCalendarEvents(ctx, id);
  ctx.db
    .update(calendars)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(calendars.id, id))
    .run();
}

// ---------------------------------------------------------------- ocorrências

function rangeOf(ctx: Ctx, fromDay: string, toDay: string): Range {
  return {
    fromDay,
    toDay,
    from: startOfDayInZone(fromDay, ctx.timeZone),
    to: startOfDayInZone(toDay, ctx.timeZone),
  };
}

/** Todas as ocorrências dos calendários marcados que se sobrepõem a [from, to), em dias do fuso. */
export function listOccurrences(ctx: Ctx, query: { from: string; to: string }): EventOccurrence[] {
  ensureLocalCalendar(ctx);
  const range = rangeOf(ctx, query.from, query.to);
  const visible = ctx.db
    .select({ id: calendars.id })
    .from(calendars)
    .where(and(eq(calendars.selected, true), liveCalendar))
    .all()
    .map((row) => row.id);
  if (!visible.length) return [];

  const roots = and(
    inArray(events.calendarId, visible),
    isNull(events.deletedAt),
    isNull(events.recurringEventId),
    eq(events.status, 'CONFIRMED')
  );
  const singles = ctx.db
    .select()
    .from(events)
    .where(
      and(
        roots,
        isNull(events.rrule),
        or(
          and(eq(events.allDay, false), lt(events.startAt, range.to.getTime()), gt(events.endAt, range.from.getTime())),
          and(eq(events.allDay, true), lt(events.startDate, range.toDay), gt(events.endDate, range.fromDay))
        )
      )
    )
    .all();
  const masters = ctx.db
    .select()
    .from(events)
    .where(
      and(
        roots,
        isNotNull(events.rrule),
        or(lt(events.startAt, range.to.getTime()), lt(events.startDate, range.toDay))
      )
    )
    .all();
  const overrides = masters.length
    ? ctx.db
        .select()
        .from(events)
        .where(
          and(
            inArray(events.recurringEventId, masters.map((m) => m.id)),
            isNull(events.deletedAt)
          )
        )
        .all()
    : [];
  const reminders = remindersByEvent(ctx, [...singles, ...masters].map((e) => e.id));

  const result = singles.map((event) =>
    occurrenceOf(
      event,
      startOf(event),
      endOf(event),
      startOf(event),
      null,
      reminders.get(event.id) ?? []
    )
  );
  for (const master of masters) {
    const mine = overrides.filter((o) => o.recurringEventId === master.id);
    result.push(...expandSeries(master, mine, range, ctx.timeZone, reminders.get(master.id)));
  }
  return result.sort(compareOccurrences);
}

// ---------------------------------------------------------------- eventos

function assertRRule(rrule: string | null | undefined) {
  if (!rrule) return;
  try {
    const now = new Date();
    eventOccurrences(rrule, now, now, new Date(now.getTime() + 86_400_000), 'UTC');
  } catch {
    throw new AppError(400, 'Regra de repetição inválida.');
  }
}

/** As quatro colunas de horário. Dia inteiro: o fim fica ao menos no dia seguinte. */
function timesOf(allDay: boolean, startAt: string, endAt: string) {
  if (allDay) {
    const startDate = startAt.slice(0, 10);
    const end = endAt.slice(0, 10);
    return {
      startDate,
      endDate: end > startDate ? end : addDays(startDate, 1),
      startAt: null,
      endAt: null,
    };
  }
  return {
    startAt: new Date(startAt).getTime(),
    endAt: new Date(endAt).getTime(),
    startDate: null,
    endDate: null,
  };
}

function findEvent(ctx: Ctx, id: string) {
  const row = ctx.db
    .select()
    .from(events)
    .where(and(eq(events.id, id), isNull(events.deletedAt)))
    .get();
  if (!row) throw notFound('Evento');
  return row;
}

function toEvent(ctx: Ctx, row: EventRow) {
  return {
    id: row.id,
    calendarId: row.calendarId,
    title: row.title,
    notes: row.notes,
    location: row.location,
    allDay: row.allDay,
    startAt: startOf(row),
    endAt: endOf(row),
    color: row.color,
    rrule: row.rrule,
    source: row.source,
    reminders: remindersByEvent(ctx, [row.id]).get(row.id) ?? [],
  };
}

export const getEvent = (ctx: Ctx, id: string) => toEvent(ctx, findEvent(ctx, id));

export function createEvent(ctx: Ctx, body: CreateEvent) {
  const calendar = body.calendarId ? findCalendar(ctx, body.calendarId) : ensureLocalCalendar(ctx);
  if (calendar.source !== 'LOCAL') throw readOnly();
  assertRRule(body.rrule);
  const allDay = body.allDay ?? false;
  const row = ctx.db
    .insert(events)
    .values({
      ...stamp(),
      calendarId: calendar.id,
      title: body.title,
      notes: body.notes ?? null,
      location: body.location ?? null,
      allDay,
      ...timesOf(allDay, body.startAt, body.endAt),
      color: body.color ?? null,
      rrule: body.rrule ?? null,
    })
    .returning()
    .get();
  if (body.reminders?.length) setEventReminders(ctx, row.id, row.title, body.reminders);
  return toEvent(ctx, row);
}

const textFields = (body: UpdateEvent) => ({
  ...(body.title !== undefined && { title: body.title }),
  ...(body.notes !== undefined && { notes: body.notes }),
  ...(body.location !== undefined && { location: body.location }),
  ...(body.color !== undefined && { color: body.color }),
});

function overrideFor(ctx: Ctx, masterId: string, original: string) {
  return ctx.db
    .select()
    .from(events)
    .where(
      and(
        eq(events.recurringEventId, masterId),
        eq(events.originalStart, original),
        isNull(events.deletedAt)
      )
    )
    .get();
}

function assertOccurrence(event: EventRow, original: string | undefined): string {
  if (!original) throw new AppError(400, 'Informe a ocorrência.');
  const valid = event.allDay ? /^\d{4}-\d{2}-\d{2}$/ : /T/;
  if (!valid.test(original) || Number.isNaN(new Date(original).getTime())) {
    throw new AppError(400, 'Ocorrência inválida.');
  }
  return event.allDay ? original : new Date(original).toISOString();
}

/** Horários da ocorrência `original` com a duração da série. */
function occurrenceEnd(event: EventRow, original: string) {
  if (event.allDay) return addDays(original, diffInDays(event.startDate!, event.endDate!));
  return new Date(new Date(original).getTime() + event.endAt! - event.startAt!).toISOString();
}

function updateSingle(ctx: Ctx, event: EventRow, body: UpdateEvent, occurrence: string) {
  const original = assertOccurrence(event, occurrence);
  const allDay = body.allDay ?? event.allDay;
  const times = timesOf(
    allDay,
    body.startAt ?? original,
    body.endAt ?? occurrenceEnd(event, original)
  );
  const existing = overrideFor(ctx, event.id, original);
  const row = existing
    ? ctx.db
        .update(events)
        .set({ ...textFields(body), allDay, ...times, status: 'CONFIRMED', updatedAt: Date.now() })
        .where(eq(events.id, existing.id))
        .returning()
        .get()
    : ctx.db
        .insert(events)
        .values({
          ...stamp(),
          calendarId: event.calendarId,
          title: event.title,
          notes: event.notes,
          location: event.location,
          color: event.color,
          source: event.source,
          ...textFields(body),
          allDay,
          ...times,
          recurringEventId: event.id,
          originalStart: original,
        })
        .returning()
        .get();
  refreshOwner(ctx, 'EVENT', event.id);
  return toEvent(ctx, row);
}

/** A série mudou de horário: cada exceção segue presa à ocorrência dela. */
function moveOverrides(ctx: Ctx, event: EventRow, next: { startAt: number | null; startDate: string | null }) {
  const overrides = ctx.db
    .select()
    .from(events)
    .where(and(eq(events.recurringEventId, event.id), isNull(events.deletedAt)))
    .all();
  for (const override of overrides) {
    const original = override.originalStart!;
    const moved = event.allDay
      ? next.startDate && addDays(original, diffInDays(event.startDate!, next.startDate))
      : next.startAt &&
        new Date(new Date(original).getTime() + next.startAt - event.startAt!).toISOString();
    if (!moved) {
      // Virou (ou deixou de ser) dia inteiro: a exceção não tem mais a que se prender.
      ctx.db
        .update(events)
        .set({ deletedAt: Date.now(), updatedAt: Date.now() })
        .where(eq(events.id, override.id))
        .run();
    } else {
      ctx.db
        .update(events)
        .set({ originalStart: moved, updatedAt: Date.now() })
        .where(eq(events.id, override.id))
        .run();
    }
  }
}

export function updateEvent(ctx: Ctx, id: string, body: UpdateEvent & { scope?: EventScope }) {
  const event = findEvent(ctx, id);
  if (event.source !== 'LOCAL') throw readOnly();
  if (body.calendarId !== undefined && body.calendarId !== event.calendarId) {
    const target = findCalendar(ctx, body.calendarId);
    if (target.source !== 'LOCAL') throw readOnly();
  }
  assertRRule(body.rrule);

  if (event.rrule && body.scope === 'single') {
    return updateSingle(ctx, event, body, body.occurrenceStart ?? '');
  }

  const allDay = body.allDay ?? event.allDay;
  const timesChanged = body.startAt || body.endAt || allDay !== event.allDay;
  if (timesChanged && allDay !== event.allDay && !(body.startAt && body.endAt)) {
    throw new AppError(400, 'Informe início e fim.');
  }
  const times = timesChanged
    ? timesOf(allDay, body.startAt ?? startOf(event), body.endAt ?? endOf(event))
    : null;
  if (times && !allDay && times.endAt! < times.startAt!) {
    throw new AppError(400, 'O fim precisa ser depois do início.');
  }

  if (event.rrule && body.rrule === null) {
    // Deixou de repetir: as exceções somem junto com a série.
    ctx.db
      .update(events)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(events.recurringEventId, id), isNull(events.deletedAt)))
      .run();
  } else if (event.rrule && times) {
    const sameKind = allDay === event.allDay;
    moveOverrides(ctx, event, {
      startAt: sameKind ? times.startAt : null,
      startDate: sameKind ? times.startDate : null,
    });
  }

  const row = ctx.db
    .update(events)
    .set({
      ...textFields(body),
      allDay,
      ...(times ?? {}),
      ...(body.calendarId !== undefined && { calendarId: body.calendarId }),
      ...(body.rrule !== undefined && { rrule: body.rrule }),
      updatedAt: Date.now(),
    })
    .where(eq(events.id, id))
    .returning()
    .get();
  if (body.reminders) setEventReminders(ctx, id, row.title, body.reminders);
  else refreshOwner(ctx, 'EVENT', id);
  return toEvent(ctx, row);
}

export function deleteEvent(
  ctx: Ctx,
  id: string,
  query: { scope?: EventScope; occurrenceStart?: string }
) {
  const event = findEvent(ctx, id);
  if (event.source !== 'LOCAL') throw readOnly();

  if (event.rrule && query.scope === 'single') {
    const original = assertOccurrence(event, query.occurrenceStart);
    const existing = overrideFor(ctx, event.id, original);
    if (existing) {
      ctx.db
        .update(events)
        .set({ status: 'CANCELLED', updatedAt: Date.now() })
        .where(eq(events.id, existing.id))
        .run();
    } else {
      ctx.db
        .insert(events)
        .values({
          ...stamp(),
          calendarId: event.calendarId,
          title: event.title,
          allDay: event.allDay,
          ...timesOf(event.allDay, original, occurrenceEnd(event, original)),
          status: 'CANCELLED',
          source: event.source,
          recurringEventId: event.id,
          originalStart: original,
        })
        .run();
    }
    refreshOwner(ctx, 'EVENT', event.id);
    return;
  }

  deleteOwnerReminders(ctx, 'EVENT', [id]);
  ctx.db
    .update(events)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(or(eq(events.id, id), eq(events.recurringEventId, id)))
    .run();
}

