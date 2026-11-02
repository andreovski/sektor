import { addDays, addMonthsToMonth, daysInMonth, parseDateString } from '@sektor/finance-engine';

import { AppError } from '../../services/context';
import { mondayOf } from '../focus/service';

export type PeriodKind = 'week' | 'month' | 'year';

export interface Period {
  kind: PeriodKind;
  key: string;
  from: string;
  to: string;
  previous: string;
  next: string | null;
}

const PATTERN: Record<PeriodKind, RegExp> = {
  week: /^\d{4}-\d{2}-\d{2}$/,
  month: /^\d{4}-\d{2}$/,
  year: /^\d{4}$/,
};

function span(kind: PeriodKind, key: string) {
  if (kind === 'week') return { key, from: key, to: addDays(key, 6) };
  if (kind === 'month') {
    const { year, month } = parseDateString(`${key}-01`);
    return { key, from: `${key}-01`, to: `${key}-${daysInMonth(year, month)}` };
  }
  return { key, from: `${key}-01-01`, to: `${key}-12-31` };
}

const step = (kind: PeriodKind, key: string, by: number) => {
  if (kind === 'week') return addDays(key, by * 7);
  if (kind === 'month') return addMonthsToMonth(key, by);
  return String(Number(key) + by);
};

export function currentKey(kind: PeriodKind, today: string) {
  if (kind === 'week') return mondayOf(today);
  return today.slice(0, kind === 'month' ? 7 : 4);
}

/** Sem `key`, o período de hoje. Na semana, qualquer dia vale pela segunda daquela semana. */
export function periodOf(kind: PeriodKind, key: string | undefined, today: string): Period {
  const raw = key ?? currentKey(kind, today);
  if (!PATTERN[kind].test(raw)) throw new AppError(400, 'Período inválido.');
  const normal = kind === 'week' ? mondayOf(raw) : raw;
  const next = step(kind, normal, 1);
  return {
    kind,
    ...span(kind, normal),
    previous: step(kind, normal, -1),
    next: span(kind, next).from <= today ? next : null,
  };
}
