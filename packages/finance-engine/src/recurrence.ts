import { RRule, rrulestr } from 'rrule';

import {
  type DateString,
  dateStringToUtc,
  instantToWallTime,
  utcToDateString,
  wallTimeToInstant,
} from './dates';

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** O que a tela de recorrência edita. A regra completa (RFC 5545) é gerada a partir disto. */
export interface SimpleRecurrence {
  freq: Frequency;
  interval?: number;
  /** Dias da semana, 0 = domingo. Só em WEEKLY. */
  byWeekday?: number[];
  /** Termina depois de N ocorrências. */
  count?: number;
  /** Termina neste dia (inclusive). */
  until?: DateString;
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export function buildRRule(recurrence: SimpleRecurrence): string {
  const parts = [`FREQ=${recurrence.freq}`];
  if (recurrence.interval && recurrence.interval > 1) parts.push(`INTERVAL=${recurrence.interval}`);
  if (recurrence.freq === 'WEEKLY' && recurrence.byWeekday?.length) {
    const days = [...new Set(recurrence.byWeekday)].sort((a, b) => a - b);
    parts.push(`BYDAY=${days.map((d) => WEEKDAY_CODES[d]).join(',')}`);
  }
  if (recurrence.count) parts.push(`COUNT=${recurrence.count}`);
  else if (recurrence.until) parts.push(`UNTIL=${recurrence.until.replace(/-/g, '')}T235959Z`);
  return parts.join(';');
}

export function parseSimpleRRule(rrule: string): SimpleRecurrence | null {
  const fields = Object.fromEntries(
    rrule
      .replace(/^RRULE:/, '')
      .split(';')
      .map((part) => part.split('=') as [string, string])
  );
  const freq = fields.FREQ as Frequency | undefined;
  if (!freq || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null;

  const result: SimpleRecurrence = { freq };
  if (fields.INTERVAL) result.interval = Number(fields.INTERVAL);
  if (fields.BYDAY) {
    const days = fields.BYDAY.split(',').map((code) =>
      WEEKDAY_CODES.indexOf(code.replace(/^[+-]?\d+/, '') as (typeof WEEKDAY_CODES)[number])
    );
    if (days.some((d) => d < 0)) return null;
    result.byWeekday = days;
  }
  if (fields.COUNT) result.count = Number(fields.COUNT);
  if (fields.UNTIL) {
    const u = fields.UNTIL;
    result.until = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`;
  }
  return result;
}

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const UNIT = {
  DAILY: ['Todo dia', 'dias'],
  WEEKLY: ['Toda semana', 'semanas'],
  MONTHLY: ['Todo mês', 'meses'],
  YEARLY: ['Todo ano', 'anos'],
} as const;

/** "Toda semana: segunda, quarta", "A cada 2 meses, 10 vezes". */
export function describeRRule(rrule: string): string {
  const parsed = parseSimpleRRule(rrule);
  if (!parsed) return 'Recorrência personalizada';

  const [every, plural] = UNIT[parsed.freq];
  let text = parsed.interval && parsed.interval > 1 ? `A cada ${parsed.interval} ${plural}` : every;
  if (parsed.byWeekday?.length)
    text += `: ${parsed.byWeekday.map((d) => WEEKDAY_NAMES[d]).join(', ')}`;
  if (parsed.count) text += `, ${parsed.count} vezes`;
  else if (parsed.until) {
    const [y, m, d] = parsed.until.split('-');
    text += `, até ${d}/${m}/${y}`;
  }
  return text;
}

/**
 * O RRULE pula os meses sem o dia (dia 31 só cai em 7 meses). Aqui a série vale todo mês: fica no
 * último dia dos meses curtos e volta ao dia original, porque a âncora é sempre o início da série.
 * Regra que já escolhe o dia (`BYDAY`, `BYMONTHDAY`...) fica como veio.
 */
function clampedToMonthEnd(rrule: string, dtstart: Date): string {
  if (rrule.includes('\n') || /(^|;)BY[A-Z]+=/.test(rrule)) return rrule;
  const day = dtstart.getUTCDate();
  if (day < 29) return rrule;
  const lastDays = Array.from({ length: day - 27 }, (_, i) => 28 + i).join(',');
  if (/(^|;)FREQ=MONTHLY(;|$)/.test(rrule)) {
    return `${rrule};BYMONTHDAY=${lastDays};BYSETPOS=-1`;
  }
  // No ano, só 29/02 falta.
  if (/(^|;)FREQ=YEARLY(;|$)/.test(rrule) && dtstart.getUTCMonth() === 1) {
    return `${rrule};BYMONTH=2;BYMONTHDAY=${lastDays};BYSETPOS=-1`;
  }
  return rrule;
}

function ruleFrom(rrule: string, dtstart: Date): RRule {
  const text = clampedToMonthEnd(rrule.replace(/^RRULE:/, ''), dtstart);
  return rrulestr(text, { dtstart }) as RRule;
}

/**
 * Datas (AAAA-MM-DD) de uma recorrência de lançamento entre `from` e `to`, inclusive.
 * O dia de início é a primeira ocorrência quando cai na regra.
 */
export function dateOccurrences(
  rrule: string,
  startDate: DateString,
  from: DateString,
  to: DateString
): DateString[] {
  const rule = ruleFrom(rrule, dateStringToUtc(startDate));
  return rule
    .between(dateStringToUtc(from), dateStringToUtc(to), true)
    .map((date) => utcToDateString(date));
}

/**
 * Inícios das ocorrências de um evento no intervalo [from, to), no relógio de parede do fuso: um
 * evento às 9h continua às 9h depois de uma mudança de horário de verão.
 * `durationMs` entra para pegar ocorrências que começaram antes de `from` e ainda estão rolando.
 */
export function eventOccurrences(
  rrule: string,
  dtstart: Date,
  from: Date,
  to: Date,
  timeZone: string,
  durationMs = 0
): Date[] {
  const wall = instantToWallTime(dtstart, timeZone);
  const floatingStart = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second ?? 0)
  );
  const rule = ruleFrom(rrule, floatingStart);

  // Janela alargada em 2 dias para cobrir qualquer fuso; o filtro exato vem depois.
  const pad = 2 * 86_400_000;
  const candidates = rule.between(
    new Date(from.getTime() - durationMs - pad),
    new Date(to.getTime() + pad),
    true
  );

  return candidates
    .map((floating) =>
      wallTimeToInstant(
        {
          year: floating.getUTCFullYear(),
          month: floating.getUTCMonth() + 1,
          day: floating.getUTCDate(),
          hour: floating.getUTCHours(),
          minute: floating.getUTCMinutes(),
          second: floating.getUTCSeconds(),
        },
        timeZone
      )
    )
    .filter(
      (start) =>
        start.getTime() < to.getTime() &&
        (durationMs > 0
          ? start.getTime() + durationMs > from.getTime()
          : start.getTime() >= from.getTime())
    );
}

/** Próxima ocorrência a partir de `after` (exclusivo), ou null quando a série acabou. */
export function nextEventOccurrence(
  rrule: string,
  dtstart: Date,
  after: Date,
  timeZone: string
): Date | null {
  const horizon = new Date(after.getTime() + 3 * 366 * 86_400_000);
  const next = eventOccurrences(rrule, dtstart, after, horizon, timeZone).find(
    (start) => start.getTime() > after.getTime()
  );
  return next ?? null;
}
