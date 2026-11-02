import { addDays, wallTimeToInstant } from '@sektor/finance-engine';
import { and, asc, eq, gte, inArray, isNotNull, isNull, like, ne, or, sql } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { assertRRule } from '../agenda/rrule';
import { type CalendarRow, calendars, type EventRow, events } from '../agenda/schema';
import { defaultCalendar, deleteCalendarEvents, setDefaultCalendar } from '../agenda/service';
import { type Tone, TONES } from '../agenda/contract';
import { deleteOwnerReminders, refreshOwner } from '../reminders/service';
import { stamp } from '../../services/context';

import {
  GoogleApiError,
  GoogleAuthError,
  googleFetch,
  isAccountWide,
  isNotFound,
} from './client';

const API = 'https://www.googleapis.com/calendar/v3';
/** Leitura completa traz a partir de 180 dias atrás. */
const LOOKBACK_DAYS = 180;
const DAY = 86_400_000;
const HOUR = 3_600_000;
/** Exclusão que veio de um EXDATE do mestre, e não de uma instância do Google. */
const EXDATE_MARK = '#ex:';

interface GoogleDate {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDate;
  end?: GoogleDate;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: GoogleDate;
}

interface CalendarListEntry {
  id: string;
  summary: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

const enc = (value: string) => encodeURIComponent(value);
const pendingStates = inArray(events.syncState, ['PENDING', 'ERROR']);

// ---------------------------------------------------------------- calendários

/** Matiz de cada tom do tema, para escolher o mais perto da cor do Google na primeira leitura. */
const HUES: Record<Tone, number> = {
  rose: 340,
  orange: 20,
  amber: 45,
  green: 130,
  cyan: 190,
  blue: 220,
  violet: 280,
};

export function toneOf(hex: string | undefined): Tone {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '');
  if (!match) return 'blue';
  const [r, g, b] = match.slice(1).map((part) => parseInt(part, 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const span = max - Math.min(r, g, b);
  if (span < 0.08) return 'blue';
  const sextant =
    max === r ? ((g - b) / span + 6) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  const hue = sextant * 60;
  const gap = (tone: Tone) => {
    const delta = Math.abs(HUES[tone] - hue);
    return Math.min(delta, 360 - delta);
  };
  return [...TONES].sort((x, y) => gap(x) - gap(y))[0]!;
}

function removeCalendar(ctx: AppCtx, row: CalendarRow) {
  deleteCalendarEvents(ctx, row.id);
  ctx.db
    .update(calendars)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(calendars.id, row.id))
    .run();
}

export const calendarsOf = (ctx: AppCtx, accountId: string) =>
  ctx.db
    .select()
    .from(calendars)
    .where(
      and(
        eq(calendars.source, 'GOOGLE'),
        eq(calendars.externalAccount, accountId),
        isNull(calendars.deletedAt)
      )
    )
    .orderBy(asc(calendars.createdAt))
    .all();

/** Só o primeiro principal entra no padrão: a escolha da pessoa continua valendo. */
function adoptDefault(ctx: AppCtx, accountId: string) {
  if (defaultCalendar(ctx).source !== 'LOCAL') return;
  const primary = calendarsOf(ctx, accountId).find((row) => row.isPrimary && !row.readOnly);
  if (primary) setDefaultCalendar(ctx, primary.id);
}

/** Lista da conta. Calendário que já vem de outra conta chega desmarcado. A cor nunca volta do Google. */
export async function syncCalendarList(ctx: AppCtx, accountId: string) {
  const items: CalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const page = await googleFetch<{ items?: CalendarListEntry[]; nextPageToken?: string }>(
      ctx,
      accountId,
      `${API}/users/me/calendarList`,
      { query: { minAccessRole: 'reader', pageToken } }
    );
    items.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);

  const known = calendarsOf(ctx, accountId);
  const firstRead = known.length === 0;
  for (const item of items) {
    const name = item.summaryOverride ?? item.summary;
    const primary = Boolean(item.primary);
    const readOnly = item.accessRole === 'reader' || item.accessRole === 'freeBusyReader';
    const current = known.find((row) => row.externalId === item.id);
    if (current) {
      ctx.db
        .update(calendars)
        .set({ name, isPrimary: primary, readOnly, updatedAt: Date.now() })
        .where(eq(calendars.id, current.id))
        .run();
      continue;
    }
    const elsewhere = ctx.db
      .select({ id: calendars.id })
      .from(calendars)
      .where(
        and(
          eq(calendars.source, 'GOOGLE'),
          eq(calendars.externalId, item.id),
          ne(calendars.externalAccount, accountId),
          isNull(calendars.deletedAt)
        )
      )
      .get();
    ctx.db
      .insert(calendars)
      .values({
        ...stamp(),
        name,
        color: toneOf(item.backgroundColor),
        source: 'GOOGLE',
        externalId: item.id,
        externalAccount: accountId,
        isPrimary: primary,
        readOnly,
        selected: primary && !elsewhere,
      })
      .run();
  }
  const seen = new Set(items.map((item) => item.id));
  for (const row of known) if (!seen.has(row.externalId!)) removeCalendar(ctx, row);
  if (firstRead) adoptDefault(ctx, accountId);
}

// ---------------------------------------------------------------- Google -> Sektor

type Moment = { allDay: true; date: string } | { allDay: false; at: number };

function momentOf(value: GoogleDate | undefined): Moment | null {
  if (value?.dateTime) return { allDay: false, at: new Date(value.dateTime).getTime() };
  if (value?.date) return { allDay: true, date: value.date };
  return null;
}

/** A chave da ocorrência, na forma que `expandSeries` usa. */
const originalKey = (moment: Moment) =>
  moment.allDay ? moment.date : new Date(moment.at).toISOString();

function times(start: Moment, end: Moment | null, spanMs = HOUR) {
  if (start.allDay) {
    const endDate = end?.allDay && end.date > start.date ? end.date : addDays(start.date, 1);
    return { allDay: true, startDate: start.date, endDate, startAt: null, endAt: null };
  }
  const endAt = end && !end.allDay && end.at >= start.at ? end.at : start.at + spanMs;
  return { allDay: false, startAt: start.at, endAt, startDate: null, endDate: null };
}

function ruleOf(recurrence: string[] | undefined): string | null {
  const rule = recurrence?.find((line) => line.startsWith('RRULE:'))?.slice('RRULE:'.length);
  if (!rule) return null;
  try {
    assertRRule(rule);
    return rule;
  } catch {
    // Regra que o motor não entende vira um evento só: melhor que derrubar a agenda inteira.
    return null;
  }
}

/** As datas de EXDATE, como chaves de ocorrência. */
export function parseExdates(lines: string[], fallbackZone: string): string[] {
  const result: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('EXDATE')) continue;
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const zone = /TZID=([^;:]+)/.exec(line.slice(0, separator))?.[1] ?? fallbackZone;
    for (const value of line.slice(separator + 1).split(',')) {
      const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
      if (date) {
        result.push(`${date[1]}-${date[2]}-${date[3]}`);
        continue;
      }
      const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
      if (!stamp) continue;
      const [year, month, day, hour, minute, second] = stamp.slice(1, 7).map(Number) as [
        number, number, number, number, number, number,
      ];
      result.push(
        stamp[7]
          ? new Date(Date.UTC(year, month - 1, day, hour, minute, second)).toISOString()
          : wallTimeToInstant({ year, month, day, hour, minute, second }, zone).toISOString()
      );
    }
  }
  return result;
}

/** Linha viva ou apagada que ainda não subiu. Apagada e enviada não volta a existir por aqui. */
function findExisting(ctx: AppCtx, calendarId: string, externalId: string) {
  return ctx.db
    .select()
    .from(events)
    .where(
      and(
        eq(events.calendarId, calendarId),
        eq(events.externalId, externalId),
        or(isNull(events.deletedAt), pendingStates)
      )
    )
    .orderBy(sql`${events.deletedAt} IS NOT NULL`)
    .get();
}

const overrideAt = (ctx: AppCtx, masterId: string, original: string) =>
  ctx.db
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

function softDelete(ctx: AppCtx, row: EventRow) {
  const now = Date.now();
  const overrides = ctx.db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.recurringEventId, row.id), isNull(events.deletedAt)))
    .all()
    .map((o) => o.id);
  const ids = [row.id, ...overrides];
  if (!row.recurringEventId) deleteOwnerReminders(ctx, 'EVENT', ids);
  ctx.db
    .update(events)
    .set({ deletedAt: now, updatedAt: now, syncState: 'SYNCED' })
    .where(inArray(events.id, ids))
    .run();
}

function applyExdates(ctx: AppCtx, calendar: CalendarRow, master: EventRow, remoteId: string, lines: string[]) {
  const wanted = new Set(parseExdates(lines, master.timeZone ?? ctx.timeZone));
  const mark = `${remoteId}${EXDATE_MARK}`;
  const stale = ctx.db
    .select()
    .from(events)
    .where(
      and(
        eq(events.recurringEventId, master.id),
        like(events.externalId, `${mark}%`),
        isNull(events.deletedAt),
        eq(events.syncState, 'SYNCED')
      )
    )
    .all()
    .filter((row) => !wanted.has(row.originalStart!));
  for (const row of stale) softDelete(ctx, row);
  for (const original of wanted) {
    if (overrideAt(ctx, master.id, original)) continue;
    const start: Moment = master.allDay
      ? { allDay: true, date: original }
      : { allDay: false, at: new Date(original).getTime() };
    const span = master.allDay ? DAY : master.endAt! - master.startAt!;
    ctx.db
      .insert(events)
      .values({
        ...stamp(),
        calendarId: calendar.id,
        title: master.title,
        ...times(start, null, span),
        status: 'CANCELLED',
        source: 'GOOGLE',
        externalId: `${mark}${original}`,
        recurringEventId: master.id,
        originalStart: original,
      })
      .run();
  }
}

/** Mudança local pendente vence: o que vier do Google para esta linha fica de fora. */
function applyRemote(ctx: AppCtx, calendar: CalendarRow, item: GoogleEvent) {
  const master = item.recurringEventId
    ? findExisting(ctx, calendar.id, item.recurringEventId)
    : undefined;
  if (item.recurringEventId && (!master || master.deletedAt)) return;

  const original = momentOf(item.originalStartTime);
  const key = master ? (original ? originalKey(original) : null) : null;
  const existing =
    findExisting(ctx, calendar.id, item.id) ??
    (master && key ? overrideAt(ctx, master.id, key) : undefined);
  if (existing && existing.syncState !== 'SYNCED') return;

  if (item.status === 'cancelled' && !master) {
    if (existing) softDelete(ctx, existing);
    return;
  }

  const start = momentOf(item.start) ?? original;
  if (!start) return;
  const span = master && !master.allDay ? master.endAt! - master.startAt! : HOUR;
  const rrule = master ? null : ruleOf(item.recurrence);
  const extra = master ? null : (item.recurrence?.filter((line) => !line.startsWith('RRULE:')) ?? []);

  const fields = {
    title: item.summary || master?.title || '(sem título)',
    notes: item.description ?? null,
    location: item.location ?? null,
    ...times(start, momentOf(item.end), span),
    rrule,
    recurrenceExtra: extra?.length ? extra : null,
    timeZone: item.start?.timeZone ?? master?.timeZone ?? null,
    status: item.status === 'cancelled' ? ('CANCELLED' as const) : ('CONFIRMED' as const),
    recurringEventId: master?.id ?? null,
    originalStart: master ? key : null,
    externalId: item.id,
    externalEtag: item.etag ?? null,
    syncState: 'SYNCED' as const,
  };

  const row = existing
    ? ctx.db
        .update(events)
        .set({ ...fields, updatedAt: Date.now() })
        .where(eq(events.id, existing.id))
        .returning()
        .get()
    : ctx.db
        .insert(events)
        .values({ ...stamp(), ...fields, calendarId: calendar.id, source: 'GOOGLE' })
        .returning()
        .get();
  if (rrule) applyExdates(ctx, calendar, row, item.id, extra ?? []);
  refreshOwner(ctx, 'EVENT', master?.id ?? row.id);
}

/** Depois da leitura completa, o que aqui não veio de lá deixou de existir no Google. */
function reconcile(ctx: AppCtx, calendar: CalendarRow, items: GoogleEvent[], since: Date) {
  const seen = new Set(items.map((item) => item.id));
  const rows = ctx.db
    .select()
    .from(events)
    .where(
      and(
        eq(events.calendarId, calendar.id),
        isNull(events.deletedAt),
        eq(events.syncState, 'SYNCED'),
        isNotNull(events.externalId),
        or(
          gte(events.startAt, since.getTime()),
          gte(events.startDate, since.toISOString().slice(0, 10))
        )
      )
    )
    .all();
  for (const row of rows) {
    if (!seen.has(row.externalId!) && !row.externalId!.includes(EXDATE_MARK)) softDelete(ctx, row);
  }
}

function saveCalendar(ctx: AppCtx, id: string, data: Partial<CalendarRow>) {
  ctx.db
    .update(calendars)
    .set({ ...data, updatedAt: Date.now() })
    .where(eq(calendars.id, id))
    .run();
}

/** Incremental com `syncToken`. Token vencido (410) faz a leitura completa, sem trocar os ids daqui. */
export async function syncCalendar(ctx: AppCtx, accountId: string, calendar: CalendarRow) {
  const items: GoogleEvent[] = [];
  let pageToken: string | undefined;
  let nextSyncToken: string | undefined;
  const syncToken = calendar.syncToken;
  const timeMin = new Date(Date.now() - LOOKBACK_DAYS * DAY);

  try {
    do {
      const page = await googleFetch<{
        items?: GoogleEvent[];
        nextPageToken?: string;
        nextSyncToken?: string;
      }>(ctx, accountId, `${API}/calendars/${enc(calendar.externalId!)}/events`, {
        query: {
          maxResults: '250',
          showDeleted: 'true',
          pageToken,
          ...(syncToken ? { syncToken } : { timeMin: timeMin.toISOString() }),
        },
      });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
  } catch (error) {
    if (syncToken && error instanceof GoogleApiError && error.status === 410) {
      saveCalendar(ctx, calendar.id, { syncToken: null });
      return syncCalendar(ctx, accountId, { ...calendar, syncToken: null });
    }
    throw error;
  }

  // Mestres antes das exceções: a exceção aponta para o mestre.
  for (const item of items.filter((i) => !i.recurringEventId)) applyRemote(ctx, calendar, item);
  for (const item of items.filter((i) => i.recurringEventId)) applyRemote(ctx, calendar, item);
  if (!syncToken) reconcile(ctx, calendar, items, timeMin);

  saveCalendar(ctx, calendar.id, {
    syncToken: nextSyncToken ?? syncToken,
    syncedAt: Date.now(),
    lastError: null,
  });
}

// ---------------------------------------------------------------- Sektor -> Google

function googleTimes(event: EventRow, timeZone: string, patching: boolean) {
  // PATCH mescla os objetos: sem o null, dia inteiro e horário ficariam juntos e o Google recusa.
  const clear = (field: 'date' | 'dateTime') => (patching ? { [field]: null } : {});
  if (event.allDay) {
    return {
      start: { date: event.startDate, ...clear('dateTime') },
      end: { date: event.endDate, ...clear('dateTime') },
    };
  }
  return {
    start: { dateTime: new Date(event.startAt!).toISOString(), timeZone, ...clear('date') },
    end: { dateTime: new Date(event.endAt!).toISOString(), timeZone, ...clear('date') },
  };
}

/** Id da instância de uma série no Google: `<mestre>_<início original em UTC>`. */
export function instanceId(masterId: string, original: string, allDay: boolean) {
  const compact = allDay
    ? original.replaceAll('-', '')
    : original.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `${masterId}_${compact}`;
}

/** Quem mudou enquanto a chamada estava no ar continua pendente: só o id chega à linha. */
function settle(ctx: AppCtx, event: EventRow, result: GoogleEvent | null) {
  ctx.db
    .update(events)
    .set({
      externalId: result?.id ?? event.externalId,
      externalEtag: result?.etag ?? event.externalEtag,
    })
    .where(eq(events.id, event.id))
    .run();
  ctx.db
    .update(events)
    .set({ syncState: 'SYNCED' })
    .where(and(eq(events.id, event.id), eq(events.updatedAt, event.updatedAt)))
    .run();
}

async function pushDelete(ctx: AppCtx, accountId: string, base: string, event: EventRow) {
  if (event.externalId) {
    await googleFetch(ctx, accountId, `${base}/${enc(event.externalId)}`, {
      method: 'DELETE',
    }).catch((error) => {
      if (!isNotFound(error)) throw error;
    });
  }
  settle(ctx, event, null);
}

async function pushInstance(ctx: AppCtx, accountId: string, base: string, event: EventRow) {
  const master = ctx.db.select().from(events).where(eq(events.id, event.recurringEventId!)).get();
  if (!master || master.deletedAt) return settle(ctx, event, null);
  if (!master.externalId) return;
  const id =
    event.externalId && !event.externalId.includes(EXDATE_MARK)
      ? event.externalId
      : instanceId(master.externalId, event.originalStart!, master.allDay);
  const body =
    event.status === 'CANCELLED'
      ? { status: 'cancelled' }
      : {
          summary: event.title,
          description: event.notes,
          location: event.location,
          status: 'confirmed',
          ...googleTimes(event, master.timeZone ?? ctx.timeZone, true),
        };
  const result = await googleFetch<GoogleEvent>(ctx, accountId, `${base}/${enc(id)}`, {
    method: 'PATCH',
    body,
  });
  settle(ctx, event, result);
}

async function pushMaster(ctx: AppCtx, accountId: string, base: string, event: EventRow) {
  const timeZone = event.timeZone ?? ctx.timeZone;
  const body = (patching: boolean) => ({
    summary: event.title,
    description: event.notes,
    location: event.location,
    status: 'confirmed',
    ...googleTimes(event, timeZone, patching),
    recurrence: event.rrule ? [`RRULE:${event.rrule}`, ...(event.recurrenceExtra ?? [])] : [],
  });
  const create = () =>
    googleFetch<GoogleEvent>(ctx, accountId, base, { method: 'POST', body: body(false) });
  if (!event.externalId) return settle(ctx, event, await create());
  try {
    const result = await googleFetch<GoogleEvent>(ctx, accountId, `${base}/${enc(event.externalId)}`, {
      method: 'PATCH',
      body: body(true),
    });
    settle(ctx, event, result);
  } catch (error) {
    if (!isNotFound(error)) throw error;
    // Sumiu de lá enquanto mudava aqui: a mudança local vence, e o evento nasce de novo.
    settle(ctx, event, await create());
  }
}

/** Falha de um evento fica nele. Falha da conta sobe, e o evento continua pendente. */
async function pushEvent(ctx: AppCtx, accountId: string, calendar: CalendarRow, event: EventRow) {
  const base = `${API}/calendars/${enc(calendar.externalId!)}/events`;
  try {
    if (event.deletedAt) await pushDelete(ctx, accountId, base, event);
    else if (event.recurringEventId) await pushInstance(ctx, accountId, base, event);
    else await pushMaster(ctx, accountId, base, event);
  } catch (error) {
    if (error instanceof GoogleAuthError || isAccountWide(error)) throw error;
    ctx.db
      .update(events)
      .set({ syncState: 'ERROR' })
      .where(and(eq(events.id, event.id), eq(events.updatedAt, event.updatedAt)))
      .run();
    saveCalendar(ctx, calendar.id, {
      lastError: `O Google recusou "${event.title}" (${(error as GoogleApiError).status}).`,
    });
  }
}

export function pendingEventCount(ctx: AppCtx) {
  return ctx.db
    .select({ id: events.id })
    .from(events)
    .where(and(eq(events.source, 'GOOGLE'), pendingStates))
    .all().length;
}

export async function pushPendingEvents(ctx: AppCtx, accountId: string) {
  for (const calendar of calendarsOf(ctx, accountId)) {
    const pending = ctx.db
      .select()
      .from(events)
      .where(and(eq(events.calendarId, calendar.id), eq(events.source, 'GOOGLE'), pendingStates))
      .orderBy(asc(sql`${events.recurringEventId} IS NOT NULL`), asc(events.createdAt))
      .all();
    for (const event of pending) await pushEvent(ctx, accountId, calendar, event);
  }
}

/** Sai a conta: calendários e eventos dela somem daqui, e nada é enviado ao Google. */
export function forgetCalendars(ctx: AppCtx, accountId: string) {
  for (const row of calendarsOf(ctx, accountId)) removeCalendar(ctx, row);
  ctx.db
    .update(events)
    .set({ syncState: 'SYNCED' })
    .where(
      and(
        pendingStates,
        inArray(
          events.calendarId,
          ctx.db
            .select({ id: calendars.id })
            .from(calendars)
            .where(eq(calendars.externalAccount, accountId))
        )
      )
    )
    .run();
}
