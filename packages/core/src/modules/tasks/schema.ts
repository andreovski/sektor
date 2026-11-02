import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { TONES } from './contract';

// As restrições (CHECK e índices parciais) moram em `0010_tasks.sql`.
const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

export const taskLists = sqliteTable('task_lists', {
  ...base,
  name: text('name').notNull(),
  color: text('color', { enum: TONES }),
  sortOrder: integer('sort_order').notNull().default(0),
  isInbox: integer('is_inbox', { mode: 'boolean' }).notNull().default(false),
  source: text('source', { enum: ['LOCAL', 'GOOGLE'] }).notNull().default('LOCAL'),
  externalId: text('external_id'),
  syncState: text('sync_state', { enum: ['SYNCED', 'PENDING', 'ERROR'] })
    .notNull()
    .default('PENDING'),
});

export const projects = sqliteTable('projects', {
  ...base,
  name: text('name').notNull(),
  type: text('type', { enum: ['PERSONAL', 'ACADEMIC', 'PROFESSIONAL', 'FREELANCE'] })
    .notNull()
    .default('PERSONAL'),
  description: text('description'),
  color: text('color', { enum: TONES }),
  startDate: text('start_date'),
  status: text('status', { enum: ['ACTIVE', 'PAUSED', 'DONE'] })
    .notNull()
    .default('ACTIVE'),
  dueDate: text('due_date'),
  completedAt: integer('completed_at'),
});

export const tasks = sqliteTable('tasks', {
  ...base,
  listId: text('list_id').notNull(),
  projectId: text('project_id'),
  parentTaskId: text('parent_task_id'),
  title: text('title').notNull(),
  notes: text('notes'),
  status: text('status', { enum: ['BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE'] })
    .notNull()
    .default('TODO'),
  priority: text('priority', { enum: ['LOW', 'MEDIUM', 'HIGH'] }),
  // Prazo em texto, sem fuso: AAAA-MM-DD e, se tiver hora, HH:MM do relógio de parede.
  dueDate: text('due_date'),
  dueTime: text('due_time'),
  rrule: text('rrule'),
  /** Primeiro prazo da série: é ele que diz o dia do mês. Vazio, vale o prazo da própria tarefa. */
  rruleAnchor: text('rrule_anchor'),
  /** A tarefa gerada ao concluir esta, para reabrir e concluir não gerar outra. */
  nextTaskId: text('next_task_id'),
  sortOrder: integer('sort_order').notNull().default(0),
  completedAt: integer('completed_at'),
  source: text('source', { enum: ['LOCAL', 'GOOGLE'] }).notNull().default('LOCAL'),
  externalId: text('external_id'),
  externalEtag: text('external_etag'),
  /** Onde o `externalId` vive hoje no Google, para notar que a tarefa trocou de lista ou de mãe. */
  externalListId: text('external_list_id'),
  externalParentId: text('external_parent_id'),
  syncState: text('sync_state', { enum: ['SYNCED', 'PENDING', 'ERROR'] })
    .notNull()
    .default('PENDING'),
});

export const taskTags = sqliteTable('task_tags', {
  ...base,
  name: text('name').notNull(),
});

export const taskTagLinks = sqliteTable('task_tag_links', {
  ...base,
  taskId: text('task_id').notNull(),
  tagId: text('tag_id').notNull(),
});
