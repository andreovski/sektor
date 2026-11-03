import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// As restrições e os índices moram em `0120_project_page.sql`.
const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

export const projectNotes = sqliteTable('project_notes', {
  ...base,
  projectId: text('project_id').notNull(),
  body: text('body').notNull().default(''),
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
});

export const projectFiles = sqliteTable('project_files', {
  ...base,
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  contentHash: text('content_hash').notNull(),
  /** Nome do arquivo cifrado na pasta local: o hash, sem revelar a extensão. */
  storedName: text('stored_name').notNull(),
});
