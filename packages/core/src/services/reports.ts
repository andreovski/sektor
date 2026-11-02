import type {
  BudgetStatusResponse,
  ForecastResponse,
  MonthSummaryResponse,
  UpsertBudgetBody,
} from '@sektor/contract';
import {
  addDays,
  addMonthsToMonth,
  budgetLevel,
  type LedgerTransaction,
  monthRange,
  projectBalances,
} from '@sektor/finance-engine';
import { and, asc, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { accounts, budgets, categories, invoices, transactions } from '../db/schema';

import { AppError, type Ctx, notFound, stamp, todayIn } from './context';
import { invoiceBalances, toLedgerAccount, toLedgerTx } from './finance';

type Transaction = typeof transactions.$inferSelect;

/** Fatura do período cujo cartão não tem conta pagadora ativa. */
export interface UnassignedInvoice {
  invoiceId: string;
  accountId: string;
  cardName: string;
  referenceMonth: string;
  dueDate: string;
  totalCents: number;
  /** Conta em que a previsão a contou. Nula quando não há conta nenhuma. */
  payerAccountId: string | null;
}

function monthTransactions(ctx: Ctx, month: string) {
  const { first, last } = monthRange(month);
  return ctx.db
    .select()
    .from(transactions)
    .where(
      and(
        isNull(transactions.deletedAt),
        inArray(transactions.kind, ['INCOME', 'EXPENSE']),
        gte(transactions.date, first),
        lte(transactions.date, last)
      )
    )
    .all();
}

function totalsByCategory(rows: Transaction[], kind: 'INCOME' | 'EXPENSE') {
  const totals = new Map<string | null, number>();
  for (const tx of rows) {
    if (tx.kind !== kind || tx.status !== 'DONE') continue;
    totals.set(tx.categoryId, (totals.get(tx.categoryId) ?? 0) + tx.amountCents);
  }
  return [...totals.entries()]
    .map(([categoryId, totalCents]) => ({ categoryId, totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents);
}

const sum = (rows: Transaction[], kind: 'INCOME' | 'EXPENSE', status: 'DONE' | 'PLANNED') =>
  rows
    .filter((tx) => tx.kind === kind && tx.status === status)
    .reduce((total, tx) => total + tx.amountCents, 0);

export function monthSummary(ctx: Ctx, month: string): MonthSummaryResponse {
  const previousMonth = addMonthsToMonth(month, -1);
  const current = monthTransactions(ctx, month);
  const previous = monthTransactions(ctx, previousMonth);
  const incomeCents = sum(current, 'INCOME', 'DONE');
  const expenseCents = sum(current, 'EXPENSE', 'DONE');
  return {
    month,
    incomeCents,
    expenseCents,
    netCents: incomeCents - expenseCents,
    plannedIncomeCents: sum(current, 'INCOME', 'PLANNED'),
    plannedExpenseCents: sum(current, 'EXPENSE', 'PLANNED'),
    expenseByCategory: totalsByCategory(current, 'EXPENSE'),
    incomeByCategory: totalsByCategory(current, 'INCOME'),
    previous: {
      month: previousMonth,
      incomeCents: sum(previous, 'INCOME', 'DONE'),
      expenseCents: sum(previous, 'EXPENSE', 'DONE'),
      expenseByCategory: totalsByCategory(previous, 'EXPENSE'),
    },
  };
}

/**
 * Saldo dia a dia. Além dos previstos, cada fatura não paga entra como uma transferência prevista
 * da conta de pagamento para o cartão no vencimento. Cartão sem conta pagadora ativa cai na primeira
 * conta ativa, e a fatura volta em `unassignedInvoices` para a tela avisar.
 */
export function forecast(
  ctx: Ctx,
  days: number
): ForecastResponse & { unassignedInvoices: UnassignedInvoice[] } {
  if (![30, 90, 365].includes(days)) throw new AppError(400, 'Período inválido.');
  const start = todayIn(ctx);
  const open = ctx.db
    .select()
    .from(accounts)
    .where(and(isNull(accounts.deletedAt), isNull(accounts.archivedAt)))
    .orderBy(asc(accounts.type), asc(accounts.createdAt))
    .all();
  const ledger: LedgerTransaction[] = ctx.db
    .select()
    .from(transactions)
    .where(isNull(transactions.deletedAt))
    .all()
    .map(toLedgerTx);
  const ids = new Set(open.map((a) => a.id));
  const fallback = open.find((a) => a.type !== 'CREDIT_CARD')?.id ?? null;
  const lastDay = addDays(start, days - 1);
  const unpaid = ctx.db
    .select({ invoice: invoices, card: accounts })
    .from(invoices)
    .innerJoin(accounts, eq(accounts.id, invoices.accountId))
    .where(and(isNull(invoices.deletedAt), isNull(invoices.paidAt)))
    .all();
  const balances = new Map<string, ReturnType<typeof invoiceBalances>>();
  const unassignedInvoices: UnassignedInvoice[] = [];
  for (const { invoice, card } of unpaid) {
    if (!balances.has(card.id)) balances.set(card.id, invoiceBalances(ctx, card.id));
    const total = balances.get(card.id)!.get(invoice.id)!.totalCents;
    if (total <= 0) continue;
    const assigned = card.paymentAccountId && ids.has(card.paymentAccountId);
    const payer = assigned ? card.paymentAccountId : fallback;
    if (!assigned && invoice.dueDate <= lastDay) {
      unassignedInvoices.push({
        invoiceId: invoice.id,
        accountId: card.id,
        cardName: card.name,
        referenceMonth: invoice.referenceMonth,
        dueDate: invoice.dueDate,
        totalCents: total,
        payerAccountId: payer,
      });
    }
    if (!payer) continue;
    ledger.push({
      kind: 'TRANSFER',
      amountCents: total,
      date: invoice.dueDate,
      accountId: payer,
      toAccountId: invoice.accountId,
      status: 'PLANNED',
    });
  }
  const result = projectBalances(open.map(toLedgerAccount), ledger, start, days);
  unassignedInvoices.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { start, days: result.days, firstNegative: result.firstNegative, unassignedInvoices };
}

// ---------------------------------------------------------------- orçamentos

export function budgetStatuses(ctx: Ctx, month: string): BudgetStatusResponse[] {
  const rows = ctx.db
    .select()
    .from(budgets)
    .where(and(eq(budgets.month, month), isNull(budgets.deletedAt)))
    .all();
  const all = ctx.db
    .select({ id: categories.id, parentId: categories.parentId })
    .from(categories)
    .all();
  const txs = monthTransactions(ctx, month);

  // Orçamento de uma categoria-mãe cobre as subcategorias.
  const parentOf = new Map(all.map((c) => [c.id, c.parentId]));
  const covers = (budgetCategoryId: string, categoryId: string | null) =>
    categoryId === budgetCategoryId ||
    (categoryId !== null && parentOf.get(categoryId) === budgetCategoryId);

  return rows.map((budget) => {
    const matching = txs.filter(
      (tx) => tx.kind === 'EXPENSE' && covers(budget.categoryId, tx.categoryId)
    );
    const spentCents = matching
      .filter((tx) => tx.status === 'DONE')
      .reduce((total, tx) => total + tx.amountCents, 0);
    const plannedCents = matching
      .filter((tx) => tx.status === 'PLANNED')
      .reduce((total, tx) => total + tx.amountCents, 0);
    return {
      id: budget.id,
      categoryId: budget.categoryId,
      month,
      limitCents: budget.limitCents,
      spentCents,
      plannedCents,
      ratio: budget.limitCents > 0 ? spentCents / budget.limitCents : 0,
      level: budgetLevel(spentCents, budget.limitCents),
    };
  });
}

function writeBudget(ctx: Ctx, categoryId: string, month: string, limitCents: number) {
  ctx.db
    .insert(budgets)
    .values({ ...stamp(), categoryId, month, limitCents })
    .onConflictDoUpdate({
      target: [budgets.categoryId, budgets.month],
      set: { limitCents, deletedAt: null, updatedAt: Date.now() },
    })
    .run();
}

export function upsertBudget(ctx: Ctx, body: UpsertBudgetBody) {
  const category = ctx.db
    .select()
    .from(categories)
    .where(and(eq(categories.id, body.categoryId), isNull(categories.deletedAt)))
    .get();
  if (!category) throw notFound('Categoria não encontrada.');
  if (category.kind !== 'EXPENSE') throw new AppError(400, 'Orçamento é só para despesas.');
  writeBudget(ctx, body.categoryId, body.month, body.limitCents);
  return budgetStatuses(ctx, body.month).find((s) => s.categoryId === body.categoryId)!;
}

/** Copia os orçamentos do mês anterior, sem sobrescrever os que já existem. */
export function copyPreviousBudgets(ctx: Ctx, month: string) {
  const current = new Set(budgetStatuses(ctx, month).map((b) => b.categoryId));
  const previous = ctx.db
    .select()
    .from(budgets)
    .where(and(eq(budgets.month, addMonthsToMonth(month, -1)), isNull(budgets.deletedAt)))
    .all();
  for (const budget of previous) {
    if (!current.has(budget.categoryId)) {
      writeBudget(ctx, budget.categoryId, month, budget.limitCents);
    }
  }
  return budgetStatuses(ctx, month);
}

export function deleteBudget(ctx: Ctx, id: string) {
  const { changes } = ctx.db
    .update(budgets)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(budgets.id, id), isNull(budgets.deletedAt)))
    .run();
  if (changes === 0) throw notFound('Orçamento não encontrado.');
}
