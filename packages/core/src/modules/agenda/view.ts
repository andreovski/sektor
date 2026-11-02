import {
  addDays,
  dateStringInZone,
  dateStringToUtc,
  diffInDays,
  instantToWallTime,
  monthRange,
  parseDateString,
  wallTimeToInstant,
} from '@sektor/finance-engine';

import type { CalendarSource } from './schema';

// A tela não enxerga o motor: o que ela usa dele passa por aqui.
export { addDays, addMonthsClamped, describeRRule, instantToWallTime } from '@sektor/finance-engine';

// Regras da tela, puras e sem Node: a tela importa daqui, e o teste roda junto com o núcleo.

/** Uma ocorrência na agenda. No dia inteiro `startAt`/`endAt` são AAAA-MM-DD, com fim exclusivo. */
export interface EventOccurrence {
  /** Id do evento mestre (ou do evento simples). É o id para editar e apagar. */
  eventId: string;
  /** Início original: o que vai em `occurrenceStart` para mexer só nela. */
  occurrenceStart: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  title: string;
  notes: string | null;
  location: string | null;
  color: string | null;
  rrule: string | null;
  isRecurring: boolean;
  isException: boolean;
  source: CalendarSource;
  calendarId: string;
  reminders: number[];
  projectId?: string | null;
  /** Tarefa com prazo sobreposta à agenda: não é evento, abre em Tarefas. */
  taskId?: string;
}

export const DAY_MINUTES = 24 * 60;

export const dayKey = dateStringInZone;

/** 0 = domingo. */
export const weekdayOf = (key: string) => dateStringToUtc(key).getUTCDay();

export function startOfWeek(key: string, weekStartsOn = 0) {
  return addDays(key, -((weekdayOf(key) - weekStartsOn + 7) % 7));
}

export function dayRange(from: string, count: number) {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

export const weekDays = (key: string, weekStartsOn = 0) =>
  dayRange(startOfWeek(key, weekStartsOn), 7);

/** Semanas (linhas de 7 dias) que cobrem o mês de `key`, com os dias vizinhos nas pontas. */
export function monthGrid(key: string, weekStartsOn = 0): string[][] {
  const { first, last } = monthRange(key.slice(0, 7));
  const weeks: string[][] = [];
  for (let cursor = startOfWeek(first, weekStartsOn); cursor <= last; cursor = addDays(cursor, 7)) {
    weeks.push(dayRange(cursor, 7));
  }
  return weeks;
}

type Span = Pick<EventOccurrence, 'allDay' | 'startAt' | 'endAt'>;

/** Primeiro e último dia (inclusive) que a ocorrência ocupa. */
export function occurrenceSpan(event: Span, timeZone: string): { first: string; last: string } {
  if (event.allDay) {
    const first = event.startAt.slice(0, 10);
    const endExclusive = event.endAt.slice(0, 10);
    return { first, last: endExclusive > first ? addDays(endExclusive, -1) : first };
  }
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const first = dayKey(start, timeZone);
  // Termina à meia-noite em ponto: não ocupa o dia seguinte.
  const last = end > start ? dayKey(new Date(end.getTime() - 1), timeZone) : first;
  return { first, last: last < first ? first : last };
}

/** Dia inteiro primeiro, depois por início e maior duração. */
export function compareOccurrences(a: EventOccurrence, b: EventOccurrence) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  return (
    a.startAt.localeCompare(b.startAt) ||
    b.endAt.localeCompare(a.endAt) ||
    a.title.localeCompare(b.title, 'pt-BR')
  );
}

export function eventsByDay(events: EventOccurrence[], days: string[], timeZone: string) {
  const map = new Map<string, EventOccurrence[]>(days.map((day) => [day, []]));
  const from = days[0];
  const to = days[days.length - 1];
  if (!from || !to) return map;
  for (const event of events) {
    const span = occurrenceSpan(event, timeZone);
    const first = span.first < from ? from : span.first;
    const last = span.last > to ? to : span.last;
    for (let day = first; day <= last; day = addDays(day, 1)) map.get(day)?.push(event);
  }
  for (const list of map.values()) list.sort(compareOccurrences);
  return map;
}

/** Trecho da ocorrência com hora dentro do dia, em minutos do relógio (0–1440). */
export function segmentOnDay(
  event: Pick<EventOccurrence, 'startAt' | 'endAt'>,
  key: string,
  timeZone: string
): { start: number; end: number } {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const minutesOf = (instant: Date) => {
    const wall = instantToWallTime(instant, timeZone);
    return wall.hour * 60 + wall.minute;
  };
  const startMin = dayKey(start, timeZone) < key ? 0 : minutesOf(start);
  const endMin = dayKey(end, timeZone) > key ? DAY_MINUTES : minutesOf(end);
  return { start: startMin, end: Math.max(startMin, endMin) };
}

/** Evento com hora que ocupa o dia todo (vem de antes e segue depois): vai para a faixa de cima. */
export function coversWholeDay(event: Span, key: string, timeZone: string) {
  if (event.allDay) return true;
  const { start, end } = segmentOnDay(event, key, timeZone);
  return start === 0 && end === DAY_MINUTES && occurrenceSpan(event, timeZone).first < key;
}

// ---------------------------------------------------------------- blocos lado a lado

export interface TimedItem {
  id: string;
  start: number;
  end: number;
}

export interface PlacedItem extends TimedItem {
  column: number;
  columns: number;
  /** Quantas colunas o bloco ocupa (cresce para a direita quando ali está livre). */
  span: number;
}

/**
 * Eventos que se sobrepõem, direta ou indiretamente, formam um grupo e dividem a largura.
 * `minDuration` é a altura mínima do bloco na tela: é esse espaço que conta para a sobreposição.
 */
export function layoutColumns(items: TimedItem[], minDuration = 20): PlacedItem[] {
  const sorted = items
    .map((item) => ({ ...item, visualEnd: Math.max(item.end, item.start + minDuration) }))
    .sort((a, b) => a.start - b.start || b.visualEnd - a.visualEnd || a.id.localeCompare(b.id));

  const result: PlacedItem[] = [];
  let cluster: (typeof sorted)[number][] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;
  const columnOf = new Map<string, number>();

  const flush = () => {
    const columns = columnEnds.length;
    for (const item of cluster) {
      const column = columnOf.get(item.id)!;
      let span = 1;
      for (let next = column + 1; next < columns; next++) {
        const blocked = cluster.some(
          (other) =>
            columnOf.get(other.id) === next &&
            other.start < item.visualEnd &&
            item.start < other.visualEnd
        );
        if (blocked) break;
        span++;
      }
      result.push({ id: item.id, start: item.start, end: item.end, column, columns, span });
    }
    cluster = [];
    columnEnds = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length) flush();
    let column = columnEnds.findIndex((end) => end <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.visualEnd);
    } else {
      columnEnds[column] = item.visualEnd;
    }
    columnOf.set(item.id, column);
    cluster.push(item);
    clusterEnd = cluster.length === 1 ? item.visualEnd : Math.max(clusterEnd, item.visualEnd);
  }
  if (cluster.length) flush();

  return result;
}

// ---------------------------------------------------------------- tarefas com prazo

export interface TaskDue {
  id: string;
  title: string;
  dueDate: string;
  /** "HH:MM"; sem hora, a tarefa vale pelo dia. */
  dueTime: string | null;
  done: boolean;
}

const TASK_MINUTES = 30;

/** Lê o que importa de uma tarefa do módulo de Tarefas. Sem prazo, devolve null. */
export function readTaskDue(raw: unknown): TaskDue | null {
  if (!raw || typeof raw !== 'object') return null;
  const task = raw as Record<string, unknown>;
  if (typeof task.id !== 'string' || typeof task.dueDate !== 'string') return null;
  return {
    id: task.id,
    title: typeof task.title === 'string' ? task.title : 'Tarefa',
    dueDate: task.dueDate,
    dueTime: typeof task.dueTime === 'string' ? task.dueTime.slice(0, 5) : null,
    done: Boolean(task.completedAt) || task.status === 'DONE',
  };
}

/** "HH:MM" do dia, no fuso, como instante. */
export function wallInstant(date: string, time: string, timeZone: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return wallTimeToInstant({ ...parseDateString(date), hour, minute }, timeZone);
}

export function taskOccurrence(task: TaskDue, timeZone: string): EventOccurrence {
  const base = {
    eventId: `task:${task.id}`,
    taskId: task.id,
    title: task.title,
    notes: null,
    location: null,
    color: 'amber',
    rrule: null,
    isRecurring: false,
    isException: false,
    source: 'LOCAL' as const,
    calendarId: '',
    reminders: [],
  };
  if (!task.dueTime) {
    return {
      ...base,
      allDay: true,
      occurrenceStart: task.dueDate,
      startAt: task.dueDate,
      endAt: addDays(task.dueDate, 1),
    };
  }
  const start = wallInstant(task.dueDate, task.dueTime, timeZone);
  return {
    ...base,
    allDay: false,
    occurrenceStart: start.toISOString(),
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + TASK_MINUTES * 60_000).toISOString(),
  };
}

/** Só as abertas com prazo dentro de [from, to). */
export function tasksInRange(raw: unknown, from: string, to: string, timeZone: string) {
  return (Array.isArray(raw) ? raw : [])
    .map(readTaskDue)
    .filter((t): t is TaskDue => !!t && !t.done && t.dueDate >= from && t.dueDate < to)
    .map((task) => taskOccurrence(task, timeZone));
}

// ---------------------------------------------------------------- textos

const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC', ...options });
const WEEKDAY_SHORT = fmt({ weekday: 'short' });
const LONG_DAY = fmt({ weekday: 'long', day: 'numeric', month: 'long' });
const SHORT_DAY = fmt({ day: 'numeric', month: 'short' });
const MONTH = fmt({ month: 'long', year: 'numeric' });

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const at = (key: string) => dateStringToUtc(key);

export const weekdayShort = (key: string) => WEEKDAY_SHORT.format(at(key)).replace('.', '');
export const longDay = (key: string) => LONG_DAY.format(at(key));
export const shortDay = (key: string) => SHORT_DAY.format(at(key)).replace(' de', '').replace('.', '');
export const monthTitle = (key: string) => capitalize(MONTH.format(at(`${key.slice(0, 7)}-01`)));

export function timeOf(iso: string, timeZone: string) {
  const wall = instantToWallTime(new Date(iso), timeZone);
  return `${String(wall.hour).padStart(2, '0')}:${String(wall.minute).padStart(2, '0')}`;
}

export const timeRange = (startAt: string, endAt: string, timeZone: string) =>
  `${timeOf(startAt, timeZone)} – ${timeOf(endAt, timeZone)}`;

export function durationText(startAt: string, endAt: string) {
  const minutes = Math.round((new Date(endAt).getTime() - new Date(startAt).getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest}` : `${minutes / 60} h`;
}

/** As duas linhas de data do detalhe do evento. */
export function whenLines(event: EventOccurrence, timeZone: string): [string, string] {
  const { first, last } = occurrenceSpan(event, timeZone);
  const year = (key: string) => key.slice(0, 4);
  const full = (key: string) => capitalize(`${longDay(key)} de ${year(key)}`);
  if (event.allDay) {
    if (first === last) return [full(first), 'Dia inteiro'];
    return [`De ${shortDay(first)} até ${shortDay(last)} de ${year(last)}`, 'Dia inteiro'];
  }
  const length = durationText(event.startAt, event.endAt);
  if (first === last) {
    return [full(first), `${timeRange(event.startAt, event.endAt, timeZone)} · ${length}`];
  }
  return [
    `De ${shortDay(first)}, ${timeOf(event.startAt, timeZone)}`,
    `até ${shortDay(last)}, ${timeOf(event.endAt, timeZone)} · ${length}`,
  ];
}

/** "Hoje · sábado, 18 de outubro"; outros dias só a data por extenso. */
export function listDayTitle(day: string, today: string) {
  const distance = diffInDays(today, day);
  const relative = { 0: 'Hoje', 1: 'Amanhã', [-1]: 'Ontem' }[distance];
  const long = longDay(day) + (day.slice(0, 4) !== today.slice(0, 4) ? ` de ${day.slice(0, 4)}` : '');
  return relative ? `${relative} · ${long}` : capitalize(long);
}

export const occurrenceKey = (event: Pick<EventOccurrence, 'eventId' | 'occurrenceStart'>) =>
  `${event.eventId}:${event.occurrenceStart}`;
