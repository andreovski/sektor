import type { CreateTransactionBody } from '@sektor/contract';
import { addDays, addMonthsToMonth, monthOf, monthRange } from '@sektor/finance-engine';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';

import { appMeta, categories, recurrences, transactions } from '../../db/schema';
import { AppError, type Ctx, notFound, stamp, todayIn } from '../../services/context';
import * as fin from '../../services/finance';

import { listGoals } from '../goals/service';

import { computeAvailable, goalContributions, monthChanges, type MonthRow } from './available';
import { byCost, comparePlans, debtTotals, simulateRenegotiation } from './debts';
import { detectFixedBills, matchRule, plainText, recurringKey } from './rules';
import { categoryRules, debts, importLines, recurringDismissals } from './schema';
import {
  type ImportMode,
  type LineStatus,
  markDuplicates,
  parseStatement,
  toEntries,
} from './statement';

const liveTx = isNull(transactions.deletedAt);

// ---------------------------------------------------------------- ajustes

const CAP_KEY = 'plus.dailyCapCents';

function readNumber(ctx: Ctx, key: string): number | null {
  const row = ctx.db.select().from(appMeta).where(eq(appMeta.key, key)).get();
  return row ? Number(row.value) : null;
}

function writeNumber(ctx: Ctx, key: string, value: number | null) {
  if (value === null) {
    ctx.db.delete(appMeta).where(eq(appMeta.key, key)).run();
    return;
  }
  const row = { value: String(value), updatedAt: Date.now() };
  ctx.db
    .insert(appMeta)
    .values({ key, ...row })
    .onConflictDoUpdate({ target: appMeta.key, set: row })
    .run();
}

export function saveAvailableSettings(ctx: Ctx, input: { dailyCapCents: number | null }) {
  writeNumber(ctx, CAP_KEY, input.dailyCapCents);
}

// ---------------------------------------------------------------- disponível hoje

export function available(ctx: Ctx) {
  const today = todayIn(ctx);
  const month = monthOf(today);
  const { first, last } = monthRange(month);
  const previousMonth = addMonthsToMonth(month, -1);

  const allAccounts = fin.listAccounts(ctx);
  const open = allAccounts.filter((account) => account.type !== 'CREDIT_CARD');
  const openIds = open.map((account) => account.id);

  // Cartão fica de fora dos previstos: ele já chega aqui pela fatura.
  const planned = ctx.db
    .select()
    .from(transactions)
    .where(
      and(
        liveTx,
        eq(transactions.status, 'PLANNED'),
        lte(transactions.date, last),
        inArray(transactions.accountId, openIds)
      )
    )
    .all();
  const plannedExpenses = planned
    .filter((tx) => tx.kind === 'EXPENSE')
    .sort((a, b) => a.date.localeCompare(b.date));
  // Receita prevista atrasada não conta: se não chegou no dia, não dá para contar com ela.
  const plannedIncomeCents = planned
    .filter((tx) => tx.kind === 'INCOME' && tx.date >= today)
    .reduce((sum, tx) => sum + tx.amountCents, 0);

  const invoices = fin.listDueInvoices(ctx, { to: last });
  const names = new Map(allAccounts.map((account) => [account.id, account.name]));

  const history = ctx.db
    .select()
    .from(transactions)
    .where(
      and(
        liveTx,
        eq(transactions.status, 'DONE'),
        inArray(transactions.kind, ['INCOME', 'EXPENSE']),
        gte(transactions.date, monthRange(previousMonth).first),
        lte(transactions.date, today)
      )
    )
    .all();
  const spending = history
    .filter((tx) => tx.kind === 'EXPENSE' && tx.date >= first)
    .map((tx) => ({
      date: tx.date,
      amountCents: tx.amountCents,
      fixed: Boolean(tx.recurrenceId || tx.installmentGroupId),
    }));

  const goalItems = goalContributions(listGoals(ctx));
  const result = computeAvailable({
    today,
    balanceCents: open.reduce((sum, account) => sum + account.balanceCents, 0),
    plannedExpenses,
    invoices,
    goalsCents: goalItems.reduce((sum, goal) => sum + goal.amountCents, 0),
    plannedIncomeCents,
    spending,
    dailyCapCents: readNumber(ctx, CAP_KEY),
  });

  const changes = monthChanges(history as MonthRow[], today, previousMonth);
  const categoryNames = new Map(
    ctx.db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .all()
      .map((row) => [row.id, row.name])
  );

  return {
    hasAccounts: open.length > 0,
    today,
    ...result,
    plannedItems: plannedExpenses.slice(0, 6).map((tx) => ({
      id: tx.id,
      date: tx.date,
      description: tx.description,
      amountCents: tx.amountCents,
    })),
    plannedCount: plannedExpenses.length,
    goalItems,
    invoiceItems: invoices.map((invoice) => ({
      id: invoice.id,
      name: names.get(invoice.accountId) ?? 'Cartão',
      dueDate: invoice.dueDate,
      totalCents: invoice.totalCents,
    })),
    changes: {
      ...changes,
      categories: changes.categories.map((entry) => ({
        ...entry,
        name: entry.categoryId
          ? (categoryNames.get(entry.categoryId) ?? 'Sem categoria')
          : 'Sem categoria',
      })),
    },
  };
}

// ---------------------------------------------------------------- dívidas

export interface DebtBody {
  name: string;
  balanceCents: number;
  rateBp: number;
  minPaymentCents: number;
  dueDay: number;
}

function liveDebts(ctx: Ctx) {
  return ctx.db.select().from(debts).where(isNull(debts.deletedAt)).all();
}

function ownedDebt(ctx: Ctx, id: string) {
  const debt = ctx.db
    .select()
    .from(debts)
    .where(and(eq(debts.id, id), isNull(debts.deletedAt)))
    .get();
  if (!debt) throw notFound('Dívida');
  return debt;
}

export function listDebts(ctx: Ctx) {
  const rows = liveDebts(ctx);
  return { debts: byCost(rows), totals: debtTotals(rows) };
}

export function createDebt(ctx: Ctx, body: DebtBody) {
  return ctx.db
    .insert(debts)
    .values({ ...stamp(), ...body })
    .returning()
    .get();
}

export function updateDebt(ctx: Ctx, id: string, body: DebtBody) {
  ownedDebt(ctx, id);
  return ctx.db
    .update(debts)
    .set({ ...body, updatedAt: Date.now() })
    .where(eq(debts.id, id))
    .returning()
    .get();
}

export function deleteDebt(ctx: Ctx, id: string) {
  ownedDebt(ctx, id);
  ctx.db
    .update(debts)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(debts.id, id))
    .run();
}

export function debtPlan(ctx: Ctx, extraCents: number) {
  const month = monthOf(todayIn(ctx));
  return { month, ...comparePlans(liveDebts(ctx), extraCents) };
}

export function renegotiate(ctx: Ctx, id: string, rateBp: number, termMonths: number) {
  const debt = ownedDebt(ctx, id);
  if (debt.balanceCents === 0) throw new AppError(400, 'Esta dívida já está quitada.');
  return simulateRenegotiation(debt, rateBp, termMonths);
}

// ---------------------------------------------------------------- regras de categoria

function liveRules(ctx: Ctx) {
  return ctx.db
    .select({ rule: categoryRules, categoryName: categories.name })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(and(isNull(categoryRules.deletedAt), isNull(categories.deletedAt)))
    .all()
    .map(({ rule, categoryName }) => ({ ...rule, categoryName }));
}

export function listRules(ctx: Ctx) {
  return liveRules(ctx).sort((a, b) => a.pattern.localeCompare(b.pattern, 'pt-BR'));
}

function ruleValues(ctx: Ctx, body: { pattern: string; categoryId: string }, id?: string) {
  const patternKey = plainText(body.pattern);
  if (patternKey.length < 2) throw new AppError(400, 'Escreva ao menos 2 letras.');
  const category = ctx.db
    .select()
    .from(categories)
    .where(and(eq(categories.id, body.categoryId), isNull(categories.deletedAt)))
    .get();
  if (!category) throw notFound('Categoria');
  const clash = ctx.db
    .select({ id: categoryRules.id })
    .from(categoryRules)
    .where(
      and(
        eq(categoryRules.patternKey, patternKey),
        eq(categoryRules.kind, category.kind),
        isNull(categoryRules.deletedAt)
      )
    )
    .get();
  if (clash && clash.id !== id) throw new AppError(409, 'Já existe uma regra para esse texto.');
  return {
    pattern: body.pattern.trim(),
    patternKey,
    kind: category.kind,
    categoryId: category.id,
  };
}

export function createRule(ctx: Ctx, body: { pattern: string; categoryId: string }) {
  return ctx.db
    .insert(categoryRules)
    .values({ ...stamp(), ...ruleValues(ctx, body) })
    .returning()
    .get();
}

export function updateRule(ctx: Ctx, id: string, body: { pattern: string; categoryId: string }) {
  const { changes } = ctx.db
    .update(categoryRules)
    .set({ ...ruleValues(ctx, body, id), updatedAt: Date.now() })
    .where(and(eq(categoryRules.id, id), isNull(categoryRules.deletedAt)))
    .run();
  if (changes === 0) throw notFound('Regra');
}

export function deleteRule(ctx: Ctx, id: string) {
  const { changes } = ctx.db
    .update(categoryRules)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(categoryRules.id, id), isNull(categoryRules.deletedAt)))
    .run();
  if (changes === 0) throw notFound('Regra');
}

function ruleChanges(ctx: Ctx, overwrite: boolean) {
  const rules = liveRules(ctx);
  return ctx.db
    .select()
    .from(transactions)
    .where(and(liveTx, inArray(transactions.kind, ['INCOME', 'EXPENSE'])))
    .all()
    .flatMap((tx) => {
      const rule = matchRule(rules, tx);
      if (!rule || rule.categoryId === tx.categoryId) return [];
      if (tx.categoryId && !overwrite) return [];
      return [{ tx, categoryId: rule.categoryId }];
    });
}

export function previewRules(ctx: Ctx) {
  return {
    uncategorized: ruleChanges(ctx, false).length,
    withOverwrite: ruleChanges(ctx, true).length,
  };
}

/**
 * Grava só a categoria. `updateTransaction` não serve aqui: ele recalcula a fatura pela data, o
 * que tiraria da fatura certa um lançamento posto nela pelo banco, e marcaria cada previsto de uma
 * recorrência como exceção. A recorrência recebe a categoria para os próximos meses saírem certos.
 */
export function applyRules(ctx: Ctx, overwrite: boolean) {
  const changes = ruleChanges(ctx, overwrite);
  ctx.db.transaction(() => {
    const series = new Map<string, string>();
    for (const { tx, categoryId } of changes) {
      ctx.db
        .update(transactions)
        .set({ categoryId, updatedAt: Date.now() })
        .where(eq(transactions.id, tx.id))
        .run();
      if (tx.recurrenceId) series.set(tx.recurrenceId, categoryId);
    }
    for (const [id, categoryId] of series) {
      const recurrence = ctx.db.select().from(recurrences).where(eq(recurrences.id, id)).get();
      if (!recurrence) continue;
      ctx.db
        .update(recurrences)
        .set({
          template: { ...(recurrence.template as object), categoryId },
          updatedAt: Date.now(),
        })
        .where(eq(recurrences.id, id))
        .run();
    }
  });
  return { updated: changes.length };
}

// ---------------------------------------------------------------- contas fixas

function dismissedKeys(ctx: Ctx) {
  return ctx.db
    .select({ key: recurringDismissals.key })
    .from(recurringDismissals)
    .where(isNull(recurringDismissals.deletedAt))
    .all()
    .map((row) => row.key);
}

export function recurringSuggestions(ctx: Ctx) {
  const today = todayIn(ctx);
  const rows = ctx.db
    .select()
    .from(transactions)
    .where(
      and(
        liveTx,
        eq(transactions.kind, 'EXPENSE'),
        gte(transactions.date, addDays(today, -200))
      )
    )
    .all();
  // Quem já tem recorrência ou é parcela não vira sugestão, nem por um lançamento avulso igual.
  const taken = rows.filter((tx) => tx.recurrenceId).map((tx) => recurringKey(tx.description));
  const ignored = new Set([...taken, ...dismissedKeys(ctx)]);
  const history = rows.filter(
    (tx) => tx.status === 'DONE' && !tx.recurrenceId && !tx.installmentGroupId
  );
  const openAccounts = new Map(fin.listAccounts(ctx).map((account) => [account.id, account.name]));
  const liveCategories = new Map(
    ctx.db
      .select({ id: categories.id, name: categories.name })
      .from(categories)
      .where(isNull(categories.deletedAt))
      .all()
      .map((row) => [row.id, row.name])
  );
  return detectFixedBills(history, today, ignored)
    .filter((item) => openAccounts.has(item.accountId))
    .map((item) => {
      const categoryId =
        item.categoryId && liveCategories.has(item.categoryId) ? item.categoryId : null;
      return {
        ...item,
        categoryId,
        accountName: openAccounts.get(item.accountId)!,
        categoryName: categoryId ? liveCategories.get(categoryId)! : null,
      };
    });
}

export function acceptRecurring(ctx: Ctx, key: string) {
  const item = recurringSuggestions(ctx).find((suggestion) => suggestion.key === key);
  if (!item) throw notFound('Sugestão');
  return fin.createTransactions(ctx, {
    kind: 'EXPENSE',
    amountCents: item.amountCents,
    date: item.nextDate,
    accountId: item.accountId,
    categoryId: item.categoryId,
    description: item.description,
    recurrence: { rrule: 'FREQ=MONTHLY' },
  });
}

export function dismissRecurring(ctx: Ctx, key: string) {
  if (dismissedKeys(ctx).includes(key)) return;
  ctx.db
    .insert(recurringDismissals)
    .values({ ...stamp(), key })
    .run();
}

// ---------------------------------------------------------------- importação

export interface ImportInput {
  text: string;
  fileName?: string;
  accountId: string;
  mode: ImportMode;
  invert?: boolean;
  /** Modo fatura: o vencimento da fatura. Sem ele, cada compra vai para a fatura da sua data. */
  dueDate?: string;
}

function importTarget(ctx: Ctx, input: ImportInput) {
  const account = fin.ownedAccount(ctx, input.accountId);
  if (account.archivedAt) throw new AppError(400, 'Esta conta está arquivada.');
  const isCard = account.type === 'CREDIT_CARD';
  if (input.mode === 'invoice' && !isCard) {
    throw new AppError(400, 'Fatura só pode ser importada para um cartão.');
  }
  if (input.mode === 'statement' && isCard) {
    throw new AppError(400, 'Para um cartão, use o modo fatura.');
  }
  return account;
}

function analyze(ctx: Ctx, input: ImportInput) {
  importTarget(ctx, input);
  const parsed = parseStatement(input.text, input.fileName);
  const entries = toEntries(parsed, input.mode, Boolean(input.invert));

  const imported = new Map(
    ctx.db
      .select({ fingerprint: importLines.fingerprint, transactionId: importLines.transactionId })
      .from(importLines)
      .innerJoin(transactions, eq(transactions.id, importLines.transactionId))
      .where(
        and(
          eq(importLines.accountId, input.accountId),
          isNull(importLines.deletedAt),
          liveTx
        )
      )
      .all()
      .map((row) => [row.fingerprint, row.transactionId])
  );

  const dates = entries.map((entry) => entry.date).sort();
  const existing = ctx.db
    .select()
    .from(transactions)
    .where(
      and(
        liveTx,
        eq(transactions.accountId, input.accountId),
        inArray(transactions.kind, ['INCOME', 'EXPENSE']),
        gte(transactions.date, addDays(dates[0]!, -2)),
        lte(transactions.date, addDays(dates.at(-1)!, 2))
      )
    )
    .all();

  const statuses = markDuplicates(entries, imported, existing);
  const rules = liveRules(ctx);
  return {
    parsed,
    lines: entries.map((entry) => {
      const status: LineStatus = statuses.get(entry.index)!;
      return {
        ...entry,
        status,
        categoryId: matchRule(rules, entry)?.categoryId ?? null,
      };
    }),
  };
}

export function previewImport(ctx: Ctx, input: ImportInput) {
  const { parsed, lines } = analyze(ctx, input);
  const count = (status: LineStatus) => lines.filter((line) => line.status === status).length;
  const invoice = input.dueDate ? fin.findBillInvoice(ctx, input.accountId, input.dueDate) : null;
  return {
    format: parsed.format,
    unreadable: parsed.unreadable,
    ignored: parsed.ignored,
    counts: {
      total: lines.length,
      new: count('NEW'),
      duplicate: count('DUPLICATE'),
      possible: count('POSSIBLE'),
      payment: count('PAYMENT'),
    },
    invoicePaid: Boolean(invoice?.paidAt),
    lines,
  };
}

export function confirmImport(
  ctx: Ctx,
  input: ImportInput & { selected: number[]; categories?: Record<string, string | null> }
) {
  const { lines } = analyze(ctx, input);
  const chosen = new Set(input.selected);
  const bill = input.dueDate ? { dueDate: input.dueDate, closingDate: null } : undefined;
  const toImport = lines.filter((line) => chosen.has(line.index) && line.status !== 'DUPLICATE');

  ctx.db.transaction(() => {
    for (const line of toImport) {
      const override = input.categories?.[line.index];
      const body: CreateTransactionBody = {
        kind: line.kind,
        amountCents: line.amountCents,
        date: line.date,
        accountId: input.accountId,
        categoryId: override === undefined ? line.categoryId : override,
        description: line.description,
      };
      const [tx] = fin.createTransactions(ctx, body, { bill });
      // A linha antiga ficou de um lançamento apagado: a importação nova toma o lugar dela.
      ctx.db
        .update(importLines)
        .set({ deletedAt: Date.now(), updatedAt: Date.now() })
        .where(
          and(
            eq(importLines.accountId, input.accountId),
            eq(importLines.fingerprint, line.fingerprint),
            isNull(importLines.deletedAt)
          )
        )
        .run();
      ctx.db
        .insert(importLines)
        .values({
          ...stamp(),
          accountId: input.accountId,
          fingerprint: line.fingerprint,
          transactionId: tx!.id,
        })
        .run();
    }
  });
  return { imported: toImport.length, skipped: lines.length - toImport.length };
}

/** Sugestão de vencimento para o modo fatura: a próxima fatura em aberto do cartão. */
export function nextInvoiceDue(ctx: Ctx, accountId: string) {
  const invoices = fin.listInvoices(ctx, accountId);
  const open = invoices
    .filter((invoice) => invoice.status === 'OPEN' || invoice.status === 'CLOSED')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return { dueDate: open[0]?.dueDate ?? null };
}
