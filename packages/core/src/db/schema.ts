import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Dinheiro em centavos inteiros e datas de lançamento em texto AAAA-MM-DD, como no finance-engine.
// Ids em texto (UUID v7), `updatedAt` e `deletedAt` em tudo: é o que a sincronização vai precisar.
const base = {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),
};

export const appMeta = sqliteTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const accounts = sqliteTable(
  'accounts',
  {
    ...base,
    name: text('name').notNull(),
    type: text('type', { enum: ['WALLET', 'CHECKING', 'SAVINGS', 'CREDIT_CARD'] }).notNull(),
    initialBalanceCents: integer('initial_balance_cents').notNull().default(0),
    color: text('color'),
    closingDay: integer('closing_day'),
    dueDay: integer('due_day'),
    paymentAccountId: text('payment_account_id'),
    archivedAt: integer('archived_at'),
  },
  (t) => [
    check('accounts_type', sql`${t.type} IN ('WALLET','CHECKING','SAVINGS','CREDIT_CARD')`),
  ]
);

export const categories = sqliteTable(
  'categories',
  {
    ...base,
    name: text('name').notNull(),
    kind: text('kind', { enum: ['INCOME', 'EXPENSE'] }).notNull(),
    parentId: text('parent_id'),
    icon: text('icon'),
    color: text('color'),
    systemKey: text('system_key'),
    defaultKey: text('default_key'),
  },
  (t) => [
    check('categories_kind', sql`${t.kind} IN ('INCOME','EXPENSE')`),
    uniqueIndex('categories_system_key').on(t.kind, t.systemKey),
    uniqueIndex('categories_default_key').on(t.kind, t.defaultKey),
  ]
);

export const recurrences = sqliteTable('recurrences', {
  ...base,
  rrule: text('rrule').notNull(),
  startDate: text('start_date').notNull(),
  template: text('template', { mode: 'json' }).notNull(),
  generatedUntil: text('generated_until').notNull(),
});

export const invoices = sqliteTable(
  'credit_card_invoices',
  {
    ...base,
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    referenceMonth: text('reference_month').notNull(),
    closingDate: text('closing_date').notNull(),
    dueDate: text('due_date').notNull(),
    paidAt: integer('paid_at'),
  },
  (t) => [uniqueIndex('invoices_account_month').on(t.accountId, t.referenceMonth)]
);

export const transactions = sqliteTable(
  'transactions',
  {
    ...base,
    kind: text('kind', { enum: ['INCOME', 'EXPENSE', 'TRANSFER'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    date: text('date').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => accounts.id),
    toAccountId: text('to_account_id').references(() => accounts.id),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    notes: text('notes'),
    status: text('status', { enum: ['PLANNED', 'DONE'] })
      .notNull()
      .default('DONE'),
    recurrenceId: text('recurrence_id').references(() => recurrences.id, { onDelete: 'set null' }),
    isRecurrenceException: integer('is_recurrence_exception', { mode: 'boolean' })
      .notNull()
      .default(false),
    installmentGroupId: text('installment_group_id'),
    installmentNumber: integer('installment_number'),
    installmentTotal: integer('installment_total'),
    invoiceId: text('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    paysInvoiceId: text('pays_invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('transactions_kind', sql`${t.kind} IN ('INCOME','EXPENSE','TRANSFER')`),
    check('transactions_status', sql`${t.status} IN ('PLANNED','DONE')`),
    check('transactions_positive', sql`${t.amountCents} > 0`),
    uniqueIndex('transactions_pays_invoice').on(t.paysInvoiceId),
    index('transactions_date').on(t.date),
    index('transactions_account_date').on(t.accountId, t.date),
  ]
);

export const budgets = sqliteTable(
  'budgets',
  {
    ...base,
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id),
    month: text('month').notNull(),
    limitCents: integer('limit_cents').notNull(),
  },
  (t) => [uniqueIndex('budgets_category_month').on(t.categoryId, t.month)]
);

export const pluggyItems = sqliteTable(
  'pluggy_items',
  {
    ...base,
    itemId: text('item_id').notNull(),
    name: text('name').notNull(),
    imageUrl: text('image_url'),
    status: text('status'),
    lastError: text('last_error'),
    syncedAt: integer('synced_at'),
  },
  (t) => [uniqueIndex('pluggy_items_item').on(t.itemId)]
);

export const bankAccounts = sqliteTable(
  'bank_accounts',
  {
    ...base,
    itemId: text('item_id')
      .notNull()
      .references(() => pluggyItems.id),
    externalId: text('external_id').notNull(),
    name: text('name').notNull(),
    number: text('number'),
    type: text('type', { enum: ['BANK', 'CREDIT'] }).notNull(),
    balanceCents: integer('balance_cents').notNull().default(0),
    accountId: text('account_id').references(() => accounts.id),
    importFrom: text('import_from'),
    syncedAt: integer('synced_at'),
  },
  (t) => [
    uniqueIndex('bank_accounts_external').on(t.externalId),
    uniqueIndex('bank_accounts_account').on(t.accountId),
  ]
);

// Sem cascata: remover um banco não apaga estas linhas, que são o que impede importar de novo.
export const bankMovements = sqliteTable(
  'bank_movements',
  {
    ...base,
    bankAccountId: text('bank_account_id')
      .notNull()
      .references(() => bankAccounts.id),
    externalId: text('external_id').notNull(),
    kind: text('kind', { enum: ['INCOME', 'EXPENSE'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),
    date: text('date').notNull(),
    description: text('description').notNull(),
    installmentNumber: integer('installment_number'),
    installmentTotal: integer('installment_total'),
    billDueDate: text('bill_due_date'),
    billClosingDate: text('bill_closing_date'),
    status: text('status', { enum: ['PENDING', 'MATCHED', 'IMPORTED', 'IGNORED'] }).notNull(),
    suggestedCategoryId: text('suggested_category_id').references(() => categories.id, {
      onDelete: 'set null',
    }),
    suggestionSource: text('suggestion_source', { enum: ['HISTORY', 'RULE', 'AI'] }),
    /** Probabilidade do Jev quando a sugestão veio da IA e ele conferiu. */
    suggestionConfidence: real('suggestion_confidence'),
    /** A IA já olhou este lançamento: não pergunta de novo. */
    aiCheckedAt: integer('ai_checked_at'),
    transactionId: text('transaction_id').references(() => transactions.id, {
      onDelete: 'set null',
    }),
    edited: integer('edited', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [
    uniqueIndex('bank_movements_external').on(t.bankAccountId, t.externalId),
    index('bank_movements_status').on(t.status),
  ]
);
