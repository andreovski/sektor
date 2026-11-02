import { addDays, type DateString } from './dates';

export interface LedgerTransaction {
  kind: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  amountCents: number;
  date: DateString;
  accountId: string;
  toAccountId: string | null;
  status: 'PLANNED' | 'DONE';
}

export interface LedgerAccount {
  id: string;
  type: 'WALLET' | 'CHECKING' | 'SAVINGS' | 'CREDIT_CARD';
  initialBalanceCents: number;
}

/** Quanto o lançamento move o saldo da conta (positivo entra, negativo sai, 0 não é dela). */
export function signedAmount(tx: LedgerTransaction, accountId: string): number {
  if (tx.kind === 'INCOME') return tx.accountId === accountId ? tx.amountCents : 0;
  if (tx.kind === 'EXPENSE') return tx.accountId === accountId ? -tx.amountCents : 0;
  let delta = 0;
  if (tx.accountId === accountId) delta -= tx.amountCents;
  if (tx.toAccountId === accountId) delta += tx.amountCents;
  return delta;
}

/**
 * Saldo da conta: inicial + efetivados. Com `plannedUntil`, soma também os previstos até esse dia
 * (inclusive), que é o saldo "esperado".
 */
export function accountBalance(
  account: LedgerAccount,
  transactions: LedgerTransaction[],
  options: { plannedUntil?: DateString } = {}
): number {
  let balance = account.initialBalanceCents;
  for (const tx of transactions) {
    if (tx.status === 'DONE' || (options.plannedUntil && tx.date <= options.plannedUntil)) {
      balance += signedAmount(tx, account.id);
    }
  }
  return balance;
}

export interface ProjectionDay {
  date: DateString;
  /** Soma das contas que não são cartão: o dinheiro disponível. */
  totalCents: number;
  byAccount: Record<string, number>;
}

export interface NegativeAlert {
  date: DateString;
  /** null = o total ficou negativo, mesmo sem nenhuma conta sozinha negativa. */
  accountId: string | null;
  balanceCents: number;
}

/**
 * Saldo dia a dia de `start` por `days` dias. Parte dos efetivados; previstos atrasados (antes de
 * `start`) entram no primeiro dia, porque ainda vão acontecer.
 */
export function projectBalances(
  accounts: LedgerAccount[],
  transactions: LedgerTransaction[],
  start: DateString,
  days: number
): { days: ProjectionDay[]; firstNegative: NegativeAlert | null } {
  const balances: Record<string, number> = {};
  for (const account of accounts) {
    balances[account.id] = accountBalance(account, transactions);
  }

  const plannedByDate = new Map<DateString, LedgerTransaction[]>();
  for (const tx of transactions) {
    if (tx.status !== 'PLANNED') continue;
    const day = tx.date < start ? start : tx.date;
    const list = plannedByDate.get(day) ?? [];
    list.push(tx);
    plannedByDate.set(day, list);
  }

  const cash = accounts.filter((a) => a.type !== 'CREDIT_CARD');
  const result: ProjectionDay[] = [];
  let firstNegative: NegativeAlert | null = null;

  for (let i = 0; i < days; i++) {
    const date = addDays(start, i);
    for (const tx of plannedByDate.get(date) ?? []) {
      for (const account of accounts) {
        balances[account.id] += signedAmount(tx, account.id);
      }
    }

    const totalCents = cash.reduce((sum, a) => sum + balances[a.id], 0);
    result.push({ date, totalCents, byAccount: { ...balances } });

    if (!firstNegative) {
      const negative = cash.find((a) => balances[a.id] < 0);
      if (negative) {
        firstNegative = { date, accountId: negative.id, balanceCents: balances[negative.id] };
      } else if (totalCents < 0) {
        firstNegative = { date, accountId: null, balanceCents: totalCents };
      }
    }
  }

  return { days: result, firstNegative };
}
