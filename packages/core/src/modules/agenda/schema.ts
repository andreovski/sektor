import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

export const CALENDAR_SOURCES = ['LOCAL', 'ICS', 'GOOGLE', 'MICROSOFT'] as const;
export type CalendarSource = (typeof CALENDAR_SOURCES)[number];

// GOOGLE e MICROSOFT ainda não têm quem grave: a tabela já nasce com a origem e os ids de fora.
export const calendars = sqliteTable(
  'agenda_calendars',
  {
    ...base,
    name: text('name').notNull(),
    /** Nome de um tom do tema (`blue`, `rose`...). */
    color: text('color').notNull(),
    source: text('source', { enum: CALENDAR_SOURCES }).notNull().default('LOCAL'),
    externalId: text('external_id'),
    externalAccount: text('external_account'),
    /** Só o domínio do link. O link mesmo fica no cofre. */
    host: text('host'),
    selected: integer('selected', { mode: 'boolean' }).notNull().default(true),
    syncToken: text('sync_token'),
    syncWindowStart: text('sync_window_start'),
    syncedAt: integer('synced_at'),
    lastError: text('last_error'),
  },
  (t) => [
    check('agenda_calendars_source', sql`${t.source} IN ('LOCAL','ICS','GOOGLE','MICROSOFT')`),
    uniqueIndex('agenda_calendars_external')
      .on(t.source, t.externalId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.externalId} IS NOT NULL`),
  ]
);

// Com hora: `startAt`/`endAt` em ms. Dia inteiro: `startDate`/`endDate` em AAAA-MM-DD, com o fim
// exclusivo (o dia seguinte ao último), como no ICS. Nunca os dois pares.
export const events = sqliteTable(
  'agenda_events',
  {
    ...base,
    calendarId: text('calendar_id')
      .notNull()
      .references(() => calendars.id),
    title: text('title').notNull(),
    notes: text('notes'),
    location: text('location'),
    allDay: integer('all_day', { mode: 'boolean' }).notNull().default(false),
    startAt: integer('start_at'),
    endAt: integer('end_at'),
    startDate: text('start_date'),
    endDate: text('end_date'),
    color: text('color'),
    rrule: text('rrule'),
    status: text('status', { enum: ['CONFIRMED', 'CANCELLED'] })
      .notNull()
      .default('CONFIRMED'),
    /** Exceção de uma série: o evento mestre e o início original da ocorrência trocada. */
    recurringEventId: text('recurring_event_id'),
    originalStart: text('original_start'),
    source: text('source', { enum: CALENDAR_SOURCES }).notNull().default('LOCAL'),
    externalId: text('external_id'),
    externalEtag: text('external_etag'),
    syncState: text('sync_state', { enum: ['SYNCED', 'PENDING', 'ERROR'] })
      .notNull()
      .default('SYNCED'),
  },
  (t) => [
    check('agenda_events_status', sql`${t.status} IN ('CONFIRMED','CANCELLED')`),
    check('agenda_events_source', sql`${t.source} IN ('LOCAL','ICS','GOOGLE','MICROSOFT')`),
    check('agenda_events_sync_state', sql`${t.syncState} IN ('SYNCED','PENDING','ERROR')`),
    check(
      'agenda_events_times',
      sql`(${t.allDay} = 1 AND ${t.startDate} IS NOT NULL AND ${t.endDate} IS NOT NULL AND ${t.startAt} IS NULL AND ${t.endAt} IS NULL) OR (${t.allDay} = 0 AND ${t.startAt} IS NOT NULL AND ${t.endAt} IS NOT NULL AND ${t.startDate} IS NULL AND ${t.endDate} IS NULL)`
    ),
    uniqueIndex('agenda_events_external')
      .on(t.calendarId, t.externalId)
      .where(sql`${t.deletedAt} IS NULL AND ${t.externalId} IS NOT NULL`),
    uniqueIndex('agenda_events_override')
      .on(t.recurringEventId, t.originalStart)
      .where(sql`${t.deletedAt} IS NULL AND ${t.recurringEventId} IS NOT NULL`),
    index('agenda_events_start_at').on(t.startAt),
    index('agenda_events_start_date').on(t.startDate),
    index('agenda_events_calendar').on(t.calendarId),
  ]
);

export type CalendarRow = typeof calendars.$inferSelect;
export type EventRow = typeof events.$inferSelect;
