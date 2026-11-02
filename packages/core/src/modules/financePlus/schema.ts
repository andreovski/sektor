import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { accounts, categories, transactions } from '../../db/schema';

const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

export const debts = sqliteTable('plus_debts', {
  ...base,
  name: text('name').notNull(),
  balanceCents: integer('balance_cents').notNull(),
  /** Juros ao mês em centésimos de ponto percentual: 2,99% = 299. */
  rateBp: integer('rate_bp').notNull(),
  minPaymentCents: integer('min_payment_cents').notNull(),
  dueDay: integer('due_day').notNull(),
});

export const categoryRules = sqliteTable('plus_category_rules', {
  ...base,
  pattern: text('pattern').notNull(),
  patternKey: text('pattern_key').notNull(),
  kind: text('kind', { enum: ['INCOME', 'EXPENSE'] }).notNull(),
  categoryId: text('category_id')
    .notNull()
    .references(() => categories.id),
});

export const importLines = sqliteTable('plus_import_lines', {
  ...base,
  accountId: text('account_id')
    .notNull()
    .references(() => accounts.id),
  fingerprint: text('fingerprint').notNull(),
  transactionId: text('transaction_id')
    .notNull()
    .references(() => transactions.id),
});

export const recurringDismissals = sqliteTable('plus_recurring_dismissals', {
  ...base,
  key: text('key').notNull(),
});
