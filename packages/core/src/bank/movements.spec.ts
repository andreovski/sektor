import { describe, expect, it } from 'vitest';

import type { PluggyTransaction } from './pluggy-types';
import {
  billPayment,
  AI_MIN_CONFIDENCE,
  categoryMemory,
  decideAiCategory,
  findMatch,
  importedDescription,
  type InstallmentPiece,
  installmentSeries,
  installmentTitle,
  type MatchCandidate,
  movementBill,
  normalize,
  parseMovement,
  ruleCategory,
  shortDescription,
  suggestCategory,
} from './movements';

const TZ = 'America/Sao_Paulo';

const tx = (fields: Partial<PluggyTransaction>): PluggyTransaction => ({
  id: 'tx-1',
  description: 'Padaria Pão Quente',
  amount: -12.5,
  date: '2026-10-10T03:00:00.000Z',
  type: 'DEBIT',
  status: 'POSTED',
  ...fields,
});

const candidate = (fields: Partial<MatchCandidate>): MatchCandidate => ({
  id: 'c-1',
  kind: 'EXPENSE',
  amountCents: 1250,
  date: '2026-10-10',
  accountId: 'acc',
  toAccountId: null,
  installmentNumber: null,
  installmentTotal: null,
  ...fields,
});

describe('parseMovement', () => {
  it('débito vira despesa em centavos positivos, no dia do fuso do usuário', () => {
    expect(parseMovement(tx({}), 'BANK', TZ)).toMatchObject({
      kind: 'EXPENSE',
      amountCents: 1250,
      date: '2026-10-10',
      isCardPayment: false,
    });
  });

  it('crédito vira receita', () => {
    expect(parseMovement(tx({ amount: 3000, type: 'CREDIT' }), 'BANK', TZ)?.kind).toBe('INCOME');
  });

  it('na conta, o agendado (PENDING) fica de fora; no cartão, a compra pendente entra', () => {
    expect(parseMovement(tx({ status: 'PENDING' }), 'BANK', TZ)).toBeNull();
    expect(parseMovement(tx({ status: 'PENDING', amount: 12.5 }), 'CREDIT', TZ)).not.toBeNull();
  });

  it('usa o valor na moeda da conta quando a compra foi em outra moeda', () => {
    expect(
      parseMovement(tx({ amount: 10, amountInAccountCurrency: 55.3 }), 'CREDIT', TZ)?.amountCents
    ).toBe(5530);
  });

  it('pagamento recebido no cartão é marcado como pagamento da fatura', () => {
    const payment = tx({ description: 'Pagamento recebido', amount: -800, type: 'CREDIT' });
    expect(parseMovement(payment, 'CREDIT', TZ)?.isCardPayment).toBe(true);
    const refund = tx({ description: 'Estorno Loja', amount: -20, type: 'CREDIT' });
    expect(parseMovement(refund, 'CREDIT', TZ)?.isCardPayment).toBe(false);
  });

  it('parcela datada pela compra vai para o mês dela', () => {
    const third = tx({
      amount: 100,
      date: '2026-08-05T03:00:00.000Z',
      creditCardMetadata: {
        installmentNumber: 3,
        totalInstallments: 10,
        purchaseDate: '2026-08-05T03:00:00.000Z',
      },
    });
    expect(parseMovement(third, 'CREDIT', TZ)).toMatchObject({
      date: '2026-10-05',
      installmentNumber: 3,
      installmentTotal: 10,
    });
  });

  it('parcela datada longe da compra fica com a data que veio e guarda a compra', () => {
    const third = tx({
      amount: 100,
      date: '2026-10-07T03:00:00.000Z',
      creditCardMetadata: {
        installmentNumber: 3,
        totalInstallments: 10,
        purchaseDate: '2026-08-20T03:00:00.000Z',
      },
    });
    expect(parseMovement(third, 'CREDIT', TZ)).toMatchObject({
      date: '2026-10-07',
      purchaseDate: '2026-08-20',
    });
  });

  it('parcela sem a data da compra vale pela data', () => {
    const second = tx({
      amount: 100,
      date: '2026-11-14T03:00:00.000Z',
      creditCardMetadata: { installmentNumber: 2, totalInstallments: 2 },
    });
    expect(parseMovement(second, 'CREDIT', TZ)).toMatchObject({
      date: '2026-11-14',
      purchaseDate: null,
    });
  });
});

describe('faturas do cartão', () => {
  const card = { closingDay: 1, dueDay: 18 };
  const bills = new Map([['b-out', { dueDate: '2026-10-18', closingDate: '2026-10-08' }]]);

  it('a fatura do banco vale mais que a data', () => {
    const movement = { billId: 'b-out', purchaseDate: null, installmentNumber: null };
    expect(movementBill(movement, bills, card)).toEqual(bills.get('b-out'));
  });

  it('parcela com a data da compra vai N-1 faturas depois da fatura da compra', () => {
    // Compra em 20/08 (fecha dia 1): 1ª parcela na fatura de setembro, 3ª na de novembro.
    expect(
      movementBill({ billId: null, purchaseDate: '2026-08-20', installmentNumber: 3 }, bills, card)
    ).toEqual({ dueDate: '2026-11-18', closingDate: null });
    // Cartão que vence no mês seguinte ao fechamento.
    expect(
      movementBill({ billId: null, purchaseDate: '2026-11-03', installmentNumber: 2 }, bills, {
        closingDay: 25,
        dueDay: 5,
      })
    ).toEqual({ dueDate: '2027-01-05', closingDate: null });
  });

  it('Nubank: parcela datada pela compra mais N-1 meses fica na fatura de cada mês', () => {
    // Fecha dia 12, vence dia 19. Compra em 13/10: 1/5 vence em 19/11, 2/5 (datada 14/11) em 19/12.
    const nubank = { closingDay: 12, dueDay: 19 };
    const second = parseMovement(
      tx({
        amount: 100,
        date: '2026-11-14T03:00:00.000Z',
        creditCardMetadata: {
          installmentNumber: 2,
          totalInstallments: 5,
          purchaseDate: '2026-10-13T03:00:00.000Z',
        },
      }),
      'CREDIT',
      TZ
    )!;
    expect(movementBill(second, new Map(), nubank)).toEqual({
      dueDate: '2026-12-19',
      closingDate: null,
    });
  });

  it('sem fatura nem data da compra, vale a data', () => {
    expect(
      movementBill({ billId: 'outra', purchaseDate: null, installmentNumber: 2 }, bills, card)
    ).toBeNull();
  });

  it('paga só quando os pagamentos cobrem o total', () => {
    const bill = {
      id: 'b',
      dueDate: '2026-10-18T03:00:00.000Z',
      totalAmount: 590.7,
      payments: [
        { paymentDate: '2026-10-10T03:00:00.000Z', amount: 90.7 },
        { paymentDate: '2026-10-17T03:00:00.000Z', amount: 500 },
      ],
    };
    expect(billPayment(bill, TZ)).toEqual({ amountCents: 590_70, date: '2026-10-17' });
    expect(billPayment({ ...bill, payments: bill.payments.slice(1) }, TZ)).toBeNull();
    expect(billPayment({ ...bill, payments: undefined }, TZ)).toBeNull();
  });
});

describe('findMatch', () => {
  const movement = parseMovement(tx({}), 'BANK', TZ)!;

  it('casa mesmo valor e sentido com data perto, o mais próximo primeiro', () => {
    const far = candidate({ id: 'far', date: '2026-10-13' });
    const near = candidate({ id: 'near', date: '2026-10-11' });
    expect(findMatch(movement, 'acc', [far, near], new Set())?.id).toBe('near');
  });

  it('não casa valor diferente, data longe, outra conta, sentido oposto ou já usado', () => {
    const none = [
      candidate({ amountCents: 1251 }),
      candidate({ date: '2026-10-20' }),
      candidate({ accountId: 'other' }),
      candidate({ kind: 'INCOME' }),
    ];
    expect(findMatch(movement, 'acc', none, new Set())).toBeNull();
    expect(findMatch(movement, 'acc', [candidate({})], new Set(['c-1']))).toBeNull();
  });

  it('transferência casa pelos dois lados: saída na origem, entrada no destino', () => {
    const transfer = candidate({ kind: 'TRANSFER', accountId: 'acc', toAccountId: 'card' });
    expect(findMatch(movement, 'acc', [transfer], new Set())?.id).toBe('c-1');
    const incoming = parseMovement(tx({ type: 'CREDIT', amount: 12.5 }), 'CREDIT', TZ)!;
    expect(findMatch(incoming, 'card', [transfer], new Set())?.id).toBe('c-1');
  });

  it('parcela casa pelo número da parcela, com folga de centavos e de data', () => {
    const installment = parseMovement(
      tx({
        amount: 33.33,
        date: '2026-10-25T03:00:00.000Z',
        creditCardMetadata: { installmentNumber: 2, totalInstallments: 3 },
      }),
      'CREDIT',
      TZ
    )!;
    const jottape = [
      candidate({
        id: 'p1',
        amountCents: 3334,
        installmentNumber: 1,
        installmentTotal: 3,
        date: '2026-09-15',
      }),
      candidate({
        id: 'p2',
        amountCents: 3333,
        installmentNumber: 2,
        installmentTotal: 3,
        date: '2026-10-15',
      }),
    ];
    expect(findMatch(installment, 'acc', jottape, new Set())?.id).toBe('p2');
  });
});

describe('categorias', () => {
  it('normaliza sem acento, números e pontuação, nas três primeiras palavras', () => {
    expect(normalize('PADARIA Pão-Quente 123 Centro SP')).toBe('padaria pao quente');
  });

  it('sugere a categoria do lançamento mais recente com a mesma descrição e tipo', () => {
    const memory = categoryMemory([
      { description: 'Padaria Pão Quente', kind: 'EXPENSE', categoryId: 'nova' },
      { description: 'padaria pao quente', kind: 'EXPENSE', categoryId: 'velha' },
      { description: 'Padaria Pão Quente', kind: 'INCOME', categoryId: 'receita' },
    ]);
    expect(
      suggestCategory(memory, { kind: 'EXPENSE', description: 'PADARIA PÃO QUENTE 0001' })
    ).toBe('nova');
    expect(suggestCategory(memory, { kind: 'EXPENSE', description: 'Mercado' })).toBeNull();
  });

  it('aceita descrição que começa pela outra, mas não nome curto demais', () => {
    const memory = categoryMemory([
      { description: 'Rendimento', kind: 'INCOME', categoryId: 'investimentos' },
      { description: 'Pix', kind: 'EXPENSE', categoryId: 'outros' },
      { description: 'Uber Trip', kind: 'EXPENSE', categoryId: 'transporte' },
    ]);
    const suggest = (kind: 'INCOME' | 'EXPENSE', description: string) =>
      suggestCategory(memory, { kind, description });
    expect(suggest('INCOME', 'RENDIMENTO DA CONTA')).toBe('investimentos');
    expect(suggest('INCOME', 'Rendimentos')).toBeNull();
    expect(suggest('EXPENSE', 'Rendimento da conta')).toBeNull();
    expect(suggest('EXPENSE', 'PIX ENVIADO Fulano')).toBeNull();
    expect(suggest('EXPENSE', 'Uber')).toBeNull();
  });
});

it('a parcela vai no fim da descrição', () => {
  expect(
    importedDescription({ description: 'Loja', installmentNumber: 2, installmentTotal: 10 })
  ).toBe('Loja (2/10)');
  expect(
    importedDescription({ description: 'Loja', installmentNumber: null, installmentTotal: null })
  ).toBe('Loja');
});

describe('título do lançamento do banco', () => {
  it('fica com o nome depois do "|"', () => {
    expect(
      shortDescription(
        'Transferência enviada pelo Pix|MARIA EXEMPLO DA SILVA|•••.123.456-••|NU PAGAMENTOS - IP'
      )
    ).toBe('Maria Exemplo da Silva');
    expect(shortDescription('Transferência recebida|MARIA DE SOUZA|12.345.678/0001-90')).toBe(
      'Maria de Souza'
    );
    // Sem nome depois do "|" (só documento), fica como veio.
    expect(shortDescription('Pix enviado|•••.123.456-••')).toBe('Pix enviado|•••.123.456-••');
  });

  it('sem "|" fica como veio', () => {
    expect(shortDescription('  Padaria Pão Quente ')).toBe('Padaria Pão Quente');
    expect(shortDescription('Transferência enviada pelo Pix')).toBe(
      'Transferência enviada pelo Pix'
    );
  });

  it('a categoria sugerida olha o título: cada pessoa do Pix tem a sua', () => {
    const memory = categoryMemory([
      { description: 'Maria Exemplo', kind: 'EXPENSE', categoryId: 'casa' },
      { description: 'Outra Pessoa', kind: 'EXPENSE', categoryId: 'outros' },
    ]);
    expect(
      suggestCategory(memory, {
        kind: 'EXPENSE',
        description: 'Transferência enviada pelo Pix|MARIA EXEMPLO|•••.123.456-••',
      })
    ).toBe('casa');
  });
});

describe('categoria pela nota, regra fixa e IA', () => {
  const PIX = 'Transferência enviada pelo Pix|MARIA EXEMPLO|•••.123.456-••|NU PAGAMENTOS - IP';

  it('casa pela nota igual ao texto do banco, mesmo com o título trocado', () => {
    const memory = categoryMemory([
      { description: 'Faxina', notes: PIX, kind: 'EXPENSE', categoryId: 'casa' },
    ]);
    expect(
      suggestCategory(memory, { kind: 'EXPENSE', description: ` ${PIX.toUpperCase()} ` })
    ).toBe('casa');
    // O tipo também precisa bater.
    expect(suggestCategory(memory, { kind: 'INCOME', description: PIX })).toBeNull();
  });

  it('a descrição igual vem antes da nota', () => {
    const memory = categoryMemory([
      { description: 'Outra coisa', notes: PIX, kind: 'EXPENSE', categoryId: 'pela-nota' },
      { description: 'Maria Exemplo', notes: null, kind: 'EXPENSE', categoryId: 'pelo-titulo' },
    ]);
    expect(suggestCategory(memory, { kind: 'EXPENSE', description: PIX })).toBe('pelo-titulo');
  });

  const ids = new Map([
    ['EXPENSE:TRANSFER', 'saida'],
    ['EXPENSE:TRANSFER_PIX', 'saida-pix'],
    ['EXPENSE:TRANSFER_DEBIT', 'saida-debito'],
    ['EXPENSE:TRANSFER_CREDIT', 'saida-credito'],
    ['INCOME:TRANSFER', 'entrada'],
    ['INCOME:TRANSFER_PIX', 'entrada-pix'],
  ]);
  const rule = (
    kind: 'INCOME' | 'EXPENSE',
    description: string,
    type: 'BANK' | 'CREDIT' = 'BANK'
  ) => ruleCategory({ kind, description }, type, ids);

  it('a regra fixa vai pela forma de pagamento', () => {
    expect(rule('EXPENSE', PIX)).toBe('saida-pix');
    expect(rule('INCOME', 'Transferência recebida pelo Pix|MARIA')).toBe('entrada-pix');
    expect(rule('EXPENSE', 'Compra no débito|PADARIA')).toBe('saida-debito');
    expect(rule('EXPENSE', 'NETFLIX.COM', 'CREDIT')).toBe('saida-credito');
    expect(rule('EXPENSE', 'TED enviada|FULANO')).toBe('saida');
    // Estorno no cartão e o que não tem forma de pagamento ficam sem categoria.
    expect(rule('INCOME', 'Estorno NETFLIX', 'CREDIT')).toBeNull();
    expect(rule('EXPENSE', 'Padaria Pão Quente')).toBeNull();
  });

  it('a IA só vale com o Jev confiante e de acordo com o Haiku', () => {
    const jev = new Map([
      ['transporte', 0.82],
      ['lazer', 0.1],
    ]);
    expect(decideAiCategory('transporte', jev)).toEqual({
      categoryId: 'transporte',
      confidence: 0.82,
      agreement: 'SAME',
    });
    expect(decideAiCategory('lazer', jev)).toBeNull();
    expect(decideAiCategory(null, jev)).toBeNull();
    expect(decideAiCategory('transporte', null)).toBeNull();
    expect(
      decideAiCategory('transporte', new Map([['transporte', AI_MIN_CONFIDENCE - 0.01]]))
    ).toBeNull();
  });

  describe('mesma categoria-mãe', () => {
    const parents = new Map<string, string | null>([
      ['alimentacao', null],
      ['fastfood', 'alimentacao'],
      ['restaurante', 'alimentacao'],
      ['transporte', null],
    ]);

    it('Haiku na mãe e Jev seguro numa filha dela: a filha', () => {
      const jev = new Map([
        ['fastfood', 0.67],
        ['alimentacao', 0.2],
        ['transporte', 0.13],
      ]);
      expect(decideAiCategory('alimentacao', jev, parents)).toEqual({
        categoryId: 'fastfood',
        confidence: 0.67,
        agreement: 'SUBCATEGORY',
      });
    });

    it('filhas diferentes da mesma mãe: a mãe, com a soma do Jev na família', () => {
      const jev = new Map([
        ['restaurante', 0.45],
        ['fastfood', 0.3],
        ['transporte', 0.25],
      ]);
      expect(decideAiCategory('fastfood', jev, parents)).toEqual({
        categoryId: 'alimentacao',
        confidence: 0.75,
        agreement: 'PARENT',
      });
    });

    it('Haiku na filha e Jev na mãe: a mãe', () => {
      const jev = new Map([
        ['alimentacao', 0.5],
        ['fastfood', 0.3],
        ['transporte', 0.2],
      ]);
      expect(decideAiCategory('fastfood', jev, parents)?.categoryId).toBe('alimentacao');
    });

    it('Haiku na mãe e Jev pouco seguro na filha: a mãe, se a família somar o mínimo', () => {
      const jev = new Map([
        ['fastfood', 0.4],
        ['alimentacao', 0.25],
        ['transporte', 0.35],
      ]);
      expect(decideAiCategory('alimentacao', jev, parents)).toEqual({
        categoryId: 'alimentacao',
        confidence: 0.65,
        agreement: 'PARENT',
      });
    });

    it('família abaixo do mínimo ou mães diferentes: nada', () => {
      const weak = new Map([
        ['restaurante', 0.3],
        ['fastfood', 0.2],
        ['transporte', 0.5],
      ]);
      expect(decideAiCategory('fastfood', weak, parents)).toBeNull();
      const other = new Map([
        ['transporte', 0.9],
        ['fastfood', 0.1],
      ]);
      expect(decideAiCategory('fastfood', other, parents)).toBeNull();
    });
  });
});

describe('parcelas da mesma compra', () => {
  const piece = (over: Partial<InstallmentPiece> & { id: string }) => ({
    description: 'LOJA X',
    amountCents: 10_000,
    date: '2026-10-05',
    installmentNumber: 2,
    installmentTotal: 5,
    ...over,
  });
  const ids = (series: { id: string }[][]) => series.map((s) => s.map((p) => p.id));

  it('junta pelo texto sem a parcela e pela data da compra', () => {
    expect(
      ids(
        installmentSeries([
          piece({
            id: 'a',
            description: 'Jim.Com* 549 Day 1/2',
            installmentNumber: 1,
            installmentTotal: 2,
            date: '2026-10-14',
          }),
          piece({
            id: 'b',
            description: 'Jim.Com* 549 Day 2/2',
            installmentNumber: 2,
            installmentTotal: 2,
            date: '2026-11-14',
            amountCents: 10_001,
          }),
          piece({ id: 'c', description: 'OUTRA', installmentNumber: 1, installmentTotal: 3 }),
        ])
      )
    ).toEqual([['a', 'b'], ['c']]);
  });

  it('separa duas compras iguais feitas em meses diferentes', () => {
    expect(
      ids(installmentSeries([piece({ id: 'a' }), piece({ id: 'b', installmentNumber: 4 })]))
    ).toEqual([['a'], ['b']]);
  });

  it('troca a parcela no título, ou põe no fim', () => {
    expect(installmentTitle('Bwt Operadora 7/10 (7/10)', 7, 10, 8)).toBe(
      'Bwt Operadora 8/10 (8/10)'
    );
    expect(installmentTitle('Loja PARC 03/10', 3, 10, 4)).toBe('Loja PARC 04/10');
    expect(installmentTitle('Loja', 3, 10, 4)).toBe('Loja (4/10)');
  });
});
