import type { AccountResponse, InvoiceResponse } from '@sektor/contract';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DbHandle, openDatabase } from '../db/client';
import { accounts, categories, invoices, recurrences, transactions } from '../db/schema';
import { handlers } from '../modules/finance';

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
    expect(account(card.id).balanceCents).toBe(-250_00);

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

  const purchase = (over: Partial<Parameters<typeof fin.createTransactions>[1]> = {}) =>
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 100_00,
      date: '2026-10-20',
      accountId: card.id,
      description: 'Compra',
      ...over,
    });
  const chargeback = (amountCents: number, date = '2026-10-21') =>
    purchase({ kind: 'INCOME', amountCents, date, description: 'Estorno' });
  const invoiceOf = (month: string) =>
    fin.listInvoices(ctx, card.id).find((i) => i.referenceMonth === month)!;

  describe('lançamento de cartão é sempre efetivado', () => {
    it('com data futura, na recorrência e na extensão', () => {
      expect(purchase({ date: '2026-12-01' })[0]!.status).toBe('DONE');
      expect(purchase({ date: '2026-12-01', status: 'PLANNED' })[0]!.status).toBe('DONE');

      const created = purchase({ description: 'Streaming', recurrence: { rrule: 'FREQ=MONTHLY' } });
      expect(new Set(created.map((t) => t.status))).toEqual(new Set(['DONE']));

      vi.setSystemTime(new Date('2027-01-20T12:00:00Z'));
      expect(fin.extendRecurrences(ctx)).toBeGreaterThan(0);
      expect(fin.listTransactions(ctx, { status: 'PLANNED' })).toEqual([]);
    });

    it('editar não o devolve a previsto', () => {
      const [tx] = purchase();
      expect(fin.updateTransaction(ctx, tx!.id, { status: 'PLANNED' }).status).toBe('DONE');
    });

    it('a fatura cobra o mesmo que o saldo e o relatório do mês contam', () => {
      purchase({ date: '2026-11-10', description: 'Luz', recurrence: { rrule: 'FREQ=MONTHLY' } });
      expect(account(card.id).balanceCents).toBe(-13 * 100_00);
      expect(rep.monthSummary(ctx, '2026-11').expenseCents).toBe(100_00);
    });

    it('a migração 0100 efetiva os previstos que já existem no cartão', () => {
      const [onCard] = purchase();
      const [onChecking] = purchase({ accountId: checking.id, date: '2026-12-01' });
      handle.raw.prepare('UPDATE transactions SET status = ? WHERE id = ?').run('PLANNED', onCard!.id);
      handle.raw.exec(
        readFileSync(new URL('../db/migrations/0100_card_done.sql', import.meta.url), 'utf8')
      );
      const status = (id: string) =>
        ctx.db.select().from(transactions).where(eq(transactions.id, id)).get()!.status;
      expect(status(onCard!.id)).toBe('DONE');
      expect(status(onChecking!.id)).toBe('PLANNED');
    });
  });

  describe('recorrência no fim do mês', () => {
    it('salário no dia 31 cai todo mês', () => {
      const created = fin.createTransactions(ctx, {
        kind: 'INCOME',
        amountCents: 5000_00,
        date: '2026-10-31',
        accountId: checking.id,
        description: 'Salário',
        recurrence: { rrule: 'FREQ=MONTHLY' },
      });
      expect(created.map((t) => t.date.slice(0, 7))).toHaveLength(13);
      expect(created[4]!.date).toBe('2027-02-28');
    });
  });

  describe('compra em ciclo de fatura já paga', () => {
    it('vai para a próxima fatura em aberto, avisando', () => {
      purchase();
      fin.payInvoice(ctx, invoiceOf('2026-10').id);
      const [late] = purchase({ date: '2026-10-21', description: 'Atrasada' });
      expect(late!.rolledToInvoice).toEqual({ referenceMonth: '2026-11', dueDate: '2026-12-05' });
      expect(invoiceOf('2026-10').totalCents).toBe(100_00);
      expect(invoiceOf('2026-11').totalCents).toBe(100_00);
      expect(fin.listDueInvoices(ctx, {}).map((i) => i.referenceMonth)).toEqual(['2026-11']);
    });

    it('pula também a seguinte, se já estiver paga', () => {
      purchase();
      purchase({ date: '2026-11-20' });
      fin.payInvoice(ctx, invoiceOf('2026-10').id);
      fin.payInvoice(ctx, invoiceOf('2026-11').id);
      const [late] = purchase({ date: '2026-10-21' });
      expect(late!.rolledToInvoice?.referenceMonth).toBe('2026-12');
    });

    it('compra em ciclo aberto não avisa nada', () => {
      expect(purchase()[0]!.rolledToInvoice).toBeUndefined();
    });

    it('mudar a data para um ciclo pago também avisa', () => {
      purchase();
      const [other] = purchase({ date: '2026-11-20' });
      fin.payInvoice(ctx, invoiceOf('2026-10').id);
      const moved = fin.updateTransaction(ctx, other!.id, { date: '2026-10-22' });
      expect(moved.rolledToInvoice?.referenceMonth).toBe('2026-11');
    });

    it('editar a série não tira da fatura paga o que já estava lá', () => {
      const [first, second] = purchase({ recurrence: { rrule: 'FREQ=MONTHLY' } });
      fin.payInvoice(ctx, invoiceOf('2026-11').id);
      fin.updateTransaction(ctx, first!.id, { description: 'Nova', scope: 'future' });
      expect(fin.listTransactions(ctx, {}).find((t) => t.id === second!.id)!.invoiceId).toBe(
        invoiceOf('2026-11').id
      );
    });
  });

  describe('previsão com fatura sem conta pagadora', () => {
    let orphan: AccountResponse;
    beforeEach(() => {
      orphan = fin.createAccount(ctx, {
        name: 'Sem pagadora',
        type: 'CREDIT_CARD',
        initialBalanceCents: 0,
        closingDay: 25,
        dueDay: 5,
      });
    });

    it('usa a primeira conta ativa e devolve a fatura para o aviso', () => {
      purchase({ accountId: orphan.id, amountCents: 300_00 });
      const forecast = rep.forecast(ctx, 30);
      expect(forecast.days.find((d) => d.date === '2026-11-05')!.byAccount[checking.id]).toBe(
        700_00
      );
      expect(forecast.unassignedInvoices).toEqual([
        expect.objectContaining({
          accountId: orphan.id,
          cardName: 'Sem pagadora',
          dueDate: '2026-11-05',
          totalCents: 300_00,
          payerAccountId: checking.id,
        }),
      ]);
    });

    it('conta pagadora arquivada conta como sem pagadora', () => {
      const other = fin.createAccount(ctx, {
        name: 'Antiga',
        type: 'SAVINGS',
        initialBalanceCents: 0,
      });
      fin.updateAccount(ctx, orphan.id, { paymentAccountId: other.id });
      fin.updateAccount(ctx, other.id, { archived: true });
      purchase({ accountId: orphan.id });
      expect(rep.forecast(ctx, 30).unassignedInvoices).toHaveLength(1);
    });

    it('fatura de quem tem pagadora e fatura fora do período não entram no aviso', () => {
      purchase();
      purchase({ accountId: orphan.id, date: '2027-01-20' });
      expect(rep.forecast(ctx, 30).unassignedInvoices).toEqual([]);
    });
  });

  it('apagar a conta pagadora limpa o cartão', () => {
    const payer = fin.createAccount(ctx, { name: 'Pagadora', type: 'CHECKING', initialBalanceCents: 0 });
    fin.updateAccount(ctx, card.id, { paymentAccountId: payer.id });
    fin.deleteAccount(ctx, payer.id);
    expect(account(card.id).paymentAccountId).toBeNull();
  });

  describe('categoria apagada', () => {
    it('sai do modelo da recorrência', () => {
      const own = cat.createCategory(ctx, { name: 'Própria', kind: 'EXPENSE' });
      purchase({
        accountId: checking.id,
        categoryId: own.id,
        recurrence: { rrule: 'FREQ=MONTHLY' },
      });
      cat.deleteCategory(ctx, own.id);
      const [row] = ctx.db.select().from(recurrences).all();
      expect((row!.template as { categoryId: string | null }).categoryId).toBeNull();
    });

    it('a extensão não recria a categoria apagada de um modelo antigo', () => {
      const own = cat.createCategory(ctx, { name: 'Própria', kind: 'EXPENSE' });
      purchase({
        accountId: checking.id,
        categoryId: own.id,
        recurrence: { rrule: 'FREQ=MONTHLY' },
      });
      const [row] = ctx.db.select().from(recurrences).all();
      ctx.db
        .update(categories)
        .set({ deletedAt: Date.now() })
        .where(eq(categories.id, own.id))
        .run();
      expect((row!.template as { categoryId: string }).categoryId).toBe(own.id);
      vi.setSystemTime(new Date('2027-01-20T12:00:00Z'));
      fin.extendRecurrences(ctx);
      const generated = fin.listTransactions(ctx, { from: '2027-11-01' });
      expect(generated.length).toBeGreaterThan(0);
      expect(generated.every((t) => t.categoryId === null)).toBe(true);
    });
  });

  describe('parcelado com escopo', () => {
    const parcels = () =>
      fin
        .listTransactions(ctx, {})
        .filter((t) => t.installmentGroupId)
        .sort((a, b) => (a.installmentNumber ?? 0) - (b.installmentNumber ?? 0));
    const buy = () => purchase({ amountCents: 100_00, description: 'Fone', installments: 3 });

    it('apaga esta, esta e seguintes, ou todas', () => {
      const [, second] = buy();
      fin.deleteTransaction(ctx, second!.id, 'single');
      expect(parcels().map((t) => t.installmentNumber)).toEqual([1, 3]);
      ctx.db.update(transactions).set({ deletedAt: Date.now() }).run();

      const [, again] = buy();
      fin.deleteTransaction(ctx, again!.id, 'future');
      expect(parcels().map((t) => t.installmentNumber)).toEqual([1]);
      ctx.db.update(transactions).set({ deletedAt: Date.now() }).run();

      const [, third] = buy();
      fin.deleteTransaction(ctx, third!.id, 'all');
      expect(parcels()).toEqual([]);
    });

    it('edita esta e seguintes, ou todas, sem refazer os centavos das outras', () => {
      const [first, second] = purchase({
        amountCents: 100_00,
        description: 'Fone',
        installments: 3,
      });
      expect(parcels().map((t) => t.amountCents)).toEqual([33_34, 33_33, 33_33]);
      fin.updateTransaction(ctx, second!.id, { description: 'Fone novo', scope: 'future' });
      expect(parcels().map((t) => t.description)).toEqual(['Fone', 'Fone novo', 'Fone novo']);
      expect(parcels().map((t) => t.amountCents)).toEqual([33_34, 33_33, 33_33]);

      fin.updateTransaction(ctx, first!.id, { notes: 'Presente', scope: 'all' });
      expect(parcels().map((t) => t.notes)).toEqual(['Presente', 'Presente', 'Presente']);

      fin.updateTransaction(ctx, second!.id, { amountCents: 40_00, scope: 'single' });
      expect(parcels().map((t) => t.amountCents)).toEqual([33_34, 40_00, 33_33]);
    });

    it('a parcela de fatura paga não muda nem some', () => {
      const [first, second] = buy();
      fin.payInvoice(ctx, invoiceOf('2026-10').id);
      expect(
        fin.updateTransaction(ctx, second!.id, { amountCents: 50_00, scope: 'all' })
          .keptInPaidInvoices
      ).toBe(1);
      expect(parcels().map((t) => t.amountCents)).toEqual([33_34, 50_00, 50_00]);
      expect(fin.deleteTransaction(ctx, second!.id, 'all')).toEqual({ keptInPaidInvoices: 1 });
      expect(parcels().map((t) => t.id)).toEqual([first!.id]);
      expect(invoiceOf('2026-10').totalCents).toBe(33_34);
    });

    it('todas não vale para recorrência', () => {
      const [tx] = purchase({ recurrence: { rrule: 'FREQ=MONTHLY' } });
      expectStatus(() => fin.deleteTransaction(ctx, tx!.id, 'all'), 400);
      expectStatus(() => fin.updateTransaction(ctx, tx!.id, { notes: 'x', scope: 'all' }), 400);
    });

    it('a entrada do RPC aceita o escopo todas', () => {
      const [first] = buy();
      handlers(ctx as never)['transactions.update']({ id: first!.id, notes: 'y', scope: 'all' });
      expect(parcels().every((t) => t.notes === 'y')).toBe(true);
    });
  });

  describe('total não pago dos cartões', () => {
    it('soma fechada, vencida e a atual, sem as futuras', () => {
      vi.setSystemTime(new Date('2026-09-10T15:00:00Z'));
      purchase({ date: '2026-08-10', amountCents: 10_00 }); // venceu em 05/09
      purchase({ date: '2026-08-28', amountCents: 20_00 }); // fecha em 25/09: aberta atual
      purchase({ date: '2026-10-10', amountCents: 40_00 }); // futura
      expect(account(card.id)).toMatchObject({
        openInvoiceCents: 20_00,
        unpaidInvoiceCents: 30_00,
        overdueInvoiceCents: 10_00,
      });
      vi.setSystemTime(new Date('2026-09-28T15:00:00Z'));
      expect(account(card.id)).toMatchObject({
        unpaidInvoiceCents: 70_00,
        overdueInvoiceCents: 10_00,
      });
    });

    it('fatura paga sai do total; conta sem cartão fica nula', () => {
      purchase();
      expect(account(card.id).unpaidInvoiceCents).toBe(100_00);
      fin.payInvoice(ctx, invoiceOf('2026-10').id);
      expect(account(card.id).unpaidInvoiceCents).toBe(0);
      expect(account(checking.id).unpaidInvoiceCents).toBeNull();
    });
  });

  describe('transferência para cartão', () => {
    const transfer = () =>
      fin.createTransactions(ctx, {
        kind: 'TRANSFER',
        amountCents: 100_00,
        date: '2026-10-18',
        accountId: checking.id,
        toAccountId: card.id,
        description: 'Pagamento',
      });

    it('é recusada, apontando para pagar a fatura', () => {
      expect(transfer).toThrow(expect.objectContaining({ status: 400, message: expect.stringContaining('Pagar fatura') }));
    });

    it('mudar o destino para um cartão também é recusado', () => {
      const savings = fin.createAccount(ctx, { name: 'R', type: 'SAVINGS', initialBalanceCents: 0 });
      const [tx] = fin.createTransactions(ctx, {
        kind: 'TRANSFER',
        amountCents: 100_00,
        date: '2026-10-18',
        accountId: checking.id,
        toAccountId: savings.id,
        description: 'Guardar',
      });
      expectStatus(() => fin.updateTransaction(ctx, tx!.id, { toAccountId: card.id }), 400);
    });

    it('o pagamento feito por payInvoice segue editável', () => {
      purchase();
      const paid = fin.payInvoice(ctx, invoiceOf('2026-10').id);
      expect(
        fin.updateTransaction(ctx, paid.paymentTransactionId!, { date: '2026-10-19' }).date
      ).toBe('2026-10-19');
    });

    it('transferência antiga para cartão segue editável', () => {
      const [row] = ctx.db
        .insert(transactions)
        .values({
          id: '00000000-0000-7000-8000-000000000001',
          createdAt: 1,
          updatedAt: 1,
          kind: 'TRANSFER',
          amountCents: 1_00,
          date: '2026-10-01',
          accountId: checking.id,
          toAccountId: card.id,
          description: 'Antiga',
          status: 'DONE',
        })
        .returning()
        .all();
      expect(fin.updateTransaction(ctx, row!.id, { notes: 'ok' }).notes).toBe('ok');
    });
  });

  describe('crédito de estorno', () => {
    it('fatura negativa leva o crédito para a seguinte', () => {
      purchase({ amountCents: 20_00 });
      chargeback(50_00);
      purchase({ date: '2026-11-10', amountCents: 100_00 });

      expect(invoiceOf('2026-10')).toMatchObject({ totalCents: 0, creditCarriedCents: 30_00 });
      expect(invoiceOf('2026-11')).toMatchObject({
        totalCents: 70_00,
        ownCents: 100_00,
        creditAppliedCents: 30_00,
      });

      const paid = fin.payInvoice(ctx, invoiceOf('2026-11').id);
      expect(paid.totalCents).toBe(70_00);
      expect(account(checking.id).balanceCents).toBe(930_00);
      expect(account(card.id).balanceCents).toBe(0);
    });

    it('a compra futura consome o crédito uma vez só', () => {
      chargeback(30_00);
      purchase({ date: '2026-11-10', amountCents: 100_00 });
      purchase({ date: '2026-12-10', amountCents: 100_00 });
      fin.payInvoice(ctx, invoiceOf('2026-11').id);
      expect(invoiceOf('2026-11').totalCents).toBe(70_00);
      expect(invoiceOf('2026-12').totalCents).toBe(100_00);
    });

    it('não altera fatura paga: o crédito pula para a próxima em aberto', () => {
      purchase({ date: '2026-11-10', amountCents: 100_00 });
      fin.payInvoice(ctx, invoiceOf('2026-11').id);
      chargeback(30_00, '2026-10-21');
      purchase({ date: '2026-12-10', amountCents: 100_00 });
      expect(invoiceOf('2026-11')).toMatchObject({ totalCents: 100_00, status: 'PAID' });
      expect(invoiceOf('2026-12').totalCents).toBe(70_00);
    });

    it('estorno depois de pagar entra na próxima fatura', () => {
      purchase({ amountCents: 100_00 });
      fin.payInvoice(ctx, invoiceOf('2026-10').id);
      const [back] = chargeback(30_00);
      expect(back!.rolledToInvoice?.referenceMonth).toBe('2026-11');
      expect(invoiceOf('2026-10').totalCents).toBe(100_00);
      expect(invoiceOf('2026-11')).toMatchObject({ totalCents: 0, creditCarriedCents: 30_00 });
    });

    it('a previsão e os totais do cartão contam o valor com o crédito', () => {
      chargeback(30_00);
      purchase({ date: '2026-11-10', amountCents: 100_00 });
      expect(rep.forecast(ctx, 90).days.at(-1)!.byAccount[checking.id]).toBe(930_00);
      expect(fin.listDueInvoices(ctx, {}).map((i) => i.totalCents)).toEqual([70_00]);
    });
  });

  describe('entrada do RPC', () => {
    const rpc = () => handlers(ctx as never);

    it('invoices.pay valida o corpo', () => {
      purchase();
      const id = invoiceOf('2026-10').id;
      expectStatus(() => rpc()['invoices.pay']({ id, date: 'ontem' }), 400);
      expectStatus(() => rpc()['invoices.pay']({ id: 'x' }), 400);
      expectStatus(() => rpc()['invoices.pay'](undefined as never), 400);
      expect(rpc()['invoices.pay']({ id }).status).toBe('PAID');
    });

    it('entrada ausente é 400, em português', () => {
      expect(() => rpc()['transactions.list'](undefined as never)).toThrow(
        expect.objectContaining({ status: 400, message: 'Dados inválidos.' })
      );
      expectStatus(() => rpc()['reports.month'](undefined as never), 400);
      expectStatus(() => rpc()['reports.month']({ month: 'x' }), 400);
      expect(rpc()['transactions.list']({})).toEqual([]);
    });
  });

  it('mensagens de não encontrado têm o gênero certo', () => {
    expect(() => fin.ownedAccount(ctx, 'x')).toThrow('Conta não encontrada.');
    expect(() => fin.deleteTransaction(ctx, 'x')).toThrow('Lançamento não encontrado.');
  });
});
