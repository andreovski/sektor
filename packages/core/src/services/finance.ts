import type {
  AccountResponse,
  CreateAccountBody,
  CreateTransactionBody,
  InvoiceResponse,
  InvoiceStatus,
  ListTransactionsQuery,
  RecurrenceScope,
  TransactionResponse,
  UpdateAccountBody,
  UpdateTransactionBody,
} from '@sektor/contract';
import {
  accountBalance,
  addDays,
  addMonthsClamped,
  dateOccurrences,
  diffInDays,
  installmentDates,
  invoiceCycleFor,
  invoiceCycleForMonth,
  type LedgerAccount,
  type LedgerTransaction,
  monthRange,
  referenceMonthForDue,
  splitInstallments,
} from '@sektor/finance-engine';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { accounts, categories, invoices, recurrences, transactions } from '../db/schema';

import { AppError, type Ctx, notFound, stamp, todayIn } from './context';

/** Até onde os previstos de uma recorrência existem como lançamentos: 12 meses à frente. */
export const RECURRENCE_HORIZON_MONTHS = 12;

type Account = typeof accounts.$inferSelect;
type Invoice = typeof invoices.$inferSelect;
type Transaction = typeof transactions.$inferSelect;

interface TransactionTemplate {
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amountCents: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  description: string;
  notes: string | null;
}

export interface BankBill {
  dueDate: string;
  closingDate: string | null;
}

const liveTx = isNull(transactions.deletedAt);
const liveInvoice = isNull(invoices.deletedAt);

function softDeleteTransactions(ctx: Ctx, where: ReturnType<typeof eq>) {
  const now = Date.now();
  // O índice único de `paysInvoiceId` não pode segurar a linha apagada.
  ctx.db
    .update(transactions)
    .set({ deletedAt: now, updatedAt: now, paysInvoiceId: null })
    .where(where)
    .run();
}

// ---------------------------------------------------------------- donos

function ownedAccount(ctx: Ctx, id: string): Account {
  const account = ctx.db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, id), isNull(accounts.deletedAt)))
    .get();
  if (!account) throw notFound('Conta');
  return account;
}

function assertCategory(ctx: Ctx, id: string | null | undefined) {
  if (!id) return;
  const found = ctx.db
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.id, id), isNull(categories.deletedAt)))
    .get();
  if (!found) throw notFound('Categoria');
}

// ---------------------------------------------------------------- faturas

function upsertInvoice(
  ctx: Ctx,
  accountId: string,
  referenceMonth: string,
  dates: { closingDate: string; dueDate: string },
  overwrite: boolean
): Invoice {
  const existing = ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.accountId, accountId), eq(invoices.referenceMonth, referenceMonth)))
    .get();
  if (!existing) {
    return ctx.db
      .insert(invoices)
      .values({ ...stamp(), accountId, referenceMonth, ...dates })
      .returning()
      .get();
  }
  if (!existing.deletedAt && !overwrite) return existing;
  // Fatura aberta que esvaziou foi apagada: a compra nova a traz de volta.
  return ctx.db
    .update(invoices)
    .set({
      deletedAt: null,
      updatedAt: Date.now(),
      ...(existing.deletedAt || overwrite ? dates : {}),
    })
    .where(eq(invoices.id, existing.id))
    .returning()
    .get();
}

function ensureInvoice(ctx: Ctx, card: Account, date: string): Invoice {
  if (!card.closingDay || !card.dueDay) {
    throw new AppError(400, 'Cartão sem dia de fechamento ou de vencimento.');
  }
  const cycle = invoiceCycleFor(date, card.closingDay, card.dueDay);
  return upsertInvoice(ctx, card.id, cycle.referenceMonth, cycle, false);
}

/** O mês de fechamento da fatura que o banco diz que vence em `bill.dueDate`. */
export function billReferenceMonth(card: Account, bill: BankBill): string {
  if (!card.closingDay || !card.dueDay) {
    throw new AppError(400, 'Cartão sem dia de fechamento ou de vencimento.');
  }
  return bill.closingDate
    ? bill.closingDate.slice(0, 7)
    : referenceMonthForDue(bill.dueDate, card.closingDay, card.dueDay);
}

/**
 * A fatura que já existe para o vencimento do banco (até uma semana de diferença, a mais perto).
 * Pelo vencimento, e não pelo mês do fechamento: com o fechamento na virada do mês, o mês muda,
 * mas a fatura é a mesma.
 */
export function findBillInvoice(ctx: Ctx, cardId: string, dueDate: string) {
  const near = ctx.db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.accountId, cardId),
        liveInvoice,
        gte(invoices.dueDate, addDays(dueDate, -7)),
        lte(invoices.dueDate, addDays(dueDate, 7))
      )
    )
    .all();
  const distance = (d: string) => Math.abs(diffInDays(d, dueDate));
  return near.sort((a, b) => distance(a.dueDate) - distance(b.dueDate))[0] ?? null;
}

export function invoicePayment(ctx: Ctx, invoiceId: string): Transaction | null {
  return (
    ctx.db
      .select()
      .from(transactions)
      .where(and(eq(transactions.paysInvoiceId, invoiceId), liveTx))
      .get() ?? null
  );
}

export function ensureBillInvoice(ctx: Ctx, card: Account, bill: BankBill): Invoice {
  const bankDates = bill.closingDate
    ? { closingDate: bill.closingDate, dueDate: bill.dueDate }
    : null;
  const existing = findBillInvoice(ctx, card.id, bill.dueDate);
  if (existing) {
    if (!bankDates) return existing;
    return ctx.db
      .update(invoices)
      .set({ ...bankDates, updatedAt: Date.now() })
      .where(eq(invoices.id, existing.id))
      .returning()
      .get();
  }
  const referenceMonth = billReferenceMonth(card, bill);
  const cycle = invoiceCycleForMonth(referenceMonth, card.closingDay!, card.dueDay!);
  return upsertInvoice(ctx, card.id, referenceMonth, bankDates ?? cycle, Boolean(bankDates));
}

function openInvoiceIds(ctx: Ctx, accountId: string): Invoice[] {
  return ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.accountId, accountId), liveInvoice, isNull(invoices.paidAt)))
    .all()
    .filter((invoice) => !invoicePayment(ctx, invoice.id));
}

/** Fechamento ou vencimento mudou: as faturas em aberto passam às datas novas. */
export function redateOpenInvoices(ctx: Ctx, card: Account) {
  if (!card.closingDay || !card.dueDay) return;
  for (const invoice of openInvoiceIds(ctx, card.id)) {
    const cycle = invoiceCycleForMonth(invoice.referenceMonth, card.closingDay, card.dueDay);
    ctx.db
      .update(invoices)
      .set({ closingDate: cycle.closingDate, dueDate: cycle.dueDate, updatedAt: Date.now() })
      .where(eq(invoices.id, invoice.id))
      .run();
  }
  placeCardItems(ctx, card);
}

/**
 * Põe cada lançamento das faturas em aberto na fatura certa: a que o banco disse (`bills`, por
 * lançamento) ou, sem ela, a do ciclo da data. Fatura paga não muda; a aberta que esvaziar sai.
 */
export function placeCardItems(ctx: Ctx, card: Account, bills = new Map<string, BankBill>()) {
  if (!card.closingDay || !card.dueDay) return;
  const open = new Set(openInvoiceIds(ctx, card.id).map((invoice) => invoice.id));
  const items = ctx.db
    .select({ id: transactions.id, date: transactions.date, invoiceId: transactions.invoiceId })
    .from(transactions)
    .where(and(eq(transactions.accountId, card.id), isNull(transactions.paysInvoiceId), liveTx))
    .all()
    .filter((tx) => tx.invoiceId === null || open.has(tx.invoiceId));
  const emptied = new Set<string>();
  for (const tx of items) {
    const bill = bills.get(tx.id);
    const target = bill ? ensureBillInvoice(ctx, card, bill) : ensureInvoice(ctx, card, tx.date);
    if (target.id === tx.invoiceId || target.paidAt) continue;
    ctx.db
      .update(transactions)
      .set({ invoiceId: target.id, updatedAt: Date.now() })
      .where(eq(transactions.id, tx.id))
      .run();
    if (tx.invoiceId) emptied.add(tx.invoiceId);
  }
  for (const id of emptied) {
    const used = ctx.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.invoiceId, id), liveTx))
      .get();
    if (!used && !invoicePayment(ctx, id)) {
      ctx.db
        .update(invoices)
        .set({ deletedAt: Date.now(), updatedAt: Date.now() })
        .where(and(eq(invoices.id, id), isNull(invoices.paidAt)))
        .run();
    }
  }
}

function invoiceIdFor(
  ctx: Ctx,
  account: Account,
  date: string,
  paysInvoiceId: string | null = null
): string | null {
  if (account.type !== 'CREDIT_CARD' || paysInvoiceId) return null;
  return ensureInvoice(ctx, account, date).id;
}

/** Quanto a fatura cobra: compras e saques somam, estornos subtraem. */
export function invoiceTotal(items: Pick<Transaction, 'kind' | 'amountCents'>[]): number {
  return items.reduce(
    (sum, tx) => sum + (tx.kind === 'INCOME' ? -tx.amountCents : tx.amountCents),
    0
  );
}

export function invoiceStatus(
  invoice: Pick<Invoice, 'closingDate' | 'dueDate' | 'paidAt'>,
  today: string
): InvoiceStatus {
  if (invoice.paidAt) return 'PAID';
  if (today < invoice.closingDate) return 'OPEN';
  if (today > invoice.dueDate) return 'OVERDUE';
  return 'CLOSED';
}

function invoiceItems(ctx: Ctx, invoiceId: string) {
  return ctx.db
    .select({ kind: transactions.kind, amountCents: transactions.amountCents })
    .from(transactions)
    .where(and(eq(transactions.invoiceId, invoiceId), liveTx))
    .all();
}

export function toInvoice(ctx: Ctx, invoice: Invoice, today: string): InvoiceResponse {
  return {
    id: invoice.id,
    accountId: invoice.accountId,
    referenceMonth: invoice.referenceMonth,
    closingDate: invoice.closingDate,
    dueDate: invoice.dueDate,
    totalCents: invoiceTotal(invoiceItems(ctx, invoice.id)),
    status: invoiceStatus(invoice, today),
    paidAt: invoice.paidAt ? new Date(invoice.paidAt).toISOString() : null,
    paymentTransactionId: invoicePayment(ctx, invoice.id)?.id ?? null,
  };
}

export function listInvoices(ctx: Ctx, accountId: string): InvoiceResponse[] {
  const card = ownedAccount(ctx, accountId);
  if (card.type !== 'CREDIT_CARD') throw new AppError(400, 'A conta não é um cartão.');
  const today = todayIn(ctx);
  return ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.accountId, accountId), liveInvoice))
    .orderBy(desc(invoices.referenceMonth))
    .all()
    .map((invoice) => toInvoice(ctx, invoice, today));
}

/** Faturas ainda sem pagamento que vencem no período, com algo a cobrar. */
export function listDueInvoices(ctx: Ctx, query: { month?: string; from?: string; to?: string }) {
  const range = query.month ? monthRange(query.month) : null;
  const from = query.from ?? range?.first;
  const to = query.to ?? range?.last;
  const today = todayIn(ctx);
  return ctx.db
    .select({ invoice: invoices })
    .from(invoices)
    .innerJoin(accounts, eq(accounts.id, invoices.accountId))
    .where(
      and(
        liveInvoice,
        isNull(invoices.paidAt),
        isNull(accounts.archivedAt),
        from ? gte(invoices.dueDate, from) : undefined,
        to ? lte(invoices.dueDate, to) : undefined
      )
    )
    .orderBy(asc(invoices.dueDate), asc(invoices.createdAt))
    .all()
    .map(({ invoice }) => toInvoice(ctx, invoice, today))
    .filter((invoice) => invoice.totalCents > 0 && !invoice.paymentTransactionId);
}

export function invoiceTransactions(ctx: Ctx, invoiceId: string): TransactionResponse[] {
  const invoice = ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), liveInvoice))
    .get();
  if (!invoice) throw notFound('Fatura');
  return ctx.db
    .select({ tx: transactions, rrule: recurrences.rrule })
    .from(transactions)
    .leftJoin(recurrences, eq(recurrences.id, transactions.recurrenceId))
    .where(and(eq(transactions.invoiceId, invoiceId), liveTx))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .all()
    .map(toTransaction);
}

export function payInvoice(
  ctx: Ctx,
  invoiceId: string,
  options: { fromAccountId?: string; date?: string; amountCents?: number } = {}
): InvoiceResponse {
  const invoice = ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), liveInvoice))
    .get();
  if (!invoice) throw notFound('Fatura');
  if (invoice.paidAt || invoicePayment(ctx, invoiceId)) {
    throw new AppError(409, 'Esta fatura já foi paga.');
  }
  const card = ownedAccount(ctx, invoice.accountId);
  const total = invoiceTotal(invoiceItems(ctx, invoiceId));
  if (total <= 0) throw new AppError(400, 'A fatura não tem valor a pagar.');

  const fromAccountId = options.fromAccountId ?? card.paymentAccountId;
  if (!fromAccountId) throw new AppError(400, 'Escolha a conta que paga a fatura.');
  const from = ownedAccount(ctx, fromAccountId);
  if (from.type === 'CREDIT_CARD') {
    throw new AppError(400, 'Uma fatura não pode ser paga com cartão.');
  }

  const date = options.date ?? todayIn(ctx);
  const [year, month] = invoice.referenceMonth.split('-');
  ctx.db.transaction(() => {
    ctx.db
      .insert(transactions)
      .values({
        ...stamp(),
        kind: 'TRANSFER',
        amountCents: options.amountCents ?? total,
        date,
        accountId: from.id,
        toAccountId: invoice.accountId,
        description: `Fatura ${card.name} ${month}/${year}`,
        status: 'DONE',
        paysInvoiceId: invoice.id,
      })
      .run();
    ctx.db
      .update(invoices)
      .set({ paidAt: Date.now(), updatedAt: Date.now() })
      .where(eq(invoices.id, invoice.id))
      .run();
  });
  const updated = ctx.db.select().from(invoices).where(eq(invoices.id, invoice.id)).get()!;
  return toInvoice(ctx, updated, todayIn(ctx));
}

/**
 * Compra parcelada em que o banco manda uma parcela por fatura: a partir da parcela `number` já
 * lançada, cria as seguintes até `total`, para o cartão já contar com elas. Quando o banco mandar
 * cada uma, ela casa pelo número. Não faz nada se a série já tem parcela depois desta.
 */
export function completeInstallments(
  ctx: Ctx,
  transactionId: string,
  number: number,
  total: number,
  title: (n: number) => string
): string[] {
  return ctx.db.transaction(() => {
    const tx = ctx.db
      .select()
      .from(transactions)
      .where(
        and(
          eq(transactions.id, transactionId),
          eq(transactions.kind, 'EXPENSE'),
          isNull(transactions.recurrenceId),
          liveTx
        )
      )
      .get();
    if (!tx) return [];
    const account = ownedAccount(ctx, tx.accountId);
    if (account.type !== 'CREDIT_CARD' || number >= total) return [];
    if (tx.installmentGroupId) {
      const later = ctx.db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(
            eq(transactions.installmentGroupId, tx.installmentGroupId),
            gt(transactions.installmentNumber, number),
            liveTx
          )
        )
        .get();
      if (later) return [];
    }
    const groupId = tx.installmentGroupId ?? randomUUID();
    ctx.db
      .update(transactions)
      .set({
        installmentGroupId: groupId,
        installmentNumber: number,
        installmentTotal: total,
        updatedAt: Date.now(),
      })
      .where(eq(transactions.id, tx.id))
      .run();
    const ids: string[] = [];
    for (let n = number + 1; n <= total; n++) {
      const date = addMonthsClamped(tx.date, n - number);
      const row = stamp();
      ids.push(row.id);
      ctx.db
        .insert(transactions)
        .values({
          ...row,
          kind: 'EXPENSE',
          amountCents: tx.amountCents,
          date,
          accountId: tx.accountId,
          categoryId: tx.categoryId,
          description: title(n),
          notes: tx.notes,
          status: 'DONE',
          installmentGroupId: groupId,
          installmentNumber: n,
          installmentTotal: total,
          invoiceId: invoiceIdFor(ctx, account, date),
        })
        .run();
    }
    return ids;
  });
}

/** Um débito lançado como despesa era o pagamento da fatura: vira a transferência que a paga. */
export function turnIntoInvoicePayment(ctx: Ctx, invoiceId: string, transactionId: string) {
  const invoice = ctx.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), liveInvoice))
    .get();
  if (!invoice || invoicePayment(ctx, invoiceId)) return false;
  const tx = ctx.db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.id, transactionId),
        eq(transactions.kind, 'EXPENSE'),
        isNull(transactions.invoiceId),
        liveTx
      )
    )
    .get();
  if (!tx || tx.accountId === invoice.accountId) return false;
  ctx.db.transaction(() => {
    ctx.db
      .update(transactions)
      .set({
        kind: 'TRANSFER',
        toAccountId: invoice.accountId,
        categoryId: null,
        paysInvoiceId: invoice.id,
        recurrenceId: null,
        updatedAt: Date.now(),
      })
      .where(eq(transactions.id, tx.id))
      .run();
    ctx.db
      .update(invoices)
      .set({ paidAt: Date.now(), updatedAt: Date.now() })
      .where(eq(invoices.id, invoice.id))
      .run();
  });
  return true;
}

// ---------------------------------------------------------------- contas

export function toLedgerTx(tx: Transaction): LedgerTransaction {
  return {
    kind: tx.kind,
    amountCents: tx.amountCents,
    date: tx.date,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId,
    status: tx.status,
  };
}

export function toLedgerAccount(account: Account): LedgerAccount {
  return { id: account.id, type: account.type, initialBalanceCents: account.initialBalanceCents };
}

export function listAccounts(ctx: Ctx, includeArchived = false): AccountResponse[] {
  const today = todayIn(ctx);
  const rows = ctx.db
    .select()
    .from(accounts)
    .where(
      and(isNull(accounts.deletedAt), includeArchived ? undefined : isNull(accounts.archivedAt))
    )
    .orderBy(asc(accounts.type), asc(accounts.createdAt))
    .all();
  const ledger = ctx.db.select().from(transactions).where(liveTx).all().map(toLedgerTx);

  const openInvoices = new Map<string, number>();
  // Fatura paga por fora: não tem transferência, então o saldo do cartão só deixa de dever essas
  // compras somando-as de volta.
  const paidElsewhere = new Map<string, number>();
  for (const card of rows.filter((a) => a.type === 'CREDIT_CARD')) {
    const cardInvoices = ctx.db
      .select()
      .from(invoices)
      .where(and(eq(invoices.accountId, card.id), liveInvoice))
      .orderBy(asc(invoices.referenceMonth))
      .all();
    for (const invoice of cardInvoices) {
      const total = invoiceTotal(invoiceItems(ctx, invoice.id));
      if (invoice.paidAt && !invoicePayment(ctx, invoice.id)) {
        paidElsewhere.set(card.id, (paidElsewhere.get(card.id) ?? 0) + total);
      }
      if (invoiceStatus(invoice, today) === 'OPEN' && !openInvoices.has(card.id)) {
        openInvoices.set(card.id, total);
      }
    }
  }

  return rows.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    initialBalanceCents: account.initialBalanceCents,
    color: account.color,
    closingDay: account.closingDay,
    dueDay: account.dueDay,
    paymentAccountId: account.paymentAccountId,
    archived: Boolean(account.archivedAt),
    balanceCents:
      accountBalance(toLedgerAccount(account), ledger) + (paidElsewhere.get(account.id) ?? 0),
    expectedBalanceCents:
      accountBalance(toLedgerAccount(account), ledger, { plannedUntil: today }) +
      (paidElsewhere.get(account.id) ?? 0),
    openInvoiceCents: account.type === 'CREDIT_CARD' ? (openInvoices.get(account.id) ?? 0) : null,
  }));
}

function accountResponse(ctx: Ctx, id: string) {
  return listAccounts(ctx, true).find((account) => account.id === id)!;
}

export function createAccount(ctx: Ctx, body: CreateAccountBody): AccountResponse {
  if (body.paymentAccountId) ownedAccount(ctx, body.paymentAccountId);
  const isCard = body.type === 'CREDIT_CARD';
  const { id } = ctx.db
    .insert(accounts)
    .values({
      ...stamp(),
      name: body.name,
      type: body.type,
      initialBalanceCents: isCard ? 0 : body.initialBalanceCents,
      color: body.color ?? null,
      closingDay: isCard ? body.closingDay : null,
      dueDay: isCard ? body.dueDay : null,
      paymentAccountId: isCard ? (body.paymentAccountId ?? null) : null,
    })
    .returning()
    .get();
  return accountResponse(ctx, id);
}

export function updateAccount(ctx: Ctx, id: string, input: UpdateAccountBody): AccountResponse {
  const { archived, ...body } = input;
  const account = ownedAccount(ctx, id);
  if (body.paymentAccountId === id) throw new AppError(400, 'O cartão não pode pagar a si mesmo.');
  const updated = ctx.db
    .update(accounts)
    .set({
      ...body,
      updatedAt: Date.now(),
      ...(archived === undefined ? {} : { archivedAt: archived ? Date.now() : null }),
    })
    .where(eq(accounts.id, id))
    .returning()
    .get();
  if (
    updated.type === 'CREDIT_CARD' &&
    (updated.closingDay !== account.closingDay || updated.dueDay !== account.dueDay)
  ) {
    redateOpenInvoices(ctx, updated);
  }
  return accountResponse(ctx, id);
}

export function deleteAccount(ctx: Ctx, id: string) {
  ownedAccount(ctx, id);
  const used = ctx.db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(or(eq(transactions.accountId, id), eq(transactions.toAccountId, id)), liveTx))
    .get();
  if (used) throw new AppError(409, 'A conta tem lançamentos. Arquive em vez de apagar.');
  ctx.db
    .update(accounts)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(accounts.id, id))
    .run();
}

// ---------------------------------------------------------------- lançamentos

function toTransaction(row: { tx: Transaction; rrule: string | null }): TransactionResponse {
  const { tx, rrule } = row;
  return {
    id: tx.id,
    kind: tx.kind,
    amountCents: tx.amountCents,
    date: tx.date,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId,
    categoryId: tx.categoryId,
    description: tx.description,
    notes: tx.notes,
    status: tx.status,
    recurrenceId: tx.recurrenceId,
    recurrenceRule: rrule,
    installmentGroupId: tx.installmentGroupId,
    installmentNumber: tx.installmentNumber,
    installmentTotal: tx.installmentTotal,
    invoiceId: tx.invoiceId,
    paysInvoiceId: tx.paysInvoiceId,
  };
}

function withRecurrence(ctx: Ctx, ids: string[]): TransactionResponse[] {
  return ctx.db
    .select({ tx: transactions, rrule: recurrences.rrule })
    .from(transactions)
    .leftJoin(recurrences, eq(recurrences.id, transactions.recurrenceId))
    .where(inArray(transactions.id, ids))
    .orderBy(asc(transactions.date))
    .all()
    .map(toTransaction);
}

const defaultStatus = (date: string, today: string) => (date <= today ? 'DONE' : 'PLANNED');

function validateTemplate(ctx: Ctx, template: TransactionTemplate): Account {
  const account = ownedAccount(ctx, template.accountId);
  if (template.kind === 'TRANSFER') {
    if (!template.toAccountId) throw new AppError(400, 'Escolha a conta de destino.');
    if (template.toAccountId === template.accountId) {
      throw new AppError(400, 'Origem e destino precisam ser contas diferentes.');
    }
    ownedAccount(ctx, template.toAccountId);
  }
  assertCategory(ctx, template.categoryId);
  return account;
}

function templateFrom(body: CreateTransactionBody): TransactionTemplate {
  return {
    kind: body.kind,
    amountCents: body.amountCents,
    accountId: body.accountId,
    toAccountId: body.kind === 'TRANSFER' ? (body.toAccountId ?? null) : null,
    categoryId: body.kind === 'TRANSFER' ? null : (body.categoryId ?? null),
    description: body.description,
    notes: body.notes ?? null,
  };
}

export function listTransactions(ctx: Ctx, query: ListTransactionsQuery): TransactionResponse[] {
  const range = query.month ? monthRange(query.month) : null;
  const from = query.from ?? range?.first;
  const to = query.to ?? range?.last;
  const escaped = query.search?.replace(/[\\%_]/g, '\\$&');
  return ctx.db
    .select({ tx: transactions, rrule: recurrences.rrule })
    .from(transactions)
    .leftJoin(recurrences, eq(recurrences.id, transactions.recurrenceId))
    .where(
      and(
        liveTx,
        from ? gte(transactions.date, from) : undefined,
        to ? lte(transactions.date, to) : undefined,
        query.accountId
          ? or(
              eq(transactions.accountId, query.accountId),
              eq(transactions.toAccountId, query.accountId)
            )
          : undefined,
        query.categoryId
          ? inArray(
              transactions.categoryId,
              ctx.db
                .select({ id: categories.id })
                .from(categories)
                .where(
                  or(eq(categories.id, query.categoryId), eq(categories.parentId, query.categoryId))
                )
            )
          : undefined,
        query.kind ? eq(transactions.kind, query.kind) : undefined,
        query.status ? eq(transactions.status, query.status) : undefined,
        escaped ? sql`${transactions.description} LIKE ${`%${escaped}%`} ESCAPE '\\'` : undefined
      )
    )
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(2000)
    .all()
    .map(toTransaction);
}

/** `bill`: a fatura que o banco já disse (só para um lançamento simples no cartão). */
export function createTransactions(
  ctx: Ctx,
  body: CreateTransactionBody,
  options: { bill?: BankBill } = {}
): TransactionResponse[] {
  const today = todayIn(ctx);
  const template = templateFrom(body);

  return ctx.db.transaction(() => {
    const account = validateTemplate(ctx, template);
    const rows: (typeof transactions.$inferInsert)[] = [];

    if (body.installments) {
      const amounts = splitInstallments(body.amountCents, body.installments);
      const dates = installmentDates(body.date, body.installments);
      const groupId = randomUUID();
      for (let i = 0; i < amounts.length; i++) {
        // No cartão a compra parcelada já está feita: cada parcela cai numa fatura.
        const status =
          account.type === 'CREDIT_CARD'
            ? 'DONE'
            : i === 0 && body.status
              ? body.status
              : defaultStatus(dates[i]!, today);
        rows.push({
          ...stamp(),
          ...template,
          amountCents: amounts[i]!,
          date: dates[i]!,
          status,
          installmentGroupId: groupId,
          installmentNumber: i + 1,
          installmentTotal: amounts.length,
          invoiceId: invoiceIdFor(ctx, account, dates[i]!),
        });
      }
    } else if (body.recurrence) {
      const horizon = addMonthsClamped(
        today > body.date ? today : body.date,
        RECURRENCE_HORIZON_MONTHS
      );
      const recurrence = ctx.db
        .insert(recurrences)
        .values({
          ...stamp(),
          rrule: body.recurrence.rrule,
          startDate: body.date,
          template,
          generatedUntil: horizon,
        })
        .returning()
        .get();
      const dates = dateOccurrences(body.recurrence.rrule, body.date, body.date, horizon);
      if (dates.length === 0) throw new AppError(400, 'A recorrência não gera nenhuma data.');
      for (const [i, date] of dates.entries()) {
        rows.push({
          ...stamp(),
          ...template,
          date,
          status: i === 0 && body.status ? body.status : defaultStatus(date, today),
          recurrenceId: recurrence.id,
          invoiceId: invoiceIdFor(ctx, account, date),
        });
      }
    } else {
      rows.push({
        ...stamp(),
        ...template,
        date: body.date,
        status: body.status ?? defaultStatus(body.date, today),
        invoiceId:
          options.bill && account.type === 'CREDIT_CARD'
            ? ensureBillInvoice(ctx, account, options.bill).id
            : invoiceIdFor(ctx, account, body.date),
      });
    }

    for (const row of rows) ctx.db.insert(transactions).values(row).run();
    return withRecurrence(
      ctx,
      rows.map((row) => row.id)
    );
  });
}

export function updateTransaction(
  ctx: Ctx,
  id: string,
  body: Partial<UpdateTransactionBody>
): TransactionResponse {
  const existing = ctx.db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), liveTx))
    .get();
  if (!existing) throw notFound('Lançamento');
  const { scope = 'single', ...fields } = body;

  return ctx.db.transaction(() => {
    const merged: TransactionTemplate = {
      kind: existing.kind,
      amountCents: fields.amountCents ?? existing.amountCents,
      accountId: fields.accountId ?? existing.accountId,
      toAccountId:
        existing.kind === 'TRANSFER'
          ? fields.toAccountId !== undefined
            ? fields.toAccountId
            : existing.toAccountId
          : null,
      categoryId:
        existing.kind === 'TRANSFER'
          ? null
          : fields.categoryId !== undefined
            ? fields.categoryId
            : existing.categoryId,
      description: fields.description ?? existing.description,
      notes: fields.notes !== undefined ? fields.notes : existing.notes,
    };
    const account = validateTemplate(ctx, merged);
    const date = fields.date ?? existing.date;

    if (scope === 'future' && existing.recurrenceId) {
      const recurrence = ctx.db
        .select()
        .from(recurrences)
        .where(eq(recurrences.id, existing.recurrenceId))
        .get()!;
      ctx.db
        .update(recurrences)
        .set({
          template: { ...(recurrence.template as TransactionTemplate), ...merged },
          updatedAt: Date.now(),
        })
        .where(eq(recurrences.id, recurrence.id))
        .run();
      const followers = ctx.db
        .select()
        .from(transactions)
        .where(
          and(
            eq(transactions.recurrenceId, recurrence.id),
            gt(transactions.date, existing.date),
            eq(transactions.isRecurrenceException, false),
            liveTx
          )
        )
        .all();
      for (const tx of followers) {
        ctx.db
          .update(transactions)
          .set({
            ...merged,
            invoiceId: invoiceIdFor(ctx, account, tx.date),
            updatedAt: Date.now(),
          })
          .where(eq(transactions.id, tx.id))
          .run();
      }
    }

    ctx.db
      .update(transactions)
      .set({
        ...merged,
        date,
        status: fields.status ?? existing.status,
        invoiceId: invoiceIdFor(ctx, account, date, existing.paysInvoiceId),
        isRecurrenceException:
          existing.recurrenceId && scope === 'single' ? true : existing.isRecurrenceException,
        updatedAt: Date.now(),
      })
      .where(eq(transactions.id, id))
      .run();
    return withRecurrence(ctx, [id])[0]!;
  });
}

/** Encerra a regra no dia anterior a `date`, para a extensão não recriar o que foi apagado. */
function endRuleBefore(rrule: string, date: string): string {
  const until = addDays(date, -1).replace(/-/g, '');
  const parts = rrule.split(';').filter((part) => !/^(UNTIL|COUNT)=/.test(part));
  return [...parts, `UNTIL=${until}T235959Z`].join(';');
}

export function deleteTransaction(ctx: Ctx, id: string, scope: RecurrenceScope = 'single') {
  const existing = ctx.db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, id), liveTx))
    .get();
  if (!existing) throw notFound('Lançamento');

  ctx.db.transaction(() => {
    if (existing.paysInvoiceId) {
      ctx.db
        .update(invoices)
        .set({ paidAt: null, updatedAt: Date.now() })
        .where(eq(invoices.id, existing.paysInvoiceId))
        .run();
    }
    if (scope === 'future' && existing.recurrenceId) {
      const recurrence = ctx.db
        .select()
        .from(recurrences)
        .where(eq(recurrences.id, existing.recurrenceId))
        .get()!;
      ctx.db
        .update(recurrences)
        .set({ rrule: endRuleBefore(recurrence.rrule, existing.date), updatedAt: Date.now() })
        .where(eq(recurrences.id, recurrence.id))
        .run();
      softDeleteTransactions(
        ctx,
        and(eq(transactions.recurrenceId, recurrence.id), gte(transactions.date, existing.date), liveTx)!
      );
      return;
    }
    softDeleteTransactions(ctx, eq(transactions.id, id));
  });
}

/** Mantém cada recorrência com previstos até 12 meses à frente. Idempotente. */
export function extendRecurrences(ctx: Ctx, now = new Date()): number {
  const today = todayIn(ctx, now);
  const horizon = addMonthsClamped(today, RECURRENCE_HORIZON_MONTHS);
  let created = 0;

  for (const recurrence of ctx.db
    .select()
    .from(recurrences)
    .where(isNull(recurrences.deletedAt))
    .all()) {
    if (recurrence.generatedUntil >= horizon) continue;
    const template = recurrence.template as TransactionTemplate;
    const account = ctx.db.select().from(accounts).where(eq(accounts.id, template.accountId)).get();
    if (!account || account.deletedAt) continue;

    const dates = dateOccurrences(
      recurrence.rrule,
      recurrence.startDate,
      addDays(recurrence.generatedUntil, 1),
      horizon
    );
    ctx.db.transaction(() => {
      for (const date of dates) {
        ctx.db
          .insert(transactions)
          .values({
            ...stamp(),
            ...template,
            date,
            status: 'PLANNED',
            recurrenceId: recurrence.id,
            invoiceId: invoiceIdFor(ctx, account, date),
          })
          .run();
      }
      ctx.db
        .update(recurrences)
        .set({ generatedUntil: horizon, updatedAt: Date.now() })
        .where(eq(recurrences.id, recurrence.id))
        .run();
    });
    created += dates.length;
  }
  return created;
}

