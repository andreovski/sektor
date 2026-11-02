import { describe, expect, it } from 'vitest';

import { formatCents, parseCents } from './money';

describe('formatCents', () => {
  it('formata em reais', () => {
    expect(formatCents(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
  });

  it('recusa valor que não é inteiro', () => {
    expect(() => formatCents(10.5)).toThrow(RangeError);
  });
});

describe('parseCents', () => {
  it.each([
    ['1.234,56', 123456],
    ['R$ 10', 1000],
    ['-3,5', -350],
    ['0,07', 7],
    ['1234', 123400],
  ])('%s vira %i centavos', (texto, esperado) => {
    expect(parseCents(texto)).toBe(esperado);
  });

  it.each(['', 'abc', '1,234', '12.34', '1,999'])('"%s" não é valor', (texto) => {
    expect(parseCents(texto)).toBeNull();
  });
});
