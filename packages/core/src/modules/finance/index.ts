import type {
  AcceptBankMovementBody,
  BankMovementStatus,
  CreateAccountBody,
  CreateCategoryBody,
  CreateTransactionBody,
  LinkBankAccountBody,
  ListTransactionsQuery,
  PayInvoiceBody,
  SaveBankCredentialsBody,
  UpdateAccountBody,
  UpdateCategoryBody,
  UpdateTransactionBody,
  UpsertBudgetBody,
} from '@sektor/contract';
import {
  acceptBankMovementBodySchema,
  createAccountBodySchema,
  createCategoryBodySchema,
  createTransactionBodySchema,
  linkBankAccountBodySchema,
  listTransactionsQuerySchema,
  monthSummaryQuerySchema,
  payInvoiceBodySchema,
  saveBankCredentialsBodySchema,
  updateAccountBodySchema,
  updateCategoryBodySchema,
  updateTransactionBodySchema,
  upsertBudgetBodySchema,
} from '@sektor/contract';
import { idSchema } from '@sektor/contract';
import { z, ZodError, type ZodType } from 'zod';

import type { AppCtx, Job } from '../../app';
import * as bank from '../../bank';
import * as cat from '../../services/categories';
import { AppError } from '../../services/context';
import * as fin from '../../services/finance';
import * as rep from '../../services/reports';

/** Valida a entrada e transforma o erro do Zod em mensagem de tela. */
export function parse<T>(schema: ZodType<T, never, unknown>, input: unknown): T {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      const message = error.issues[0]?.message;
      // "Required" é a mensagem padrão do Zod: campo que a tela não preenche nem mostra.
      throw new AppError(400, !message || message === 'Required' ? 'Dados inválidos.' : message);
    }
    throw error;
  }
}

const transactionScopeSchema = z.enum(['single', 'future', 'all']);
const updateInputSchema = updateTransactionBodySchema.extend({
  scope: transactionScopeSchema.default('single'),
});
const payInvoiceInputSchema = payInvoiceBodySchema.extend({ id: idSchema });

type UpdateInput = Omit<Partial<UpdateTransactionBody>, 'scope'> & {
  id: string;
  scope?: fin.TransactionScope;
};

export const handlers = (ctx: AppCtx) => ({
  'accounts.list': (input?: { archived?: boolean }) => fin.listAccounts(ctx, input?.archived),
  'accounts.create': (input: CreateAccountBody) =>
    fin.createAccount(ctx, parse(createAccountBodySchema as never, input)),
  'accounts.update': ({ id, ...input }: UpdateAccountBody & { id: string }) =>
    fin.updateAccount(ctx, id, parse(updateAccountBodySchema as never, input)),
  'accounts.delete': ({ id }: { id: string }) => fin.deleteAccount(ctx, id),
  'accounts.invoices': ({ id }: { id: string }) => fin.listInvoices(ctx, id),

  'invoices.due': (input: { month?: string; from?: string; to?: string }) =>
    fin.listDueInvoices(ctx, input),
  'invoices.transactions': ({ id }: { id: string }) => fin.invoiceTransactions(ctx, id),
  'invoices.pay': (input: { id: string } & PayInvoiceBody) => {
    const { id, ...options } = parse(payInvoiceInputSchema as never, input) as {
      id: string;
    } & PayInvoiceBody;
    return fin.payInvoice(ctx, id, options);
  },

  'invoices.setPaidElsewhere': ({ id, paid }: { id: string; paid: boolean }) =>
    fin.setInvoicePaidElsewhere(ctx, id, paid),

  'categories.list': () => cat.listCategories(ctx),
  'categories.create': (input: CreateCategoryBody) =>
    cat.createCategory(ctx, parse(createCategoryBodySchema as never, input)),
  'categories.update': ({ id, ...input }: UpdateCategoryBody & { id: string }) =>
    cat.updateCategory(ctx, id, parse(updateCategoryBodySchema as never, input)),
  'categories.delete': ({ id }: { id: string }) => cat.deleteCategory(ctx, id),

  'transactions.list': (input: ListTransactionsQuery) =>
    fin.listTransactions(ctx, parse(listTransactionsQuerySchema as never, input)),
  'transactions.create': (input: CreateTransactionBody) =>
    fin.createTransactions(ctx, parse(createTransactionBodySchema as never, input)),
  'transactions.update': ({ id, ...input }: UpdateInput) =>
    fin.updateTransaction(
      ctx,
      id,
      parse<Omit<UpdateInput, 'id'>>(updateInputSchema as never, input)
    ),
  'transactions.delete': ({ id, scope }: { id: string; scope?: fin.TransactionScope }) =>
    fin.deleteTransaction(ctx, id, parse(transactionScopeSchema.optional() as never, scope)),

  'budgets.list': ({ month }: { month: string }) => rep.budgetStatuses(ctx, month),
  'budgets.upsert': (input: UpsertBudgetBody) =>
    rep.upsertBudget(ctx, parse(upsertBudgetBodySchema as never, input)),
  'budgets.copyPrevious': ({ month }: { month: string }) => rep.copyPreviousBudgets(ctx, month),
  'budgets.delete': ({ id }: { id: string }) => rep.deleteBudget(ctx, id),

  'reports.month': (input: { month: string }) =>
    rep.monthSummary(ctx, parse<{ month: string }>(monthSummaryQuerySchema as never, input).month),
  'reports.forecast': ({ days }: { days: number }) => rep.forecast(ctx, days),

  'bank.status': () => bank.bankStatus(ctx),
  'bank.acceptNotice': () => bank.acceptNotice(ctx),
  'bank.saveCredentials': (input: SaveBankCredentialsBody) =>
    bank.saveCredentials(ctx, parse(saveBankCredentialsBodySchema as never, input)),
  'bank.removeCredentials': () => bank.removeCredentials(ctx),
  'bank.connectToken': () => bank.connectToken(ctx),
  'bank.addItem': ({ itemId }: { itemId: string }) => bank.addItem(ctx, itemId),
  'bank.removeItem': ({ id }: { id: string }) => bank.removeItem(ctx, id),
  'bank.linkAccount': ({ id, ...input }: LinkBankAccountBody & { id: string }) =>
    bank.linkAccount(ctx, id, parse(linkBankAccountBodySchema as never, input)),
  'bank.sync': async () => {
    await bank.syncBanks(ctx);
    return bank.bankStatus(ctx);
  },
  'bank.movements': (input?: { status?: BankMovementStatus }) =>
    bank.listMovements(ctx, input?.status),
  'bank.accept': ({ id, ...input }: AcceptBankMovementBody & { id: string }) =>
    bank.acceptMovement(ctx, id, parse(acceptBankMovementBodySchema as never, input)),
  'bank.acceptAll': () => bank.acceptAll(ctx),
  'bank.ignore': ({ id }: { id: string }) => bank.ignoreMovement(ctx, id),
  'bank.ignoreAll': () => bank.ignoreAll(ctx),
  'bank.cardCheck': ({ accountId }: { accountId: string }) => bank.cardCheck(ctx, accountId),
});

const HOUR = 3_600_000;

export const jobs: Job[] = [
  { name: 'recurrences', everyMs: 24 * HOUR, run: (ctx) => fin.extendRecurrences(ctx) },
  // O Meu Pluggy atualiza cada banco uma vez por dia; ler a cada 6 h pega a atualização cedo.
  { name: 'bank', everyMs: 6 * HOUR, run: (ctx) => bank.syncBanks(ctx) },
];
