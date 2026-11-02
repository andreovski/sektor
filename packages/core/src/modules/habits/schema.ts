import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

export const HABIT_COLORS = ['green', 'cyan', 'blue', 'violet', 'rose', 'orange', 'amber'] as const;
export type ToneColor = (typeof HABIT_COLORS)[number];

export const habits = sqliteTable(
  'habits',
  {
    ...base,
    name: text('name').notNull(),
    kind: text('kind', { enum: ['CONTINUOUS', 'CHALLENGE'] })
      .notNull()
      .default('CONTINUOUS'),
    frequency: text('frequency', { enum: ['DAILY', 'WEEKDAYS', 'TIMES'] })
      .notNull()
      .default('DAILY'),
    timesPerWeek: integer('times_per_week'),
    startOn: text('start_on').notNull(),
    endOn: text('end_on'),
    color: text('color', { enum: HABIT_COLORS }).notNull().default('green'),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('habits_position').on(t.position)]
);

export const habitChecks = sqliteTable(
  'habit_checks',
  {
    ...base,
    habitId: text('habit_id')
      .notNull()
      .references(() => habits.id),
    date: text('date').notNull(),
  },
  (t) => [uniqueIndex('habit_checks_day').on(t.habitId, t.date).where(sql`deleted_at IS NULL`)]
);
