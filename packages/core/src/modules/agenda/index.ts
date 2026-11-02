import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import {
  addIcsSchema,
  createCalendarSchema,
  type CreateEvent,
  createEventSchema,
  deleteEventSchema,
  type EventScope,
  rangeSchema,
  type Tone,
  type UpdateEvent,
  updateCalendarSchema,
  updateEventSchema,
} from './contract';
import * as ics from './ics';
import * as svc from './service';

export const handlers = (ctx: AppCtx) => ({
  'calendars.list': () => svc.listCalendars(ctx),
  'calendars.create': (input: { name: string; color: Tone }) =>
    svc.createCalendar(ctx, parse(createCalendarSchema as never, input)),
  'calendars.update': ({
    id,
    ...input
  }: {
    id: string;
    name?: string;
    color?: Tone;
    selected?: boolean;
  }) => svc.updateCalendar(ctx, id, parse(updateCalendarSchema as never, input)),
  'calendars.setDefault': ({ id }: { id: string | null }) => svc.setDefaultCalendar(ctx, id),
  'calendars.delete': ({ id }: { id: string }) => {
    svc.deleteCalendar(ctx, id);
    ics.removeIcsSecret(ctx, id);
  },
  'calendars.addIcs': (input: { url: string; name?: string | null; color?: Tone }) =>
    ics.addIcsCalendar(ctx, parse(addIcsSchema as never, input)),
  'calendars.replaceIcsUrl': ({ id, url }: { id: string; url: string }) =>
    ics.replaceIcsUrl(ctx, id, url),
  'calendars.sync': ({ id }: { id: string }) => ics.syncNow(ctx, id),

  'events.list': (input: { from: string; to: string }) =>
    svc.listOccurrences(ctx, parse(rangeSchema as never, input)),
  'events.get': ({ id }: { id: string }) => svc.getEvent(ctx, id),
  'events.create': (input: CreateEvent) =>
    svc.createEvent(ctx, parse(createEventSchema as never, input)),
  'events.update': ({ id, ...input }: UpdateEvent & { id: string }) =>
    svc.updateEvent(ctx, id, parse(updateEventSchema as never, input)),
  'events.delete': ({
    id,
    ...input
  }: {
    id: string;
    scope?: EventScope;
    occurrenceStart?: string;
  }) => svc.deleteEvent(ctx, id, parse(deleteEventSchema as never, input)),
});

export const jobs: Job[] = [
  { name: 'agenda-ics', everyMs: 15 * 60_000, run: (ctx) => ics.syncAllIcs(ctx) },
];
