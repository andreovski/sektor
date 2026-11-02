import { addDays, type DateString, dateStringToUtc, diffInDays } from '@sektor/finance-engine';

export type Frequency =
  | { type: 'DAILY' }
  | { type: 'WEEKDAYS' }
  | { type: 'TIMES'; times: number };

export type Marks = ReadonlySet<DateString>;

const WINDOW = 7;
export const RATE_DAYS = 28;

const isWeekday = (day: DateString) => {
  const weekday = dateStringToUtc(day).getUTCDay();
  return weekday !== 0 && weekday !== 6;
};

/** Dia que conta para a frequência. Em "X vezes" todo dia pode contar. */
export const isScheduled = (frequency: Frequency, day: DateString) =>
  frequency.type !== 'WEEKDAYS' || isWeekday(day);

function previousScheduled(frequency: Frequency, day: DateString) {
  let previous = addDays(day, -1);
  while (!isScheduled(frequency, previous)) previous = addDays(previous, -1);
  return previous;
}

function marksInWindow(marks: Marks, day: DateString) {
  let count = 0;
  for (let i = 0; i < WINDOW; i++) if (marks.has(addDays(day, -i))) count++;
  return count;
}

/** "X vezes": o dia cumpre quando os 7 dias que terminam nele têm X marcas. */
const windowMet = (times: number, marks: Marks, day: DateString) =>
  marksInWindow(marks, day) >= times;

/** Dias do trecho cumprido que acaba em `end`, somando os dias até a marca que abriu a janela. */
function windowRunLength(times: number, marks: Marks, end: DateString) {
  let start = end;
  let length = 0;
  while (windowMet(times, marks, start)) {
    length++;
    start = addDays(start, -1);
  }
  const first = addDays(start, 1);
  for (let i = WINDOW - 1; i > 0; i--) {
    if (marks.has(addDays(first, -i))) return length + i;
  }
  return length;
}

/**
 * Sequência em dias. Hoje sem marca ainda não quebra nada: o dia só termina à meia-noite. Em dias
 * úteis contam só os dias úteis, e o fim de semana não interrompe.
 */
export function currentStreak(frequency: Frequency, marks: Marks, today: DateString): number {
  if (frequency.type === 'TIMES') {
    const { times } = frequency;
    if (windowMet(times, marks, today)) return windowRunLength(times, marks, today);
    // Uma marca sai da janela por dia, então ontem cumprido significa que falta só a de hoje.
    const yesterday = addDays(today, -1);
    return windowMet(times, marks, yesterday) ? windowRunLength(times, marks, yesterday) : 0;
  }
  let day = today;
  if (!isScheduled(frequency, day) || !marks.has(day)) day = previousScheduled(frequency, day);
  let streak = 0;
  while (marks.has(day)) {
    streak++;
    day = previousScheduled(frequency, day);
  }
  return streak;
}

export function longestStreak(frequency: Frequency, marks: Marks, today: DateString): number {
  const days = [...marks].filter((day) => day <= today).sort();
  if (days.length === 0) return 0;
  let best = 0;
  if (frequency.type === 'TIMES') {
    const { times } = frequency;
    for (let day = days[0]!; day <= today; day = addDays(day, 1)) {
      const next = addDays(day, 1);
      const endsRun = windowMet(times, marks, day) && !(next <= today && windowMet(times, marks, next));
      if (endsRun) best = Math.max(best, windowRunLength(times, marks, day));
    }
    return best;
  }
  let run = 0;
  let previous: DateString | null = null;
  for (const day of days) {
    if (!isScheduled(frequency, day)) continue;
    run = previous && previousScheduled(frequency, day) === previous ? run + 1 : 1;
    previous = day;
    best = Math.max(best, run);
  }
  return best;
}

/** Ainda há o que fazer hoje para cumprir a frequência. */
export function isDue(frequency: Frequency, marks: Marks, today: DateString): boolean {
  if (marks.has(today) || !isScheduled(frequency, today)) return false;
  return frequency.type !== 'TIMES' || !windowMet(frequency.times, marks, today);
}

/** A sequência existe e termina hoje se nada for marcado. */
export function isAtRisk(frequency: Frequency, marks: Marks, today: DateString): boolean {
  return isDue(frequency, marks, today) && currentStreak(frequency, marks, today) > 0;
}

function scheduledBetween(frequency: Frequency, from: DateString, to: DateString) {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) if (isScheduled(frequency, day)) count++;
  return count;
}

function doneBetween(frequency: Frequency, marks: Marks, from: DateString, to: DateString) {
  let count = 0;
  for (const day of marks) {
    if (day >= from && day <= to && isScheduled(frequency, day)) count++;
  }
  return count;
}

function earliest(marks: Marks, start: DateString) {
  let first = start;
  for (const day of marks) if (day < first) first = day;
  return first;
}

export interface Period {
  today: DateString;
  start: DateString;
  end?: DateString | null;
}

/**
 * Taxa de 0 a 1 nos últimos 28 dias, contando desde o começo do hábito. Hoje sem marca fica de fora
 * enquanto o dia não acabou. Sem dia para medir, `null`.
 */
export function completionRate(
  frequency: Frequency,
  marks: Marks,
  { today, start, end }: Period
): number | null {
  const ended = Boolean(end && end < today);
  const lastDay = ended ? end! : today;
  const windowStart = addDays(lastDay, 1 - RATE_DAYS);
  const first = earliest(marks, start);
  const from = first > windowStart ? first : windowStart;
  const to = !ended && !marks.has(today) ? addDays(today, -1) : lastDay;
  if (to < from) return null;
  const expected =
    frequency.type === 'TIMES'
      ? (frequency.times * (diffInDays(from, to) + 1)) / WINDOW
      : scheduledBetween(frequency, from, to);
  if (expected === 0) return null;
  return Math.min(1, doneBetween(frequency, marks, from, to) / expected);
}

/** Quanto do desafio foi cumprido e quanto ele pede, do começo ao prazo. */
export function challengeProgress(
  frequency: Frequency,
  marks: Marks,
  start: DateString,
  end: DateString
): { done: number; target: number } {
  const first = earliest(marks, start);
  const target =
    frequency.type === 'TIMES'
      ? Math.ceil((frequency.times * (diffInDays(first, end) + 1)) / WINDOW)
      : scheduledBetween(frequency, first, end);
  return { done: Math.min(target, doneBetween(frequency, marks, first, end)), target };
}
