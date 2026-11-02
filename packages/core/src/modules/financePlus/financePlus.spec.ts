import type { AccountResponse } from '@sektor/contract';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DbHandle, openDatabase } from '../../db/client';
import { categories, recurrences, transactions } from '../../db/schema';
import * as cat from '../../services/categories';
import type { Ctx } from '../../services/context';
import * as fin from '../../services/finance';
import { createGoal } from '../goals/service';

import { computeAvailable, goalContributions, monthChanges } from './available';
import {
  byCost,
  comparePlans,
  debtTotals,
  fixedInstallment,
  simulatePayoff,
  simulateRenegotiation,
} from './debts';
import { detectFixedBills, matchRule } from './rules';
import * as svc from './service';
import {
  markDuplicates,
  parseAmount,
  parseCsv,
  parseDate,
  parseOfx,
  parseStatement,
  purchasesAreNegative,
  toEntries,
} from './statement';

describe('disponível hoje', () => {
  const base = {
    today: '2026-11-11',
    balanceCents: 3000_00,
    plannedExpenses: [{ amountCents: 800_00 }, { amountCents: 200_00 }],
    invoices: [{ totalCents: 500_00 }],
    goalsCents: 100_00,
    plannedIncomeCents: 0,
    spending: [],
    dailyCapCents: null,
  };

  it('tira do saldo os previstos, as faturas e as metas', () => {
    const result = computeAvailable(base);
    expect(result.availableCents).toBe(1400_00);
    expect(result.daysLeft).toBe(20);
    expect(result.dailyAllowanceCents).toBe(70_00);
  });

  it('o ritmo ignora as fixas e o mês fecha com a receita prevista', () => {
    const result = computeAvailable({
      ...base,
      plannedIncomeCents: 100_00,
      spending: [
        { date: '2026-11-02', amountCents: 2000_00, fixed: true },
        { date: '2026-11-03', amountCents: 110_00, fixed: false },
      ],
    });
    expect(result.pace.dailyCents).toBe(10_00);
    expect(result.pace.closeCents).toBe(1400_00 + 100_00 - 19 * 10_00);
    expect(result.pace.risk).toBe(false);
  });

  it('avisa quando o ritmo estoura o mês', () => {
    const result = computeAvailable({
      ...base,
      spending: [{ date: '2026-11-05', amountCents: 2200_00, fixed: false }],
    });
    expect(result.pace.dailyCents).toBe(200_00);
    expect(result.pace.closeCents).toBe(1400_00 - 19 * 200_00);
    expect(result.pace.risk).toBe(true);
  });

  it('disponível negativo não vira teto negativo', () => {
    const result = computeAvailable({ ...base, balanceCents: 0 });
    expect(result.availableCents).toBe(-1600_00);
    expect(result.dailyAllowanceCents).toBe(0);
  });

  it('o teto diário mostra o que sobrou hoje e se cabe no mês', () => {
    const result = computeAvailable({
      ...base,
      dailyCapCents: 100_00,
      spending: [{ date: '2026-11-11', amountCents: 30_00, fixed: false }],
    });
    expect(result.cap).toMatchObject({ leftTodayCents: 70_00, fits: false });
    expect(result.cap!.closeCents).toBe(1400_00 - 19 * 100_00);
  });

  it('o aporte divide o que falta pelos meses até o prazo', () => {
    const goal = (over: object) => ({
      id: 'g',
      title: 'Viagem',
      money: true,
      pace: { remaining: 1200_00, daysLeft: 364, status: 'on_track' },
      ...over,
    });
    expect(goalContributions([goal({})])[0]!.amountCents).toBe(100_00);
    const soon = goal({ pace: { remaining: 300_00, daysLeft: 5, status: 'behind' } });
    expect(goalContributions([soon])[0]!.amountCents).toBe(300_00);
    const skipped = [
      goal({ money: false }),
      goal({ pace: { remaining: 1, daysLeft: null, status: 'no_deadline' } }),
      goal({ pace: { remaining: 1, daysLeft: -2, status: 'overdue' } }),
      goal({ pace: { remaining: 0, daysLeft: 9, status: 'done' } }),
    ];
    expect(goalContributions(skipped)).toEqual([]);
  });

  it('compara com o mês anterior só até o mesmo dia', () => {
    const rows = [
      { date: '2026-10-05', kind: 'EXPENSE', amountCents: 100_00, categoryId: 'a' },
      { date: '2026-10-20', kind: 'EXPENSE', amountCents: 999_00, categoryId: 'a' },
      { date: '2026-11-05', kind: 'EXPENSE', amountCents: 150_00, categoryId: 'a' },
      { date: '2026-11-06', kind: 'INCOME', amountCents: 50_00, categoryId: 'b' },
    ] as const;
    const result = monthChanges([...rows], '2026-11-11', '2026-10');
    expect(result).toMatchObject({
      cutoff: '2026-10-11',
      spentCents: 150_00,
      spentBeforeCents: 100_00,
      incomeCents: 50_00,
    });
    expect(result.categories[0]).toMatchObject({ categoryId: 'a', deltaCents: 50_00 });
  });

  it('no começo do mês, o mês anterior existe mesmo sem nada até aquele dia', () => {
    const rows = [
      { date: '2026-10-20', kind: 'EXPENSE', amountCents: 10_00, categoryId: null },
    ] as const;
    expect(monthChanges([...rows], '2026-11-02', '2026-10')).toMatchObject({
      hasPrevious: true,
      spentBeforeCents: 0,
    });
  });

  it('no dia 31 compara com o último dia do mês mais curto', () => {
    expect(monthChanges([], '2026-03-31', '2026-02').cutoff).toBe('2026-02-28');
  });
});

describe('dívidas', () => {
  const card = { id: 'c', name: 'Cartão', balanceCents: 5000_00, rateBp: 1200, minPaymentCents: 800_00 };
  const loan = { id: 'l', name: 'Empréstimo', balanceCents: 1000_00, rateBp: 300, minPaymentCents: 200_00 };

  it('soma e ordena da mais cara', () => {
    expect(debtTotals([card, loan])).toMatchObject({
      balanceCents: 6000_00,
      minPaymentCents: 1000_00,
      monthlyInterestCents: 630_00,
      averageRateBp: 1050,
    });
    expect(byCost([loan, card]).map((d) => d.id)).toEqual(['c', 'l']);
  });

  it('bola de neve quita a menor primeiro; juros altos, a mais cara', () => {
    expect(simulatePayoff([card, loan], 'snowball', 100_00).order[0]!.id).toBe('l');
    expect(simulatePayoff([card, loan], 'avalanche', 1000_00).order[0]!.id).toBe('c');
  });

  it('juros altos nunca paga mais juros que a bola de neve', () => {
    const { snowball, avalanche, better } = comparePlans([card, loan], 100_00);
    expect(avalanche.totalInterestCents).toBeLessThanOrEqual(snowball.totalInterestCents);
    expect(better).toBe('avalanche');
  });

  it('o extra reduz prazo e juros contra pagar só o mínimo', () => {
    const plans = comparePlans([card, loan], 300_00);
    expect(plans.avalanche.months).toBeLessThan(plans.minimumsOnly.months);
    expect(plans.avalanche.totalInterestCents).toBeLessThan(plans.minimumsOnly.totalInterestCents);
  });

  it('o total pago é saldo mais juros, sem centavo a mais', () => {
    const plan = simulatePayoff([card, loan], 'snowball', 77_77);
    expect(plan.feasible).toBe(true);
    expect(plan.totalPaidCents).toBe(6000_00 + plan.totalInterestCents);
  });

  it('parcela menor que os juros nunca quita', () => {
    const stuck = { ...card, minPaymentCents: 100_00 };
    expect(simulatePayoff([stuck], 'avalanche', 0).feasible).toBe(false);
    expect(simulatePayoff([stuck], 'avalanche', 900_00).feasible).toBe(true);
  });

  it('sem juros e sem parcela não fica em laço', () => {
    const idle = { ...card, rateBp: 0, minPaymentCents: 0 };
    expect(simulatePayoff([idle], 'avalanche', 0).feasible).toBe(false);
  });

  it('parcela fixa fecha dentro do prazo', () => {
    expect(fixedInstallment(1200_00, 0, 12)).toBe(100_00);
    const installment = fixedInstallment(1000_00, 200, 12);
    expect(installment).toBe(94_56);
    const debt = { ...card, balanceCents: 1000_00, rateBp: 200, minPaymentCents: installment };
    expect(simulatePayoff([debt], 'avalanche', 0).months).toBe(12);
  });

  it('renegociação: taxa menor compensa', () => {
    const result = simulateRenegotiation(card, 300, 12);
    expect(result.verdict).toBe('worth');
    expect(result.savingsCents).toBeGreaterThan(0);
  });

  it('renegociação: prazo maior baixa a parcela, mas custa mais', () => {
    const result = simulateRenegotiation(card, 1200, 36);
    expect(result.verdict).toBe('relief');
    expect(result.savingsCents).toBeLessThan(0);
  });

  it('renegociação: parcela maior e custo maior não compensa', () => {
    const debt = { ...loan, rateBp: 100, minPaymentCents: 500_00 };
    expect(simulateRenegotiation(debt, 500, 2).verdict).toBe('not_worth');
  });

  it('renegociação: dívida que nunca acaba sempre compensa', () => {
    const stuck = { ...card, minPaymentCents: 100_00 };
    expect(simulateRenegotiation(stuck, 1200, 60)).toMatchObject({
      verdict: 'worth',
      savingsCents: null,
    });
  });
});

describe('regras e contas fixas', () => {
  it('casa sem acento nem maiúscula e a regra mais específica vence', () => {
    const rules = [
      { patternKey: 'uber', kind: 'EXPENSE', categoryId: 'transporte' },
      { patternKey: 'uber eats', kind: 'EXPENSE', categoryId: 'comida' },
      { patternKey: 'uber', kind: 'INCOME', categoryId: 'renda' },
    ] as const;
    const expense = { kind: 'EXPENSE', description: 'UBER  Eats *Pedido' };
    expect(matchRule([...rules], expense)?.categoryId).toBe('comida');
    const income = { kind: 'INCOME', description: 'Repasse Uber' };
    expect(matchRule([...rules], income)?.categoryId).toBe('renda');
    expect(matchRule([...rules], { kind: 'EXPENSE', description: 'Táxi' })).toBeNull();
  });

  const bill = (date: string, amountCents: number, description = 'Internet Vivo') => ({
    date,
    amountCents,
    description,
    accountId: 'a',
    categoryId: 'c',
  });

  it('acha a conta fixa e propõe a próxima data', () => {
    const history = [
      bill('2026-08-10', 100_00),
      bill('2026-09-10', 104_00),
      bill('2026-10-11', 99_00),
    ];
    const [found] = detectFixedBills(history, '2026-11-02', new Set());
    expect(found).toMatchObject({
      description: 'Internet Vivo',
      amountCents: 100_00,
      day: 10,
      months: 3,
      nextDate: '2026-11-10',
    });
  });

  it('já paga neste mês, a próxima é a do mês seguinte', () => {
    const history = [
      bill('2026-09-01', 100_00),
      bill('2026-10-01', 100_00),
      bill('2026-11-01', 100_00),
    ];
    expect(detectFixedBills(history, '2026-11-02', new Set())[0]!.nextDate).toBe('2026-12-01');
  });

  it('não sugere com 2 meses, valor diferente, gasto frequente, conta parada ou ignorada', () => {
    const two = [bill('2026-09-10', 100_00), bill('2026-10-10', 100_00)];
    expect(detectFixedBills(two, '2026-11-02', new Set())).toEqual([]);

    const varied = [
      bill('2026-08-10', 100_00),
      bill('2026-09-10', 300_00),
      bill('2026-10-10', 700_00),
    ];
    expect(detectFixedBills(varied, '2026-11-02', new Set())).toEqual([]);

    const frequent = ['08', '09', '10'].flatMap((month) =>
      ['05', '12', '19', '26'].map((day) => bill(`2026-${month}-${day}`, 20_00, 'Padaria'))
    );
    expect(detectFixedBills(frequent, '2026-11-02', new Set())).toEqual([]);

    const stopped = [
      bill('2026-04-10', 100_00),
      bill('2026-05-10', 100_00),
      bill('2026-06-10', 100_00),
    ];
    expect(detectFixedBills(stopped, '2026-11-02', new Set())).toEqual([]);

    const fine = [
      bill('2026-08-10', 100_00),
      bill('2026-09-10', 100_00),
      bill('2026-10-10', 100_00),
    ];
    expect(detectFixedBills(fine, '2026-11-02', new Set(['internet vivo']))).toEqual([]);
  });

  it('conta do dia 31 fica no dia 31; a próxima data cabe no mês', () => {
    const history = [
      bill('2026-08-31', 100_00),
      bill('2026-09-30', 100_00),
      bill('2026-10-31', 100_00),
    ];
    expect(detectFixedBills(history, '2026-11-02', new Set())[0]).toMatchObject({
      day: 31,
      nextDate: '2026-11-30',
    });
  });
});

describe('leitura de extrato', () => {
  it('lê valores nos formatos dos bancos', () => {
    expect(parseAmount('1.234,56')).toBe(1234_56);
    expect(parseAmount('1,234.56')).toBe(1234_56);
    expect(parseAmount('-12.50')).toBe(-12_50);
    expect(parseAmount('r$ 10')).toBe(10_00);
    expect(parseAmount('R$ -1.000,00')).toBe(-1000_00);
    expect(parseAmount('(5,00)')).toBe(-5_00);
    expect(parseAmount('12,34-')).toBe(-12_34);
    expect(parseAmount('12,34 D')).toBe(-12_34);
    expect(parseAmount('12,34 C')).toBe(12_34);
    expect(parseAmount('1.234')).toBe(1234_00);
    expect(parseAmount('12,5')).toBe(12_50);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('lê datas e recusa data que não existe', () => {
    expect(parseDate('05/10/2026')).toBe('2026-10-05');
    expect(parseDate('05-10-26')).toBe('2026-10-05');
    expect(parseDate('2026-10-05T12:00:00Z')).toBe('2026-10-05');
    expect(parseDate('20261005120000[-3:BRT]')).toBe('2026-10-05');
    expect(parseDate('31/02/2026')).toBeNull();
    expect(parseDate('hoje')).toBeNull();
  });

  it('CSV brasileiro com linhas antes do cabeçalho, saldo e aspas', () => {
    const text = [
      'Agência 0001;Conta 12345-6',
      'Período;01/10/2026 a 31/10/2026',
      '',
      'Data Lançamento;Histórico;Valor (R$);Saldo',
      '01/10/2026;SALDO ANTERIOR;;1.000,00',
      '02/10/2026;"Mercado; Central";-123,45;876,55',
      '03/10/2026;PIX RECEBIDO;1.000,00;1.876,55',
      'data ruim;Algo;10,00;0',
    ].join('\r\n');
    const parsed = parseCsv(text);
    expect(parsed.lines).toEqual([
      { date: '2026-10-02', amountCents: -123_45, description: 'Mercado; Central', externalId: null },
      { date: '2026-10-03', amountCents: 1000_00, description: 'PIX RECEBIDO', externalId: null },
    ]);
    expect(parsed).toMatchObject({ ignored: 1, unreadable: 1 });
  });

  it('CSV com vírgula, em inglês e identificador', () => {
    const text = 'Data,Valor,Identificador,Descrição\n05/10/2026,-10.50,abc-1,Café\n';
    expect(parseCsv(text).lines[0]).toEqual({
      date: '2026-10-05',
      amountCents: -10_50,
      description: 'Café',
      externalId: 'abc-1',
    });
    const card = parseCsv('date,title,amount\n2026-10-05,Loja,10.50\n');
    expect(card.lines[0]).toMatchObject({ date: '2026-10-05', amountCents: 10_50 });
  });

  it('CSV com colunas de débito e crédito', () => {
    const text = 'Data;Descrição;Débito;Crédito\n01/10/2026;Luz;50,00;\n02/10/2026;Salário;;900,00\n';
    expect(parseCsv(text).lines.map((l) => l.amountCents)).toEqual([-50_00, 900_00]);
  });

  it('CSV com coluna D/C', () => {
    const text = 'Data;Descrição;Valor;D/C\n01/10/2026;Luz;50,00;D\n02/10/2026;Salário;900,00;C\n';
    expect(parseCsv(text).lines.map((l) => l.amountCents)).toEqual([-50_00, 900_00]);
  });

  it('CSV sem cabeçalho', () => {
    const text = '01/10/2026;Luz da casa;-50,00\n02/10/2026;Salário;900,00\n';
    expect(parseCsv(text).lines).toHaveLength(2);
    expect(parseCsv(text).lines[0]!.description).toBe('Luz da casa');
  });

  it('CSV com data MM/DD quando o arquivo prova', () => {
    const text = 'Date,Description,Amount\n10/25/2026,A,1.00\n10/05/2026,B,2.00\n';
    expect(parseCsv(text).lines.map((l) => l.date)).toEqual(['2026-10-25', '2026-10-05']);
  });

  it('não confunde loja "Total Pass" com linha de total', () => {
    const text = 'Data;Descrição;Valor\n01/10/2026;Total Pass;-99,90\n02/10/2026;Total;-99,90\n';
    expect(parseCsv(text).lines.map((l) => l.description)).toEqual(['Total Pass']);
  });

  it('CSV sem as colunas é recusado com mensagem', () => {
    expect(() => parseCsv('a;b\nc;d\n')).toThrow(/colunas/);
  });

  const SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20261005120000[-3:BRT]
<TRNAMT>-45.90
<FITID>F1
<MEMO>Padaria &amp; Cia
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20261006
<TRNAMT>1500,00
<FITID>F2
<NAME>Salário
</STMTTRN>
<STMTTRN>
<DTPOSTED>xx
<TRNAMT>1
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;

  it('OFX em SGML, sem fechar as tags, com vírgula e entidade', () => {
    const parsed = parseOfx(SGML);
    expect(parsed.lines).toEqual([
      { date: '2026-10-05', amountCents: -45_90, description: 'Padaria & Cia', externalId: 'F1' },
      { date: '2026-10-06', amountCents: 1500_00, description: 'Salário', externalId: 'F2' },
    ]);
    expect(parsed.unreadable).toBe(1);
  });

  it('OFX em XML', () => {
    const xml = `<?xml version="1.0"?><OFX><STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20261005</DTPOSTED><TRNAMT>-10.00</TRNAMT><FITID>X</FITID><NAME>Loja</NAME><MEMO>Compra</MEMO></STMTTRN></OFX>`;
    expect(parseStatement(xml).lines).toEqual([
      { date: '2026-10-05', amountCents: -10_00, description: 'Loja - Compra', externalId: 'X' },
    ]);
  });

  it('recusa acima de 5 MB, 5.000 linhas, vazio e arquivo sem lançamento', () => {
    expect(() => parseStatement('x'.repeat(5 * 1024 * 1024 + 1))).toThrow(/5 MB/);
    const rows = Array.from({ length: 5001 }, () => '01/10/2026;Loja;-1,00');
    expect(() => parseStatement(`Data;Descrição;Valor\n${rows.join('\n')}`)).toThrow(/5\.000/);
    expect(() => parseStatement(`Data;Descrição;Valor\n${rows.slice(1).join('\n')}`)).not.toThrow();
    expect(() => parseStatement('  ')).toThrow(/vazio/);
    expect(() => parseStatement('Data;Descrição;Valor\n')).toThrow(/nenhum lançamento/);
  });

  it('tira o BOM do início', () => {
    expect(parseStatement('﻿Data;Descrição;Valor\n01/10/2026;A;-1,00').lines).toHaveLength(1);
  });

  it('fatura: compra é o sinal da maioria; no OFX, sempre negativa', () => {
    const positive = parseCsv(
      'date,title,amount\n2026-10-01,Loja,10.00\n2026-10-02,Bar,20.00\n2026-10-03,Estorno,-5.00\n'
    );
    expect(purchasesAreNegative(positive)).toBe(false);
    expect(toEntries(positive, 'invoice', false).map((e) => e.kind)).toEqual([
      'EXPENSE',
      'EXPENSE',
      'INCOME',
    ]);
    expect(toEntries(positive, 'invoice', true)[0]!.kind).toBe('INCOME');
    expect(purchasesAreNegative(parseOfx(SGML))).toBe(true);
  });

  it('marca o pagamento da fatura para não contar duas vezes', () => {
    const invoice = parseCsv(
      'date,title,amount\n2026-10-01,Loja,10.00\n2026-10-02,Bar,20.00\n2026-10-05,Pagamento recebido,-30.00\n'
    );
    expect(toEntries(invoice, 'invoice', false).map((e) => e.isPayment)).toEqual([
      false,
      false,
      true,
    ]);
    const statement = parseCsv('Data;Descrição;Valor\n05/10/2026;Pagamento de fatura;-30,00\n');
    expect(toEntries(statement, 'statement', false)[0]!.isPayment).toBe(true);
  });

  it('duas compras iguais no dia têm identidades diferentes', () => {
    const parsed = parseCsv('Data;Descrição;Valor\n01/10/2026;Café;-5,00\n01/10/2026;Café;-5,00\n');
    const [first, second] = toEntries(parsed, 'statement', false);
    expect(first!.fingerprint).not.toBe(second!.fingerprint);
  });

  it('um lançamento só explica uma linha do arquivo', () => {
    const parsed = parseCsv('Data;Descrição;Valor\n01/10/2026;Café;-5,00\n01/10/2026;Café;-5,00\n');
    const entries = toEntries(parsed, 'statement', false);
    const existing = [
      { id: 't', date: '2026-10-01', kind: 'EXPENSE', amountCents: 5_00, description: 'x' },
    ];
    const status = markDuplicates(entries, new Map(), existing);
    expect([...status.values()].sort()).toEqual(['NEW', 'POSSIBLE']);
  });

  it('com data próxima, só é duplicado se a descrição bate', () => {
    const parsed = parseCsv('Data;Descrição;Valor\n03/10/2026;Café;-5,00\n03/10/2026;Bar;-7,00\n');
    const existing = [
      { id: 'a', date: '2026-10-01', kind: 'EXPENSE', amountCents: 5_00, description: 'CAFÉ' },
      { id: 'b', date: '2026-10-01', kind: 'EXPENSE', amountCents: 7_00, description: 'Outro' },
    ];
    const status = markDuplicates(toEntries(parsed, 'statement', false), new Map(), existing);
    expect([...status.values()]).toEqual(['POSSIBLE', 'NEW']);
  });
});

// 18/10/2026, meio-dia em São Paulo.
const NOW = new Date('2026-10-18T15:00:00Z');

describe('financeiro com banco', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: Ctx;
  let checking: AccountResponse;
  let card: AccountResponse;
  let market: string;

  const expectStatus = (run: () => unknown, status: number) =>
    expect(run).toThrow(expect.objectContaining({ status }));
  const accountTxs = (accountId: string) => fin.listTransactions(ctx, { accountId });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-plus-'));
    handle = openDatabase(join(dir, 'p.db'), 'c'.repeat(64));
    ctx = { db: handle.orm, timeZone: 'America/Sao_Paulo' };
    cat.ensureCategories(ctx);
    checking = fin.createAccount(ctx, {
      name: 'Conta',
      type: 'CHECKING',
      initialBalanceCents: 3000_00,
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

  const expense = (over: Partial<Parameters<typeof fin.createTransactions>[1]> = {}) =>
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 100_00,
      date: '2026-10-10',
      accountId: checking.id,
      description: 'Compra',
      ...over,
    });

  it('banco vazio de contas não quebra o disponível', () => {
    handle.raw.exec(`UPDATE accounts SET deleted_at = 1`);
    expect(svc.available(ctx)).toMatchObject({ hasAccounts: false, availableCents: 0 });
  });

  it('o previsto no cartão entra pela fatura, não duas vezes', () => {
    // Compra de 01/10 cai na fatura que fecha em 25/10 e vence em 05/11: fora do mês.
    expense({ accountId: card.id, date: '2026-09-20', amountCents: 200_00 });
    expense({ accountId: card.id, date: '2026-10-19', amountCents: 50_00, status: 'PLANNED' });
    expense({ date: '2026-10-25', amountCents: 300_00, status: 'PLANNED' });
    expense({ date: '2026-11-05', amountCents: 999_00, status: 'PLANNED' });
    createGoal(ctx, {
      title: 'Reserva',
      area: 'FINANCAS',
      target: 100_00,
      unit: 'R$',
      deadline: '2026-10-30',
      color: 'green',
      source: 'MANUAL',
    } as Parameters<typeof createGoal>[1]);

    const result = svc.available(ctx);
    expect(result.goalItems).toMatchObject([{ title: 'Reserva', amountCents: 100_00 }]);
    expect(result.balanceCents).toBe(3000_00);
    expect(result.plannedCents).toBe(300_00);
    expect(result.invoicesCents).toBe(200_00);
    expect(result.availableCents).toBe(3000_00 - 300_00 - 200_00 - 100_00);
    expect(result.invoiceItems[0]).toMatchObject({ name: 'Cartão', totalCents: 200_00 });
  });

  it('previsto atrasado continua comprometido; receita atrasada não conta', () => {
    expense({ date: '2026-10-02', amountCents: 40_00, status: 'PLANNED' });
    fin.createTransactions(ctx, {
      kind: 'INCOME',
      amountCents: 500_00,
      date: '2026-10-02',
      accountId: checking.id,
      description: 'Atrasada',
      status: 'PLANNED',
    });
    fin.createTransactions(ctx, {
      kind: 'INCOME',
      amountCents: 70_00,
      date: '2026-10-25',
      accountId: checking.id,
      description: 'Prevista',
    });
    const result = svc.available(ctx);
    expect(result.plannedCents).toBe(40_00);
    expect(result.plannedIncomeCents).toBe(70_00);
  });

  it('o teto diário se liga e desliga', () => {
    svc.saveAvailableSettings(ctx, { dailyCapCents: 80_00 });
    expect(svc.available(ctx).cap?.capCents).toBe(80_00);
    svc.saveAvailableSettings(ctx, { dailyCapCents: null });
    expect(svc.available(ctx).cap).toBeNull();
  });

  it('dívida: cria, ordena, atualiza, apaga e não acha a apagada', () => {
    const cheap = svc.createDebt(ctx, {
      name: 'Barata',
      balanceCents: 100_00,
      rateBp: 100,
      minPaymentCents: 10_00,
      dueDay: 5,
    });
    const costly = svc.createDebt(ctx, {
      name: 'Cara',
      balanceCents: 100_00,
      rateBp: 900,
      minPaymentCents: 20_00,
      dueDay: 10,
    });
    expect(svc.listDebts(ctx).debts.map((d) => d.id)).toEqual([costly.id, cheap.id]);
    svc.updateDebt(ctx, cheap.id, { ...cheap, rateBp: 2000 });
    expect(svc.listDebts(ctx).debts[0]!.id).toBe(cheap.id);
    svc.deleteDebt(ctx, cheap.id);
    expect(svc.listDebts(ctx).totals.count).toBe(1);
    expectStatus(() => svc.deleteDebt(ctx, cheap.id), 404);
    expect(svc.debtPlan(ctx, 0).month).toBe('2026-10');
  });

  it('regra: recusa texto repetido, mesmo com outra caixa, e libera depois de apagar', () => {
    const rule = svc.createRule(ctx, { pattern: 'Mercadão', categoryId: market });
    expectStatus(() => svc.createRule(ctx, { pattern: 'MERCADAO', categoryId: market }), 409);
    svc.deleteRule(ctx, rule.id);
    expect(svc.createRule(ctx, { pattern: 'mercadao', categoryId: market }).kind).toBe('EXPENSE');
  });

  it('aplicar regra só nos sem categoria, ou em todos a pedido', () => {
    const other = ctx.db.select().from(categories).where(eq(categories.name, 'Restaurantes')).get();
    const [free] = expense({ description: 'Mercado Bom' });
    const [set] = expense({ description: 'Mercado Bom 2', categoryId: other?.id ?? null });
    svc.createRule(ctx, { pattern: 'mercado', categoryId: market });

    expect(svc.previewRules(ctx).uncategorized).toBe(other ? 1 : 2);
    svc.applyRules(ctx, false);
    const category = (id: string) => accountTxs(checking.id).find((t) => t.id === id)!.categoryId;
    expect(category(free!.id)).toBe(market);
    if (other) expect(category(set!.id)).toBe(other.id);
    svc.applyRules(ctx, true);
    expect(category(set!.id)).toBe(market);
  });

  it('aplicar regra não tira o lançamento da fatura que o banco definiu', () => {
    const [tx] = fin.createTransactions(
      ctx,
      {
        kind: 'EXPENSE',
        amountCents: 10_00,
        date: '2026-09-01',
        accountId: card.id,
        description: 'Mercado parcela',
      },
      { bill: { dueDate: '2026-11-05', closingDate: null } }
    );
    svc.createRule(ctx, { pattern: 'mercado', categoryId: market });
    svc.applyRules(ctx, false);
    const after = accountTxs(card.id)[0]!;
    expect(after.categoryId).toBe(market);
    expect(after.invoiceId).toBe(tx!.invoiceId);
  });

  it('aplicar regra na recorrência não cria exceção e vale para os próximos', () => {
    expense({ description: 'Mercado mensal', recurrence: { rrule: 'FREQ=MONTHLY' } });
    svc.createRule(ctx, { pattern: 'mercado', categoryId: market });
    svc.applyRules(ctx, false);
    const rows = ctx.db.select().from(transactions).all();
    expect(rows.every((tx) => !tx.isRecurrenceException && tx.categoryId === market)).toBe(true);
    const recurrence = ctx.db.select().from(recurrences).get()!;
    expect((recurrence.template as { categoryId: string }).categoryId).toBe(market);
  });

  const threeMonths = (description = 'Academia') => {
    for (const date of ['2026-08-12', '2026-09-12', '2026-10-12']) {
      expense({ description, date, amountCents: 90_00, categoryId: market });
    }
  };

  it('conta fixa vira recorrente e sai das sugestões', () => {
    threeMonths();
    const [item] = svc.recurringSuggestions(ctx);
    expect(item).toMatchObject({
      description: 'Academia',
      accountName: 'Conta',
      nextDate: '2026-11-12',
      categoryId: market,
    });
    const created = svc.acceptRecurring(ctx, item!.key);
    expect(created[0]).toMatchObject({ date: '2026-11-12', status: 'PLANNED' });
    expect(created[0]!.recurrenceId).not.toBeNull();
    expect(svc.recurringSuggestions(ctx)).toEqual([]);
    expectStatus(() => svc.acceptRecurring(ctx, item!.key), 404);
  });

  it('dispensar a sugestão é definitivo', () => {
    threeMonths();
    const [item] = svc.recurringSuggestions(ctx);
    svc.dismissRecurring(ctx, item!.key);
    svc.dismissRecurring(ctx, item!.key);
    expect(svc.recurringSuggestions(ctx)).toEqual([]);
  });

  const CSV = [
    'Data;Descrição;Valor',
    '05/10/2026;Padaria Central;-20,00',
    '06/10/2026;Salário;2.000,00',
    '07/10/2026;Café;-5,00',
    '07/10/2026;Café;-5,00',
  ].join('\n');
  const statement = () => ({
    text: CSV,
    fileName: 'extrato.csv',
    accountId: checking.id,
    mode: 'statement' as const,
  });
  const allLines = (input: svc.ImportInput) =>
    svc.previewImport(ctx, input).lines.map((line) => line.index);

  it('importa pela prévia, com regra, e cada lançamento nasce por createTransactions', () => {
    svc.createRule(ctx, { pattern: 'padaria', categoryId: market });
    const spy = vi.spyOn(fin, 'createTransactions');
    const preview = svc.previewImport(ctx, statement());
    expect(preview.counts).toMatchObject({ total: 4, new: 4, duplicate: 0 });
    expect(preview.lines[0]).toMatchObject({ kind: 'EXPENSE', categoryId: market });
    expect(accountTxs(checking.id)).toEqual([]);

    const result = svc.confirmImport(ctx, { ...statement(), selected: [0, 1, 2, 3] });
    expect(result).toEqual({ imported: 4, skipped: 0 });
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
    const saved = accountTxs(checking.id);
    expect(saved).toHaveLength(4);
    expect(saved.find((tx) => tx.description === 'Padaria Central')?.categoryId).toBe(market);
    expect(fin.listAccounts(ctx).find((a) => a.id === checking.id)!.balanceCents).toBe(
      3000_00 - 20_00 + 2000_00 - 10_00
    );
  });

  it('importar de novo: tudo duplicado e nada entra, mesmo se a tela mandar', () => {
    svc.confirmImport(ctx, { ...statement(), selected: [0, 1, 2, 3] });
    const preview = svc.previewImport(ctx, statement());
    expect(preview.counts).toMatchObject({ duplicate: 4, new: 0 });
    expect(svc.confirmImport(ctx, { ...statement(), selected: [0, 1, 2, 3] }).imported).toBe(0);
    expect(accountTxs(checking.id)).toHaveLength(4);
  });

  it('só parte do arquivo: o resto continua novo', () => {
    svc.confirmImport(ctx, { ...statement(), selected: [0] });
    expect(svc.previewImport(ctx, statement()).counts).toMatchObject({ duplicate: 1, new: 3 });
  });

  it('lançamento importado e depois apagado pode voltar', () => {
    svc.confirmImport(ctx, { ...statement(), selected: [0] });
    const [tx] = accountTxs(checking.id);
    fin.deleteTransaction(ctx, tx!.id);
    expect(svc.previewImport(ctx, statement()).counts.duplicate).toBe(0);
    expect(svc.confirmImport(ctx, { ...statement(), selected: [0] }).imported).toBe(1);
    expect(accountTxs(checking.id)).toHaveLength(1);
  });

  it('lançamento feito à mão vira possível duplicado, e a pessoa decide', () => {
    expense({ date: '2026-10-05', amountCents: 20_00, description: 'pão' });
    const preview = svc.previewImport(ctx, statement());
    expect(preview.lines[0]!.status).toBe('POSSIBLE');
    expect(svc.confirmImport(ctx, { ...statement(), selected: [0] }).imported).toBe(1);
  });

  it('a mesma linha em outra conta não é duplicada', () => {
    svc.confirmImport(ctx, { ...statement(), selected: allLines(statement()) });
    const other = fin.createAccount(ctx, { name: 'Outra', type: 'SAVINGS', initialBalanceCents: 0 });
    const input = { ...statement(), accountId: other.id };
    expect(svc.previewImport(ctx, input).counts.duplicate).toBe(0);
  });

  it('erro no meio desfaz a importação inteira', () => {
    expect(() =>
      svc.confirmImport(ctx, {
        ...statement(),
        selected: [0, 1],
        categories: { 1: '00000000-0000-7000-8000-000000000000' },
      })
    ).toThrow();
    expect(accountTxs(checking.id)).toEqual([]);
    expect(svc.previewImport(ctx, statement()).counts.duplicate).toBe(0);
  });

  const INVOICE = [
    'date,title,amount',
    '2026-09-28,Loja A,100.00',
    '2026-10-02,Loja B,50.00',
    '2026-10-03,Estorno Loja B,-10.00',
    '2026-10-04,Pagamento recebido,-500.00',
  ].join('\n');
  const invoiceInput = (dueDate?: string) => ({
    text: INVOICE,
    fileName: 'fatura.csv',
    accountId: card.id,
    mode: 'invoice' as const,
    dueDate,
  });

  it('modo fatura: tudo cai na fatura do vencimento escolhido e o pagamento fica de fora', () => {
    const input = invoiceInput('2026-11-05');
    const preview = svc.previewImport(ctx, input);
    expect(preview.lines.map((line) => line.status)).toEqual(['NEW', 'NEW', 'NEW', 'PAYMENT']);
    const selected = preview.lines.filter((l) => l.status === 'NEW').map((l) => l.index);
    svc.confirmImport(ctx, { ...input, selected });

    const [invoice] = fin.listDueInvoices(ctx, { month: '2026-11' });
    expect(invoice).toMatchObject({ dueDate: '2026-11-05', totalCents: 140_00 });
    expect(fin.listInvoices(ctx, card.id)).toHaveLength(1);
  });

  it('modo fatura sem vencimento: cada compra vai para a fatura da sua data', () => {
    const input = invoiceInput();
    svc.confirmImport(ctx, { ...input, selected: [0] });
    expect(fin.listInvoices(ctx, card.id)[0]!.dueDate).toBe('2026-11-05');
  });

  it('a prévia não cria fatura e avisa quando ela já está paga', () => {
    svc.previewImport(ctx, invoiceInput('2026-11-05'));
    expect(fin.listInvoices(ctx, card.id)).toEqual([]);
    expense({ accountId: card.id, date: '2026-10-01', amountCents: 10_00 });
    fin.payInvoice(ctx, fin.listInvoices(ctx, card.id)[0]!.id, { fromAccountId: checking.id });
    expect(svc.previewImport(ctx, invoiceInput('2026-11-05')).invoicePaid).toBe(true);
  });

  it('modo e conta precisam combinar', () => {
    expectStatus(() => svc.previewImport(ctx, { ...statement(), mode: 'invoice' }), 400);
    expectStatus(() => svc.previewImport(ctx, { ...invoiceInput(), mode: 'statement' }), 400);
  });

  it('sugere o vencimento da próxima fatura em aberto', () => {
    expect(svc.nextInvoiceDue(ctx, card.id).dueDate).toBeNull();
    expense({ accountId: card.id, date: '2026-10-10', amountCents: 10_00 });
    expect(svc.nextInvoiceDue(ctx, card.id).dueDate).toBe('2026-11-05');
  });

  it('importa 5.000 linhas em bloco', () => {
    const rows = Array.from(
      { length: 5000 },
      (_, i) => `01/10/2026;Loja ${i};-${(i % 90) + 1},00`
    );
    const input = { ...statement(), text: `Data;Descrição;Valor\n${rows.join('\n')}` };
    const selected = rows.map((_, i) => i);
    expect(svc.confirmImport(ctx, { ...input, selected }).imported).toBe(5000);
    expect(svc.previewImport(ctx, input).counts.duplicate).toBe(5000);
  }, 60_000);
});
