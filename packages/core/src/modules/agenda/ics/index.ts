import { and, eq, inArray, isNull } from 'drizzle-orm';

import type { AppCtx } from '../../../app';
import { AppError, notFound, stamp } from '../../../services/context';
import { deleteOwnerReminders, refreshOwner } from '../../reminders/service';
import type { Tone } from '../contract';
import { type CalendarRow, calendars, events } from '../schema';
import { findCalendar, listCalendars } from '../service';

import { fetchIcs, IcsFetchError, type IcsFetcher, icsHost, normalizeIcsUrl } from './fetch';
import { type IcsOccurrence, parseIcs } from './parse';

// Agenda por link (ICS/webcal), só de leitura. A cada leitura o arquivo inteiro é expandido numa
// janela de datas e comparado com o que está guardado: só o que mudou é gravado. O link é segredo:
// mora no cofre, e no banco fica só o domínio.

const LOOKBACK_DAYS = 180;
const LOOKAHEAD_DAYS = 365;
const DAY = 86_400_000;

type Ctx = Pick<AppCtx, 'db' | 'timeZone' | 'secrets'>;

const secretName = (calendarId: string) => `ics:${calendarId}`;

function windowFor(now = new Date()) {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(today - LOOKBACK_DAYS * DAY),
    to: new Date(today + LOOKAHEAD_DAYS * DAY),
  };
}

const dateOf = (date: Date) => date.toISOString().slice(0, 10);

async function download(ctx: Ctx, url: string, fetcher: IcsFetcher, etag?: string | null) {
  const result = await fetcher(url, { etag });
  if (result.notModified) return null;
  const window = windowFor();
  const parsed = parseIcs(result.text, { ...window, defaultTimeZone: ctx.timeZone });
  return { ...parsed, windowStart: dateOf(window.from), etag: result.etag };
}

const times = (item: IcsOccurrence) =>
  item.allDay
    ? {
        startDate: dateOf(item.startAt),
        endDate: dateOf(item.endAt),
        startAt: null,
        endAt: null,
      }
    : {
        startAt: item.startAt.getTime(),
        endAt: item.endAt.getTime(),
        startDate: null,
        endDate: null,
      };

/** Grava as ocorrências: cria as novas, atualiza as mudadas, apaga as que sumiram. */
export function applyIcsOccurrences(ctx: Ctx, calendar: CalendarRow, items: IcsOccurrence[]) {
  const existing = ctx.db
    .select()
    .from(events)
    .where(and(eq(events.calendarId, calendar.id), isNull(events.deletedAt)))
    .all();
  const byKey = new Map(existing.map((event) => [event.externalId, event]));
  const wanted = new Set(items.map((item) => item.key));
  const stale = existing.filter((e) => !e.externalId || !wanted.has(e.externalId)).map((e) => e.id);
  const counts = { created: 0, updated: 0, deleted: stale.length };
  const changed: string[] = [];

  ctx.db.transaction((tx) => {
    if (stale.length) {
      tx.update(events)
        .set({ deletedAt: Date.now(), updatedAt: Date.now() })
        .where(inArray(events.id, stale))
        .run();
    }
    for (const item of items) {
      const fields = {
        title: item.title,
        notes: item.description,
        location: item.location,
        allDay: item.allDay,
        ...times(item),
      };
      const current = byKey.get(item.key);
      if (!current) {
        tx.insert(events)
          .values({
            ...stamp(),
            ...fields,
            calendarId: calendar.id,
            source: 'ICS',
            externalId: item.key,
          })
          .run();
        counts.created++;
      } else if (
        (Object.keys(fields) as (keyof typeof fields)[]).some((k) => current[k] !== fields[k])
      ) {
        tx.update(events)
          .set({ ...fields, updatedAt: Date.now() })
          .where(eq(events.id, current.id))
          .run();
        changed.push(current.id);
        counts.updated++;
      }
    }
  });
  deleteOwnerReminders(ctx, 'EVENT', stale);
  for (const id of changed) refreshOwner(ctx, 'EVENT', id);
  return counts;
}

/** Só as mensagens nossas chegam à tela e ao banco: qualquer outro erro pode carregar o link. */
const safeMessage = (error: unknown) =>
  error instanceof IcsFetchError ? error.message : 'Falha ao ler a agenda.';

function saveCalendar(ctx: Ctx, id: string, data: Partial<CalendarRow>) {
  ctx.db
    .update(calendars)
    .set({ ...data, updatedAt: Date.now() })
    .where(eq(calendars.id, id))
    .run();
}

/**
 * Lê o link de novo. O ETag só vale com a mesma janela da última leitura completa: num dia novo a
 * janela andou e o arquivo precisa ser expandido de novo, mesmo sem mudança.
 */
export async function syncIcsCalendar(ctx: Ctx, calendar: CalendarRow, fetcher: IcsFetcher) {
  const url = ctx.secrets.get(secretName(calendar.id));
  if (!url) {
    saveCalendar(ctx, calendar.id, { lastError: 'O link desta agenda não está mais no cofre.' });
    return;
  }
  try {
    const sameWindow = calendar.syncWindowStart === dateOf(windowFor().from);
    const result = await download(ctx, url, fetcher, sameWindow ? calendar.syncToken : null);
    if (result) applyIcsOccurrences(ctx, calendar, result.occurrences);
    saveCalendar(ctx, calendar.id, {
      syncedAt: Date.now(),
      lastError: null,
      ...(result ? { syncToken: result.etag, syncWindowStart: result.windowStart } : {}),
    });
  } catch (error) {
    saveCalendar(ctx, calendar.id, { lastError: safeMessage(error) });
  }
}

/** Uma agenda com erro não para as outras. */
export async function syncAllIcs(ctx: Ctx, fetcher: IcsFetcher = fetchIcs) {
  const rows = ctx.db
    .select()
    .from(calendars)
    .where(and(eq(calendars.source, 'ICS'), isNull(calendars.deletedAt)))
    .all();
  for (const calendar of rows) await syncIcsCalendar(ctx, calendar, fetcher);
}

function assertNotDuplicate(ctx: Ctx, url: string, exceptId?: string) {
  const others = ctx.db
    .select({ id: calendars.id })
    .from(calendars)
    .where(and(eq(calendars.source, 'ICS'), isNull(calendars.deletedAt)))
    .all();
  if (others.some((o) => o.id !== exceptId && ctx.secrets.get(secretName(o.id)) === url)) {
    throw new AppError(409, 'Essa agenda já foi adicionada.');
  }
}

function parseUrl(input: string) {
  const url = normalizeIcsUrl(input);
  if (!url) throw new AppError(400, 'Cole um link que comece com https:// ou webcal://.');
  return url;
}

async function readNow(ctx: Ctx, url: string, fetcher: IcsFetcher) {
  try {
    const result = await download(ctx, url, fetcher);
    if (!result) throw new IcsFetchError('Não deu para ler a agenda.');
    return result;
  } catch (error) {
    throw new AppError(400, safeMessage(error));
  }
}

/** Lê o link na hora: link errado nem chega a ser salvo. */
export async function addIcsCalendar(
  ctx: Ctx,
  body: { url: string; name?: string | null; color?: Tone },
  fetcher: IcsFetcher = fetchIcs
) {
  const url = parseUrl(body.url);
  assertNotDuplicate(ctx, url);
  const result = await readNow(ctx, url, fetcher);
  const row = ctx.db
    .insert(calendars)
    .values({
      ...stamp(),
      name: (body.name?.trim() || result.name?.trim() || 'Agenda por link').slice(0, 80),
      color: body.color ?? 'cyan',
      source: 'ICS',
      host: icsHost(url),
      syncToken: result.etag,
      syncWindowStart: result.windowStart,
      syncedAt: Date.now(),
    })
    .returning()
    .get();
  ctx.secrets.set(secretName(row.id), url);
  applyIcsOccurrences(ctx, row, result.occurrences);
  return listCalendars(ctx).find((calendar) => calendar.id === row.id)!;
}

/** Troca o link: o novo é lido na hora, e os eventos são refeitos. */
export async function replaceIcsUrl(
  ctx: Ctx,
  id: string,
  input: string,
  fetcher: IcsFetcher = fetchIcs
) {
  const calendar = findCalendar(ctx, id);
  if (calendar.source !== 'ICS') throw notFound('Agenda');
  const url = parseUrl(input);
  if (url === ctx.secrets.get(secretName(id))) return;
  assertNotDuplicate(ctx, url, id);
  const result = await readNow(ctx, url, fetcher);
  ctx.secrets.set(secretName(id), url);
  applyIcsOccurrences(ctx, calendar, result.occurrences);
  saveCalendar(ctx, id, {
    host: icsHost(url),
    lastError: null,
    syncToken: result.etag,
    syncWindowStart: result.windowStart,
    syncedAt: Date.now(),
  });
}

export function removeIcsSecret(ctx: Ctx, id: string) {
  ctx.secrets.set(secretName(id), null);
}

export async function syncNow(ctx: Ctx, id: string, fetcher: IcsFetcher = fetchIcs) {
  const calendar = findCalendar(ctx, id);
  if (calendar.source !== 'ICS') throw notFound('Agenda');
  await syncIcsCalendar(ctx, calendar, fetcher);
}

