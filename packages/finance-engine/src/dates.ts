// Datas "de calendário" (AAAA-MM-DD) como strings: comparam por ordem alfabética e não carregam
// fuso, que é como a pessoa pensa num vencimento. Contas em UTC para não escorregar um dia.

export type DateString = string;

export function parseDateString(value: DateString): { year: number; month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Data inválida: ${value}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

export function toDateString(year: number, month: number, day: number): DateString {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dateStringToUtc(value: DateString): Date {
  const { year, month, day } = parseDateString(value);
  return new Date(Date.UTC(year, month - 1, day));
}

export function utcToDateString(date: Date): DateString {
  return date.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(value: DateString, days: number): DateString {
  const date = dateStringToUtc(value);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToDateString(date);
}

/** Soma meses mantendo o dia, ou o último dia do mês quando ele não existe (31/01 + 1 = 28/02). */
export function addMonthsClamped(
  value: DateString,
  months: number,
  anchorDay?: number
): DateString {
  const { year, month, day } = parseDateString(value);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return toDateString(y, m, Math.min(anchorDay ?? day, daysInMonth(y, m)));
}

export function diffInDays(from: DateString, to: DateString): number {
  return Math.round((dateStringToUtc(to).getTime() - dateStringToUtc(from).getTime()) / 86_400_000);
}

/** "2026-10" → { first: "2026-10-01", last: "2026-10-31" }. */
export function monthRange(month: string): { first: DateString; last: DateString } {
  const [year, m] = month.split('-').map(Number);
  return { first: toDateString(year, m, 1), last: toDateString(year, m, daysInMonth(year, m)) };
}

export function monthOf(value: DateString): string {
  return value.slice(0, 7);
}

export function addMonthsToMonth(month: string, months: number): string {
  return monthOf(addMonthsClamped(`${month}-01`, months));
}

// ------------------------------------------------------------------ fusos

/** Diferença (ms) entre o relógio de parede no fuso e UTC, no instante dado. */
export function timezoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

export interface WallTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second?: number;
}

/** Relógio de parede no fuso → instante. Resolve horário de verão com duas passadas. */
export function wallTimeToInstant(wall: WallTime, timeZone: string): Date {
  const guess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second ?? 0
  );
  let instant = guess - timezoneOffsetMs(new Date(guess), timeZone);
  instant = guess - timezoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant);
}

export function instantToWallTime(instant: Date, timeZone: string): WallTime {
  const shifted = new Date(instant.getTime() + timezoneOffsetMs(instant, timeZone));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

/** Dia de calendário do instante no fuso. */
export function dateStringInZone(instant: Date, timeZone: string): DateString {
  const wall = instantToWallTime(instant, timeZone);
  return toDateString(wall.year, wall.month, wall.day);
}

/** Meia-noite do dia no fuso, como instante. */
export function startOfDayInZone(value: DateString, timeZone: string): Date {
  const { year, month, day } = parseDateString(value);
  return wallTimeToInstant({ year, month, day, hour: 0, minute: 0 }, timeZone);
}
