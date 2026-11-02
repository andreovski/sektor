import { z } from 'zod';

import { SCHEDULES } from './schema';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');
const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida.');
const minutes = z.number().int().min(0).max(40_320);

const customFields = z
  .object({
    title: z.string().trim().min(1, 'Dê um nome ao lembrete.').max(200),
    notes: z.string().max(1000).nullable().optional(),
    schedule: z.enum(SCHEDULES),
    startDate: day,
    time: clock.nullable().optional(),
    intervalHours: z.number().int().min(1).max(24).nullable().optional(),
    windowStart: clock.nullable().optional(),
    windowEnd: clock.nullable().optional(),
  })
  .superRefine((value, issue) => {
    if (value.schedule === 'INTERVAL') {
      if (!value.intervalHours || !value.windowStart || !value.windowEnd) {
        issue.addIssue({ code: 'custom', message: 'Informe o intervalo e as horas.' });
      } else if (value.windowEnd <= value.windowStart) {
        issue.addIssue({ code: 'custom', message: 'O fim do intervalo vem depois do início.' });
      }
    } else if (!value.time) {
      issue.addIssue({ code: 'custom', message: 'Informe a hora.' });
    }
  });

export const customReminderSchema = customFields;
export type CustomReminder = z.input<typeof customReminderSchema>;

export const eventReminderSchema = z.object({
  eventId: z.string().min(1, 'Escolha o evento.'),
  minutesBefore: minutes,
});

export const taskReminderSchema = z.object({
  taskId: z.string().min(1, 'Escolha a tarefa.'),
  title: z.string().trim().min(1).max(500),
  dueDate: day,
  dueTime: clock.nullable().optional(),
  minutesBefore: minutes,
});
