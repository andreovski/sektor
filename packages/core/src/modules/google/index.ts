import { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import * as svc from './service';

export { connectAccount, schedulePush, syncAll } from './service';

const syncSchema = z.object({ accountId: z.string().optional() });
const selectSchema = z.object({ id: z.string().min(1), selected: z.boolean() });
const tasksAccountSchema = z.object({ accountId: z.string().nullable() });

export const handlers = (ctx: AppCtx) => ({
  'google.status': () => svc.status(ctx),
  'google.sync': async (input?: { accountId?: string }) => {
    const { accountId } = parse(syncSchema as never, input ?? {}) as { accountId?: string };
    await svc.syncAll(ctx, accountId);
    return svc.status(ctx);
  },
  'google.setCalendarSelected': (input: { id: string; selected: boolean }) => {
    const { id, selected } = parse(selectSchema as never, input) as typeof input;
    return svc.setCalendarSelected(ctx, id, selected);
  },
  'google.setTasksAccount': (input: { accountId: string | null }) => {
    const { accountId } = parse(tasksAccountSchema as never, input) as typeof input;
    return svc.setTasksAccount(ctx, accountId);
  },
  'google.disconnect': ({ id }: { id: string }) => svc.disconnect(ctx, id),
});

export const jobs: Job[] = [{ name: 'google', everyMs: 5 * 60_000, run: (ctx) => svc.syncAll(ctx) }];
