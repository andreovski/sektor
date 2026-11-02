import {
  eventOccurrences,
  instantToWallTime,
  type WallTime,
  wallTimeToInstant,
} from '@sektor/finance-engine';

import { WINDOWS_ZONES } from './windows-zones';

// Leitura de um iCalendar (RFC 5545) publicado, como o link ICS do Outlook. Funções puras: o
// arquivo entra como texto e sai a lista de ocorrências numa janela de datas, já expandidas (cada
// ocorrência vira um evento simples, só de leitura).

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Component {
  name: string;
  props: Prop[];
  children: Component[];
}

/** Um fuso: IANA (com horário de verão) ou deslocamento fixo em minutos. */
type Zone = { iana: string } | { offsetMinutes: number };

/** Uma ocorrência pronta para virar evento. `key` é estável entre leituras do mesmo arquivo. */
export interface IcsOccurrence {
  key: string;
  title: string;
  description: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date;
  allDay: boolean;
}

export interface IcsCalendar {
  /** X-WR-CALNAME, quando o arquivo tem. */
  name: string | null;
  occurrences: IcsOccurrence[];
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MAX_TEXT = 8000;

// ---------------------------------------------------------------- linhas e componentes

/** Desdobra as linhas (continuação começa com espaço ou tab) e separa nome, parâmetros e valor. */
function parseLines(text: string): Prop[] {
  const raw = text.replace(/\r\n?/g, '\n').split('\n');
  const lines: string[] = [];
  for (const line of raw) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else if (line.trim()) {
      lines.push(line);
    }
  }

  const props: Prop[] = [];
  for (const line of lines) {
    // O valor começa no primeiro ":" fora de aspas.
    let quoted = false;
    let colon = -1;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') quoted = !quoted;
      else if (char === ':' && !quoted) {
        colon = i;
        break;
      }
    }
    if (colon < 0) continue;
    const head = line.slice(0, colon);
    const value = line.slice(colon + 1);

    const parts: string[] = [];
    let current = '';
    quoted = false;
    for (const char of head) {
      if (char === '"') quoted = !quoted;
      if (char === ';' && !quoted) {
        parts.push(current);
        current = '';
      } else current += char;
    }
    parts.push(current);

    const params: Record<string, string> = {};
    for (const part of parts.slice(1)) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, '');
    }
    props.push({ name: parts[0].toUpperCase(), params, value });
  }
  return props;
}

function parseComponents(text: string): Component {
  const root: Component = { name: 'ROOT', props: [], children: [] };
  const stack = [root];
  for (const prop of parseLines(text)) {
    const top = stack[stack.length - 1];
    if (prop.name === 'BEGIN') {
      const child: Component = { name: prop.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(child);
      stack.push(child);
    } else if (prop.name === 'END') {
      if (stack.length > 1) stack.pop();
    } else {
      top.props.push(prop);
    }
  }
  return root;
}

const first = (component: Component, name: string) => component.props.find((p) => p.name === name);
const all = (component: Component, name: string) => component.props.filter((p) => p.name === name);

function unescapeText(value: string) {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char
  );
}

function textOf(component: Component, name: string): string | null {
  const prop = first(component, name);
  if (!prop) return null;
  const value = unescapeText(prop.value).trim();
  return value ? value.slice(0, MAX_TEXT) : null;
}

// ---------------------------------------------------------------- fusos

function isIana(name: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

const WINDOWS_ZONES_LOWER = new Map(
  Object.entries(WINDOWS_ZONES).map(([name, iana]) => [name.toLowerCase(), iana])
);

/** "-0300" -> -180. */
function parseOffset(value: string | undefined): number | null {
  const match = /^([+-])(\d{2})(\d{2})/.exec(value?.trim() ?? '');
  if (!match) return null;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/**
 * Resolve um TZID: nome IANA, nome do Windows (o Outlook escreve "E. South America Standard
 * Time"), "tzone://Microsoft/Utc", ou, por fim, o VTIMEZONE do próprio arquivo quando ele tem um
 * deslocamento só. Sem saída, vale o fuso padrão (o do calendário ou o da pessoa).
 */
export function resolveZone(
  tzid: string | undefined,
  timezones: Map<string, Component>,
  fallback: Zone
): Zone {
  if (!tzid) return fallback;
  const name = tzid.trim().replace(/^"|"$/g, '');
  if (/utc$|^gmt$|^z$/i.test(name) && !name.includes(' ')) return { iana: 'UTC' };
  if (/^tzone:\/\/microsoft\/utc$/i.test(name)) return { iana: 'UTC' };
  // "/mozilla.org/20050126_1/America/Sao_Paulo" e parecidos.
  const tail = name.match(/([A-Za-z_]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?)$/)?.[1];
  for (const candidate of [name, tail]) {
    if (candidate && candidate.includes('/') && isIana(candidate)) return { iana: candidate };
  }
  const windows = WINDOWS_ZONES[name] ?? WINDOWS_ZONES_LOWER.get(name.toLowerCase());
  if (windows) return { iana: windows };
  if (isIana(name)) return { iana: name };

  const vtimezone = timezones.get(name);
  if (vtimezone) {
    const location = first(vtimezone, 'X-LIC-LOCATION')?.value.trim();
    if (location && isIana(location)) return { iana: location };
    const offsets = new Set(
      vtimezone.children
        .filter((c) => c.name === 'STANDARD' || c.name === 'DAYLIGHT')
        .map((c) => parseOffset(first(c, 'TZOFFSETTO')?.value))
        .filter((o): o is number => o !== null)
    );
    if (offsets.size === 1) return { offsetMinutes: [...offsets][0] };
  }
  return fallback;
}

function toInstant(wall: WallTime, zone: Zone): Date {
  if ('iana' in zone) return wallTimeToInstant(wall, zone.iana);
  return new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second ?? 0) -
      zone.offsetMinutes * 60_000
  );
}

function toWall(instant: Date, zone: Zone): WallTime {
  if ('iana' in zone) return instantToWallTime(instant, zone.iana);
  const shifted = new Date(instant.getTime() + zone.offsetMinutes * 60_000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
  };
}

// ---------------------------------------------------------------- datas

/** Data ou data-hora do arquivo: o relógio de parede e onde ele está. */
interface IcsTime {
  wall: WallTime;
  /** Só data (dia inteiro). */
  date: boolean;
  /** Em UTC ("Z" no fim). */
  utc: boolean;
  zone: Zone;
}

function parseTimeValue(value: string, params: Record<string, string>, context: TimeContext) {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/i.exec(value.trim());
  if (!match) return null;
  const wall: WallTime = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4] ?? 0),
    minute: Number(match[5] ?? 0),
    second: Number(match[6] ?? 0),
  };
  const date = !match[4] || params.VALUE?.toUpperCase() === 'DATE';
  const utc = Boolean(match[7]);
  const zone: Zone = utc
    ? { iana: 'UTC' }
    : resolveZone(params.TZID, context.timezones, context.defaultZone);
  return { wall, date, utc, zone } satisfies IcsTime;
}

interface TimeContext {
  timezones: Map<string, Component>;
  defaultZone: Zone;
}

function parseTime(prop: Prop | undefined, context: TimeContext): IcsTime | null {
  if (!prop) return null;
  return parseTimeValue(prop.value.split(',')[0], prop.params, context);
}

/** Dia inteiro mora em meia-noite UTC, como guardamos. */
const dateInstant = (wall: WallTime) => new Date(Date.UTC(wall.year, wall.month - 1, wall.day));

function instantOf(time: IcsTime, allDay: boolean): Date {
  return allDay ? dateInstant(time.wall) : toInstant(time.wall, time.zone);
}

/** "PT1H30M", "P1D", "-PT15M" -> ms. */
export function parseDuration(value: string | undefined): number | null {
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i.exec(
    value?.trim() ?? ''
  );
  if (!match) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const ms =
    Number(weeks ?? 0) * 7 * DAY +
    Number(days ?? 0) * DAY +
    Number(hours ?? 0) * HOUR +
    Number(minutes ?? 0) * 60_000 +
    Number(seconds ?? 0) * 1000;
  return sign === '-' ? -ms : ms;
}

// ---------------------------------------------------------------- recorrência

const floating = (wall: WallTime) =>
  new Date(Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second ?? 0));

const fromFloating = (date: Date): WallTime => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
  hour: date.getUTCHours(),
  minute: date.getUTCMinutes(),
  second: date.getUTCSeconds(),
});

const pad = (n: number, size = 2) => String(n).padStart(size, '0');
const floatingStamp = (wall: WallTime) =>
  `${pad(wall.year, 4)}${pad(wall.month)}${pad(wall.day)}T${pad(wall.hour)}${pad(wall.minute)}${pad(wall.second ?? 0)}Z`;

/**
 * A regra corre no relógio de parede do evento (uma reunião às 9h segue às 9h depois do horário de
 * verão), com as datas "flutuantes" disfarçadas de UTC. O UNTIL em UTC vira relógio de parede.
 */
function floatingRule(rrule: string, start: IcsTime, allDay: boolean): string {
  return rrule
    .replace(/^RRULE:/i, '')
    .split(';')
    .filter(Boolean)
    .map((part) => {
      const [key = '', value = ''] = part.split('=');
      if (key.toUpperCase() !== 'UNTIL') return part;
      const until = parseTimeValue(value, {}, { timezones: new Map(), defaultZone: start.zone });
      if (!until) return part;
      if (allDay || until.date) {
        // Até o fim do dia indicado.
        return `UNTIL=${floatingStamp({ ...until.wall, hour: 23, minute: 59, second: 59 })}`;
      }
      const wall = until.utc ? toWall(toInstant(until.wall, until.zone), start.zone) : until.wall;
      return `UNTIL=${floatingStamp(wall)}`;
    })
    .join(';');
}

/** Regra de horas, minutos ou segundos daria milhões de datas: fica só a primeira ocorrência. */
const TOO_DENSE = /FREQ=(SECONDLY|MINUTELY|HOURLY)/i;

function expandFloating(rule: string, start: Date, from: Date, to: Date): Date[] | null {
  if (TOO_DENSE.test(rule)) return null;
  try {
    return eventOccurrences(rule, start, from, to, 'UTC').slice(0, MAX_PER_SERIES);
  } catch {
    return null;
  }
}

/** Instantes (ou dias, no dia inteiro) de EXDATE/RDATE de um evento. */
function dateList(component: Component, name: string, context: TimeContext, allDay: boolean) {
  const result: Date[] = [];
  for (const prop of all(component, name)) {
    for (const value of prop.value.split(',')) {
      const time = parseTimeValue(value, prop.params, context);
      if (time) result.push(instantOf(time, allDay));
    }
  }
  return result;
}

// ---------------------------------------------------------------- eventos

/** O Outlook às vezes manda dia inteiro como meia-noite a meia-noite com esta marca. */
function isAllDay(event: Component, start: IcsTime, end: IcsTime | null) {
  if (start.date) return true;
  const flag = first(event, 'X-MICROSOFT-CDO-ALLDAYEVENT')?.value.trim().toUpperCase();
  const midnight = (t: IcsTime) => !t.wall.hour && !t.wall.minute && !t.wall.second;
  return flag === 'TRUE' && midnight(start) && (!end || midnight(end));
}

interface Base {
  title: string;
  description: string | null;
  location: string | null;
}

/** Título, notas e local; a exceção sem um campo herda o da série. */
function baseOf(event: Component, master?: Component): Base {
  const text = (name: string) =>
    textOf(event, name) ?? (master && !first(event, name) ? textOf(master, name) : null);
  return {
    title: text('SUMMARY') ?? '(sem título)',
    description: text('DESCRIPTION'),
    location: text('LOCATION'),
  };
}

const cancelled = (event: Component) =>
  first(event, 'STATUS')?.value.trim().toUpperCase() === 'CANCELLED';

/** Início, fim e dia inteiro de um VEVENT (fim padrão: 1 dia no dia inteiro, 1 h no resto). */
function timesOf(event: Component, context: TimeContext) {
  const start = parseTime(first(event, 'DTSTART'), context);
  if (!start) return null;
  const end = parseTime(first(event, 'DTEND'), context);
  const allDay = isAllDay(event, start, end);
  const startAt = instantOf(start, allDay);
  let duration: number | null = end ? instantOf(end, allDay).getTime() - startAt.getTime() : null;
  if (duration === null) duration = parseDuration(first(event, 'DURATION')?.value);
  if (duration === null || duration <= 0) duration = allDay ? DAY : HOUR;
  if (allDay) duration = Math.max(DAY, Math.round(duration / DAY) * DAY);
  return { start, startAt, duration, allDay };
}

/** Teto de ocorrências por série (uma regra diária de anos não pode travar a leitura). */
const MAX_PER_SERIES = 2000;

export function parseIcs(
  text: string,
  options: { from: Date; to: Date; defaultTimeZone: string }
): IcsCalendar {
  const root = parseComponents(text);
  const calendar = root.children.find((c) => c.name === 'VCALENDAR') ?? root;
  const timezones = new Map(
    calendar.children
      .filter((c) => c.name === 'VTIMEZONE')
      .map((c) => [first(c, 'TZID')?.value.trim() ?? '', c] as const)
  );
  const calendarZone = first(calendar, 'X-WR-TIMEZONE')?.value.trim();
  const context: TimeContext = {
    timezones,
    defaultZone: resolveZone(calendarZone, timezones, {
      iana: isIana(options.defaultTimeZone) ? options.defaultTimeZone : 'UTC',
    }),
  };
  const { from, to } = options;
  const inWindow = (start: Date, end: Date) => start < to && end > from;

  const events = calendar.children.filter((c) => c.name === 'VEVENT');
  const byUid = new Map<string, { master?: Component; overrides: Component[] }>();
  let anonymous = 0;
  for (const event of events) {
    const uid = first(event, 'UID')?.value.trim() || `sem-uid-${anonymous++}`;
    const entry = byUid.get(uid) ?? { overrides: [] };
    if (first(event, 'RECURRENCE-ID')) entry.overrides.push(event);
    else if (!entry.master) entry.master = event;
    byUid.set(uid, entry);
  }

  const occurrences = new Map<string, IcsOccurrence>();
  const push = (occurrence: IcsOccurrence) => {
    if (!occurrences.has(occurrence.key)) occurrences.set(occurrence.key, occurrence);
  };
  const keyOf = (uid: string, original: Date, allDay: boolean) =>
    `${uid}@${allDay ? original.toISOString().slice(0, 10) : original.toISOString()}`;

  for (const [uid, { master, overrides }] of byUid) {
    // Exceções: cada uma troca (ou cancela) a ocorrência do RECURRENCE-ID.
    const replaced = new Set<number>();
    for (const override of overrides) {
      const recurrenceId = parseTime(first(override, 'RECURRENCE-ID'), context);
      const times = timesOf(override, context);
      if (!recurrenceId || !times) continue;
      const original = instantOf(recurrenceId, times.allDay || recurrenceId.date);
      replaced.add(original.getTime());
      if (cancelled(override)) continue;
      const endAt = new Date(times.startAt.getTime() + times.duration);
      if (!inWindow(times.startAt, endAt)) continue;
      push({
        key: keyOf(uid, original, times.allDay),
        ...baseOf(override, master),
        startAt: times.startAt,
        endAt,
        allDay: times.allDay,
      });
    }

    if (!master || cancelled(master)) continue;
    const times = timesOf(master, context);
    if (!times) continue;
    const base = baseOf(master);
    const rrule = first(master, 'RRULE')?.value;

    if (!rrule) {
      const endAt = new Date(times.startAt.getTime() + times.duration);
      if (inWindow(times.startAt, endAt) && !replaced.has(times.startAt.getTime())) {
        push({ key: uid, ...base, startAt: times.startAt, endAt, allDay: times.allDay });
      }
      continue;
    }

    const rule = floatingRule(rrule, times.start, times.allDay);
    const excluded = new Set(
      dateList(master, 'EXDATE', context, times.allDay).map((d) => d.getTime())
    );
    const zone = times.start.zone;
    const toStart = (date: Date) =>
      times.allDay
        ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
        : toInstant(fromFloating(date), zone);

    // Janela em relógio de parede, alargada em 2 dias para cobrir qualquer fuso.
    const margin = 2 * DAY;
    const floatingStart = floating(
      times.allDay ? { ...times.start.wall, hour: 0, minute: 0, second: 0 } : times.start.wall
    );
    const expanded = expandFloating(
      rule,
      floatingStart,
      new Date(from.getTime() - times.duration - margin),
      new Date(to.getTime() + margin)
    );
    const starts = expanded ? expanded.map(toStart) : [times.startAt];
    for (const extra of dateList(master, 'RDATE', context, times.allDay)) starts.push(extra);

    for (const start of starts) {
      const time = start.getTime();
      if (excluded.has(time) || replaced.has(time)) continue;
      const endAt = new Date(time + times.duration);
      if (!inWindow(start, endAt)) continue;
      push({
        key: keyOf(uid, start, times.allDay),
        ...base,
        startAt: start,
        endAt,
        allDay: times.allDay,
      });
    }
  }

  return {
    name: textOf(calendar, 'X-WR-CALNAME'),
    occurrences: [...occurrences.values()].sort(
      (a, b) => a.startAt.getTime() - b.startAt.getTime()
    ),
  };
}

/** O texto parece um iCalendar? (para recusar uma página de login colada no lugar do link) */
export function looksLikeIcs(text: string) {
  return /^\s*BEGIN:VCALENDAR/i.test(text.replace(/^\uFEFF/, ''));
}
