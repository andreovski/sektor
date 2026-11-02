import { addDays, dateStringToUtc, diffInDays } from '@sektor/finance-engine';

export type ScheduleKind = 'DAILY' | 'WEEKDAYS' | 'INTERVAL' | 'AS_NEEDED';

export interface Schedule {
  schedule: ScheduleKind;
  weekdays: number[];
  intervalDays: number | null;
  times: string[];
  startDate: string;
  endDate: string | null;
}

export const ADHERENCE_DAYS = 30;

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** Duração do sono em minutos. Dormir depois de acordar no relógio é atravessar a meia-noite. */
export function sleepMinutes(bedTime: string, wakeTime: string) {
  return (toMinutes(wakeTime) - toMinutes(bedTime) + 1440) % 1440;
}

/** Minutos de relógio local desde a época, sem passar por fuso: só servem para comparar. */
export const localMinutes = (date: string, time: string) =>
  dateStringToUtc(date).getTime() / 60_000 + toMinutes(time);

/** 0 é domingo. */
export const weekdayOf = (date: string) => dateStringToUtc(date).getUTCDay();

export const isActiveOn = (s: Schedule, date: string) =>
  date >= s.startDate && (s.endDate === null || date <= s.endDate);

/** Horários das doses do dia. O "a cada X dias" conta a partir do início. */
export function slotsOn(s: Schedule, date: string): string[] {
  if (!isActiveOn(s, date)) return [];
  if (s.schedule === 'DAILY') return s.times;
  if (s.schedule === 'WEEKDAYS') return s.weekdays.includes(weekdayOf(date)) ? s.times : [];
  if (s.schedule === 'INTERVAL') {
    return diffInDays(s.startDate, date) % (s.intervalDays ?? 1) === 0 ? s.times : [];
  }
  return [];
}

export interface Adherence {
  expected: number;
  taken: number;
  percent: number | null;
}

/**
 * Doses tomadas sobre as previstas, por dia, para trocar a hora de um remédio não apagar o passado.
 * Hoje só contam as doses cuja hora já passou, mais as que foram tomadas adiantadas.
 */
export function adherence(
  s: Schedule,
  takenByDate: ReadonlyMap<string, number>,
  from: string,
  today: string,
  nowTime: string
): Adherence {
  let expected = 0;
  let taken = 0;
  for (let date = from; date <= today; date = addDays(date, 1)) {
    const slots = slotsOn(s, date);
    if (slots.length === 0) continue;
    const done = Math.min(takenByDate.get(date) ?? 0, slots.length);
    taken += done;
    expected +=
      date === today ? Math.max(slots.filter((time) => time <= nowTime).length, done) : slots.length;
  }
  return {
    expected,
    taken,
    percent: expected === 0 ? null : Math.round((taken / expected) * 100),
  };
}
