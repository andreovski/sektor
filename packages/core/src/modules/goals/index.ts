import { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';
import { HABIT_COLORS } from '../habits/schema';

import { GOAL_AREAS, GOAL_SOURCES } from './schema';
import * as svc from './service';

const goalBodySchema = z
  .object({
    title: z.string().trim().min(1, 'Dê um título à meta.').max(120, 'Título longo demais.'),
    area: z.enum(GOAL_AREAS),
    target: z.number().positive('O alvo precisa ser maior que zero.'),
    unit: z.string().trim().max(20, 'Unidade longa demais.'),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida.').nullish(),
    color: z.enum(HABIT_COLORS),
    source: z.enum(GOAL_SOURCES),
    sourceId: z.string().nullish(),
    manualValue: z.number().min(0, 'O valor não pode ser negativo.').optional(),
  })
  .refine((body) => body.source !== 'MANUAL' || body.unit.length > 0, {
    message: 'Diga a unidade do alvo.',
  })
  .refine((body) => body.source === 'MANUAL' || body.sourceId, {
    message: 'Escolha o que acompanhar.',
  });

const valueSchema = z.number().min(0, 'O valor não pode ser negativo.');

export const handlers = (ctx: AppCtx) => ({
  'goals.list': () => svc.listGoals(ctx),
  'goals.sources': () => svc.goalSources(ctx),
  'goals.create': (input: svc.GoalBody) =>
    svc.createGoal(ctx, parse(goalBodySchema as never, input)),
  'goals.update': ({ id, ...input }: svc.GoalBody & { id: string }) =>
    svc.updateGoal(ctx, id, parse(goalBodySchema as never, input)),
  'goals.setProgress': ({ id, value }: { id: string; value: number }) =>
    svc.setProgress(ctx, id, parse(valueSchema as never, value)),
  'goals.delete': ({ id }: { id: string }) => svc.deleteGoal(ctx, id),
});

export const jobs: Job[] = [];
