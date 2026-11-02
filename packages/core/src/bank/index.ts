import type {
  AcceptBankMovementBody,
  BankCardCheckResponse,
  BankMovementResponse,
  BankMovementStatus,
  BankStatusResponse,
  LinkBankAccountBody,
} from '@sektor/contract';
import { addDays, dateStringInZone, diffInDays } from '@sektor/finance-engine';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';

import {
  accounts,
  appMeta,
  bankAccounts,
  bankMovements,
  categories,
  invoices,
  pluggyItems,
  transactions,
} from '../db/schema';
import { type CategoryRule, matchRule } from '../modules/financePlus/rules';
import { categoryRules } from '../modules/financePlus/schema';
import { AppError, type Ctx, notFound, stamp, todayIn } from '../services/context';
import {
  completeInstallments,
  createTransactions,
  findBillInvoice,
  invoicePayment,
  invoiceBalances,
  listInvoices,
  payInvoice,
  placeCardItems,
  redateOpenInvoices,
  removeTransaction,
  settleInvoicesBefore,
  turnIntoInvoicePayment,
} from '../services/finance';

import {
  authenticatePluggy,
  createConnectToken,
  fetchAccounts,
  fetchBills,
  fetchItem,
  fetchTransactions,
  forgetPluggyKey,
  type KeyStore,
  meuPluggyConnectorIds,
  PluggyApiError,
  type PluggyKeys,
  pluggyFetch,
} from './client';
import {
  type BillDates,
  billDates,
  billPayment,
  candidateRange,
  type CategoryMemory,
  categoryMemory,
  findMatch,
  importedDescription,
  installmentSeries,
  installmentTitle,
  invoiceForPayment,
  looksLikeBoleto,
  looksLikeInvoicePayment,
  MATCH_WINDOW_DAYS,
  movementBill,
  parseMovement,
  ruleCategory,
  shortDescription,
  suggestCategory,
  type SystemCategoryIds,
} from './movements';
import type { PluggyAccount, PluggyBill, PluggyItem } from './pluggy-types';

// Bancos pelo Meu Pluggy. Cada sincronização lê as contas dos bancos conectados e, nas ligadas a
// uma conta do Sektor, os lançamentos novos: o que já foi lançado à mão só é marcado como visto; o
// resto espera revisão em "A revisar" antes de entrar no saldo.

export interface BankCtx extends Ctx {
  keys: KeyStore;
}

type Account = typeof accounts.$inferSelect;
type BankAccount = typeof bankAccounts.$inferSelect;
type BankMovement = typeof bankMovements.$inferSelect;

/** Na primeira ligação, quantos dias para trás importar. */
export const DEFAULT_IMPORT_DAYS = 30;
/** Nas sincronizações seguintes, a janela que é relida (o banco lança com atraso). */
const RESYNC_DAYS = 40;

const UNAVAILABLE = 'A Pluggy não respondeu. Tente de novo em instantes.';
const liveTx = isNull(transactions.deletedAt);
const liveBankAccount = isNull(bankAccounts.deletedAt);

async function friendly<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof PluggyApiError) throw new AppError(502, UNAVAILABLE);
    throw error;
  }
}

const errorText = (error: unknown) => (error instanceof AppError ? error.message : UNAVAILABLE);

const ITEM_ERRORS: Record<string, string> = {
  LOGIN_ERROR: 'O banco recusou o acesso. Conecte de novo no Meu Pluggy.',
  OUTDATED: 'A conexão com o banco está desatualizada. Abra o Meu Pluggy e reconecte o banco.',
  WAITING_USER_INPUT: 'O banco está esperando uma confirmação no Meu Pluggy.',
};

const itemError = (item: PluggyItem) =>
  ITEM_ERRORS[item.status] ?? (item.error?.message || null);

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

// ---------------------------------------------------------------- estado

function metaGet(ctx: Ctx, key: string): string | null {
  return ctx.db.select().from(appMeta).where(eq(appMeta.key, key)).get()?.value ?? null;
}

function metaSet(ctx: Ctx, key: string, value: string | null) {
  if (value === null) {
    ctx.db.delete(appMeta).where(eq(appMeta.key, key)).run();
    return;
  }
  ctx.db
    .insert(appMeta)
    .values({ key, value, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt: Date.now() } })
    .run();
}

function pendingCount(ctx: Ctx) {
  return ctx.db
    .select({ total: count() })
    .from(bankMovements)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankMovements.bankAccountId))
    .where(
      and(
        eq(bankMovements.status, 'PENDING'),
        isNotNull(bankAccounts.accountId),
        liveBankAccount
      )
    )
    .get()!.total;
}

export function bankStatus(ctx: BankCtx): BankStatusResponse {
  const keys = ctx.keys.get();
  const items = ctx.db
    .select()
    .from(pluggyItems)
    .where(isNull(pluggyItems.deletedAt))
    .orderBy(asc(pluggyItems.createdAt))
    .all();
  return {
    configured: Boolean(keys),
    clientId: keys?.clientId ?? null,
    syncedAt: metaGet(ctx, 'bank_synced_at'),
    lastError: metaGet(ctx, 'bank_last_error'),
    pendingCount: pendingCount(ctx),
    noticeAcceptedAt: metaGet(ctx, 'bank_notice_at'),
    items: items.map((item) => ({
      id: item.id,
      itemId: item.itemId,
      name: item.name,
      imageUrl: item.imageUrl,
      status: item.status,
      lastError: item.lastError,
      syncedAt: iso(item.syncedAt),
      accounts: ctx.db
        .select()
        .from(bankAccounts)
        .where(and(eq(bankAccounts.itemId, item.id), liveBankAccount))
        .orderBy(asc(bankAccounts.type), asc(bankAccounts.name))
        .all()
        .map((account) => ({
          id: account.id,
          name: account.name,
          number: account.number,
          type: account.type,
          balanceCents: account.balanceCents,
          accountId: account.accountId,
          importFrom: account.importFrom,
          syncedAt: iso(account.syncedAt),
        })),
    })),
  };
}

export function acceptNotice(ctx: BankCtx) {
  metaSet(ctx, 'bank_notice_at', new Date().toISOString());
  return bankStatus(ctx);
}

// ---------------------------------------------------------------- chaves e bancos

export async function saveCredentials(ctx: BankCtx, keys: PluggyKeys) {
  await friendly(() => authenticatePluggy(keys));
  ctx.keys.set(keys);
  metaSet(ctx, 'bank_last_error', null);
  forgetPluggyKey();
  return bankStatus(ctx);
}

/** Tira as chaves e os bancos. Lançamentos e movimentos ficam: impedem importar de novo. */
export function removeCredentials(ctx: BankCtx) {
  const now = Date.now();
  ctx.db.transaction(() => {
    ctx.db
      .update(bankAccounts)
      .set({ deletedAt: now, updatedAt: now, accountId: null })
      .where(liveBankAccount)
      .run();
    ctx.db
      .update(pluggyItems)
      .set({ deletedAt: now, updatedAt: now })
      .where(isNull(pluggyItems.deletedAt))
      .run();
  });
  ctx.keys.set(null);
  forgetPluggyKey();
}

/** Token do widget, sempre para criar: cada banco do Meu Pluggy é um item. */
export async function connectToken(ctx: BankCtx) {
  return friendly(async () => ({
    accessToken: await createConnectToken(ctx.keys),
    connectorIds: await meuPluggyConnectorIds(ctx.keys),
  }));
}

const BUSY = new Set(['UPDATING', 'LOGIN_IN_PROGRESS', 'WAITING_USER_INPUT', 'CREATED']);

/** Logo depois do widget o item ainda pode estar lendo o banco: espera um pouco pelas contas. */
async function settledItem(ctx: BankCtx, itemId: string): Promise<PluggyItem> {
  let remote = await fetchItem(ctx.keys, itemId);
  for (let i = 0; i < 10 && BUSY.has(remote.status); i++) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    remote = await fetchItem(ctx.keys, itemId);
  }
  return remote;
}

export async function addItem(ctx: BankCtx, itemId: string) {
  let remote: PluggyItem;
  try {
    remote = await settledItem(ctx, itemId);
  } catch (error) {
    if (error instanceof PluggyApiError && (error.status === 404 || error.status === 400)) {
      throw new AppError(404, 'Esse banco não está na sua aplicação da Pluggy.');
    }
    throw error instanceof PluggyApiError ? new AppError(502, UNAVAILABLE) : error;
  }
  const item = ctx.db
    .insert(pluggyItems)
    .values({ ...stamp(), itemId, name: remote.connector?.name ?? 'Banco' })
    .onConflictDoUpdate({
      target: pluggyItems.itemId,
      set: { deletedAt: null, updatedAt: Date.now() },
    })
    .returning()
    .get();
  await friendly(() => syncItem(ctx, item.id, { remote }));
  return bankStatus(ctx);
}

/** O banco sai da tela, mas os movimentos ficam: reconectar não importa nada de novo. */
export function removeItem(ctx: BankCtx, id: string) {
  const now = Date.now();
  const { changes } = ctx.db
    .update(pluggyItems)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(pluggyItems.id, id), isNull(pluggyItems.deletedAt)))
    .run();
  if (!changes) throw notFound('Banco não encontrado.');
  ctx.db
    .update(bankAccounts)
    .set({ deletedAt: now, updatedAt: now, accountId: null })
    .where(eq(bankAccounts.itemId, id))
    .run();
}

// ---------------------------------------------------------------- ligar contas

const COMPATIBLE: Record<BankAccount['type'], Account['type'][]> = {
  BANK: ['CHECKING', 'SAVINGS', 'WALLET'],
  CREDIT: ['CREDIT_CARD'],
};

function dayOf(ctx: Ctx, iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Number(dateStringInZone(new Date(iso), ctx.timeZone).slice(8, 10));
}

async function createAccountFor(ctx: BankCtx, bankAccount: BankAccount): Promise<string> {
  const remote = await pluggyFetch<PluggyAccount>(ctx.keys, `/accounts/${bankAccount.externalId}`);
  if (bankAccount.type === 'BANK') {
    return ctx.db
      .insert(accounts)
      .values({
        ...stamp(),
        name: bankAccount.name,
        type: remote.subtype === 'SAVINGS_ACCOUNT' ? 'SAVINGS' : 'CHECKING',
      })
      .returning()
      .get().id;
  }
  // A fatura é paga pela conta do mesmo banco, se ela já estiver ligada.
  const payer = ctx.db
    .select()
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.itemId, bankAccount.itemId),
        eq(bankAccounts.type, 'BANK'),
        isNotNull(bankAccounts.accountId),
        liveBankAccount
      )
    )
    .get();
  return ctx.db
    .insert(accounts)
    .values({
      ...stamp(),
      name: bankAccount.name,
      type: 'CREDIT_CARD',
      closingDay: dayOf(ctx, remote.creditData?.balanceCloseDate) ?? 1,
      dueDay: dayOf(ctx, remote.creditData?.balanceDueDate) ?? 10,
      paymentAccountId: payer?.accountId ?? null,
    })
    .returning()
    .get().id;
}

function bankAccountById(ctx: Ctx, id: string) {
  return ctx.db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.id, id), liveBankAccount))
    .get();
}

export async function linkAccount(ctx: BankCtx, id: string, body: LinkBankAccountBody) {
  const bankAccount = bankAccountById(ctx, id);
  if (!bankAccount) throw notFound('Conta do banco não encontrada.');
  const today = todayIn(ctx);

  // O que esperava revisão era para a conta antiga.
  ctx.db
    .delete(bankMovements)
    .where(and(eq(bankMovements.bankAccountId, id), eq(bankMovements.status, 'PENDING')))
    .run();

  if (!body.create && !body.accountId) {
    ctx.db
      .update(bankAccounts)
      .set({ accountId: null, importFrom: null, syncedAt: null, updatedAt: Date.now() })
      .where(eq(bankAccounts.id, id))
      .run();
    return bankStatus(ctx);
  }

  let accountId: string;
  if (body.create) {
    accountId = await friendly(() => createAccountFor(ctx, bankAccount));
  } else {
    const account = ctx.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.id, body.accountId!),
          isNull(accounts.deletedAt),
          isNull(accounts.archivedAt)
        )
      )
      .get();
    if (!account) throw notFound('Conta não encontrada.');
    if (!COMPATIBLE[bankAccount.type].includes(account.type)) {
      throw new AppError(
        400,
        bankAccount.type === 'CREDIT'
          ? 'Um cartão do banco só pode ser ligado a um cartão do Sektor.'
          : 'Uma conta do banco não pode ser ligada a um cartão do Sektor.'
      );
    }
    const taken = ctx.db
      .select()
      .from(bankAccounts)
      .where(and(eq(bankAccounts.accountId, account.id), ne(bankAccounts.id, id)))
      .get();
    if (taken) throw new AppError(409, 'Essa conta do Sektor já está ligada a outra conta do banco.');
    accountId = account.id;
  }

  const importFrom = body.importFrom ?? addDays(today, -DEFAULT_IMPORT_DAYS);
  const linked = ctx.db
    .update(bankAccounts)
    .set({ accountId, importFrom, syncedAt: null, updatedAt: Date.now() })
    .where(eq(bankAccounts.id, id))
    .returning()
    .get();

  try {
    await importMovements(ctx, linked, suggester(ctx));
  } catch (error) {
    ctx.db
      .update(pluggyItems)
      .set({ lastError: errorText(error), updatedAt: Date.now() })
      .where(eq(pluggyItems.id, bankAccount.itemId))
      .run();
  }

  // Conta nova: o saldo inicial é o do banco menos o que entra pela importação, para que, com
  // tudo revisado, o saldo do Sektor bata com o do banco.
  if (body.create && bankAccount.type === 'BANK') {
    const movements = ctx.db
      .select()
      .from(bankMovements)
      .where(eq(bankMovements.bankAccountId, id))
      .all();
    const net = movements.reduce(
      (sum, m) => sum + (m.kind === 'INCOME' ? m.amountCents : -m.amountCents),
      0
    );
    ctx.db
      .update(accounts)
      .set({ initialBalanceCents: bankAccount.balanceCents - net, updatedAt: Date.now() })
      .where(eq(accounts.id, accountId))
      .run();
  }
  return bankStatus(ctx);
}

// ---------------------------------------------------------------- sincronização

interface Suggester {
  memory: CategoryMemory;
  system: SystemCategoryIds;
  rules: CategoryRule[];
}

function suggester(ctx: Ctx): Suggester {
  const history = ctx.db
    .select({
      description: transactions.description,
      notes: transactions.notes,
      kind: transactions.kind,
      categoryId: transactions.categoryId,
    })
    .from(transactions)
    .where(and(isNotNull(transactions.categoryId), liveTx))
    .orderBy(desc(transactions.date), desc(transactions.createdAt))
    .limit(3000)
    .all();
  const system = ctx.db
    .select({ id: categories.id, kind: categories.kind, systemKey: categories.systemKey })
    .from(categories)
    .where(isNotNull(categories.systemKey))
    .all();
  const rules = ctx.db
    .select({
      patternKey: categoryRules.patternKey,
      kind: categoryRules.kind,
      categoryId: categoryRules.categoryId,
    })
    .from(categoryRules)
    .innerJoin(categories, eq(categories.id, categoryRules.categoryId))
    .where(and(isNull(categoryRules.deletedAt), isNull(categories.deletedAt)))
    .all();
  return {
    rules,
    memory: categoryMemory(history),
    system: new Map(system.map((c) => [`${c.kind}:${c.systemKey}`, c.id])),
  };
}

/** A sugestão: o histórico; sem ele, as regras da pessoa e a regra fixa (Pix → Transferência › Pix). */
function suggestionFor(
  { memory, system, rules }: Suggester,
  movement: { kind: 'INCOME' | 'EXPENSE'; description: string },
  accountType: 'BANK' | 'CREDIT'
) {
  const history = suggestCategory(memory, movement);
  if (history) return { suggestedCategoryId: history, suggestionSource: 'HISTORY' as const };
  const own = matchRule(rules, movement);
  if (own) return { suggestedCategoryId: own.categoryId, suggestionSource: 'RULE' as const };
  // Pagamento de fatura vira transferência para o cartão ao aceitar: não leva categoria.
  if (movement.kind === 'EXPENSE' && looksLikeInvoicePayment(movement.description)) {
    return { suggestedCategoryId: null, suggestionSource: null };
  }
  const rule = ruleCategory(movement, accountType, system);
  return { suggestedCategoryId: rule, suggestionSource: rule ? ('RULE' as const) : null };
}

const billColumns = (bill: BillDates) => ({
  billDueDate: bill.dueDate,
  billClosingDate: bill.closingDate,
});

const storedBill = (m: Pick<BankMovement, 'billDueDate' | 'billClosingDate'>): BillDates | null =>
  m.billDueDate ? { dueDate: m.billDueDate, closingDate: m.billClosingDate } : null;

/** Lê os lançamentos novos de uma conta ligada e casa ou põe em revisão. */
async function importMovements(ctx: BankCtx, bankAccount: BankAccount, suggest: Suggester) {
  if (!bankAccount.accountId) return 0;
  const accountId = bankAccount.accountId;
  const today = todayIn(ctx);
  const importFrom = bankAccount.importFrom ?? today;
  const recent = addDays(today, -RESYNC_DAYS);
  const dateFrom = bankAccount.syncedAt && recent > importFrom ? recent : importFrom;

  // No cartão, parcelas de compras antigas podem vir datadas pela compra: lemos um ano antes e
  // filtramos pela data da parcela.
  const fetchFrom = bankAccount.type === 'CREDIT' ? addDays(dateFrom, -366) : dateFrom;
  const remote = await fetchTransactions(ctx.keys, bankAccount.externalId, fetchFrom);

  // No cartão, as faturas fechadas dizem em que fatura cada lançamento caiu e se foi paga.
  const linkedCard =
    bankAccount.type === 'CREDIT'
      ? ctx.db
          .select()
          .from(accounts)
          .where(and(eq(accounts.id, accountId), eq(accounts.type, 'CREDIT_CARD')))
          .get()
      : undefined;
  const pluggyBills = linkedCard ? await fetchBillsOrNone(ctx, bankAccount.externalId) : [];
  const bills = new Map(pluggyBills.map((bill) => [bill.id, billDates(bill, ctx.timeZone)]));
  const card = linkedCard && cardDaysFromBank(ctx, linkedCard, [...bills.values()]);

  const parsed = remote
    .map((tx) => parseMovement(tx, bankAccount.type, ctx.timeZone))
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .map((m) => ({ ...m, bill: card ? movementBill(m, bills, card) : null }));
  const known = new Map(
    ctx.db
      .select()
      .from(bankMovements)
      .where(eq(bankMovements.bankAccountId, bankAccount.id))
      .all()
      .map((m) => [m.externalId, m])
  );
  // A fatura chega depois do lançamento: guarda nos que já tínhamos. Sem `billId`, a fatura
  // guardada era um palpite pela data: sai, e vale a data.
  for (const movement of parsed) {
    const stored = known.get(movement.externalId);
    if (!stored) continue;
    if (!movement.bill) {
      if (!movement.billId && stored.billDueDate) {
        ctx.db
          .update(bankMovements)
          .set({ billDueDate: null, billClosingDate: null, updatedAt: Date.now() })
          .where(eq(bankMovements.id, stored.id))
          .run();
      }
      continue;
    }
    if (
      stored.billDueDate === movement.bill.dueDate &&
      stored.billClosingDate === movement.bill.closingDate
    ) {
      continue;
    }
    ctx.db
      .update(bankMovements)
      .set({ ...billColumns(movement.bill), updatedAt: Date.now() })
      .where(eq(bankMovements.id, stored.id))
      .run();
  }
  const fresh = parsed
    .filter((m) => !known.has(m.externalId) && m.date >= dateFrom)
    .sort((a, b) => a.date.localeCompare(b.date));

  const range = candidateRange(fresh);
  const candidates = range
    ? ctx.db
        .select()
        .from(transactions)
        .where(
          and(
            or(eq(transactions.accountId, accountId), eq(transactions.toAccountId, accountId)),
            gte(transactions.date, range.from),
            lte(transactions.date, range.to),
            liveTx
          )
        )
        .orderBy(asc(transactions.createdAt))
        .all()
    : [];
  const taken = new Set(
    [...known.values()].map((m) => m.transactionId).filter((id): id is string => id !== null)
  );

  const rows: (typeof bankMovements.$inferInsert)[] = [];
  const confirm: string[] = [];
  for (const movement of fresh) {
    const base = {
      ...stamp(),
      bankAccountId: bankAccount.id,
      externalId: movement.externalId,
      kind: movement.kind,
      amountCents: movement.amountCents,
      date: movement.date,
      description: movement.description,
      installmentNumber: movement.installmentNumber,
      installmentTotal: movement.installmentTotal,
      ...(movement.bill ? billColumns(movement.bill) : {}),
    };
    const match = findMatch(movement, accountId, candidates, taken);
    if (match) {
      taken.add(match.id);
      if (candidates.find((tx) => tx.id === match.id)?.status === 'PLANNED') confirm.push(match.id);
      rows.push({ ...base, status: 'MATCHED', transactionId: match.id });
    } else if (movement.isCardPayment) {
      rows.push({ ...base, status: 'IGNORED' });
    } else {
      rows.push({
        ...base,
        status: 'PENDING',
        ...suggestionFor(suggest, movement, bankAccount.type),
      });
    }
  }

  ctx.db.transaction(() => {
    // Duas sincronizações ao mesmo tempo não duplicam: a chave única segura.
    for (const row of rows) ctx.db.insert(bankMovements).values(row).onConflictDoNothing().run();
    // O previsto que o banco confirmou vira efetivado.
    if (confirm.length) {
      ctx.db
        .update(transactions)
        .set({ status: 'DONE', updatedAt: Date.now() })
        .where(inArray(transactions.id, confirm))
        .run();
    }
    ctx.db
      .update(bankAccounts)
      .set({ syncedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(bankAccounts.id, bankAccount.id))
      .run();
  });

  if (card) {
    fillInstallments(ctx, bankAccount.id);
    alignInvoices(ctx, bankAccount.id, card);
    payBills(ctx, card, pluggyBills);
    settleInvoicesBefore(ctx, card.id, importFrom);
  } else {
    // O cartão já deu a fatura como paga e o débito chegou depois: ele vira o pagamento.
    for (const row of rows) {
      if (row.status !== 'PENDING') continue;
      const payment = payInvoiceWith(ctx, row, accountId, true);
      if (payment) {
        ctx.db
          .update(bankMovements)
          .set({ status: 'MATCHED', transactionId: payment, updatedAt: Date.now() })
          .where(
            and(
              eq(bankMovements.bankAccountId, bankAccount.id),
              eq(bankMovements.externalId, row.externalId)
            )
          )
          .run();
      }
    }
  }
  return rows.length;
}

async function fetchBillsOrNone(ctx: BankCtx, accountId: string): Promise<PluggyBill[]> {
  try {
    return await fetchBills(ctx.keys, accountId);
  } catch (error) {
    if (!(error instanceof PluggyApiError)) throw error;
    return [];
  }
}

/**
 * Compras parceladas no cartão. O banco pode mandar só a parcela da fatura atual: lança as que
 * faltam depois da última que chegou. A parcela que o banco manda depois casa com a lançada; e a
 * lançada que ficou repetida sai.
 */
function fillInstallments(ctx: Ctx, bankAccountId: string) {
  const pieces = ctx.db
    .select({ movement: bankMovements, transaction: transactions })
    .from(bankMovements)
    .leftJoin(
      transactions,
      and(eq(transactions.id, bankMovements.transactionId), isNull(transactions.deletedAt))
    )
    .where(
      and(
        eq(bankMovements.bankAccountId, bankAccountId),
        eq(bankMovements.kind, 'EXPENSE'),
        isNotNull(bankMovements.installmentNumber),
        isNotNull(bankMovements.installmentTotal),
        ne(bankMovements.status, 'IGNORED')
      )
    )
    .all()
    .map(({ movement, transaction }) => ({
      ...movement,
      installmentNumber: movement.installmentNumber!,
      installmentTotal: movement.installmentTotal!,
      transaction,
    }));

  for (const parts of installmentSeries(pieces)) {
    const groups = [
      ...new Set(
        parts
          .map((p) => p.transaction?.installmentGroupId)
          .filter((g): g is string => g !== null && g !== undefined)
      ),
    ];
    const linked = new Set(parts.map((p) => p.transactionId).filter((id) => id !== null));
    const launched = groups.length
      ? ctx.db
          .select()
          .from(transactions)
          .where(and(inArray(transactions.installmentGroupId, groups), liveTx))
          .all()
      : [];
    for (const part of parts) {
      const twin = launched.find(
        (tx) => tx.installmentNumber === part.installmentNumber && !linked.has(tx.id)
      );
      if (!twin) continue;
      if (part.status === 'PENDING') {
        // Esperando revisão, mas a parcela já está lançada: casa com ela.
        ctx.db
          .update(bankMovements)
          .set({ status: 'MATCHED', transactionId: twin.id, updatedAt: Date.now() })
          .where(eq(bankMovements.id, part.id))
          .run();
        part.status = 'MATCHED';
        part.transactionId = twin.id;
        part.transaction = twin;
        linked.add(twin.id);
      } else if (part.transactionId) {
        removeTransaction(ctx, twin.id);
        launched.splice(launched.indexOf(twin), 1);
      }
    }

    // Enquanto a última parcela espera revisão, nada é lançado.
    const last = parts.reduce((a, b) => (b.installmentNumber > a.installmentNumber ? b : a));
    if (!last.transactionId || last.installmentNumber >= last.installmentTotal) continue;
    const title = (n: number) =>
      installmentTitle(
        last.transaction?.description ?? importedDescription(last),
        last.installmentNumber,
        last.installmentTotal,
        n
      );
    completeInstallments(
      ctx,
      last.transactionId,
      last.installmentNumber,
      last.installmentTotal,
      title
    );
    // As que já foram lançadas antes levam o título certo ("Loja 3/10", não "Loja 2/10 (3/10)").
    for (const tx of launched) {
      if (linked.has(tx.id) || !tx.installmentNumber) continue;
      if (tx.installmentNumber <= last.installmentNumber) continue;
      const expected = title(tx.installmentNumber);
      // Só o título que o Sektor deu (a pessoa pode ter trocado).
      const generated = tx.description.endsWith(
        ` (${tx.installmentNumber}/${last.installmentTotal})`
      );
      if (generated && tx.description !== expected) {
        ctx.db
          .update(transactions)
          .set({ description: expected, updatedAt: Date.now() })
          .where(eq(transactions.id, tx.id))
          .run();
      }
    }
  }
}

/** Distância entre dois dias do mês, dando a volta. */
const dayDistance = (a: number, b: number) => Math.min(Math.abs(a - b), 31 - Math.abs(a - b));

/**
 * O fechamento e o vencimento seguem a última fatura fechada do banco (o banco muda o dia em fim
 * de semana, então só uma diferença de mais de 3 dias conta). As faturas em aberto seguem juntas.
 */
function cardDaysFromBank(ctx: Ctx, card: Account, bills: BillDates[]): Account {
  const last = bills
    .filter((bill) => bill.closingDate)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .at(-1);
  if (!last) return card;
  const closingDay = Number(last.closingDate!.slice(8, 10));
  const dueDay = Number(last.dueDate.slice(8, 10));
  if (
    card.closingDay &&
    card.dueDay &&
    dayDistance(card.closingDay, closingDay) <= 3 &&
    dayDistance(card.dueDay, dueDay) <= 3
  ) {
    return card;
  }
  const updated = ctx.db
    .update(accounts)
    .set({ closingDay, dueDay, updatedAt: Date.now() })
    .where(eq(accounts.id, card.id))
    .returning()
    .get();
  redateOpenInvoices(ctx, updated);
  return updated;
}

/** Põe cada lançamento em aberto na fatura em que o banco o pôs; sem ela, na do ciclo da data. */
function alignInvoices(ctx: Ctx, bankAccountId: string, card: Account) {
  const movements = ctx.db
    .select()
    .from(bankMovements)
    .where(
      and(
        eq(bankMovements.bankAccountId, bankAccountId),
        isNotNull(bankMovements.billDueDate),
        isNotNull(bankMovements.transactionId)
      )
    )
    .all();
  placeCardItems(ctx, card, new Map(movements.map((m) => [m.transactionId!, storedBill(m)!])));
}

/**
 * Fatura que o banco diz paga. Se o débito aparece numa conta ligada, a fatura é paga por essa
 * conta; se não aparece, foi paga por fora e fica paga sem tirar de conta nenhuma. Pagamento feito
 * numa conta ligada sem o débito correspondente sai.
 */
function payBills(ctx: Ctx, card: Account, bills: PluggyBill[]) {
  for (const bill of bills) {
    const paid = billPayment(bill, ctx.timeZone);
    if (!paid) continue;
    const invoice = findBillInvoice(ctx, card.id, billDates(bill, ctx.timeZone).dueDate);
    if (!invoice) continue;
    const hasItems = ctx.db
      .select({ id: transactions.id })
      .from(transactions)
      .where(and(eq(transactions.invoiceId, invoice.id), liveTx))
      .get();
    if (!hasItems) continue;

    const payment = invoicePayment(ctx, invoice.id);
    if (payment) {
      dropPaymentWithoutDebit(ctx, payment);
      continue;
    }
    if (invoice.paidAt) continue;

    const debit = findDebit(ctx, paid.amountCents, paid.date);
    // Já lançado como despesa: a despesa vira o pagamento (senão sairia duas vezes).
    if (
      debit &&
      debit.movement.status !== 'PENDING' &&
      debit.movement.transactionId &&
      debit.transaction?.kind === 'EXPENSE' &&
      turnIntoInvoicePayment(ctx, invoice.id, debit.movement.transactionId)
    ) {
      continue;
    }
    if (debit?.movement.status === 'PENDING' && debit.accountId) {
      try {
        const result = payInvoice(ctx, invoice.id, {
          fromAccountId: debit.accountId,
          date: paid.date,
          amountCents: paid.amountCents,
        });
        if (result.paymentTransactionId) {
          ctx.db
            .update(bankMovements)
            .set({
              status: 'MATCHED',
              transactionId: result.paymentTransactionId,
              updatedAt: Date.now(),
            })
            .where(eq(bankMovements.id, debit.movement.id))
            .run();
        }
        continue;
      } catch (error) {
        if (!(error instanceof AppError)) throw error;
      }
    }
    // O banco diz que está paga: fica paga mesmo sem achar de onde saiu.
    ctx.db
      .update(invoices)
      .set({ paidAt: Date.now(), updatedAt: Date.now() })
      .where(eq(invoices.id, invoice.id))
      .run();
  }
}

/** O débito desse valor perto da data numa conta (não cartão) ligada. */
function findDebit(ctx: Ctx, amountCents: number, date: string) {
  return ctx.db
    .select({
      movement: bankMovements,
      transaction: transactions,
      accountId: bankAccounts.accountId,
    })
    .from(bankMovements)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankMovements.bankAccountId))
    .leftJoin(
      transactions,
      and(eq(transactions.id, bankMovements.transactionId), isNull(transactions.deletedAt))
    )
    .where(
      and(
        eq(bankMovements.kind, 'EXPENSE'),
        eq(bankMovements.amountCents, amountCents),
        gte(bankMovements.date, addDays(date, -MATCH_WINDOW_DAYS)),
        lte(bankMovements.date, addDays(date, MATCH_WINDOW_DAYS)),
        eq(bankAccounts.type, 'BANK'),
        isNotNull(bankAccounts.accountId)
      )
    )
    .orderBy(asc(bankMovements.date))
    .get();
}

/** O pagamento saiu de uma conta ligada, mas o banco não mostra o débito: tira a transferência. */
function dropPaymentWithoutDebit(
  ctx: Ctx,
  payment: { id: string; accountId: string; amountCents: number; date: string }
) {
  const watched = ctx.db
    .select()
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.type, 'BANK'),
        eq(bankAccounts.accountId, payment.accountId),
        lte(bankAccounts.importFrom, payment.date)
      )
    )
    .get();
  if (!watched) return;
  const seen = ctx.db
    .select({ id: bankMovements.id })
    .from(bankMovements)
    .where(
      or(
        eq(bankMovements.transactionId, payment.id),
        and(
          eq(bankMovements.bankAccountId, watched.id),
          eq(bankMovements.kind, 'EXPENSE'),
          eq(bankMovements.amountCents, payment.amountCents),
          gte(bankMovements.date, addDays(payment.date, -MATCH_WINDOW_DAYS)),
          lte(bankMovements.date, addDays(payment.date, MATCH_WINDOW_DAYS))
        )
      )
    )
    .get();
  if (seen) return;
  removeTransaction(ctx, payment.id);
}

function unpaidCardInvoices(ctx: Ctx) {
  return ctx.db
    .select({ invoice: invoices })
    .from(invoices)
    .innerJoin(accounts, eq(accounts.id, invoices.accountId))
    .where(
      and(
        isNull(invoices.deletedAt),
        eq(accounts.type, 'CREDIT_CARD'),
        isNull(accounts.archivedAt)
      )
    )
    .all()
    .map((row) => row.invoice)
    .filter((invoice) => !invoicePayment(ctx, invoice.id));
}

function itemsOf(ctx: Ctx, invoiceId: string) {
  return ctx.db
    .select()
    .from(transactions)
    .where(and(eq(transactions.invoiceId, invoiceId), liveTx))
    .all();
}

/**
 * Pagamentos de fatura vistos nas contas, mesmo quando o banco do cartão não informa: débito com
 * cara de fatura, no valor dela (até 2%) e perto do vencimento.
 */
function reconcileInvoicePayments(ctx: Ctx) {
  const since = addDays(todayIn(ctx), -120);
  const debits = ctx.db
    .select({
      movement: bankMovements,
      kind: transactions.kind,
      accountId: bankAccounts.accountId,
    })
    .from(bankMovements)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankMovements.bankAccountId))
    .leftJoin(
      transactions,
      and(eq(transactions.id, bankMovements.transactionId), isNull(transactions.deletedAt))
    )
    .where(
      and(
        eq(bankMovements.kind, 'EXPENSE'),
        gte(bankMovements.date, since),
        inArray(bankMovements.status, ['PENDING', 'IMPORTED', 'MATCHED']),
        eq(bankAccounts.type, 'BANK'),
        isNotNull(bankAccounts.accountId)
      )
    )
    .orderBy(asc(bankMovements.date))
    .all();
  const payments = debits.filter(
    (d) =>
      (looksLikeInvoicePayment(d.movement.description) ||
        looksLikeBoleto(d.movement.description)) &&
      (d.movement.status === 'PENDING' || d.kind === 'EXPENSE')
  );
  if (!payments.length) return;

  const unpaid = unpaidCardInvoices(ctx);
  const open = unpaid
    .map((i) => ({
      id: i.id,
      dueDate: i.dueDate,
      totalCents: invoiceBalances(ctx, i.accountId).get(i.id)!.totalCents,
    }))
    .filter((i) => i.totalCents > 0);

  for (const { movement, accountId } of payments) {
    // Boleto pode ser qualquer conta: só no valor exato (até R$ 1 de diferença).
    const slack = (total: number) =>
      looksLikeInvoicePayment(movement.description) ? Math.max(100, total * 0.02) : 100;
    const sameAmount = open.filter(
      (i) => Math.abs(i.totalCents - movement.amountCents) <= slack(i.totalCents)
    );
    const invoice = invoiceForPayment(movement.date, sameAmount);
    if (!invoice) continue;
    open.splice(open.indexOf(invoice), 1);

    if (movement.status === 'PENDING') {
      const paidAt = unpaid.find((i) => i.id === invoice.id)!.paidAt;
      setPaidAt(ctx, invoice.id, null);
      try {
        const paid = payInvoice(ctx, invoice.id, {
          fromAccountId: accountId!,
          date: movement.date,
          amountCents: movement.amountCents,
        });
        ctx.db
          .update(bankMovements)
          .set({
            status: 'MATCHED',
            transactionId: paid.paymentTransactionId,
            updatedAt: Date.now(),
          })
          .where(eq(bankMovements.id, movement.id))
          .run();
      } catch (error) {
        setPaidAt(ctx, invoice.id, paidAt);
        if (!(error instanceof AppError)) throw error;
      }
    } else if (movement.transactionId) {
      turnIntoInvoicePayment(ctx, invoice.id, movement.transactionId);
    }
  }
}

function setPaidAt(ctx: Ctx, invoiceId: string, paidAt: number | null) {
  ctx.db
    .update(invoices)
    .set({ paidAt, updatedAt: Date.now() })
    .where(eq(invoices.id, invoiceId))
    .run();
}

/** Atualiza um banco: estado, contas e saldos, e os lançamentos das contas ligadas. */
async function syncItem(
  ctx: BankCtx,
  id: string,
  context: { remote?: PluggyItem; suggest?: Suggester } = {}
) {
  const item = ctx.db.select().from(pluggyItems).where(eq(pluggyItems.id, id)).get()!;
  const remote = context.remote ?? (await fetchItem(ctx.keys, item.itemId));
  const remoteAccounts = await fetchAccounts(ctx.keys, item.itemId);

  for (const account of remoteAccounts) {
    const data = {
      name: (account.marketingName || account.name).slice(0, 120),
      number: account.number ?? null,
      type: account.type,
      balanceCents: Math.round(account.balance * 100),
    };
    ctx.db
      .insert(bankAccounts)
      .values({ ...stamp(), itemId: item.id, externalId: account.id, ...data })
      .onConflictDoUpdate({
        target: bankAccounts.externalId,
        set: { ...data, itemId: item.id, deletedAt: null, updatedAt: Date.now() },
      })
      .run();
  }

  const linked = ctx.db
    .select()
    .from(bankAccounts)
    .where(
      and(eq(bankAccounts.itemId, item.id), isNotNull(bankAccounts.accountId), liveBankAccount)
    )
    .all();
  if (linked.length) {
    const suggest = context.suggest ?? suggester(ctx);
    for (const bankAccount of linked) await importMovements(ctx, bankAccount, suggest);
  }

  ctx.db
    .update(pluggyItems)
    .set({
      name: remote.connector?.name ?? item.name,
      imageUrl: remote.connector?.imageUrl ?? item.imageUrl,
      status: remote.status,
      lastError: itemError(remote),
      syncedAt: Date.now(),
      updatedAt: Date.now(),
    })
    .where(eq(pluggyItems.id, id))
    .run();
}

/** Sincroniza todos os bancos. Erros ficam gravados (chaves e banco), não sobem. */
export async function syncBanks(ctx: BankCtx) {
  if (!ctx.keys.get()) return;
  const items = ctx.db.select().from(pluggyItems).where(isNull(pluggyItems.deletedAt)).all();
  const suggest = suggester(ctx);
  let lastError: string | null = null;

  for (const item of items) {
    try {
      await syncItem(ctx, item.id, { suggest });
    } catch (error) {
      if (!(error instanceof AppError || error instanceof PluggyApiError)) throw error;
      lastError = errorText(error);
      // Chave inválida vale para todos os bancos: não adianta tentar os outros.
      if (error instanceof AppError) break;
      ctx.db
        .update(pluggyItems)
        .set({ lastError, updatedAt: Date.now() })
        .where(eq(pluggyItems.id, item.id))
        .run();
      lastError = null;
    }
  }
  metaSet(ctx, 'bank_synced_at', new Date().toISOString());
  metaSet(ctx, 'bank_last_error', lastError);
  reconcileInvoicePayments(ctx);
}

// ---------------------------------------------------------------- revisão

function toBankMovement(movement: BankMovement, accountId: string | null): BankMovementResponse {
  return {
    id: movement.id,
    bankAccountId: movement.bankAccountId,
    accountId,
    kind: movement.kind,
    amountCents: movement.amountCents,
    date: movement.date,
    description: shortDescription(movement.description),
    bankDescription: movement.description,
    installmentNumber: movement.installmentNumber,
    installmentTotal: movement.installmentTotal,
    status: movement.status,
    suggestedCategoryId: movement.suggestedCategoryId,
    suggestionSource: movement.suggestedCategoryId ? movement.suggestionSource : null,
    transactionId: movement.transactionId,
  };
}

/** Refaz a sugestão dos que esperam revisão com o histórico de agora. */
function refreshSuggestions(ctx: Ctx) {
  const pending = ctx.db
    .select({ movement: bankMovements, type: bankAccounts.type })
    .from(bankMovements)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankMovements.bankAccountId))
    .where(eq(bankMovements.status, 'PENDING'))
    .all();
  if (!pending.length) return;
  const suggest = suggester(ctx);
  for (const { movement, type } of pending) {
    const next = suggestionFor(suggest, movement, type);
    if (
      next.suggestedCategoryId === movement.suggestedCategoryId &&
      next.suggestionSource === movement.suggestionSource
    ) {
      continue;
    }
    ctx.db
      .update(bankMovements)
      .set({ ...next, updatedAt: Date.now() })
      .where(eq(bankMovements.id, movement.id))
      .run();
  }
}

export function listMovements(
  ctx: Ctx,
  status: BankMovementStatus = 'PENDING'
): BankMovementResponse[] {
  if (status === 'PENDING') refreshSuggestions(ctx);
  return ctx.db
    .select({ movement: bankMovements, accountId: bankAccounts.accountId })
    .from(bankMovements)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankMovements.bankAccountId))
    .where(
      and(
        eq(bankMovements.status, status),
        status === 'PENDING' ? isNotNull(bankAccounts.accountId) : undefined
      )
    )
    .orderBy(desc(bankMovements.date), asc(bankMovements.createdAt))
    .limit(500)
    .all()
    .map(({ movement, accountId }) => toBankMovement(movement, accountId));
}

export function acceptMovement(ctx: Ctx, id: string, body: AcceptBankMovementBody = {}) {
  const row = ctx.db
    .select({ movement: bankMovements, accountId: bankAccounts.accountId })
    .from(bankMovements)
    .innerJoin(bankAccounts, eq(bankAccounts.id, bankMovements.bankAccountId))
    .where(and(eq(bankMovements.id, id), eq(bankMovements.status, 'PENDING')))
    .get();
  if (!row) throw notFound('Lançamento do banco não encontrado.');
  const { movement, accountId } = row;
  if (!accountId) throw new AppError(400, 'Ligue a conta do banco a uma conta do Sektor.');

  ctx.db
    .update(bankMovements)
    .set({ status: 'IMPORTED', updatedAt: Date.now() })
    .where(eq(bankMovements.id, id))
    .run();

  const kind = body.kind ?? movement.kind;
  const categoryId =
    body.categoryId !== undefined
      ? body.categoryId
      : kind === movement.kind
        ? movement.suggestedCategoryId
        : null;
  try {
    // Pagamento de fatura, a menos que a pessoa tenha escolhido outra categoria ou tipo.
    const payment =
      kind === 'EXPENSE' && categoryId === movement.suggestedCategoryId
        ? payInvoiceWith(ctx, movement, accountId)
        : null;
    if (payment) return finishAccept(ctx, id, { transactionId: payment }, accountId);

    const [created] = createTransactions(
      ctx,
      {
        kind,
        amountCents: movement.amountCents,
        date: movement.date,
        accountId,
        categoryId,
        description: body.description ?? importedDescription(movement),
        // O texto como veio do banco fica nas notas quando o título é outro.
        notes:
          body.notes !== undefined
            ? body.notes || null
            : shortDescription(movement.description) !== movement.description
              ? movement.description
              : null,
        status: 'DONE',
      },
      { bill: storedBill(movement) ?? undefined }
    );
    const edited =
      kind !== movement.kind ||
      categoryId !== movement.suggestedCategoryId ||
      (body.description !== undefined && body.description !== importedDescription(movement));
    const response = finishAccept(ctx, id, { transactionId: created!.id, edited }, accountId);
    if (movement.installmentNumber) fillInstallments(ctx, movement.bankAccountId);
    return response;
  } catch (error) {
    ctx.db
      .update(bankMovements)
      .set({ status: 'PENDING', updatedAt: Date.now() })
      .where(eq(bankMovements.id, id))
      .run();
    throw error;
  }
}

function finishAccept(
  ctx: Ctx,
  id: string,
  data: { transactionId: string; edited?: boolean },
  accountId: string
) {
  const updated = ctx.db
    .update(bankMovements)
    .set({ ...data, updatedAt: Date.now() })
    .where(eq(bankMovements.id, id))
    .returning()
    .get();
  return toBankMovement(updated, accountId);
}

/**
 * Débito com cara de pagamento de fatura e uma fatura aberta perto do vencimento: paga essa fatura
 * em vez de virar despesa. Devolve o id do pagamento, ou null para seguir como lançamento comum.
 */
function payInvoiceWith(
  ctx: Ctx,
  movement: Pick<BankMovement, 'kind' | 'description' | 'date' | 'amountCents'>,
  accountId: string,
  /** Só as que o banco deu como pagas sem o débito (na sincronização, sem a pessoa conferir). */
  onlyPaidElsewhere = false
): string | null {
  if (movement.kind !== 'EXPENSE' || !looksLikeInvoicePayment(movement.description)) return null;
  const candidates = unpaidCardInvoices(ctx).filter(
    (invoice) =>
      (!onlyPaidElsewhere || invoice.paidAt !== null) && itemsOf(ctx, invoice.id).length > 0
  );
  const invoice = invoiceForPayment(movement.date, candidates);
  if (!invoice) return null;
  setPaidAt(ctx, invoice.id, null);
  try {
    const paid = payInvoice(ctx, invoice.id, {
      fromAccountId: accountId,
      date: movement.date,
      amountCents: movement.amountCents,
    });
    return paid.paymentTransactionId;
  } catch (error) {
    setPaidAt(ctx, invoice.id, invoice.paidAt);
    if (!(error instanceof AppError)) throw error;
    return null;
  }
}

/** Aceita todos os pendentes com a categoria sugerida. */
export function acceptAll(ctx: Ctx) {
  // Pagamentos de fatura por último: a fatura precisa ter as compras para ser paga.
  const pending = listMovements(ctx, 'PENDING').sort(
    (a, b) =>
      Number(looksLikeInvoicePayment(a.description)) -
      Number(looksLikeInvoicePayment(b.description))
  );
  let imported = 0;
  for (const movement of pending) {
    try {
      acceptMovement(ctx, movement.id);
      imported++;
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  return { imported };
}

/** Recusa tudo o que espera revisão (o banco não manda de novo: fica recusado). */
export function ignoreAll(ctx: Ctx) {
  const { changes } = ctx.db
    .update(bankMovements)
    .set({ status: 'IGNORED', updatedAt: Date.now() })
    .where(eq(bankMovements.status, 'PENDING'))
    .run();
  return { ignored: changes };
}

export function ignoreMovement(ctx: Ctx, id: string) {
  const { changes } = ctx.db
    .update(bankMovements)
    .set({ status: 'IGNORED', updatedAt: Date.now() })
    .where(and(eq(bankMovements.id, id), eq(bankMovements.status, 'PENDING')))
    .run();
  if (!changes) throw notFound('Lançamento do banco não encontrado.');
}

// ---------------------------------------------------------------- conferência do cartão

/** O cartão ligado como o banco vê, ao lado das faturas do Sektor. Lê a Pluggy na hora. */
export async function cardCheck(ctx: BankCtx, accountId: string): Promise<BankCardCheckResponse> {
  const row = ctx.db
    .select({ bankAccount: bankAccounts, item: pluggyItems })
    .from(bankAccounts)
    .innerJoin(pluggyItems, eq(pluggyItems.id, bankAccounts.itemId))
    .where(
      and(
        eq(bankAccounts.accountId, accountId),
        eq(bankAccounts.type, 'CREDIT'),
        liveBankAccount
      )
    )
    .get();
  if (!row) throw notFound('Cartão ligado ao banco não encontrado.');
  const { bankAccount, item } = row;
  const [remote, bills] = await friendly(() =>
    Promise.all([fetchAccounts(ctx.keys, item.itemId), fetchBills(ctx.keys, bankAccount.externalId)])
  );
  const ours = listInvoices(ctx, accountId);
  const movements = ctx.db
    .select()
    .from(bankMovements)
    .where(eq(bankMovements.bankAccountId, bankAccount.id))
    .all();
  const account = remote.find((a) => a.id === bankAccount.externalId);
  const used = account ? account.balance : bankAccount.balanceCents / 100;

  return {
    bankName: item.name,
    usedCents: Math.abs(Math.round(used * 100)),
    openCents: ours.filter((i) => i.status !== 'PAID').reduce((sum, i) => sum + i.totalCents, 0),
    bills: bills
      .map((bill) => {
        const dates = billDates(bill, ctx.timeZone);
        const paid = (bill.payments ?? []).filter((p) => p.amount > 0);
        const lastPaid = paid
          .map((p) => p.paymentDate)
          .filter((d): d is string => Boolean(d))
          .sort()
          .at(-1);
        const invoice = ours
          .filter((i) => Math.abs(diffInDays(i.dueDate, dates.dueDate)) <= 7)
          .sort(
            (a, b) =>
              Math.abs(diffInDays(a.dueDate, dates.dueDate)) -
              Math.abs(diffInDays(b.dueDate, dates.dueDate))
          )[0];
        return {
          dueDate: dates.dueDate,
          closingDate: dates.closingDate,
          bankTotalCents: Math.round(bill.totalAmount * 100),
          bankPaidCents: paid.reduce((sum, p) => sum + Math.round(p.amount * 100), 0),
          bankPaidOn: lastPaid ? dateStringInZone(new Date(lastPaid), ctx.timeZone) : null,
          invoice: invoice
            ? {
                id: invoice.id,
                referenceMonth: invoice.referenceMonth,
                totalCents: invoice.totalCents,
                status: invoice.status,
              }
            : null,
        };
      })
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
      .slice(0, 6),
    movements: {
      total: movements.length,
      withBill: movements.filter((m) => m.billDueDate !== null).length,
    },
  };
}

