import {
  addMonthsToMonth,
  type DateString,
  daysInMonth,
  parseDateString,
  toDateString,
} from './dates';

export interface InvoiceCycle {
  /** Mês do fechamento (AAAA-MM): identifica a fatura. */
  referenceMonth: string;
  closingDate: DateString;
  dueDate: DateString;
}

function dayIn(month: string, day: number): DateString {
  const [y, m] = month.split('-').map(Number);
  return toDateString(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Fatura de um mês de fechamento. O vencimento cai depois do fechamento (no mesmo mês ou no seguinte). */
export function invoiceCycleForMonth(
  referenceMonth: string,
  closingDay: number,
  dueDay: number
): InvoiceCycle {
  const closingDate = dayIn(referenceMonth, closingDay);
  const dueMonth = dueDay > closingDay ? referenceMonth : addMonthsToMonth(referenceMonth, 1);
  return { referenceMonth, closingDate, dueDate: dayIn(dueMonth, dueDay) };
}

/**
 * Em que fatura cai uma compra. Compra ANTES do dia de fechamento entra na fatura que fecha no
 * mês; no dia do fechamento ou depois, na do mês seguinte (o "melhor dia de compra" dos bancos).
 */
export function invoiceCycleFor(
  purchaseDate: DateString,
  closingDay: number,
  dueDay: number
): InvoiceCycle {
  const { year, month } = parseDateString(purchaseDate);
  const thisMonth = toDateString(year, month, 1).slice(0, 7);
  const closingThisMonth = dayIn(thisMonth, closingDay);
  const referenceMonth =
    purchaseDate < closingThisMonth ? thisMonth : addMonthsToMonth(thisMonth, 1);
  return invoiceCycleForMonth(referenceMonth, closingDay, dueDay);
}

/**
 * A fatura que vence em `dueDate` (vinda do banco): o mês de fechamento é o do vencimento, ou o
 * anterior quando o cartão vence no mês seguinte ao fechamento.
 */
export function referenceMonthForDue(
  dueDate: DateString,
  closingDay: number,
  dueDay: number
): string {
  const dueMonth = dueDate.slice(0, 7);
  return dueDay > closingDay ? dueMonth : addMonthsToMonth(dueMonth, -1);
}
