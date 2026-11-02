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

export const handlers = (ctx: AppCtx) => ({
  'review.get': (input: { kind: PeriodKind; key?: string }) =>
    review.getPeriod(ctx, input.kind, input.key),
  'review.save': (input: SaveInput) => review.saveReview(ctx, parse<SaveInput>(saveSchema as never, input)),
  'review.linkTask': (input: { weekStart: string; text: string; taskId: string }) =>
    review.linkPriority(ctx, input.weekStart, input.text, input.taskId),
});

export const jobs: Job[] = [{ name: 'review.reminder', everyMs: 5 * 60_000, run: review.remind }];
