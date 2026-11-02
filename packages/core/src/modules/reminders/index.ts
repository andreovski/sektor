import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import {
  type CustomReminder,
  customReminderSchema,
  eventReminderSchema,
  taskReminderSchema,
} from './contract';
import * as rem from './service';

export const handlers = (ctx: AppCtx) => ({
  'reminders.list': () => rem.listReminders(ctx),
  'reminders.create': (input: CustomReminder) =>
    rem.createCustom(ctx, parse(customReminderSchema as never, input)),
  'reminders.createForEvent': (input: { eventId: string; minutesBefore: number }) =>
    rem.createForEvent(ctx, parse(eventReminderSchema as never, input)),
  'reminders.createForTask': (input: {
    taskId: string;
    title: string;
    dueDate: string;
    dueTime?: string | null;
    minutesBefore: number;
  }) => rem.createForTask(ctx, parse(taskReminderSchema as never, input)),
  'reminders.update': ({ id, ...input }: CustomReminder & { id: string }) =>
    rem.updateCustom(ctx, id, parse(customReminderSchema as never, input)),
  'reminders.pause': ({ id }: { id: string }) => rem.pauseReminder(ctx, id),
  'reminders.resume': ({ id }: { id: string }) => rem.resumeReminder(ctx, id),
  'reminders.delete': ({ id }: { id: string }) => rem.deleteReminder(ctx, id),
});

export const jobs: Job[] = [
  { name: 'reminders', everyMs: 60_000, run: (ctx) => rem.runReminders(ctx) },
];
