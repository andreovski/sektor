import { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import * as focus from './service';

const startSchema = z.object({
  mode: z.enum(['POMODORO', 'DEEP_WORK', 'FREE']),
  plannedMinutes: z.number().int().min(1, 'Mínimo de 1 minuto.').max(480, 'Máximo de 8 horas.').nullish(),
  taskId: z.string().min(1).nullish(),
  projectId: z.string().min(1).nullish(),
});
const breakSchema = z.object({ minutes: z.number().int().min(1).max(30).default(5) });
const noteSchema = z.object({ id: z.string(), note: z.string().max(2000, 'Texto longo demais.').nullable() });
const goalSchema = z.object({
  goalMinutes: z
    .number()
    .int()
    .min(15, 'A meta mínima é de 15 minutos.')
    .max(1440, 'Um dia tem 24 horas.'),
});

export const handlers = (ctx: AppCtx) => ({
  'focus.active': () => focus.activeSession(ctx),
  'focus.start': (input: z.input<typeof startSchema>) =>
    focus.startSession(ctx, parse(startSchema as never, input)),
  'focus.pause': () => focus.pauseSession(ctx),
  'focus.break': (input?: { minutes?: number }) =>
    focus.breakSession(ctx, parse<{ minutes: number }>(breakSchema as never, input ?? {}).minutes),
  'focus.resume': () => focus.resumeSession(ctx),
  'focus.finish': () => focus.finishSession(ctx),
  'focus.note': (input: { id: string; note: string | null }) => {
    const { id, note } = parse<{ id: string; note: string | null }>(noteSchema as never, input);
    return focus.noteSession(ctx, id, note);
  },
  'focus.delete': ({ id }: { id: string }) => focus.deleteSession(ctx, id),
  'focus.history': (input?: { limit?: number }) => focus.history(ctx, input?.limit),
  'focus.linkables': () => focus.linkables(ctx),
  'focus.panel': () => focus.panel(ctx),
  'focus.summary': () => focus.summary(ctx),
  'focus.setGoal': (input: { goalMinutes: number }) =>
    focus.setGoalMinutes(ctx, parse<{ goalMinutes: number }>(goalSchema as never, input).goalMinutes),
});

export const jobs: Job[] = [{ name: 'focus.clock', everyMs: 30_000, run: focus.runClock }];
