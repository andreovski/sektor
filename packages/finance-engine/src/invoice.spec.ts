import { describe, expect, it } from 'vitest';

import { invoiceCycleFor, referenceMonthForDue } from './invoice';

describe('invoiceCycleFor', () => {
  it('compra antes do fechamento entra na fatura do mês', () => {
    expect(invoiceCycleFor('2026-10-05', 10, 20)).toEqual({
      referenceMonth: '2026-10',
      closingDate: '2026-10-10',
      dueDate: '2026-10-20',
    });
  });

  it('compra no dia do fechamento vai para a próxima', () => {
    expect(invoiceCycleFor('2026-10-10', 10, 20).referenceMonth).toBe('2026-11');
  });

  it('vencimento antes do fechamento cai no mês seguinte', () => {
    expect(invoiceCycleFor('2026-12-01', 25, 5)).toEqual({
      referenceMonth: '2026-12',
      closingDate: '2026-12-25',
      dueDate: '2027-01-05',
    });
  });

  it('fechamento no dia 31 vira o último dia do mês curto', () => {
    expect(invoiceCycleFor('2026-02-10', 31, 10)).toMatchObject({
      closingDate: '2026-02-28',
      dueDate: '2026-03-10',
    });
  });
});

describe('referenceMonthForDue', () => {
  it('vence no mês do fechamento', () => {
    expect(referenceMonthForDue('2026-11-18', 11, 18)).toBe('2026-11');
  });

  it('vence no mês seguinte ao fechamento', () => {
    expect(referenceMonthForDue('2027-01-05', 25, 5)).toBe('2026-12');
  });
});
