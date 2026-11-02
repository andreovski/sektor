import { parseDateString, toDateString, daysInMonth } from '@sektor/finance-engine';
import { z } from 'zod';

function realDate(value: string) {
  try {
    const { year, month, day } = parseDateString(value);
    return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
      ? toDateString(year, month, day) === value
      : false;
  } catch {
    return false;
  }
}

const date = z.string().refine(realDate, 'Data inválida.');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Horário inválido.');
const score = z.number().int().min(1).max(5);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'Texto longo demais.')
    .nullish()
    .transform((value) => value || null);

export const dayInput = z.object({ date });

export const checkinInput = z.object({
  date,
  mood: score.nullable().optional(),
  energy: score.nullable().optional(),
  gratitude: z.string().max(2000, 'Texto longo demais.').nullable().optional(),
});

export const sleepInput = z.object({
  date,
  bedTime: time,
  wakeTime: time,
  quality: score.nullable().optional(),
});

export const waterInput = z.object({ date, glasses: z.number().int().min(-20).max(20) });

export const settingsInput = z.object({
  glassMl: z.number().int().min(50, 'Copo de no mínimo 50 ml.').max(2000, 'Copo de no máximo 2 L.'),
  goalMl: z.number().int().min(250, 'Meta de no mínimo 250 ml.').max(10000, 'Meta de no máximo 10 L.'),
});

export const diaryInput = z.object({ date, text: z.string().max(100_000, 'Texto longo demais.') });

export const medInput = z
  .object({
    id: z.string().optional(),
    name: z.string().trim().min(1, 'Dê um nome.').max(120, 'Nome longo demais.'),
    kind: z.enum(['MEDICINE', 'SUPPLEMENT']),
    dose: z.string().trim().min(1, 'Informe a dose.').max(120, 'Dose longa demais.'),
    schedule: z.enum(['DAILY', 'WEEKDAYS', 'INTERVAL', 'AS_NEEDED']),
    weekdays: z.array(z.number().int().min(0).max(6)).default([]),
    intervalDays: z.number().int().min(2, 'O intervalo é de 2 dias ou mais.').max(365).nullish(),
    times: z.array(time).max(12, 'No máximo 12 horários.').default([]),
    startDate: date,
    endDate: date.nullish(),
    notes: optionalText(2000),
  })
  .superRefine((med, issue) => {
    const fail = (message: string) => issue.addIssue({ code: 'custom', message });
    if (med.endDate && med.endDate < med.startDate) fail('O fim vem antes do início.');
    if (med.schedule === 'AS_NEEDED') return;
    if (med.times.length === 0) fail('Informe ao menos um horário.');
    if (med.schedule === 'WEEKDAYS' && med.weekdays.length === 0) fail('Escolha os dias da semana.');
    if (med.schedule === 'INTERVAL' && !med.intervalDays) fail('Informe de quantos em quantos dias.');
  });

export const doseInput = z.object({ medId: z.string(), date, time, taken: z.boolean() });

export const appointmentInput = z
  .object({
    id: z.string().optional(),
    kind: z.enum(['CONSULTATION', 'EXAM']),
    title: z.string().trim().min(1, 'Dê um nome.').max(200, 'Nome longo demais.'),
    date,
    time: z.union([time, z.literal('')]).nullish().transform((value) => value || null),
    location: optionalText(200),
    notes: optionalText(5000),
    returnDate: z.union([date, z.literal('')]).nullish().transform((value) => value || null),
  })
  .refine((a) => !a.returnDate || a.returnDate >= a.date, 'O retorno vem antes da consulta.');
