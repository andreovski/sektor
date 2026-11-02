import { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import { HABIT_COLORS } from './schema';
import * as svc from './service';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.');

const habitBodySchema = z
  .object({
    name: z.string().trim().min(1, 'Dê um nome ao hábito.').max(80, 'Nome longo demais.'),
    kind: z.enum(['CONTINUOUS', 'CHALLENGE']),
    frequency: z.enum(['DAILY', 'WEEKDAYS', 'TIMES']),
    timesPerWeek: z.number().int().min(1).max(6).nullish(),
    endOn: dateSchema.nullish(),
    color: z.enum(HABIT_COLORS),
  })
  .refine((body) => body.frequency !== 'TIMES' || body.timesPerWeek, {
    message: 'Escolha quantas vezes em 7 dias.',
  });

export const handlers = (ctx: AppCtx) => ({
  'habits.list': () => svc.listHabits(ctx),
  'habits.today': () => svc.habitsToday(ctx),
  'habits.create': (input: svc.HabitBody) =>
    svc.createHabit(ctx, parse(habitBodySchema as never, input)),
  'habits.update': ({ id, ...input }: svc.HabitBody & { id: string }) =>
    svc.updateHabit(ctx, id, parse(habitBodySchema as never, input)),
  'habits.delete': ({ id }: { id: string }) => svc.deleteHabit(ctx, id),
  'habits.toggle': ({ id, date }: { id: string; date: string }) =>
    svc.toggleCheck(ctx, id, parse(dateSchema as never, date)),
  'habits.reorder': ({ ids }: { ids: string[] }) => svc.reorderHabits(ctx, ids),
});

export const jobs: Job[] = [
  { name: 'habits-risk', everyMs: 5 * 60_000, run: (ctx) => svc.riskNotice(ctx) },
];
