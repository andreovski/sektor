import {
  addMonthsToMonth,
  daysInMonth,
  monthOf,
  parseDateString,
  toDateString,
} from '@sektor/finance-engine';

import { normalize as descriptionKey } from '../../bank/movements';

/** Para comparar textos: sem acento, em minúsculas e com um espaço só entre as palavras. */
export function plainText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface CategoryRule {
  patternKey: string;
  kind: 'INCOME' | 'EXPENSE';
  categoryId: string;
}

/** A regra que vale: a de texto mais longo, que é a mais específica. Um lançamento só tem uma. */
export function matchRule<T extends CategoryRule>(
  rules: T[],
  tx: { kind: string; description: string }
): T | null {
  const text = plainText(tx.description);
  let best: T | null = null;
  for (const rule of rules) {
    if (rule.kind !== tx.kind || !text.includes(rule.patternKey)) continue;
    if (!best || rule.patternKey.length > best.patternKey.length) best = rule;
  }
  return best;
}

export interface HistoryRow {
  description: string;
  amountCents: number;
  date: string;
  accountId: string;
  categoryId: string | null;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
};

const WINDOW_MONTHS = 6;
const MIN_MONTHS = 3;

export function recurringKey(description: string) {
  return descriptionKey(description);
}

/**
 * Contas fixas: mesma descrição e valor parecido em pelo menos 3 meses dos últimos 6, uma vez por
 * mês e ainda ativa (vista neste mês ou no anterior). Gasto frequente, como a padaria, repete
 * várias vezes no mês e por isso não entra.
 */
export function detectFixedBills(history: HistoryRow[], today: string, ignoredKeys: Set<string>) {
  const thisMonth = monthOf(today);
  const firstMonth = addMonthsToMonth(thisMonth, 1 - WINDOW_MONTHS);
  const groups = new Map<string, HistoryRow[]>();
  for (const row of history) {
    const month = monthOf(row.date);
    if (month < firstMonth || row.date > today) continue;
    const key = recurringKey(row.description);
    if (!key || ignoredKeys.has(key)) continue;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const found = [];
  for (const [key, rows] of groups) {
    const center = median(rows.map((row) => row.amountCents));
    const tolerance = Math.max(100, center * 0.1);
    const similar = rows.filter((row) => Math.abs(row.amountCents - center) <= tolerance);
    const months = new Set(similar.map((row) => monthOf(row.date)));
    if (months.size < MIN_MONTHS || similar.length > months.size * 1.34) continue;
    const latest = similar.reduce((a, b) => (b.date > a.date ? b : a));
    if (monthOf(latest.date) < addMonthsToMonth(thisMonth, -1)) continue;

    // Dia 29 a 31 não existe em todo mês, e a regra mensal pularia esses meses.
    const day = Math.min(28, median(similar.map((row) => parseDateString(row.date).day)));
    found.push({
      key,
      description: latest.description,
      amountCents: center,
      day,
      months: months.size,
      nextDate: nextOccurrence(day, today, months.has(thisMonth)),
      accountId: latest.accountId,
      categoryId: latest.categoryId,
    });
  }
  return found.sort((a, b) => b.amountCents - a.amountCents);
}

function nextOccurrence(day: number, today: string, paidThisMonth: boolean) {
  const { year, month, day: todayDay } = parseDateString(today);
  if (!paidThisMonth && day >= todayDay) return toDateString(year, month, day);
  const next = parseDateString(`${addMonthsToMonth(monthOf(today), 1)}-01`);
  return toDateString(next.year, next.month, Math.min(day, daysInMonth(next.year, next.month)));
}
