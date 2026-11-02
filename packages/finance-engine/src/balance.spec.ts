import { describe, expect, it } from 'vitest';

import {
  accountBalance,
  type LedgerAccount,
  type LedgerTransaction,
  projectBalances,
} from './balance';

const checking: LedgerAccount = { id: 'c', type: 'CHECKING', initialBalanceCents: 100_00 };
const card: LedgerAccount = { id: 'k', type: 'CREDIT_CARD', initialBalanceCents: 0 };

const tx = (partial: Partial<LedgerTransaction>): LedgerTransaction => ({
  kind: 'EXPENSE',
  amountCents: 0,
  date: '2026-10-01',
  accountId: 'c',
  toAccountId: null,
  status: 'DONE',
  ...partial,
});

describe('accountBalance', () => {
  const txs = [
    tx({ kind: 'INCOME', amountCents: 50_00 }),
    tx({ kind: 'EXPENSE', amountCents: 20_00 }),
    tx({ kind: 'TRANSFER', amountCents: 10_00, toAccountId: 'k' }),
    tx({ kind: 'EXPENSE', amountCents: 5_00, status: 'PLANNED', date: '2026-10-10' }),
  ];

  it('soma só os efetivados', () => {
    expect(accountBalance(checking, txs)).toBe(120_00);
    expect(accountBalance(card, txs)).toBe(10_00);
  });

  it('soma os previstos até a data pedida', () => {
    expect(accountBalance(checking, txs, { plannedUntil: '2026-10-09' })).toBe(120_00);
    expect(accountBalance(checking, txs, { plannedUntil: '2026-10-10' })).toBe(115_00);
  });
});

describe('projectBalances', () => {
  it('projeta dia a dia e acha o primeiro saldo negativo', () => {
    const txs = [
      tx({ kind: 'EXPENSE', amountCents: 30_00, status: 'PLANNED', date: '2026-09-30' }), // atrasado
      tx({ kind: 'EXPENSE', amountCents: 80_00, status: 'PLANNED', date: '2026-10-03' }),
      tx({ kind: 'INCOME', amountCents: 100_00, status: 'PLANNED', date: '2026-10-05' }),
      tx({
        kind: 'EXPENSE',
        amountCents: 40_00,
        status: 'PLANNED',
        date: '2026-10-02',
        accountId: 'k',
      }),
    ];
    const result = projectBalances([checking, card], txs, '2026-10-01', 5);

    expect(result.days.map((d) => d.totalCents)).toEqual([70_00, 70_00, -10_00, -10_00, 90_00]);
    expect(result.days[1].byAccount.k).toBe(-40_00);
    expect(result.firstNegative).toEqual({
      date: '2026-10-03',
      accountId: 'c',
      balanceCents: -10_00,
    });
  });
});
