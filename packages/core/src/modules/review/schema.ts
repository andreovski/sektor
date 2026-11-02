import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export interface Priority {
  text: string;
  taskId: string | null;
}

export const reviews = sqliteTable('reviews', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
  weekStart: text('week_start').notNull(),
  wentWell: text('went_well').notNull().default(''),
  blocked: text('blocked').notNull().default(''),
  priorities: text('priorities', { mode: 'json' }).$type<Priority[]>().notNull().default([]),
});
