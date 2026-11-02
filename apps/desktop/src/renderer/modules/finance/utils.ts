import type { Rpc } from '@sektor/core';

import { money } from '../../lib/format';

// Regras puras de Finanças. Nada aqui toca em React.

type Out<M extends keyof Rpc> = Awaited<ReturnType<Rpc[M]>>;

export type Account = Out<'accounts.list'>[number];
export type AccountType = Account['type'];
export type Category = Out<'categories.list'>[number];
export type Transaction = Out<'transactions.list'>[number];
export type TransactionKind = Transaction['kind'];
export type Invoice = Out<'accounts.invoices'>[number];
export type Budget = Out<'budgets.list'>[number];
export type Forecast = Out<'reports.forecast'>;
export type BankStatus = Out<'bank.status'>;
export type BankItem = BankStatus['items'][number];
export type BankAccount = BankItem['accounts'][number];
export type Movement = Out<'bank.movements'>[number];
export type CardCheck = Out<'bank.cardCheck'>;

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  WALLET: 'Carteira',
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  CREDIT_CARD: 'Cartão de crédito',
};

export const INVOICE_STATUS_LABELS: Record<Invoice['status'], string> = {
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  PAID: 'Paga',
  OVERDUE: 'Vencida',
};

// ------------------------------------------------------------------ datas

export const monthOfDay = (day: string) => day.slice(0, 7);

export function shiftMonth(month: string, delta: number) {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year!, m! - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

export function addDays(day: string, days: number) {
  const [year, month, d] = day.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, d! + days)).toISOString().slice(0, 10);
}

// ------------------------------------------------------------------ lançamentos

/** Linha do extrato que é uma fatura a pagar: ainda não é lançamento, sai da conta no vencimento. */
export type StatementItem = Transaction & { dueInvoice?: Invoice; cardName?: string };

export type AccountScope = ReadonlySet<string>;

const inScope = (scope: AccountScope, id: string | null) => id !== null && scope.has(id);

/** Valor com sinal. Transferência só conta num recorte, e dentro dele não muda nada. */
export function signedAmount(tx: Transaction, scope?: AccountScope): number {
  if (tx.kind === 'INCOME') return tx.amountCents;
  if (tx.kind === 'EXPENSE') return -tx.amountCents;
  if (!scope) return 0;
  const into = inScope(scope, tx.toAccountId);
  const out = inScope(scope, tx.accountId);
  if (into && !out) return tx.amountCents;
  if (out && !into) return -tx.amountCents;
  return 0;
}

export type StatementScope = 'all' | 'accounts' | 'cards';

export function scopeAccountIds(
  accounts: Pick<Account, 'id' | 'type'>[],
  scope: StatementScope
): AccountScope | undefined {
  if (scope === 'all') return undefined;
  const cards = scope === 'cards';
  return new Set(accounts.filter((a) => (a.type === 'CREDIT_CARD') === cards).map((a) => a.id));
}

export function totalsOf(transactions: Transaction[], scope?: AccountScope) {
  const totals = { incomeCents: 0, expenseCents: 0, netCents: 0 };
  for (const tx of transactions) {
    const value = signedAmount(tx, scope);
    if (value > 0) totals.incomeCents += value;
    else totals.expenseCents -= value;
  }
  totals.netCents = totals.incomeCents - totals.expenseCents;
  return totals;
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export function filterStatement(items: StatementItem[], search: string, scope?: AccountScope) {
  const term = normalize(search);
  return items.filter((tx) => {
    if (scope && !tx.dueInvoice && !inScope(scope, tx.accountId) && !inScope(scope, tx.toAccountId))
      return false;
    return !term || normalize(`${tx.description} ${tx.notes ?? ''}`).includes(term);
  });
}

export type StatementRow =
  | { type: 'day'; date: string; totalCents: number }
  | { type: 'item'; item: StatementItem };

/** Linhas da lista virtualizada: o dia, do mais recente para o mais antigo, e seus lançamentos. */
export function statementRows(items: StatementItem[], scope?: AccountScope): StatementRow[] {
  const days = new Map<string, StatementItem[]>();
  for (const item of items) days.set(item.date, [...(days.get(item.date) ?? []), item]);
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .flatMap(([date, list]) => [
      {
        type: 'day' as const,
        date,
        totalCents: list.reduce((sum, tx) => sum + signedAmount(tx, scope), 0),
      },
      ...list.map((item) => ({ type: 'item' as const, item })),
    ]);
}

/**
 * Faturas como saídas previstas no vencimento. Só no recorte Contas: em Tudo as compras do cartão já
 * contam, e a fatura seria a mesma despesa duas vezes.
 */
export function dueInvoiceRows(invoices: Invoice[], accounts: Account[]): StatementItem[] {
  return invoices.flatMap((invoice) => {
    const card = accounts.find((a) => a.id === invoice.accountId);
    if (!card || invoice.status === 'PAID' || invoice.totalCents <= 0) return [];
    return {
      id: `fatura:${invoice.id}`,
      kind: 'EXPENSE' as const,
      amountCents: invoice.totalCents,
      date: invoice.dueDate,
      accountId: card.paymentAccountId ?? card.id,
      toAccountId: null,
      categoryId: null,
      description: `Fatura ${card.name}`,
      notes: null,
      status: 'PLANNED' as const,
      recurrenceId: null,
      recurrenceRule: null,
      installmentGroupId: null,
      installmentNumber: null,
      installmentTotal: null,
      invoiceId: null,
      paysInvoiceId: null,
      dueInvoice: invoice,
      cardName: card.name,
    };
  });
}

export function installmentLabel(tx: Pick<Transaction, 'installmentNumber' | 'installmentTotal'>) {
  if (!tx.installmentNumber || !tx.installmentTotal) return null;
  return `${tx.installmentNumber}/${tx.installmentTotal}`;
}

/** "3× de R$ 33,34": a parcela maior, que é a primeira (os centavos que sobram vão nas primeiras). */
export function installmentPreview(totalCents: number, count: number) {
  if (totalCents <= 0 || count < 2) return null;
  return `${count}× de ${money(Math.ceil(totalCents / count))}`;
}

export const defaultDone = (date: string, today: string) => date <= today;

// ------------------------------------------------------------------ repetição

export type Repetition = 'none' | 'installments' | 'weekly' | 'monthly' | 'yearly';

export const REPETITION_OPTIONS: { value: Repetition; label: string }[] = [
  { value: 'none', label: 'Não repete' },
  { value: 'installments', label: 'Parcelado' },
  { value: 'weekly', label: 'Toda semana' },
  { value: 'monthly', label: 'Todo mês' },
  { value: 'yearly', label: 'Todo ano' },
];

const FREQ = { weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' } as const;

/** Campos de repetição da criação (nunca recorrência e parcelas juntas). */
export function repetitionFields(
  repetition: Repetition,
  installments: number
): { recurrence?: { rrule: string }; installments?: number } {
  if (repetition === 'none') return {};
  if (repetition === 'installments') {
    return { installments: Math.min(72, Math.max(2, Math.round(installments))) };
  }
  return { recurrence: { rrule: `FREQ=${FREQ[repetition]}` } };
}

// ------------------------------------------------------------------ categorias

/** Subcategoria sem cor ou ícone usa os da mãe. */
export function styledCategory(category: Category | null | undefined, all: Category[]) {
  if (!category) return null;
  if (category.color && category.icon) return category;
  const parent = category.parentId ? all.find((c) => c.id === category.parentId) : undefined;
  if (!parent) return category;
  return { ...category, color: category.color ?? parent.color, icon: category.icon ?? parent.icon };
}

export function categoryLabel(category: Category, all: Category[]) {
  const parent = category.parentId ? all.find((c) => c.id === category.parentId) : undefined;
  return parent ? `${parent.name} › ${category.name}` : category.name;
}

/** Mães em ordem alfabética, cada uma com as filhas. */
export function categoryTree(all: Category[], kind: TransactionKind) {
  if (kind === 'TRANSFER') return [];
  const ofKind = all.filter((c) => c.kind === kind);
  const byName = (a: Category, b: Category) => a.name.localeCompare(b.name, 'pt-BR');
  const ids = new Set(ofKind.map((c) => c.id));
  return ofKind
    .filter((c) => !c.parentId || !ids.has(c.parentId))
    .sort(byName)
    .map((parent) => ({
      parent,
      children: ofKind.filter((c) => c.parentId === parent.id).sort(byName),
    }));
}

/** Despesas do mês por categoria, da maior para a menor. */
export function categorySlices(
  totals: { categoryId: string | null; totalCents: number }[],
  all: Category[]
) {
  const positive = totals.filter((t) => t.totalCents > 0);
  const sum = positive.reduce((acc, t) => acc + t.totalCents, 0);
  return positive
    .map((t) => {
      const category = styledCategory(
        all.find((c) => c.id === t.categoryId),
        all
      );
      return {
        categoryId: t.categoryId,
        category,
        name: category ? categoryLabel(category, all) : 'Sem categoria',
        totalCents: t.totalCents,
        percent: sum ? (t.totalCents / sum) * 100 : 0,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);
}

// ------------------------------------------------------------------ números

/** "12% menos que setembro", ou null quando não há base. */
export function comparisonText(current: number, previous: number, previousName: string) {
  if (previous <= 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return `Igual a ${previousName}`;
  return `${Math.abs(change)}% ${change > 0 ? 'mais' : 'menos'} que ${previousName}`;
}

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

/** Eixo do gráfico, sem o "R$": "500", "2 mil", "1,5 mi", "−300". */
export function compactMoney(cents: number) {
  const reais = Math.abs(cents) / 100;
  const sign = cents < 0 ? '−' : '';
  if (reais >= 1_000_000) return `${sign}${decimal.format(reais / 1_000_000)} mi`;
  if (reais >= 1_000) return `${sign}${decimal.format(reais / 1_000)} mil`;
  return `${sign}${Math.round(reais)}`;
}

/** Onde (0 = topo, 1 = base) o zero cai no eixo: o ponto em que o gradiente troca de cor. */
export function zeroCrossingOffset(values: number[]) {
  if (!values.length) return 1;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max <= 0) return 0;
  if (min >= 0) return 1;
  return max / (max - min);
}

// ------------------------------------------------------------------ orçamentos e faturas

export function budgetBar(budget: Pick<Budget, 'limitCents' | 'spentCents' | 'plannedCents'>) {
  const limit = Math.max(budget.limitCents, 1);
  const ratio = budget.spentCents / limit;
  const spentWidth = Math.min(100, ratio * 100);
  return {
    spentWidth,
    plannedWidth: Math.max(0, Math.min(100 - spentWidth, (budget.plannedCents / limit) * 100)),
    level: (ratio >= 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok') as 'ok' | 'warn' | 'over',
    remainingCents: budget.limitCents - budget.spentCents,
  };
}

/** Só a primeira fatura aberta de um cartão está correndo; as outras são parcelas que vão cair. */
export function futureInvoiceIds(invoices: Pick<Invoice, 'id' | 'status' | 'closingDate'>[]) {
  const open = invoices
    .filter((i) => i.status === 'OPEN')
    .sort((a, b) => a.closingDate.localeCompare(b.closingDate));
  return new Set(open.slice(1).map((i) => i.id));
}

export function groupInvoices(invoices: Invoice[]) {
  const unpaid = invoices
    .filter((i) => i.status !== 'PAID')
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const paid = invoices
    .filter((i) => i.status === 'PAID')
    .sort((a, b) => b.dueDate.localeCompare(a.dueDate));
  return [
    { title: 'A pagar', items: unpaid },
    { title: 'Pagas', items: paid },
  ].filter((group) => group.items.length > 0);
}

export function ago(iso: string | null) {
  if (!iso) return 'nunca';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  return new Date(iso).toLocaleDateString('pt-BR');
}
