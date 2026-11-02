import { addMonthsClamped, type DateString, parseDateString } from './dates';

/** Divide o total em N parcelas inteiras; os centavos que sobram vão nas primeiras. */
export function splitInstallments(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents <= 0) {
    throw new RangeError('O total precisa ser um inteiro positivo.');
  }
  if (!Number.isInteger(count) || count < 1) throw new RangeError('Número de parcelas inválido.');

  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

/** Uma data por parcela, mês a mês, no mesmo dia da primeira (ou no último dia do mês). */
export function installmentDates(firstDate: DateString, count: number): DateString[] {
  const anchor = parseDateString(firstDate).day;
  return Array.from({ length: count }, (_, i) => addMonthsClamped(firstDate, i, anchor));
}
