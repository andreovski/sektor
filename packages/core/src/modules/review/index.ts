import { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import type { PeriodKind } from './period';
import * as review from './service';

const longText = z.string().max(4000, 'Texto longo demais.');
const saveSchema = z.object({
  weekStart: z.string(),
  wentWell: longText,
  blocked: longText,
  priorities: z.array(z.string().max(300, 'Prioridade longa demais.')).max(3, 'São até 3 prioridades.'),
});
type SaveInput = z.infer<typeof saveSchema>;

const periodSchema = z.object({
  kind: z.enum(['week', 'month', 'year'], { message: 'Período inválido.' }),
  key: z.string().optional(),
});

export const handlers = (ctx: AppCtx) => ({
  'review.get': (input: { kind: PeriodKind; key?: string }) => {
    const { kind, key } = parse<{ kind: PeriodKind; key?: string }>(periodSchema as never, input);
    return review.getPeriod(ctx, kind, key);
  },
  'review.save': (input: SaveInput) => review.saveReview(ctx, parse<SaveInput>(saveSchema as never, input)),
  'review.linkTask': (input: { weekStart: string; text: string; taskId: string }) =>
    review.linkPriority(ctx, input.weekStart, input.text, input.taskId),
});

export const jobs: Job[] = [{ name: 'review.reminder', everyMs: 5 * 60_000, run: review.remind }];
