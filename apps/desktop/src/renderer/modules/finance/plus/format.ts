import type { Rpc } from '@sektor/core';

export type Out<M extends keyof Rpc> = Awaited<ReturnType<Rpc[M]>>;

/** "1.234,56" ou "10" em centavos; texto que não é valor dá null. */
export function parseMoney(input: string): number | null {
  const text = input.replace(/R\$|\s/g, '');
  if (!/^\d{1,3}(\.\d{3})*(,\d{1,2})?$|^\d+(,\d{1,2})?$/.test(text)) return null;
  const [whole, decimals = ''] = text.replace(/\./g, '').split(',');
  return Number(whole) * 100 + Number(decimals.padEnd(2, '0'));
}

export const moneyField = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2,99" (por cento ao mês) em centésimos de ponto percentual: 299. */
export function parseRate(input: string): number | null {
  const text = input.replace('%', '').trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export const rateField = (bp: number) =>
  (bp / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const rateLabel = (bp: number) => `${rateField(bp)}% ao mês`;

export function duration(months: number) {
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [];
  if (years) parts.push(years === 1 ? '1 ano' : `${years} anos`);
  if (rest) parts.push(rest === 1 ? '1 mês' : `${rest} meses`);
  return parts.join(' e ') || '0 mês';
}

export function addMonths(month: string, count: number) {
  const [year, m] = month.split('-').map(Number);
  const total = year! * 12 + (m! - 1) + count;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** Fatura e extrato de banco brasileiro costumam vir em Windows-1252, não em UTF-8. */
export function decodeText(bytes: ArrayBuffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
