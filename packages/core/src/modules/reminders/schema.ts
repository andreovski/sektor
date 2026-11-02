import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const SCHEDULES = ['ONCE', 'INTERVAL', 'DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY'] as const;
export type Schedule = (typeof SCHEDULES)[number];

// EVENT e TASK contam `minutesBefore` antes do dono (`ownerId`). CUSTOM segue a própria agenda.
// Tarefa guarda uma cópia do prazo: o módulo de Tarefas é outro, e pode estar fora do ar.
export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    deletedAt: integer('deleted_at'),
    kind: text('kind', { enum: ['EVENT', 'TASK', 'CUSTOM'] }).notNull(),
    ownerId: text('owner_id'),
    title: text('title').notNull(),
    notes: text('notes'),
    minutesBefore: integer('minutes_before').notNull().default(0),
    schedule: text('schedule', { enum: SCHEDULES }),
    /** Primeiro dia. Em WEEKLY dá o dia da semana; em MONTHLY, o dia do mês. */
    startDate: text('start_date'),
    /** "HH:MM". */
    time: text('time'),
    intervalHours: integer('interval_hours'),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    taskDueDate: text('task_due_date'),
    taskDueTime: text('task_due_time'),
    /** Início da ocorrência já avisada (ms): impede repetir o aviso. */
    lastFiredFor: integer('last_fired_for'),
    nextFireAt: integer('next_fire_at'),
    pausedAt: integer('paused_at'),
  },
  (t) => [
    check('reminders_kind', sql`${t.kind} IN ('EVENT','TASK','CUSTOM')`),
    uniqueIndex('reminders_owner')
      .on(t.kind, t.ownerId, t.minutesBefore)
      .where(sql`${t.deletedAt} IS NULL AND ${t.ownerId} IS NOT NULL`),
    index('reminders_next_fire').on(t.nextFireAt),
  ]
);

export type ReminderRow = typeof reminders.$inferSelect;
