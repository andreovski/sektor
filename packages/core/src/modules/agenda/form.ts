import {
  addDays,
  buildRRule,
  dateStringToUtc,
  diffInDays,
  instantToWallTime,
  parseSimpleRRule,
  type SimpleRecurrence,
  toDateString,
} from '@sektor/finance-engine';

import { type EventOccurrence, wallInstant, weekdayOf } from './view';

export type RepeatKind =
  | 'never'
  | 'daily'
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'yearly'
  | 'custom';

export const REPEAT_OPTIONS: { value: Exclude<RepeatKind, 'custom'>; label: string }[] = [
  { value: 'never', label: 'Nunca' },
  { value: 'daily', label: 'Todos os dias' },
  { value: 'weekly', label: 'Todas as semanas' },
  { value: 'biweekly', label: 'A cada 2 semanas' },
  { value: 'monthly', label: 'Todos os meses' },
  { value: 'yearly', label: 'Todos os anos' },
];

export const ALERT_OPTIONS = [0, 5, 10, 15, 30, 60, 120, 1440, 2880];

export function alertLabel(minutes: number) {
  if (minutes === 0) return 'Na hora do evento';
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? '1 dia antes' : `${days} dias antes`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? '1 hora antes' : `${hours} horas antes`;
  }
  return minutes === 1 ? '1 minuto antes' : `${minutes} minutos antes`;
}

export interface EventForm {
  title: string;
  location: string;
  notes: string;
  allDay: boolean;
  startDate: string;
  startTime: string;
  /** No dia inteiro, o último dia (inclusive). */
  endDate: string;
  endTime: string;
  repeat: RepeatKind;
  weekdays: number[];
  repeatEnd: 'never' | 'date';
  untilDate: string;
  /** A regra original quando ela não cabe nas opções simples (mantida se não mexerem). */
  customRRule: string | null;
  calendarId: string;
  reminders: number[];
  color: string | null;
  /** Vazio é sem projeto. */
  projectId: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const toTime = (hour: number, minute: number) => `${pad(hour)}:${pad(minute)}`;

/** Minutos sem fuso de uma data + hora: servem para comparar e somar durações. */
function floatingMinutes(date: string, time: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return dateStringToUtc(date).getTime() / 60_000 + hour * 60 + minute;
}

function fromFloatingMinutes(total: number) {
  const date = new Date(total * 60_000);
  return {
    date: date.toISOString().slice(0, 10),
    time: toTime(date.getUTCHours(), date.getUTCMinutes()),
  };
}

export function newEventForm({
  date,
  now,
  timeZone,
  calendarId,
  hour,
}: {
  date: string;
  now: Date;
  timeZone: string;
  calendarId: string;
  /** Hora tocada na linha do tempo. */
  hour?: number;
}): EventForm {
  const wall = instantToWallTime(now, timeZone);
  const today = toDateString(wall.year, wall.month, wall.day);
  // Hoje: a próxima hora cheia. Outro dia: 9h.
  const startHour = hour ?? (date === today ? Math.min(wall.hour + 1, 23) : 9);
  const start = floatingMinutes(date, toTime(startHour, 0));
  const end = fromFloatingMinutes(start + 60);
  return {
    title: '',
    location: '',
    notes: '',
    allDay: false,
    startDate: date,
    startTime: toTime(startHour, 0),
    endDate: end.date,
    endTime: end.time,
    repeat: 'never',
    weekdays: [weekdayOf(date)],
    repeatEnd: 'never',
    untilDate: addDays(date, 30),
    customRRule: null,
    calendarId,
    reminders: [],
    color: null,
    projectId: '',
  };
}

export function repeatFromRRule(rrule: string | null, startDate: string) {
  const base = {
    repeat: 'never' as RepeatKind,
    weekdays: [weekdayOf(startDate)],
    repeatEnd: 'never' as 'never' | 'date',
    untilDate: addDays(startDate, 30),
    customRRule: null as string | null,
  };
  if (!rrule) return base;
  const parsed = parseSimpleRRule(rrule);
  const interval = parsed?.interval ?? 1;
  let repeat: RepeatKind = 'custom';
  if (parsed && !parsed.count) {
    if (parsed.freq === 'DAILY' && interval === 1 && !parsed.byWeekday) repeat = 'daily';
    if (parsed.freq === 'WEEKLY' && interval === 1) repeat = 'weekly';
    if (parsed.freq === 'WEEKLY' && interval === 2) repeat = 'biweekly';
    if (parsed.freq === 'MONTHLY' && interval === 1 && !parsed.byWeekday) repeat = 'monthly';
    if (parsed.freq === 'YEARLY' && interval === 1 && !parsed.byWeekday) repeat = 'yearly';
  }
  if (repeat === 'custom') return { ...base, repeat, customRRule: rrule };
  return {
    ...base,
    repeat,
    weekdays: parsed?.byWeekday?.length ? parsed.byWeekday : base.weekdays,
    repeatEnd: parsed?.until ? ('date' as const) : ('never' as const),
    untilDate: parsed?.until ?? base.untilDate,
  };
}

/** O formulário de edição a partir da ocorrência clicada. */
export function formFromOccurrence(event: EventOccurrence, timeZone: string): EventForm {
  let startDate: string;
  let endDate: string;
  let startTime = '09:00';
  let endTime = '10:00';
  if (event.allDay) {
    startDate = event.startAt.slice(0, 10);
    const endExclusive = event.endAt.slice(0, 10);
    endDate = endExclusive > startDate ? addDays(endExclusive, -1) : startDate;
  } else {
    const start = instantToWallTime(new Date(event.startAt), timeZone);
    const end = instantToWallTime(new Date(event.endAt), timeZone);
    startDate = toDateString(start.year, start.month, start.day);
    endDate = toDateString(end.year, end.month, end.day);
    startTime = toTime(start.hour, start.minute);
    endTime = toTime(end.hour, end.minute);
  }
  return {
    title: event.title,
    location: event.location ?? '',
    notes: event.notes ?? '',
    allDay: event.allDay,
    startDate,
    startTime,
    endDate,
    endTime,
    ...repeatFromRRule(event.rrule, startDate),
    calendarId: event.calendarId,
    reminders: event.reminders,
    color: event.color,
    projectId: event.projectId ?? '',
  };
}

/** Muda o início e leva o término junto, mantendo a duração. */
export function withStart(
  form: EventForm,
  startDate: string,
  startTime = form.startTime
): EventForm {
  const next = { ...form, startDate, startTime };
  if (form.allDay) {
    next.endDate = addDays(form.endDate, diffInDays(form.startDate, startDate));
  } else {
    const length =
      floatingMinutes(form.endDate, form.endTime) - floatingMinutes(form.startDate, form.startTime);
    const end = fromFloatingMinutes(floatingMinutes(startDate, startTime) + Math.max(0, length));
    next.endDate = end.date;
    next.endTime = end.time;
  }
  // Repetição semanal só no dia do início: acompanha o novo dia da semana.
  const oldWeekday = weekdayOf(form.startDate);
  if (form.weekdays.length === 1 && form.weekdays[0] === oldWeekday) {
    next.weekdays = [weekdayOf(startDate)];
  }
  if (next.untilDate < startDate) next.untilDate = startDate;
  return next;
}

export function endBeforeStart(form: EventForm) {
  if (form.allDay) return form.endDate < form.startDate;
  return (
    floatingMinutes(form.endDate, form.endTime) < floatingMinutes(form.startDate, form.startTime)
  );
}

export function rruleOf(form: EventForm): string | null {
  if (form.repeat === 'never') return null;
  if (form.repeat === 'custom') return form.customRRule;
  const recurrence: SimpleRecurrence = {
    daily: { freq: 'DAILY' as const },
    weekly: { freq: 'WEEKLY' as const },
    biweekly: { freq: 'WEEKLY' as const, interval: 2 },
    monthly: { freq: 'MONTHLY' as const },
    yearly: { freq: 'YEARLY' as const },
  }[form.repeat];
  if (recurrence.freq === 'WEEKLY') {
    recurrence.byWeekday = form.weekdays.length ? form.weekdays : [weekdayOf(form.startDate)];
  }
  if (form.repeatEnd === 'date') recurrence.until = form.untilDate;
  return buildRRule(recurrence);
}

export function momentsOf(form: EventForm, timeZone: string) {
  if (form.allDay) {
    const end = form.endDate < form.startDate ? form.startDate : form.endDate;
    return { startAt: form.startDate, endAt: addDays(end, 1) };
  }
  const iso = (date: string, time: string) => wallInstant(date, time, timeZone).toISOString();
  return {
    startAt: iso(form.startDate, form.startTime),
    endAt: iso(form.endDate, form.endTime),
  };
}

export function bodyOf(form: EventForm, timeZone: string) {
  return {
    calendarId: form.calendarId,
    title: form.title.trim() || 'Novo evento',
    location: form.location.trim() || null,
    notes: form.notes.trim() || null,
    allDay: form.allDay,
    ...momentsOf(form, timeZone),
    rrule: rruleOf(form),
    reminders: form.reminders,
    color: form.color as never,
    projectId: form.projectId || null,
  };
}

/**
 * Editar "todos os eventos" a partir de uma ocorrência: a mudança de horário feita nela vale para o
 * início da série, não move a série para o dia clicado.
 */
export function shiftSeries(
  master: { startAt: string; endAt: string; allDay: boolean },
  occurrence: { startAt: string },
  edited: { startAt: string; endAt: string; allDay: boolean }
) {
  if (master.allDay !== edited.allDay) return { startAt: edited.startAt, endAt: edited.endAt };
  const ms = (value: string) => new Date(value).getTime();
  const shift = ms(edited.startAt) - ms(occurrence.startAt);
  const length = ms(edited.endAt) - ms(edited.startAt);
  const start = ms(master.startAt) + shift;
  const out = (value: number) => {
    const iso = new Date(value).toISOString();
    return edited.allDay ? iso.slice(0, 10) : iso;
  };
  return { startAt: out(start), endAt: out(start + length) };
}
