import { type DateString, diffInDays } from '@sektor/finance-engine';

const DAYS_PER_MONTH = 30.4375;
const MIN_MONTHS_VIEW = 45;
const MIN_WEEKS_VIEW = 14;
const AHEAD_MARGIN = 0.05;
const BEHIND_MARGIN = 0.1;

export interface PaceInput {
  target: number;
  current: number;
  deadline: DateString | null;
  startedOn: DateString;
  today: DateString;
  /** Só inteiros fazem sentido (centavos): o ritmo arredonda para cima sem casas. */
  whole?: boolean;
  /** O progresso não acelera (sequência sobe 1 por dia): dá para dizer que não cabe mais no prazo. */
  maxPerDay?: number;
}

export type PaceStatus =
  | 'done'
  | 'no_deadline'
  | 'overdue'
  | 'unreachable'
  | 'ahead'
  | 'on_track'
  | 'behind';

export interface Pace {
  /** De 0 a 1. */
  progress: number;
  remaining: number;
  daysLeft: number | null;
  status: PaceStatus;
  period: 'month' | 'week' | 'day' | null;
  perPeriod: number | null;
}

const ceilTo = (value: number, whole?: boolean) =>
  whole ? Math.ceil(value) : Math.ceil(value * 10 - 1e-9) / 10;

export function computePace(input: PaceInput): Pace {
  const { target, current, deadline, startedOn, today, whole, maxPerDay } = input;
  const progress = Math.min(1, Math.max(0, current / target));
  const remaining = Math.max(0, target - current);
  const daysLeft = deadline ? diffInDays(today, deadline) : null;
  const base = { progress, remaining, daysLeft, period: null, perPeriod: null };
  if (remaining === 0) return { ...base, status: 'done' };
  if (daysLeft === null) return { ...base, status: 'no_deadline' };
  if (daysLeft < 0) return { ...base, status: 'overdue' };

  // Hoje ainda conta: no último dia falta fazer tudo hoje, não em zero dias.
  const days = daysLeft + 1;
  if (maxPerDay) {
    return { ...base, status: remaining > maxPerDay * days ? 'unreachable' : status() };
  }
  const period = days >= MIN_MONTHS_VIEW ? 'month' : days >= MIN_WEEKS_VIEW ? 'week' : 'day';
  const size = period === 'month' ? DAYS_PER_MONTH : period === 'week' ? 7 : 1;
  return {
    ...base,
    status: status(),
    period,
    perPeriod: ceilTo(remaining / (days / size), whole),
  };

  function status(): PaceStatus {
    const total = diffInDays(startedOn, deadline!);
    if (total <= 0) return 'on_track';
    const expected = Math.min(1, diffInDays(startedOn, today) / total);
    if (progress >= expected + AHEAD_MARGIN) return 'ahead';
    return progress < expected - BEHIND_MARGIN ? 'behind' : 'on_track';
  }
}
