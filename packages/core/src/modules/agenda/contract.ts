import { z } from 'zod';

export const TONES = ['blue', 'green', 'rose', 'amber', 'violet', 'cyan', 'orange'] as const;
export type Tone = (typeof TONES)[number];

const day = /^\d{4}-\d{2}-\d{2}$/;
/** Com hora: instante ISO. Dia inteiro: AAAA-MM-DD. */
const moment = z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Data inválida.');
const tone = z.enum(TONES);

const reminders = z.array(z.number().int().min(0).max(40_320)).max(5);

const eventFields = {
  calendarId: z.string().min(1).optional(),
  title: z.string().trim().min(1, 'Informe o título.').max(200),
  notes: z.string().max(5000).nullable().optional(),
  location: z.string().max(300).nullable().optional(),
  allDay: z.boolean().default(false),
  startAt: moment,
  endAt: moment,
  color: tone.nullable().optional(),
  rrule: z.string().max(500).nullable().optional(),
  reminders: reminders.optional(),
};

const endAfterStart = (value: { startAt?: string; endAt?: string }) =>
  !value.startAt || !value.endAt || new Date(value.endAt) >= new Date(value.startAt);
const END_MESSAGE = { path: ['endAt'], message: 'O fim precisa ser depois do início.' };

export const createEventSchema = z.object(eventFields).refine(endAfterStart, END_MESSAGE);
export type CreateEvent = z.input<typeof createEventSchema>;

export const eventScopeSchema = z.enum(['single', 'all']);
export type EventScope = z.infer<typeof eventScopeSchema>;

export const updateEventSchema = z
  .object({
    ...eventFields,
    allDay: z.boolean(),
  })
  .partial()
  .extend({ scope: eventScopeSchema.default('all'), occurrenceStart: z.string().optional() })
  .refine(endAfterStart, END_MESSAGE);
export type UpdateEvent = z.input<typeof updateEventSchema>;

export const deleteEventSchema = z.object({
  scope: eventScopeSchema.default('all'),
  occurrenceStart: z.string().optional(),
});

/** Dias no fuso da pessoa, com `to` exclusivo. */
export const rangeSchema = z
  .object({ from: z.string().regex(day), to: z.string().regex(day) })
  .refine((v) => v.to > v.from, 'Intervalo inválido.')
  .refine(
    (v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 400 * 86_400_000,
    'Intervalo maior que 400 dias.'
  );

export const createCalendarSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao calendário.').max(80),
  color: tone,
});

export const updateCalendarSchema = z.object({
  name: z.string().trim().min(1, 'Dê um nome ao calendário.').max(80).optional(),
  color: tone.optional(),
  selected: z.boolean().optional(),
});

export const addIcsSchema = z.object({
  url: z.string().min(1, 'Cole o link da agenda.').max(2000),
  name: z.string().trim().max(80).nullable().optional(),
  color: tone.optional(),
});
