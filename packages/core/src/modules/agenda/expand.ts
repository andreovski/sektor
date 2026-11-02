import { addDays, dateStringToUtc, diffInDays, eventOccurrences, utcToDateString } from '@sektor/finance-engine';

import type { EventRow } from './schema';
import type { EventOccurrence } from './view';

/** Janela em dias do fuso (`toDay` exclusivo) e os instantes das mesmas pontas. */
export interface Range {
  fromDay: string;
  toDay: string;
  from: Date;
  to: Date;
}

const DAY = 86_400_000;

/** Como a ocorrência é identificada e mostrada: AAAA-MM-DD no dia inteiro, ISO no resto. */
export const startOf = (row: EventRow) =>
  row.allDay ? row.startDate! : new Date(row.startAt!).toISOString();
export const endOf = (row: EventRow) =>
  row.allDay ? row.endDate! : new Date(row.endAt!).toISOString();

export function occurrenceOf(
  row: EventRow,
  start: string,
  end: string,
  original: string,
  master: EventRow | null,
  reminders: number[]
): EventOccurrence {
  return {
    eventId: master?.id ?? row.id,
    occurrenceStart: original,
    startAt: start,
    endAt: end,
    allDay: row.allDay,
    title: row.title,
    notes: row.notes,
    location: row.location,
    color: row.color ?? master?.color ?? null,
    rrule: master?.rrule ?? row.rrule,
    isRecurring: Boolean(master?.rrule ?? row.rrule),
    isException: Boolean(master),
    source: row.source,
    calendarId: row.calendarId,
    reminders,
  };
}

/** Ocorrências da série que caem em `range`, com as exceções já aplicadas. Sem ordem definida. */
export function expandSeries(
  master: EventRow,
  overrides: EventRow[],
  range: Range,
  timeZone: string,
  reminders: number[] = []
): EventOccurrence[] {
  const replaced = new Set(overrides.map((o) => o.originalStart));
  const result: EventOccurrence[] = [];

  if (master.allDay) {
    const span = diffInDays(master.startDate!, master.endDate!);
    // Dia inteiro não tem fuso: a regra corre em UTC.
    const starts = eventOccurrences(
      master.rrule!,
      dateStringToUtc(master.startDate!),
      dateStringToUtc(range.fromDay),
      dateStringToUtc(range.toDay),
      'UTC',
      span * DAY
    );
    for (const instant of starts) {
      const start = utcToDateString(instant);
      if (replaced.has(start)) continue;
      result.push(occurrenceOf(master, start, addDays(start, span), start, null, reminders));
    }
  } else {
    const duration = master.endAt! - master.startAt!;
    const starts = eventOccurrences(
      master.rrule!,
      new Date(master.startAt!),
      range.from,
      range.to,
      master.timeZone ?? timeZone,
      duration
    );
    for (const instant of starts) {
      const start = instant.toISOString();
      if (replaced.has(start)) continue;
      const end = new Date(instant.getTime() + duration).toISOString();
      result.push(occurrenceOf(master, start, end, start, null, reminders));
    }
  }

  for (const override of overrides) {
    if (override.status === 'CANCELLED' || !overlaps(override, range)) continue;
    result.push(
      occurrenceOf(
        override,
        startOf(override),
        endOf(override),
        override.originalStart ?? startOf(override),
        master,
        reminders
      )
    );
  }
  return result;
}

export function overlaps(row: EventRow, range: Range) {
  return row.allDay
    ? row.startDate! < range.toDay && row.endDate! > range.fromDay
    : row.startAt! < range.to.getTime() && row.endAt! > range.from.getTime();
}
