import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const focusSessions = sqliteTable('focus_sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  mode: text('mode', { enum: ['POMODORO', 'DEEP_WORK', 'FREE'] }).notNull(),
  day: text('day').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  plannedSeconds: integer('planned_seconds'),
  pausedAt: integer('paused_at'),
  pausedUntil: integer('paused_until'),
  pausedMs: integer('paused_ms').notNull().default(0),
  focusSeconds: integer('focus_seconds'),
  plannedNotifiedAt: integer('planned_notified_at'),
  taskId: text('task_id'),
  projectId: text('project_id'),
  note: text('note'),
});

export type FocusSession = typeof focusSessions.$inferSelect;
