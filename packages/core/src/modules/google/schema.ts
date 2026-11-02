import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

// O refresh token nunca entra aqui: mora em `ctx.secrets`, um por conta.
export const googleAccounts = sqliteTable('google_accounts', {
  ...base,
  sub: text('sub').notNull(),
  email: text('email').notNull(),
  name: text('name'),
  scope: text('scope').notNull().default(''),
  syncTasks: integer('sync_tasks', { mode: 'boolean' }).notNull().default(false),
  tasksSyncedAt: integer('tasks_synced_at'),
  lastSyncAt: integer('last_sync_at'),
  needsReconnect: integer('needs_reconnect', { mode: 'boolean' }).notNull().default(false),
  lastError: text('last_error'),
});

export type GoogleAccountRow = typeof googleAccounts.$inferSelect;
