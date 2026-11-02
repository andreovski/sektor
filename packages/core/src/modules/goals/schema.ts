import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { HABIT_COLORS } from '../habits/schema';

const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

export const GOAL_AREAS = [
  'SAUDE',
  'FINANCAS',
  'CARREIRA',
  'ESTUDOS',
  'RELACIONAMENTOS',
  'PESSOAL',
] as const;
export const GOAL_SOURCES = ['MANUAL', 'PROJECT_TASKS', 'HABIT_STREAK', 'ACCOUNT_BALANCE'] as const;

/** Com esta unidade, `target` e `manualValue` são centavos inteiros. */
export const MONEY_UNIT = 'R$';

export const goals = sqliteTable(
  'goals',
  {
    ...base,
    title: text('title').notNull(),
    area: text('area', { enum: GOAL_AREAS }).notNull(),
    target: real('target').notNull(),
    unit: text('unit').notNull(),
    deadline: text('deadline'),
    startedOn: text('started_on').notNull(),
    color: text('color', { enum: HABIT_COLORS }).notNull().default('green'),
    source: text('source', { enum: GOAL_SOURCES }).notNull().default('MANUAL'),
    sourceId: text('source_id'),
    manualValue: real('manual_value').notNull().default(0),
  },
  (t) => [index('goals_deadline').on(t.deadline)]
);
