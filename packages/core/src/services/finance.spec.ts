import type { AccountResponse, InvoiceResponse } from '@sektor/contract';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DbHandle, openDatabase } from '../db/client';
import { categories, invoices, transactions } from '../db/schema';

import * as cat from './categories';
import type { Ctx } from './context';
import * as fin from './finance';
import * as rep from './reports';

// 18/10/2026, meio-dia em São Paulo.
const NOW = new Date('2026-10-18T15:00:00Z');

describe('finanças', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: Ctx;
  let checking: AccountResponse;
  let card: AccountResponse;
  let market: string;

  const account = (id: string) => fin.listAccounts(ctx, true).find((a) => a.id === id)!;
  const expectStatus = (run: () => unknown, status: number) =>
    expect(run).toThrow(expect.objectContaining({ status }));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-fin-'));
    handle = openDatabase(join(dir, 'f.db'), 'b'.repeat(64));
    ctx = { db: handle.orm, timeZone: 'America/Sao_Paulo' };
    cat.ensureCategories(ctx);
    checking = fin.createAccount(ctx, {
      name: 'Nubank',
      type: 'CHECKING',
      initialBalanceCents: 1000_00,
    });
    card = fin.createAccount(ctx, {
      name: 'Cartão',
      type: 'CREDIT_CARD',
      initialBalanceCents: 0,
      closingDay: 25,
      dueDay: 5,
      paymentAccountId: checking.id,
    });
    market = ctx.db.select().from(categories).where(eq(categories.name, 'Mercado')).get()!.id;
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('Transferência é fixa: Pix, Débito e Crédito, sem apagar nem renomear', () => {
    const list = cat.listCategories(ctx);
    const fixed = list.filter((c) => c.systemKey);
    expect(fixed).toHaveLength(8);
    for (const kind of ['INCOME', 'EXPENSE'] as const) {
      const parent = fixed.find((c) => c.kind === kind && c.systemKey === 'TRANSFER')!;
      expect(parent).toMatchObject({ name: 'Transferência', parentId: null });
      expect(
        fixed
          .filter((c) => c.parentId === parent.id)
          .map((c) => c.name)
          .sort()
      ).toEqual(['Crédito', 'Débito', 'Pix']);
    }
    const pix = fixed.find((c) => c.kind === 'EXPENSE' && c.systemKey === 'TRANSFER_PIX')!;
    expectStatus(() => cat.deleteCategory(ctx, pix.id), 409);
    expectStatus(() => cat.updateCategory(ctx, pix.id, { name: 'Pix enviado' }), 409);
    expectStatus(() => cat.updateCategory(ctx, pix.id, { parentId: null }), 409);
    expect(
      cat.updateCategory(ctx, pix.id, { name: 'Pix', color: '#ff9500', icon: 'coins' })
    ).toMatchObject({ name: 'Pix', color: '#ff9500', icon: 'coins' });
    const parent = fixed.find((c) => c.kind === 'EXPENSE' && c.systemKey === 'TRANSFER')!;
    const own = cat.createCategory(ctx, { name: 'Boleto', kind: 'EXPENSE', parentId: parent.id });
    cat.deleteCategory(ctx, own.id);
    expect(cat.listCategories(ctx).some((c) => c.id === own.id)).toBe(false);
  });

  it('categorias fixas não duplicam ao abrir de novo', () => {
    const before = cat.listCategories(ctx).length;
    cat.ensureCategories(ctx);
    expect(cat.listCategories(ctx)).toHaveLength(before);
  });

  it('lançamento passado é efetivado, futuro é previsto', () => {
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 200_00,
      date: '2026-10-10',
      accountId: checking.id,
      categoryId: market,
      description: 'Feira',
    });
    const [future] = fin.createTransactions(ctx, {
      kind: 'INCOME',
      amountCents: 500_00,
      date: '2026-10-30',
      accountId: checking.id,
      description: 'Freela',
    });
    expect(future!.status).toBe('PLANNED');
    expect(account(checking.id)).toMatchObject({
      balanceCents: 800_00,
      expectedBalanceCents: 800_00,
    });
  });

  it('transferência move entre contas', () => {
    const savings = fin.createAccount(ctx, {
      name: 'Reserva',
      type: 'SAVINGS',
      initialBalanceCents: 0,
    });
    expectStatus(
      () =>
        fin.createTransactions(ctx, {
          kind: 'TRANSFER',
          amountCents: 100_00,
          date: '2026-10-18',
          accountId: checking.id,
          description: 'Guardar',
        }),
      400
    );
    fin.createTransactions(ctx, {
      kind: 'TRANSFER',
      amountCents: 100_00,
      date: '2026-10-18',
      accountId: checking.id,
      toAccountId: savings.id,
      description: 'Guardar',
    });
    expect(account(checking.id).balanceCents).toBe(900_00);
    expect(account(savings.id).balanceCents).toBe(100_00);
  });

  it('compra parcelada cai em faturas seguidas e a fatura é paga', () => {
    const created = fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 300_00,
      date: '2026-10-20',
      accountId: card.id,
      categoryId: market,
      description: 'Fone',
      installments: 3,
    });
    expect(created.map((t) => [t.date, t.amountCents, t.installmentNumber, t.status])).toEqual([
      ['2026-10-20', 100_00, 1, 'DONE'],
      ['2026-11-20', 100_00, 2, 'DONE'],
      ['2026-12-20', 100_00, 3, 'DONE'],
    ]);
    // Compra no dia do fechamento vai para a fatura seguinte.
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 50_00,
      date: '2026-10-25',
      accountId: card.id,
      description: 'Padaria',
    });

    const list: InvoiceResponse[] = fin.listInvoices(ctx, card.id);
    expect(list.map((i) => [i.referenceMonth, i.totalCents, i.dueDate, i.status])).toEqual([
      ['2026-12', 100_00, '2027-01-05', 'OPEN'],
      ['2026-11', 150_00, '2026-12-05', 'OPEN'],
      ['2026-10', 100_00, '2026-11-05', 'OPEN'],
    ]);
    expect(account(card.id).openInvoiceCents).toBe(100_00);

    const october = list[2]!;
    const paid = fin.payInvoice(ctx, october.id);
    expect(paid.status).toBe('PAID');
    expectStatus(() => fin.payInvoice(ctx, october.id), 409);
    expect(account(checking.id).balanceCents).toBe(900_00);
    expect(account(card.id).balanceCents).toBe(-200_00);

    // Apagar o pagamento reabre a fatura, e dá para pagar de novo.
    fin.deleteTransaction(ctx, paid.paymentTransactionId!);
    expect(fin.listInvoices(ctx, card.id)[2]!.status).toBe('OPEN');
    expect(fin.payInvoice(ctx, october.id).status).toBe('PAID');
  });

  it('faturas a pagar: no vencimento, até serem pagas no app ou por fora', () => {
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 300_00,
      date: '2026-10-20',
      accountId: card.id,
      description: 'Fone',
      installments: 3,
    });
    const due = (query: { month?: string; from?: string; to?: string }) =>
      fin.listDueInvoices(ctx, query).map((i) => [i.referenceMonth, i.dueDate, i.totalCents]);

    expect(due({ month: '2026-11' })).toEqual([['2026-10', '2026-11-05', 100_00]]);
    expect(due({ from: '2026-11-01', to: '2027-01-31' })).toEqual([
      ['2026-10', '2026-11-05', 100_00],
      ['2026-11', '2026-12-05', 100_00],
      ['2026-12', '2027-01-05', 100_00],
    ]);
    expect(due({ month: '2026-10' })).toEqual([]);

    const [october, november] = fin.listDueInvoices(ctx, { from: '2026-11-01', to: '2026-12-31' });
    fin.payInvoice(ctx, october!.id);
    ctx.db
      .update(invoices)
      .set({ paidAt: Date.now() })
      .where(eq(invoices.id, november!.id))
      .run();
    expect(due({ from: '2026-11-01', to: '2027-01-31' })).toEqual([
      ['2026-12', '2027-01-05', 100_00],
    ]);
  });

  it('recorrência gera 12 meses e edita ou apaga daqui para frente', () => {
    const created = fin.createTransactions(ctx, {
      kind: 'INCOME',
      amountCents: 5000_00,
      date: '2026-10-05',
      accountId: checking.id,
      description: 'Salário',
      recurrence: { rrule: 'FREQ=MONTHLY' },
    });
    expect(created).toHaveLength(13);
    expect(created[0]).toMatchObject({ status: 'DONE', recurrenceRule: 'FREQ=MONTHLY' });
    expect(created[1]).toMatchObject({ date: '2026-11-05', status: 'PLANNED' });

    const december = created[2]!;
    fin.updateTransaction(ctx, december.id, { amountCents: 5500_00, scope: 'future' });
    const after = fin.listTransactions(ctx, { kind: 'INCOME' });
    const amounts = Object.fromEntries(after.map((t) => [t.date, t.amountCents]));
    expect(amounts['2026-11-05']).toBe(5000_00);
    expect(amounts['2026-12-05']).toBe(5500_00);
    expect(amounts['2027-06-05']).toBe(5500_00);

    // Só esta: vira exceção e não muda com as próximas edições.
    const january = after.find((t) => t.date === '2027-01-05')!;
    fin.updateTransaction(ctx, january.id, { amountCents: 6000_00 });
    fin.updateTransaction(ctx, december.id, { description: 'Salário novo', scope: 'future' });
    expect(
      ctx.db.select().from(transactions).where(eq(transactions.id, january.id)).get()
    ).toMatchObject({
      amountCents: 6000_00,
      description: 'Salário',
      isRecurrenceException: true,
    });

    // Cancela a partir de março: some e a extensão não recria.
    const march = after.find((t) => t.date === '2027-03-05')!;
    fin.deleteTransaction(ctx, march.id, 'future');
    const remaining = fin.listTransactions(ctx, { kind: 'INCOME' });
    expect(
      remaining
        .map((t) => t.date)
        .sort()
        .at(-1)
    ).toBe('2027-02-05');

    vi.setSystemTime(new Date('2027-08-01T12:00:00Z'));
    fin.extendRecurrences(ctx);
    expect(fin.listTransactions(ctx, { kind: 'INCOME' })).toHaveLength(remaining.length);
  });

  it('a extensão diária cria os meses que faltam', () => {
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 50_00,
      date: '2026-10-18',
      accountId: checking.id,
      description: 'Streaming',
      recurrence: { rrule: 'FREQ=MONTHLY' },
    });
    expect(fin.listTransactions(ctx, {})).toHaveLength(13);
    vi.setSystemTime(new Date('2027-01-20T12:00:00Z'));
    expect(fin.extendRecurrences(ctx)).toBe(3);
    expect(fin.extendRecurrences(ctx)).toBe(0);
  });

  it('previsão avisa o primeiro dia negativo, contando a fatura', () => {
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 900_00,
      date: '2026-10-20',
      accountId: card.id,
      description: 'Passagem',
    });
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 300_00,
      date: '2026-10-28',
      accountId: checking.id,
      description: 'Aluguel',
    });
    const forecast = rep.forecast(ctx, 30);
    expect(forecast.start).toBe('2026-10-18');
    expect(forecast.days).toHaveLength(30);
    const day = (date: string) => forecast.days.find((d) => d.date === date)!;
    expect(day('2026-10-28').totalCents).toBe(700_00);
    expect(day('2026-11-05').byAccount[checking.id]).toBe(-200_00);
    expect(day('2026-11-05').byAccount[card.id]).toBe(0);
    expect(forecast.firstNegative).toEqual({
      date: '2026-11-05',
      accountId: checking.id,
      balanceCents: -200_00,
    });
  });

  it('orçamento com alerta, cópia do mês anterior e resumo do mês', () => {
    rep.upsertBudget(ctx, { categoryId: market, month: '2026-10', limitCents: 500_00 });
    for (const [amountCents, date] of [
      [420_00, '2026-10-12'],
      [60_00, '2026-10-29'],
    ] as const) {
      fin.createTransactions(ctx, {
        kind: 'EXPENSE',
        amountCents,
        date,
        accountId: checking.id,
        categoryId: market,
        description: 'Mercado',
      });
    }
    expect(rep.budgetStatuses(ctx, '2026-10')[0]).toMatchObject({
      spentCents: 420_00,
      plannedCents: 60_00,
      level: 'warn',
    });
    expect(rep.copyPreviousBudgets(ctx, '2026-11')).toHaveLength(1);
    expect(rep.monthSummary(ctx, '2026-10')).toMatchObject({
      expenseCents: 420_00,
      plannedExpenseCents: 60_00,
      expenseByCategory: [{ categoryId: market, totalCents: 420_00 }],
      previous: { month: '2026-09' },
    });
  });

  it('conta com lançamentos não é apagada, só arquivada', () => {
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 1_00,
      date: '2026-10-18',
      accountId: checking.id,
      description: 'Café',
    });
    expectStatus(() => fin.deleteAccount(ctx, checking.id), 409);
    fin.updateAccount(ctx, checking.id, { archived: true });
    expect(fin.listAccounts(ctx).some((a) => a.id === checking.id)).toBe(false);
    expect(fin.listAccounts(ctx, true).some((a) => a.id === checking.id)).toBe(true);
  });

  it('lançamento apagado continua no banco, mas sai do saldo e da lista', () => {
    const [tx] = fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 10_00,
      date: '2026-10-18',
      accountId: checking.id,
      description: 'Café',
    });
    fin.deleteTransaction(ctx, tx!.id);
    expect(account(checking.id).balanceCents).toBe(1000_00);
    expect(fin.listTransactions(ctx, {})).toHaveLength(0);
    const row = ctx.db.select().from(transactions).where(eq(transactions.id, tx!.id)).get();
    expect(row?.deletedAt).not.toBeNull();
  });
});
