import type { AccountResponse, BankStatusResponse } from '@sektor/contract';
import { and, eq, isNotNull, isNull, like } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DbHandle, openDatabase } from '../db/client';
import { accounts, bankMovements, categories, invoices, transactions } from '../db/schema';
import { ensureCategories } from '../services/categories';
import { stamp } from '../services/context';
import * as fin from '../services/finance';
import * as plus from '../modules/financePlus/service';

import { type PluggyKeys, forgetPluggyKey } from './client';
import { FakePluggy } from './fake-pluggy';
import * as bank from './index';

// 18/10/2026, meio-dia em São Paulo.
const NOW = new Date('2026-10-18T15:00:00Z');
const CHECKING_ID = '22222222-2222-4222-8222-222222222222';
const CARD_ID = '33333333-3333-4333-8333-333333333333';
const KEYS = { clientId: 'pluggy-client', clientSecret: 'pluggy-secret' };

describe('bancos (Meu Pluggy)', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: bank.BankCtx;
  let pluggy: FakePluggy;
  let checking: AccountResponse;
  let groceries: string;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-bank-'));
    handle = openDatabase(join(dir, 'b.db'), 'c'.repeat(64));
    let stored: PluggyKeys | null = null;
    ctx = {
      db: handle.orm,
      timeZone: 'America/Sao_Paulo',
      keys: { get: () => stored, set: (keys) => (stored = keys) },
    };
    ensureCategories(ctx);
    forgetPluggyKey();
    pluggy = new FakePluggy().install();
    checking = fin.createAccount(ctx, {
      name: 'Minha conta',
      type: 'CHECKING',
      initialBalanceCents: 0,
    });
    groceries = ctx.db.select().from(categories).where(eq(categories.name, 'Mercado')).get()!.id;
  });

  afterEach(() => {
    pluggy.uninstall();
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const pending = () => bank.listMovements(ctx);
  const movement = (externalId: string) =>
    ctx.db.select().from(bankMovements).where(eq(bankMovements.externalId, externalId)).get()!;
  const tx = (id: string) =>
    ctx.db.select().from(transactions).where(eq(transactions.id, id)).get()!;
  const live = () => ctx.db.select().from(transactions).where(isNull(transactions.deletedAt)).all();
  const expectStatus = async (run: () => unknown, status: number) =>
    expect(await Promise.resolve().then(run).catch((error) => error.status)).toBe(status);

  async function connect() {
    await bank.saveCredentials(ctx, KEYS);
    const body = await bank.addItem(ctx, pluggy.itemId);
    const id = (name: string) => body.items[0]!.accounts.find((a) => a.name === name)!.id;
    return { checkingBank: id('Conta Corrente'), cardBank: id('Cartão Platinum') };
  }

  it('as regras de categoria valem na revisão do banco, depois do histórico', async () => {
    const { checkingBank } = await connect();
    const transport = ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.kind, 'EXPENSE'), eq(categories.name, 'Transporte')))
      .get()!.id;
    plus.createRule(ctx, { pattern: 'uber', categoryId: transport });
    plus.createRule(ctx, { pattern: 'padaria', categoryId: transport });
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 12_00,
      date: '2026-09-20',
      accountId: checking.id,
      categoryId: groceries,
      description: 'Padaria Pão Quente',
    });
    pluggy.add(CHECKING_ID, { id: 'h1', description: 'PADARIA PAO QUENTE', amount: -9 });
    pluggy.add(CHECKING_ID, { id: 'u1', description: 'UBER *TRIP', amount: -35 });
    await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    const by = Object.fromEntries(pending().map((m) => [m.description, m]));
    expect(by['UBER *TRIP']).toMatchObject({
      suggestedCategoryId: transport,
      suggestionSource: 'RULE',
    });
    expect(by['PADARIA PAO QUENTE']).toMatchObject({
      suggestedCategoryId: groceries,
      suggestionSource: 'HISTORY',
    });
  });

  it('o aviso de privacidade fica lido', () => {
    expect(bank.bankStatus(ctx).noticeAcceptedAt).toBeNull();
    expect(bank.acceptNotice(ctx).noticeAcceptedAt).not.toBeNull();
  });

  it('recusa chaves erradas e não grava nada no banco de dados', async () => {
    await expect(bank.saveCredentials(ctx, { clientId: 'x', clientSecret: 'y' })).rejects.toThrow(
      'não aceitou'
    );
    await bank.saveCredentials(ctx, KEYS);
    expect(bank.bankStatus(ctx)).toMatchObject({
      configured: true,
      clientId: 'pluggy-client',
      items: [],
    });
    expect(JSON.stringify(handle.raw.prepare('SELECT * FROM app_meta').all())).not.toContain(
      'pluggy-secret'
    );
  });

  it('adiciona o banco com contas e saldo, e recusa item de fora', async () => {
    await bank.saveCredentials(ctx, KEYS);
    await expectStatus(
      () => bank.addItem(ctx, '99999999-9999-4999-8999-999999999999'),
      404
    );
    await connect();
    const [item] = bank.bankStatus(ctx).items;
    expect(item).toMatchObject({ name: 'Banco Teste', status: 'UPDATED', lastError: null });
    expect(item!.accounts.map((a) => [a.name, a.type, a.balanceCents, a.accountId])).toEqual([
      ['Conta Corrente', 'BANK', 1500_00, null],
      ['Cartão Platinum', 'CREDIT', 320_40, null],
    ]);
    expect(await bank.connectToken(ctx)).toEqual({ accessToken: 'connect-1', connectorIds: [200] });
  });

  it('ligar a conta casa o lançado, confirma o previsto e põe o resto em revisão', async () => {
    const { checkingBank } = await connect();
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 89_90,
      date: '2026-10-12',
      accountId: checking.id,
      categoryId: groceries,
      description: 'Supermercado Bom Preço',
    });
    const [planned] = fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 120_00,
      date: '2026-10-16',
      accountId: checking.id,
      description: 'Internet',
      status: 'PLANNED',
    });
    const add = (id: string, description: string, amount: number, date: string, extra = {}) =>
      pluggy.add(CHECKING_ID, {
        id,
        description,
        amount,
        date: `${date}T03:00:00.000Z`,
        ...extra,
      });
    add('b1', 'SUPERMERCADO BOM PRECO', -89.9, '2026-10-10');
    add('b2', 'Internet Fibra', -120, '2026-10-15');
    add('b3', 'Supermercado Bom Preço', -45, '2026-10-14');
    add('b4', 'Salário', 5000, '2026-10-05', { type: 'CREDIT' });
    // Antes do "importar desde" e agendado: ficam de fora.
    add('b5', 'Antigo', -1, '2026-08-01');
    add('b6', 'Agendado', -1, '2026-10-25', { status: 'PENDING' });

    const linked = await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    expect(linked.items[0]!.accounts[0]).toMatchObject({
      accountId: checking.id,
      importFrom: '2026-09-18',
    });
    const rows = ctx.db.select().from(bankMovements).orderBy(bankMovements.externalId).all();
    expect(rows.map((m) => [m.externalId, m.status])).toEqual([
      ['b1', 'MATCHED'],
      ['b2', 'MATCHED'],
      ['b3', 'PENDING'],
      ['b4', 'PENDING'],
    ]);
    expect(tx(planned!.id).status).toBe('DONE');

    const review = pending();
    expect(
      review.map((m) => [m.description, m.kind, m.amountCents, m.suggestedCategoryId])
    ).toEqual([
      ['Supermercado Bom Preço', 'EXPENSE', 45_00, groceries],
      ['Salário', 'INCOME', 5000_00, null],
    ]);
    expect(bank.bankStatus(ctx).pendingCount).toBe(2);

    await bank.syncBanks(ctx);
    expect(ctx.db.select().from(bankMovements).all()).toHaveLength(4);

    const accepted = bank.acceptMovement(ctx, review[0]!.id);
    expect(accepted.status).toBe('IMPORTED');
    expect(tx(accepted.transactionId!)).toMatchObject({
      amountCents: 45_00,
      categoryId: groceries,
      status: 'DONE',
    });
    bank.ignoreMovement(ctx, review[1]!.id);
    expect(pending()).toEqual([]);
    await expectStatus(() => bank.acceptMovement(ctx, review[0]!.id), 404);
  });

  it('a categoria de um lançado vale para os parecidos que esperam revisão', async () => {
    const { checkingBank } = await connect();
    const income = ctx.db.select().from(categories).where(eq(categories.kind, 'INCOME')).get()!.id;
    for (const [id, day] of [
      ['r1', '06'],
      ['r2', '13'],
    ]) {
      pluggy.add(CHECKING_ID, {
        id: id!,
        description: 'RENDIMENTO DA CONTA',
        amount: 1.23,
        type: 'CREDIT',
        date: `2026-10-${day}T03:00:00.000Z`,
      });
    }
    await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    const [first, second] = pending();
    expect([first!.suggestedCategoryId, second!.suggestedCategoryId]).toEqual([null, null]);

    bank.acceptMovement(ctx, first!.id, { categoryId: income, description: 'Rendimento' });
    expect(pending().map((m) => [m.id, m.suggestedCategoryId])).toEqual([[second!.id, income]]);
    bank.acceptAll(ctx);
    expect(live().map((t) => t.categoryId)).toEqual([income, income]);
  });

  it('recusar todos tira da revisão sem lançar, nem na sincronização seguinte', async () => {
    const { checkingBank } = await connect();
    pluggy.add(CHECKING_ID, { id: 'x1', description: 'Padaria', amount: -12 });
    pluggy.add(CHECKING_ID, { id: 'x2', description: 'Padaria', amount: -12 });
    await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    expect(pending()).toHaveLength(2);
    expect(bank.ignoreAll(ctx)).toEqual({ ignored: 2 });
    await bank.syncBanks(ctx);
    expect(pending()).toEqual([]);
    expect(live()).toHaveLength(0);
  });

  it('Pix entra com o nome de quem recebeu e o texto do banco fica nas notas', async () => {
    const { checkingBank } = await connect();
    const raw = 'Transferência enviada pelo Pix|MARIA EXEMPLO|•••.123.456-••|NU PAGAMENTOS - IP';
    pluggy.add(CHECKING_ID, {
      id: 'p1',
      description: raw,
      amount: -50,
      date: '2026-10-05T03:00:00.000Z',
    });
    await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    const [first] = pending();
    expect(first).toMatchObject({ description: 'Maria Exemplo', bankDescription: raw });
    const accepted = bank.acceptMovement(ctx, first!.id);
    expect(tx(accepted.transactionId!)).toMatchObject({
      description: 'Maria Exemplo',
      notes: raw,
    });

    pluggy.add(CHECKING_ID, {
      id: 'p2',
      description: raw,
      amount: -30,
      date: '2026-10-06T03:00:00.000Z',
    });
    await bank.syncBanks(ctx);
    const [second] = pending();
    const edited = bank.acceptMovement(ctx, second!.id, { notes: 'Faxina' });
    expect(tx(edited.transactionId!).notes).toBe('Faxina');
  });

  it('sem histórico vale a regra fixa, e o histórico vence', async () => {
    const { checkingBank } = await connect();
    const pix = ctx.db
      .select()
      .from(categories)
      .where(and(eq(categories.kind, 'EXPENSE'), eq(categories.systemKey, 'TRANSFER_PIX')))
      .get()!.id;
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 12_00,
      date: '2026-09-20',
      accountId: checking.id,
      categoryId: groceries,
      description: 'Padaria Pão Quente',
    });
    pluggy.add(CHECKING_ID, {
      id: 'p1',
      description: 'Transferência enviada pelo Pix|MARIA EXEMPLO|•••.123.456-••|NU',
      amount: -50,
    });
    pluggy.add(CHECKING_ID, { id: 'h1', description: 'PADARIA PAO QUENTE', amount: -9 });
    pluggy.add(CHECKING_ID, { id: 'u1', description: 'UBER *TRIP', amount: -35 });
    await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    const by = Object.fromEntries(pending().map((m) => [m.description, m]));
    expect(by['Maria Exemplo']).toMatchObject({
      suggestedCategoryId: pix,
      suggestionSource: 'RULE',
    });
    expect(by['PADARIA PAO QUENTE']).toMatchObject({
      suggestedCategoryId: groceries,
      suggestionSource: 'HISTORY',
    });
    expect(by['UBER *TRIP']).toMatchObject({ suggestedCategoryId: null, suggestionSource: null });
  });

  it('cartão novo: fechamento e vencimento do banco, ignora o pagamento, lança na fatura', async () => {
    const { checkingBank, cardBank } = await connect();
    await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    pluggy.add(CARD_ID, {
      id: 'c1',
      description: 'Livraria',
      amount: 80,
      date: '2026-10-11T03:00:00.000Z',
    });
    pluggy.add(CARD_ID, {
      id: 'c2',
      description: 'Pagamento recebido',
      amount: -500,
      type: 'CREDIT',
      date: '2026-10-06T03:00:00.000Z',
    });
    const furnitureMeta = (installmentNumber: number) => ({
      installmentNumber,
      totalInstallments: 10,
      purchaseDate: '2026-08-15T03:00:00.000Z',
    });
    pluggy.add(CARD_ID, {
      id: 'c3',
      description: 'Loja de Móveis',
      amount: 300,
      date: '2026-08-15T03:00:00.000Z',
      status: 'PENDING',
      creditCardMetadata: furnitureMeta(3),
    });

    const linked = await bank.linkAccount(ctx, cardBank, { create: true });
    const cardId = linked.items[0]!.accounts[1]!.accountId!;
    expect(ctx.db.select().from(accounts).where(eq(accounts.id, cardId)).get()).toMatchObject({
      name: 'Cartão Platinum',
      type: 'CREDIT_CARD',
      closingDay: 25,
      dueDay: 5,
      paymentAccountId: checking.id,
    });
    expect(pending().map((m) => [m.description, m.date, m.installmentNumber])).toEqual([
      ['Loja de Móveis', '2026-10-15', 3],
      ['Livraria', '2026-10-11', null],
    ]);
    expect(movement('c2').status).toBe('IGNORED');

    expect(bank.acceptAll(ctx)).toEqual({ imported: 2 });
    expect(
      fin
        .listInvoices(ctx, cardId)
        .map((i) => [i.referenceMonth, i.totalCents])
        .sort()
    ).toEqual([
      ['2026-10', 380_00],
      ['2026-11', 300_00],
      ['2026-12', 300_00],
      ['2027-01', 300_00],
      ['2027-02', 300_00],
      ['2027-03', 300_00],
      ['2027-04', 300_00],
      ['2027-05', 300_00],
    ]);
    const furniture = live()
      .filter((t) => t.amountCents === 300_00)
      .sort((a, b) => a.installmentNumber! - b.installmentNumber!);
    expect(furniture.map((t) => t.description)).toEqual(
      [3, 4, 5, 6, 7, 8, 9, 10].map((n) => `Loja de Móveis (${n}/10)`)
    );
    expect(new Set(furniture.map((t) => t.installmentGroupId)).size).toBe(1);

    pluggy.add(CARD_ID, {
      id: 'c4',
      description: 'Loja de Móveis',
      amount: 300,
      date: '2026-08-15T03:00:00.000Z',
      status: 'PENDING',
      creditCardMetadata: furnitureMeta(4),
    });
    await bank.syncBanks(ctx);
    expect(movement('c4')).toMatchObject({ status: 'MATCHED', transactionId: furniture[1]!.id });
    expect(live().filter((t) => t.amountCents === 300_00)).toHaveLength(8);
  });

  describe('faturas do banco', () => {
    // O banco fecha no dia 28 (o cartão diz 25): a Farmácia do dia 27 é da fatura de setembro,
    // paga no dia 7. A última parcela (3/3) vem datada pela fatura, longe da compra.
    const SEPTEMBER_BILL = {
      id: 'bill-set',
      dueDate: '2026-10-08T03:00:00.000Z',
      billClosingDate: '2026-09-28T03:00:00.000Z',
      totalAmount: 200,
      payments: [{ paymentDate: '2026-10-07T03:00:00.000Z', amount: 200 }],
    };

    function addDebit() {
      pluggy.add(CHECKING_ID, {
        id: 'p1',
        description: 'Pagamento de fatura',
        amount: -200,
        date: '2026-10-07T03:00:00.000Z',
      });
    }

    function addMovements(withBill: boolean, withDebit = true) {
      pluggy.add(CARD_ID, {
        id: 'k1',
        description: 'Farmácia',
        amount: 200,
        date: '2026-09-27T03:00:00.000Z',
        creditCardMetadata: withBill ? { billId: 'bill-set' } : null,
      });
      pluggy.add(CARD_ID, {
        id: 'k2',
        description: 'Loja',
        amount: 60,
        date: '2026-11-04T03:00:00.000Z',
        status: 'PENDING',
        creditCardMetadata: {
          installmentNumber: 3,
          totalInstallments: 3,
          purchaseDate: '2026-08-04T03:00:00.000Z',
        },
      });
      if (withDebit) addDebit();
    }

    const payments = () => live().filter((t) => t.paysInvoiceId !== null);

    async function linkBoth() {
      const { checkingBank, cardBank } = await connect();
      await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
      const linked = await bank.linkAccount(ctx, cardBank, { create: true });
      return linked.items[0]!.accounts[1]!.accountId!;
    }

    const invoicesOf = (cardId: string) =>
      fin
        .listInvoices(ctx, cardId)
        .map((i) => [i.referenceMonth, i.totalCents, i.status, i.closingDate, i.dueDate])
        .sort();

    function expectRepaired(cardId: string) {
      expect(invoicesOf(cardId)).toEqual([
        ['2026-09', 200_00, 'PAID', '2026-09-28', '2026-10-08'],
        ['2026-10', 60_00, 'OPEN', '2026-10-25', '2026-11-05'],
      ]);
      const payment = tx(movement('p1').transactionId!);
      expect(payment).toMatchObject({
        kind: 'TRANSFER',
        amountCents: 200_00,
        accountId: checking.id,
        toAccountId: cardId,
        categoryId: null,
      });
      expect(payment.paysInvoiceId).not.toBeNull();
    }

    it('põe cada lançamento na fatura do banco e o débito paga a fatura', async () => {
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      addMovements(true);
      const cardId = await linkBoth();
      expect(bank.acceptAll(ctx)).toEqual({ imported: 3 });
      expectRepaired(cardId);
    });

    it('conserta o que já foi lançado quando a fatura do banco chega', async () => {
      addMovements(false);
      const cardId = await linkBoth();
      bank.acceptAll(ctx);
      expect(invoicesOf(cardId).map((i) => [i[0], i[1], i[2]])).toEqual([
        ['2026-10', 260_00, 'OPEN'],
      ]);
      pluggy.transactions.get(CARD_ID)![0]!.creditCardMetadata = { billId: 'bill-set' };
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      await bank.syncBanks(ctx);
      expectRepaired(cardId);
    });

    it('paga por uma conta de fora: fica paga sem tirar da conta ligada', async () => {
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      addMovements(true, false);
      const cardId = await linkBoth();
      bank.acceptAll(ctx);
      await bank.syncBanks(ctx);
      expect(invoicesOf(cardId)[0]!.slice(0, 3)).toEqual(['2026-09', 200_00, 'PAID']);
      expect(payments()).toEqual([]);
      expect(fin.listAccounts(ctx).find((a) => a.id === cardId)!.balanceCents).toBe(-60_00);

      addDebit();
      await bank.syncBanks(ctx);
      expectRepaired(cardId);
    });

    it('fechamento pelo banco, parcela na fatura da sua data e sem repetida', async () => {
      pluggy.bills.set(CARD_ID, [
        {
          id: 'bill-out',
          dueDate: '2026-10-19T03:00:00.000Z',
          billClosingDate: '2026-10-09T03:00:00.000Z',
          totalAmount: 0,
          payments: [],
        },
      ]);
      for (const [n, date] of [
        [1, '2026-10-14'],
        [2, '2026-11-14'],
      ] as const) {
        pluggy.add(CARD_ID, {
          id: `jim-${n}`,
          description: `Jim.Com* 54920013 Day ${n}/2`,
          amount: 499,
          date: `${date}T03:00:00.000Z`,
          status: 'PENDING',
          creditCardMetadata: { installmentNumber: n, totalInstallments: 2 },
        });
      }
      const { cardBank } = await connect();
      const linked = await bank.linkAccount(ctx, cardBank, { create: true });
      const cardId = linked.items[0]!.accounts[1]!.accountId!;
      expect(ctx.db.select().from(accounts).where(eq(accounts.id, cardId)).get()).toMatchObject({
        closingDay: 9,
        dueDay: 19,
      });
      bank.acceptAll(ctx);
      expect(invoicesOf(cardId).map((i) => [i[0], i[1], i[3], i[4]])).toEqual([
        ['2026-11', 499_00, '2026-11-09', '2026-11-19'],
        ['2026-12', 499_00, '2026-12-09', '2026-12-19'],
      ]);

      // Uma versão anterior lançou a 2/2 a partir da 1/2, além da que o banco mandou: ela sai.
      const first = ctx.db
        .select()
        .from(transactions)
        .where(and(eq(transactions.accountId, cardId), like(transactions.description, '%1/2%')))
        .get()!;
      ctx.db
        .update(transactions)
        .set({ installmentGroupId: 'grupo', installmentNumber: 1, installmentTotal: 2 })
        .where(eq(transactions.id, first.id))
        .run();
      ctx.db
        .insert(transactions)
        .values({
          ...stamp(),
          kind: 'EXPENSE',
          amountCents: 499_00,
          date: '2026-11-14',
          accountId: cardId,
          description: 'Jim.Com* 54920013 Day 1/2 (2/2)',
          installmentGroupId: 'grupo',
          installmentNumber: 2,
          installmentTotal: 2,
          invoiceId: first.invoiceId,
        })
        .run();
      await bank.syncBanks(ctx);
      expect(live().filter((t) => t.accountId === cardId)).toHaveLength(2);
      expect(invoicesOf(cardId).map((i) => [i[0], i[1]])).toEqual([
        ['2026-11', 499_00],
        ['2026-12', 499_00],
      ]);
    });

    it('parcela datada pela compra mais N-1 meses (Nubank) fica na fatura do seu mês', async () => {
      pluggy.bills.set(CARD_ID, [
        {
          id: 'bill-out',
          dueDate: '2026-10-19T03:00:00.000Z',
          billClosingDate: '2026-10-12T03:00:00.000Z',
          totalAmount: 0,
          payments: [],
        },
      ]);
      for (const [n, date] of [
        [1, '2026-10-13'],
        [2, '2026-11-14'],
      ] as const) {
        pluggy.add(CARD_ID, {
          id: `host-${n}`,
          description: `Hostgator ${n}/5`,
          amount: 30,
          date: `${date}T03:00:00.000Z`,
          status: 'PENDING',
          creditCardMetadata: {
            installmentNumber: n,
            totalInstallments: 5,
            purchaseDate: '2026-10-13T03:00:00.000Z',
          },
        });
      }
      const { cardBank } = await connect();
      const linked = await bank.linkAccount(ctx, cardBank, { create: true });
      const cardId = linked.items[0]!.accounts[1]!.accountId!;
      bank.acceptAll(ctx);
      const expected = [
        ['2026-11', 30_00, '2026-11-12', '2026-11-19'],
        ['2026-12', 30_00, '2026-12-12', '2026-12-19'],
        ['2027-01', 30_00, '2027-01-12', '2027-01-19'],
        ['2027-02', 30_00, '2027-02-12', '2027-02-19'],
        ['2027-03', 30_00, '2027-03-12', '2027-03-19'],
      ];
      expect(invoicesOf(cardId).map((i) => [i[0], i[1], i[3], i[4]])).toEqual(expected);

      // Uma versão anterior pôs a 2/5 em novembro: a sincronização a devolve para dezembro.
      const second = movement('host-2');
      const november = ctx.db
        .select()
        .from(invoices)
        .where(and(eq(invoices.accountId, cardId), eq(invoices.referenceMonth, '2026-11')))
        .get()!;
      ctx.db
        .update(bankMovements)
        .set({ billDueDate: '2026-11-19', billClosingDate: null })
        .where(eq(bankMovements.id, second.id))
        .run();
      ctx.db
        .update(transactions)
        .set({ invoiceId: november.id })
        .where(eq(transactions.id, second.transactionId!))
        .run();
      await bank.syncBanks(ctx);
      expect(invoicesOf(cardId).map((i) => [i[0], i[1], i[3], i[4]])).toEqual(expected);
    });

    it('mudar o fechamento do cartão refaz as faturas em aberto', () => {
      const card = fin.createAccount(ctx, {
        name: 'Cartão',
        type: 'CREDIT_CARD',
        initialBalanceCents: 0,
        closingDay: 1,
        dueDay: 19,
      });
      for (const date of ['2026-10-05', '2026-11-05']) {
        fin.createTransactions(ctx, {
          kind: 'EXPENSE',
          amountCents: 100_00,
          date,
          accountId: card.id,
          description: 'Compra',
        });
      }
      expect(invoicesOf(card.id).map((i) => [i[0], i[1], i[3]])).toEqual([
        ['2026-11', 100_00, '2026-11-01'],
        ['2026-12', 100_00, '2026-12-01'],
      ]);
      fin.updateAccount(ctx, card.id, { closingDay: 9 });
      expect(invoicesOf(card.id).map((i) => [i[0], i[1], i[3], i[4]])).toEqual([
        ['2026-10', 100_00, '2026-10-09', '2026-10-19'],
        ['2026-11', 100_00, '2026-11-09', '2026-11-19'],
      ]);
    });

    it('o débito lançado à mão vira o pagamento da fatura que o banco deu como paga', async () => {
      const [manual] = fin.createTransactions(ctx, {
        kind: 'EXPENSE',
        amountCents: 200_00,
        date: '2026-10-07',
        accountId: checking.id,
        description: 'Fatura do cartão',
      });
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      addMovements(true, false);
      pluggy.add(CHECKING_ID, {
        id: 'p1',
        description: 'Pix enviado',
        amount: -200,
        date: '2026-10-07T03:00:00.000Z',
      });
      const cardId = await linkBoth();
      expect(movement('p1').status).toBe('MATCHED');
      bank.acceptAll(ctx);
      await bank.syncBanks(ctx);
      expect(invoicesOf(cardId)[0]!.slice(0, 3)).toEqual(['2026-09', 200_00, 'PAID']);
      expect(tx(manual!.id)).toMatchObject({ kind: 'TRANSFER', toAccountId: cardId });
    });

    it('tira o pagamento que saiu de uma conta ligada sem o débito no banco', async () => {
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      addMovements(true, false);
      const cardId = await linkBoth();
      bank.acceptAll(ctx);
      const september = fin.listInvoices(ctx, cardId).find((i) => i.referenceMonth === '2026-09')!;
      fin.payInvoice(ctx, september.id, { fromAccountId: checking.id, date: '2026-10-07' });
      expect(payments()).toHaveLength(1);

      await bank.syncBanks(ctx);
      expect(payments()).toEqual([]);
      expect(invoicesOf(cardId)[0]!.slice(0, 3)).toEqual(['2026-09', 200_00, 'PAID']);
    });

    it('sem o pagamento na fatura do banco, o boleto do mesmo valor paga a fatura', async () => {
      pluggy.bills.set(CARD_ID, [{ ...SEPTEMBER_BILL, payments: [] }]);
      addMovements(true, false);
      pluggy.add(CHECKING_ID, {
        id: 'p1',
        description: 'Pagamento de boleto efetuado BANCO TESTE',
        amount: -200,
        date: '2026-10-07T03:00:00.000Z',
      });
      const cardId = await linkBoth();
      bank.acceptAll(ctx);
      expect(invoicesOf(cardId)[0]!.slice(0, 3)).toEqual(['2026-09', 200_00, 'OVERDUE']);
      await bank.syncBanks(ctx);
      expectRepaired(cardId);
    });

    it('confere o cartão com o banco: limite usado e cada fatura fechada', async () => {
      pluggy.bills.set(CARD_ID, [SEPTEMBER_BILL]);
      addMovements(true);
      const cardId = await linkBoth();
      bank.acceptAll(ctx);
      const check = await bank.cardCheck(ctx, cardId);
      expect(check).toMatchObject({
        usedCents: 320_40,
        openCents: 60_00,
        movements: { total: 2, withBill: 2 },
      });
      expect(check.bills).toEqual([
        {
          dueDate: '2026-10-08',
          closingDate: '2026-09-28',
          bankTotalCents: 200_00,
          bankPaidCents: 200_00,
          bankPaidOn: '2026-10-07',
          invoice: expect.objectContaining({ totalCents: 200_00, status: 'PAID' }),
        },
      ]);
      await expectStatus(() => bank.cardCheck(ctx, checking.id), 404);
    });
  });

  it('conta nova: o saldo bate com o banco depois da revisão', async () => {
    const { checkingBank } = await connect();
    pluggy.add(CHECKING_ID, {
      id: 'n1',
      description: 'Café',
      amount: -15,
      date: '2026-10-17T03:00:00.000Z',
    });
    pluggy.add(CHECKING_ID, {
      id: 'n2',
      description: 'Pix recebido',
      amount: 200,
      type: 'CREDIT',
      date: '2026-10-16T03:00:00.000Z',
    });
    const linked: BankStatusResponse = await bank.linkAccount(ctx, checkingBank, { create: true });
    const accountId = linked.items[0]!.accounts[0]!.accountId!;
    bank.acceptAll(ctx);
    expect(fin.listAccounts(ctx).find((a) => a.id === accountId)!.balanceCents).toBe(1500_00);
  });

  it('chave revogada vira erro, e remover as chaves mantém os lançamentos', async () => {
    const { checkingBank } = await connect();
    await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    pluggy.add(CHECKING_ID, {
      id: 'j1',
      description: 'Farmácia',
      amount: -30,
      date: '2026-10-17T03:00:00.000Z',
    });
    await bank.syncBanks(ctx);
    bank.acceptMovement(ctx, pending()[0]!.id);

    pluggy.clientSecret = 'trocado';
    forgetPluggyKey();
    await bank.syncBanks(ctx);
    expect(bank.bankStatus(ctx).lastError).toContain('não aceitou');

    bank.removeCredentials(ctx);
    expect(bank.bankStatus(ctx)).toMatchObject({ configured: false, items: [], pendingCount: 0 });
    expect(live().filter((t) => t.description === 'Farmácia')).toHaveLength(1);
  });

  it('remover o banco e reconectar não importa nada de novo', async () => {
    const { checkingBank } = await connect();
    pluggy.add(CHECKING_ID, {
      id: 'r1',
      description: 'Farmácia',
      amount: -30,
      date: '2026-10-17T03:00:00.000Z',
    });
    await bank.linkAccount(ctx, checkingBank, { accountId: checking.id });
    bank.acceptAll(ctx);
    bank.removeItem(ctx, bank.bankStatus(ctx).items[0]!.id);
    expect(bank.bankStatus(ctx).items).toEqual([]);

    const back = await bank.addItem(ctx, pluggy.itemId);
    const again = back.items[0]!.accounts.find((a) => a.name === 'Conta Corrente')!.id;
    await bank.linkAccount(ctx, again, { accountId: checking.id });
    expect(pending()).toEqual([]);
    expect(live()).toHaveLength(1);
  });

  it('não liga cartão a conta', async () => {
    const { cardBank } = await connect();
    await expectStatus(() => bank.linkAccount(ctx, cardBank, { accountId: checking.id }), 400);
  });

  it('não acha conta apagada', async () => {
    const { checkingBank } = await connect();
    ctx.db
      .update(accounts)
      .set({ deletedAt: 1 })
      .where(and(eq(accounts.id, checking.id), isNotNull(accounts.id)))
      .run();
    await expectStatus(() => bank.linkAccount(ctx, checkingBank, { accountId: checking.id }), 404);
  });
});
