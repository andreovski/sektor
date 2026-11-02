import { addDays, dateStringInZone } from '@sektor/finance-engine';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { z } from 'zod';

import type { AppCtx } from '../../app';
import { appMeta } from '../../db/schema';
import { AppError, type Ctx, notFound, stamp, todayIn } from '../../services/context';

import type {
  appointmentInput,
  checkinInput,
  diaryInput,
  doseInput,
  medInput,
  settingsInput,
  sleepInput,
  waterInput,
} from './input';
import { allPatterns } from './patterns';
import {
  ADHERENCE_DAYS,
  adherence,
  isActiveOn,
  localMinutes,
  type Schedule,
  sleepMinutes,
  slotsOn,
} from './schedule';
import {
  healthAppointments,
  healthDays,
  healthMedLogs,
  healthMeds,
  healthNotices,
} from './schema';

const DEFAULT_GLASS_ML = 250;
const DEFAULT_GOAL_ML = 2000;
const GLASS_KEY = 'health.glassMl';
const GOAL_KEY = 'health.goalMl';
const PATTERN_DAYS = 90;
const DIARY_LIST_LIMIT = 60;
const SNIPPET_BEFORE = 40;
const SNIPPET_LENGTH = 160;
/** Com o app fechado, só avisa a dose das últimas 6 h: as mais velhas ficam como atrasadas na tela. */
const DOSE_CATCHUP_MINUTES = 360;
/** A véspera não acorda ninguém de madrugada: o aviso sai a partir desta hora. */
const EVE_NOTICE_TIME = '09:00';

type Med = typeof healthMeds.$inferSelect;
type Appointment = typeof healthAppointments.$inferSelect;
type Day = typeof healthDays.$inferSelect;

export const nowTimeIn = (ctx: Ctx, now = new Date()) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: ctx.timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(now);

function assertNotFuture(ctx: Ctx, date: string) {
  if (date > todayIn(ctx)) throw new AppError(400, 'Essa data ainda não chegou.');
}

const findDay = (ctx: Ctx, date: string) =>
  ctx.db
    .select()
    .from(healthDays)
    .where(and(eq(healthDays.date, date), isNull(healthDays.deletedAt)))
    .get();

function patchDay(ctx: Ctx, date: string, fields: Partial<Day>) {
  const current = findDay(ctx, date);
  if (current) {
    ctx.db
      .update(healthDays)
      .set({ ...fields, updatedAt: Date.now() })
      .where(eq(healthDays.id, current.id))
      .run();
  } else {
    ctx.db.insert(healthDays).values({ ...stamp(), date, ...fields }).run();
  }
}

/* Ajustes */

function metaNumber(ctx: Ctx, key: string, fallback: number) {
  const row = ctx.db.select().from(appMeta).where(eq(appMeta.key, key)).get();
  return row ? Number(row.value) : fallback;
}

function setMeta(ctx: Ctx, key: string, value: number) {
  const updatedAt = Date.now();
  ctx.db
    .insert(appMeta)
    .values({ key, value: String(value), updatedAt })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: String(value), updatedAt } })
    .run();
}

export const getSettings = (ctx: Ctx) => ({
  glassMl: metaNumber(ctx, GLASS_KEY, DEFAULT_GLASS_ML),
  goalMl: metaNumber(ctx, GOAL_KEY, DEFAULT_GOAL_ML),
});

export function saveSettings(ctx: Ctx, input: z.output<typeof settingsInput>) {
  setMeta(ctx, GLASS_KEY, input.glassMl);
  setMeta(ctx, GOAL_KEY, input.goalMl);
  return getSettings(ctx);
}

/* Dia */

export function saveCheckin(ctx: Ctx, { date, ...fields }: z.output<typeof checkinInput>) {
  assertNotFuture(ctx, date);
  const patch: Partial<Day> = {};
  if (fields.mood !== undefined) patch.mood = fields.mood;
  if (fields.energy !== undefined) patch.energy = fields.energy;
  if (fields.gratitude !== undefined) patch.gratitude = fields.gratitude?.trim() || null;
  patchDay(ctx, date, patch);
  return getDay(ctx, date);
}

export function saveSleep(ctx: Ctx, input: z.output<typeof sleepInput>) {
  assertNotFuture(ctx, input.date);
  const minutes = sleepMinutes(input.bedTime, input.wakeTime);
  if (minutes === 0) throw new AppError(400, 'A hora de dormir e a de acordar são iguais.');
  patchDay(ctx, input.date, {
    bedTime: input.bedTime,
    wakeTime: input.wakeTime,
    sleepQuality: input.quality ?? null,
    sleepMinutes: minutes,
  });
  return getDay(ctx, input.date);
}

export function deleteSleep(ctx: Ctx, date: string) {
  patchDay(ctx, date, { bedTime: null, wakeTime: null, sleepQuality: null, sleepMinutes: null });
}

/** Grava em ml: mudar o tamanho do copo depois não reescreve o que já foi bebido. */
export function addWater(ctx: Ctx, input: z.output<typeof waterInput>) {
  assertNotFuture(ctx, input.date);
  const { glassMl } = getSettings(ctx);
  const current = findDay(ctx, input.date)?.waterMl ?? 0;
  patchDay(ctx, input.date, { waterMl: Math.max(0, current + input.glasses * glassMl) });
  return getDay(ctx, input.date);
}

export function getDay(ctx: Ctx, date: string) {
  const today = todayIn(ctx);
  const row = findDay(ctx, date);
  const { glassMl, goalMl } = getSettings(ctx);
  const ml = row?.waterMl ?? 0;
  return {
    date,
    isToday: date === today,
    checkin: {
      mood: row?.mood ?? null,
      energy: row?.energy ?? null,
      gratitude: row?.gratitude ?? null,
    },
    sleep:
      row?.sleepMinutes != null
        ? {
            bedTime: row.bedTime!,
            wakeTime: row.wakeTime!,
            quality: row.sleepQuality,
            minutes: row.sleepMinutes,
          }
        : null,
    water: {
      ml,
      glassMl,
      goalMl,
      glasses: Math.round(ml / glassMl),
      goalGlasses: Math.ceil(goalMl / glassMl),
    },
    ...dosesOn(ctx, date),
    nextAppointment: nextAppointment(ctx, today),
  };
}

export const getToday = (ctx: Ctx) => getDay(ctx, todayIn(ctx));

/* Sono */

export function sleepHistory(ctx: Ctx, days = 30) {
  const to = todayIn(ctx);
  const from = addDays(to, 1 - days);
  const rows = ctx.db
    .select()
    .from(healthDays)
    .where(and(isNull(healthDays.deletedAt), gte(healthDays.date, from), lte(healthDays.date, to)))
    .orderBy(desc(healthDays.date))
    .all()
    .filter((row) => row.sleepMinutes !== null);
  const mean = (values: number[]) =>
    values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  const week = addDays(to, -6);
  return {
    entries: rows.map((row) => ({
      date: row.date,
      bedTime: row.bedTime!,
      wakeTime: row.wakeTime!,
      quality: row.sleepQuality,
      minutes: row.sleepMinutes!,
    })),
    averageWeek: mean(rows.filter((r) => r.date >= week).map((r) => r.sleepMinutes!)),
    averageMonth: mean(rows.map((r) => r.sleepMinutes!)),
    averageQuality: mean(rows.flatMap((r) => (r.sleepQuality ? [r.sleepQuality * 10] : []))),
  };
}

/* Diário */

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** Acha o termo sem olhar acentos nem maiúsculas e devolve a posição no texto original. */
export function findInText(text: string, query: string) {
  const positions: number[] = [];
  let folded = '';
  for (let i = 0; i < text.length; i++) {
    const piece = fold(text[i]!);
    folded += piece;
    for (let n = 0; n < piece.length; n++) positions.push(i);
  }
  const at = folded.indexOf(fold(query));
  if (at < 0) return null;
  const start = positions[at]!;
  const end = positions[at + fold(query).length - 1]! + 1;
  return { start, length: end - start };
}

function snippetOf(text: string, match: { start: number; length: number } | null) {
  const from = match ? Math.max(0, match.start - SNIPPET_BEFORE) : 0;
  const prefix = from > 0 ? '…' : '';
  const body = text.slice(from, from + SNIPPET_LENGTH).replace(/\s+/g, ' ');
  const raw = text.slice(from, match?.start ?? from).replace(/\s+/g, ' ');
  return {
    snippet: `${prefix}${body}${from + SNIPPET_LENGTH < text.length ? '…' : ''}`,
    match: match ? { start: prefix.length + raw.length, length: match.length } : null,
  };
}

export const getDiary = (ctx: Ctx, date: string) => ({
  date,
  text: findDay(ctx, date)?.diary ?? '',
});

export function saveDiary(ctx: Ctx, input: z.output<typeof diaryInput>) {
  assertNotFuture(ctx, input.date);
  patchDay(ctx, input.date, { diary: input.text.trim() ? input.text : null });
}

export function listDiary(ctx: Ctx, query?: string) {
  const term = query?.trim() ?? '';
  const rows = ctx.db
    .select({ date: healthDays.date, diary: healthDays.diary })
    .from(healthDays)
    .where(isNull(healthDays.deletedAt))
    .orderBy(desc(healthDays.date))
    .all();
  const found = [];
  for (const { date, diary } of rows) {
    if (!diary) continue;
    const match = term ? findInText(diary, term) : null;
    if (term && !match) continue;
    found.push({ date, ...snippetOf(diary, match) });
    if (found.length === DIARY_LIST_LIMIT) break;
  }
  return found;
}

/* Remédios */

const liveMeds = (ctx: Ctx) =>
  ctx.db
    .select()
    .from(healthMeds)
    .where(isNull(healthMeds.deletedAt))
    .orderBy(asc(healthMeds.name))
    .all();

function findMed(ctx: Ctx, id: string) {
  const med = ctx.db
    .select()
    .from(healthMeds)
    .where(and(eq(healthMeds.id, id), isNull(healthMeds.deletedAt)))
    .get();
  if (!med) throw notFound('Remédio não encontrado.');
  return med;
}

const logsBetween = (ctx: Ctx, from: string, to: string) =>
  ctx.db
    .select()
    .from(healthMedLogs)
    .where(
      and(isNull(healthMedLogs.deletedAt), gte(healthMedLogs.date, from), lte(healthMedLogs.date, to))
    )
    .orderBy(desc(healthMedLogs.takenAt))
    .all();

function dosesOn(ctx: Ctx, date: string) {
  const today = todayIn(ctx);
  const nowTime = nowTimeIn(ctx);
  const logs = logsBetween(ctx, date, date);
  const doses: {
    medId: string;
    name: string;
    dose: string;
    kind: Med['kind'];
    time: string;
    taken: boolean;
    takenAt: number | null;
    late: boolean;
  }[] = [];
  const asNeeded = [];
  for (const med of liveMeds(ctx)) {
    const mine = logs.filter((log) => log.medId === med.id);
    for (const time of slotsOn(med, date)) {
      const log = mine.find((l) => l.time === time);
      doses.push({
        medId: med.id,
        name: med.name,
        dose: med.dose,
        kind: med.kind,
        time,
        taken: !!log,
        takenAt: log?.takenAt ?? null,
        late: !log && (date < today || (date === today && time < nowTime)),
      });
    }
    if (med.schedule === 'AS_NEEDED' && isActiveOn(med, date)) {
      const uses = mine.filter((l) => l.time === null);
      asNeeded.push({
        medId: med.id,
        name: med.name,
        dose: med.dose,
        uses: uses.map((l) => ({ id: l.id, takenAt: l.takenAt })),
      });
    }
  }
  doses.sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name));
  return { doses, asNeeded };
}

export function saveMed(ctx: Ctx, { id, ...input }: z.output<typeof medInput>) {
  const today = todayIn(ctx);
  const asNeeded = input.schedule === 'AS_NEEDED';
  const values = {
    name: input.name,
    kind: input.kind,
    dose: input.dose,
    schedule: input.schedule,
    weekdays: input.schedule === 'WEEKDAYS' ? [...new Set(input.weekdays)].sort() : [],
    intervalDays: input.schedule === 'INTERVAL' ? (input.intervalDays ?? null) : null,
    times: asNeeded ? [] : [...new Set(input.times)].sort(),
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    notes: input.notes,
  };
  if (!id) {
    const row = { ...stamp(), ...values, adherenceFrom: input.startDate };
    ctx.db.insert(healthMeds).values(row).run();
    return row;
  }
  const current = findMed(ctx, id);
  const rule = (m: Pick<Med, 'schedule' | 'weekdays' | 'intervalDays' | 'startDate' | 'times'>) =>
    JSON.stringify([m.schedule, m.weekdays, m.intervalDays, m.startDate, m.times.length]);
  const adherenceFrom = rule(current) === rule(values) ? current.adherenceFrom : today;
  ctx.db.transaction((tx) => {
    tx.update(healthMeds)
      .set({ ...values, adherenceFrom, updatedAt: Date.now() })
      .where(eq(healthMeds.id, id))
      .run();
    // A dose de hoje já tomada acompanha a troca de horário: senão voltaria a aparecer e a avisar.
    const logs = tx
      .select()
      .from(healthMedLogs)
      .where(
        and(
          eq(healthMedLogs.medId, id),
          eq(healthMedLogs.date, today),
          isNull(healthMedLogs.deletedAt)
        )
      )
      .all()
      .filter((log) => log.time !== null);
    const stale = logs.filter((log) => !values.times.includes(log.time!));
    const free = values.times.filter((time) => !logs.some((log) => log.time === time));
    stale.forEach((log, i) => {
      if (free[i]) {
        tx.update(healthMedLogs)
          .set({ time: free[i], updatedAt: Date.now() })
          .where(eq(healthMedLogs.id, log.id))
          .run();
      }
    });
  });
  return findMed(ctx, id);
}

export function deleteMed(ctx: Ctx, id: string) {
  findMed(ctx, id);
  ctx.db.update(healthMeds).set({ deletedAt: Date.now(), updatedAt: Date.now() }).where(eq(healthMeds.id, id)).run();
}

export function setDose(ctx: Ctx, input: z.output<typeof doseInput>) {
  assertNotFuture(ctx, input.date);
  const med = findMed(ctx, input.medId);
  const log = ctx.db
    .select()
    .from(healthMedLogs)
    .where(
      and(
        eq(healthMedLogs.medId, med.id),
        eq(healthMedLogs.date, input.date),
        eq(healthMedLogs.time, input.time),
        isNull(healthMedLogs.deletedAt)
      )
    )
    .get();
  if (input.taken) {
    if (log) return;
    if (!slotsOn(med, input.date).includes(input.time)) {
      throw new AppError(400, 'Essa dose não está prevista nesse dia.');
    }
    ctx.db
      .insert(healthMedLogs)
      .values({ ...stamp(), medId: med.id, date: input.date, time: input.time, takenAt: Date.now() })
      .run();
  } else if (log) {
    ctx.db
      .update(healthMedLogs)
      .set({ deletedAt: Date.now(), updatedAt: Date.now() })
      .where(eq(healthMedLogs.id, log.id))
      .run();
  }
}

export function takeNow(ctx: Ctx, medId: string) {
  const med = findMed(ctx, medId);
  if (med.schedule !== 'AS_NEEDED') {
    throw new AppError(400, 'Este remédio tem horário: marque a dose.');
  }
  const row = { ...stamp(), medId, date: todayIn(ctx), time: null, takenAt: Date.now() };
  ctx.db.insert(healthMedLogs).values(row).run();
  return row;
}

export function undoUse(ctx: Ctx, id: string) {
  ctx.db
    .update(healthMedLogs)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(and(eq(healthMedLogs.id, id), isNull(healthMedLogs.time)))
    .run();
}

function statusOf(med: Med, today: string) {
  if (med.endDate && med.endDate < today) return 'ENDED' as const;
  return med.startDate > today ? ('UPCOMING' as const) : ('ACTIVE' as const);
}

export function listMeds(ctx: Ctx) {
  const today = todayIn(ctx);
  const nowTime = nowTimeIn(ctx);
  const windowStart = addDays(today, 1 - ADHERENCE_DAYS);
  const logs = logsBetween(ctx, windowStart, today);
  const items = liveMeds(ctx).map((med) => {
    const mine = logs.filter((log) => log.medId === med.id);
    const takenByDate = new Map<string, number>();
    for (const log of mine) takenByDate.set(log.date, (takenByDate.get(log.date) ?? 0) + 1);
    const from = [windowStart, med.adherenceFrom, med.startDate].sort().at(-1)!;
    return {
      ...med,
      status: statusOf(med, today),
      adherence:
        med.schedule === 'AS_NEEDED' ? null : adherence(med, takenByDate, from, today, nowTime),
      uses: med.schedule === 'AS_NEEDED' ? mine.length : null,
    };
  });
  const totals = items.reduce(
    (sum, med) => ({
      expected: sum.expected + (med.adherence?.expected ?? 0),
      taken: sum.taken + (med.adherence?.taken ?? 0),
    }),
    { expected: 0, taken: 0 }
  );
  return {
    items,
    overall: {
      ...totals,
      percent: totals.expected ? Math.round((totals.taken / totals.expected) * 100) : null,
    },
  };
}

/* Consultas */

const liveAppointments = (ctx: Ctx) =>
  ctx.db
    .select()
    .from(healthAppointments)
    .where(isNull(healthAppointments.deletedAt))
    .orderBy(asc(healthAppointments.date), asc(healthAppointments.time))
    .all();

function nextAppointment(ctx: Ctx, today: string) {
  return liveAppointments(ctx).find((a) => a.doneAt === null && a.date >= today) ?? null;
}

function findAppointment(ctx: Ctx, id: string) {
  const row = ctx.db
    .select()
    .from(healthAppointments)
    .where(and(eq(healthAppointments.id, id), isNull(healthAppointments.deletedAt)))
    .get();
  if (!row) throw notFound('Consulta não encontrada.');
  return row;
}

export function saveAppointment(ctx: Ctx, { id, ...input }: z.output<typeof appointmentInput>) {
  if (!id) {
    const row = { ...stamp(), ...input };
    ctx.db.insert(healthAppointments).values(row).run();
    return row;
  }
  findAppointment(ctx, id);
  ctx.db
    .update(healthAppointments)
    .set({ ...input, updatedAt: Date.now() })
    .where(eq(healthAppointments.id, id))
    .run();
  return findAppointment(ctx, id);
}

export function setAppointmentDone(ctx: Ctx, id: string, done: boolean) {
  findAppointment(ctx, id);
  ctx.db
    .update(healthAppointments)
    .set({ doneAt: done ? Date.now() : null, updatedAt: Date.now() })
    .where(eq(healthAppointments.id, id))
    .run();
}

export function deleteAppointment(ctx: Ctx, id: string) {
  findAppointment(ctx, id);
  ctx.db
    .update(healthAppointments)
    .set({ deletedAt: Date.now(), updatedAt: Date.now() })
    .where(eq(healthAppointments.id, id))
    .run();
}

export function listAppointments(ctx: Ctx) {
  const today = todayIn(ctx);
  const rows = liveAppointments(ctx);
  return {
    pending: rows
      .filter((a) => a.doneAt === null)
      .map((a) => ({ ...a, overdue: a.date < today })),
    done: rows.filter((a) => a.doneAt !== null).reverse(),
  };
}

/* Padrões */

export function getPatterns(ctx: Ctx) {
  const to = todayIn(ctx);
  const days = ctx.db
    .select()
    .from(healthDays)
    .where(
      and(
        isNull(healthDays.deletedAt),
        gte(healthDays.date, addDays(to, 1 - PATTERN_DAYS)),
        lte(healthDays.date, to)
      )
    )
    .all();
  return { windowDays: PATTERN_DAYS, patterns: allPatterns(days) };
}

/* Avisos */

/** Reserva antes de avisar: falhar depois perde um aviso, nunca repete. */
function claimNotice(ctx: Ctx, key: string) {
  return ctx.db.insert(healthNotices).values({ ...stamp(), key }).onConflictDoNothing().run().changes > 0;
}

const describeDose = (med: Med, time: string) => `${med.name} (${med.dose}), ${time}`;

export function noticeDoses(ctx: AppCtx, now = new Date()) {
  const today = dateStringInZone(now, ctx.timeZone);
  const yesterday = addDays(today, -1);
  const nowMinutes = localMinutes(today, nowTimeIn(ctx, now));
  const logs = logsBetween(ctx, yesterday, today);
  const pending: string[] = [];
  for (const med of liveMeds(ctx)) {
    for (const date of [yesterday, today]) {
      for (const time of slotsOn(med, date)) {
        const late = nowMinutes - localMinutes(date, time);
        if (late < 0 || late > DOSE_CATCHUP_MINUTES) continue;
        if (logs.some((l) => l.medId === med.id && l.date === date && l.time === time)) continue;
        if (claimNotice(ctx, `dose:${med.id}:${date}:${time}`)) pending.push(describeDose(med, time));
      }
    }
  }
  if (pending.length === 1) ctx.notify('Hora da dose', pending[0]!);
  if (pending.length > 1) ctx.notify(`${pending.length} doses para tomar`, pending.join('; '));
}

const describeAppointment = (a: Appointment, label: string) =>
  [label, a.time ? `às ${a.time}` : null, a.location].filter(Boolean).join(', ');

export function noticeAppointments(ctx: AppCtx, now = new Date()) {
  if (nowTimeIn(ctx, now) < EVE_NOTICE_TIME) return;
  const tomorrow = addDays(dateStringInZone(now, ctx.timeZone), 1);
  const rows = ctx.db
    .select()
    .from(healthAppointments)
    .where(
      and(
        isNull(healthAppointments.deletedAt),
        or(eq(healthAppointments.date, tomorrow), eq(healthAppointments.returnDate, tomorrow))
      )
    )
    .all();
  for (const a of rows) {
    if (a.date === tomorrow && a.doneAt === null && claimNotice(ctx, `appointment:${a.id}:${a.date}`)) {
      ctx.notify(`Amanhã: ${a.title}`, describeAppointment(a, a.kind === 'EXAM' ? 'Exame' : 'Consulta'));
    }
    if (a.returnDate === tomorrow && claimNotice(ctx, `return:${a.id}:${a.returnDate}`)) {
      ctx.notify(`Amanhã: retorno de ${a.title}`, a.location ?? 'Retorno marcado');
    }
  }
}
