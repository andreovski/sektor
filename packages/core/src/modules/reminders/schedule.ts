import {
  addDays,
  dateStringInZone,
  daysInMonth,
  parseDateString,
  wallTimeToInstant,
} from '@sektor/finance-engine';

import type { Schedule } from './schema';

// Funções puras: quando um lembrete avulso toca, e como ele é descrito na tela.

export interface ScheduleRule {
  schedule: Schedule;
  startDate: string;
  time?: string | null;
  intervalHours?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
}

/** Quanto procurar à frente: mais que qualquer mês ou semana da regra. */
const HORIZON_DAYS = 400;

const minutesOf = (time: string) => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  return hour * 60 + minute;
};

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

function matchesDay(rule: ScheduleRule, day: string): boolean {
  if (day < rule.startDate) return false;
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  switch (rule.schedule) {
    case 'ONCE':
      return day === rule.startDate;
    case 'WEEKDAYS':
      return weekday >= 1 && weekday <= 5;
    case 'WEEKLY':
      return weekday === new Date(`${rule.startDate}T00:00:00Z`).getUTCDay();
    case 'MONTHLY': {
      // Dia 31 em mês curto toca no último dia.
      const anchor = parseDateString(rule.startDate).day;
      const { year, month, day: current } = parseDateString(day);
      return current === Math.min(anchor, daysInMonth(year, month));
    }
    default:
      return true;
  }
}

/** Minutos do dia em que a regra toca. */
export function slotsOf(rule: ScheduleRule): number[] {
  if (rule.schedule !== 'INTERVAL') return [minutesOf(rule.time ?? '09:00')];
  const start = minutesOf(rule.windowStart ?? '08:00');
  const end = minutesOf(rule.windowEnd ?? '18:00');
  const step = Math.max(1, rule.intervalHours ?? 1) * 60;
  const slots: number[] = [];
  for (let minute = start; minute <= end; minute += step) slots.push(minute);
  return slots;
}

/** Primeiro toque depois de `after`, no relógio do fuso. Null quando a regra acabou. */
export function nextScheduleFire(rule: ScheduleRule, after: Date, timeZone: string): Date | null {
  const today = dateStringInZone(after, timeZone);
  const first = today > rule.startDate ? today : rule.startDate;
  const slots = slotsOf(rule);
  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const day = addDays(first, i);
    if (!matchesDay(rule, day)) continue;
    for (const slot of slots) {
      const instant = wallTimeToInstant(
        { ...parseDateString(day), hour: Math.floor(slot / 60), minute: slot % 60 },
        timeZone
      );
      if (instant.getTime() > after.getTime()) return instant;
    }
    if (rule.schedule === 'ONCE') return null;
  }
  return null;
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

export function describeSchedule(rule: ScheduleRule): string {
  const at = rule.time ?? '09:00';
  const { day, month, year } = parseDateString(rule.startDate);
  switch (rule.schedule) {
    case 'ONCE':
      return `Uma vez, ${pad(day)}/${pad(month)}/${year} às ${at}`;
    case 'INTERVAL': {
      const hours = rule.intervalHours ?? 1;
      const every = hours === 1 ? 'A cada hora' : `A cada ${hours} horas`;
      return `${every}, das ${clock(minutesOf(rule.windowStart ?? '08:00'))} às ${clock(minutesOf(rule.windowEnd ?? '18:00'))}`;
    }
    case 'DAILY':
      return `Todo dia às ${at}`;
    case 'WEEKDAYS':
      return `Dias úteis às ${at}`;
    case 'WEEKLY': {
      const weekday = new Date(`${rule.startDate}T00:00:00Z`).getUTCDay();
      const article = weekday === 0 || weekday === 6 ? 'Todo' : 'Toda';
      return `${article} ${WEEKDAYS[weekday]} às ${at}`;
    }
    case 'MONTHLY':
      return `Todo dia ${day} do mês às ${at}`;
  }
}

/** "agora", "em 15 min", "amanhã": o fim do texto do aviso. */
export function leadText(minutes: number) {
  if (minutes === 0) return 'agora';
  if (minutes < 60) return `em ${minutes} min`;
  if (minutes % 1440 === 0) return minutes === 1440 ? 'amanhã' : `em ${minutes / 1440} dias`;
  if (minutes % 60 === 0) return `em ${minutes / 60} h`;
  return `em ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
