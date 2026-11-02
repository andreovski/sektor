import { describe, expect, it } from 'vitest';

import { installmentDates, splitInstallments } from './installments';

describe('splitInstallments', () => {
  it('divide com o resto nas primeiras parcelas', () => {
    expect(splitInstallments(1000, 3)).toEqual([334, 333, 333]);
    expect(splitInstallments(1000, 3).reduce((a, b) => a + b)).toBe(1000);
  });

  it('recusa total inválido', () => {
    expect(() => splitInstallments(0, 2)).toThrow();
  });
});

describe('installmentDates', () => {
  it('mantém o dia 31 quando o mês tem', () => {
    expect(installmentDates('2026-01-31', 4)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });
});
