import type { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { parse } from '../finance';

import * as input from './input';
import * as svc from './service';

const read = <S extends z.ZodTypeAny>(schema: S, value: unknown) =>
  parse(schema as never, value) as z.output<S>;

export const handlers = (ctx: AppCtx) => ({
  /** Resumo do dia para a tela Início. */
  'health.today': () => svc.getToday(ctx),
  'health.day': (value: z.input<typeof input.dayInput>) =>
    svc.getDay(ctx, read(input.dayInput, value).date),
  'health.settings': () => svc.getSettings(ctx),
  'health.settingsSave': (value: z.input<typeof input.settingsInput>) =>
    svc.saveSettings(ctx, read(input.settingsInput, value)),

  'health.checkinSave': (value: z.input<typeof input.checkinInput>) =>
    svc.saveCheckin(ctx, read(input.checkinInput, value)),
  'health.waterAdd': (value: z.input<typeof input.waterInput>) =>
    svc.addWater(ctx, read(input.waterInput, value)),

  'health.sleepList': () => svc.sleepHistory(ctx),
  'health.sleepSave': (value: z.input<typeof input.sleepInput>) =>
    svc.saveSleep(ctx, read(input.sleepInput, value)),
  'health.sleepDelete': (value: z.input<typeof input.dayInput>) =>
    svc.deleteSleep(ctx, read(input.dayInput, value).date),

  'health.diaryGet': (value: z.input<typeof input.dayInput>) =>
    svc.getDiary(ctx, read(input.dayInput, value).date),
  'health.diarySave': (value: z.input<typeof input.diaryInput>) =>
    svc.saveDiary(ctx, read(input.diaryInput, value)),
  'health.diaryList': (value?: { query?: string }) => svc.listDiary(ctx, value?.query),

  'health.medList': () => svc.listMeds(ctx),
  'health.medSave': (value: z.input<typeof input.medInput>) =>
    svc.saveMed(ctx, read(input.medInput, value)),
  'health.medDelete': ({ id }: { id: string }) => svc.deleteMed(ctx, id),
  'health.doseSet': (value: z.input<typeof input.doseInput>) =>
    svc.setDose(ctx, read(input.doseInput, value)),
  'health.takeNow': ({ medId }: { medId: string }) => svc.takeNow(ctx, medId),
  'health.takeUndo': ({ id }: { id: string }) => svc.undoUse(ctx, id),

  'health.appointmentList': () => svc.listAppointments(ctx),
  'health.appointmentSave': (value: z.input<typeof input.appointmentInput>) =>
    svc.saveAppointment(ctx, read(input.appointmentInput, value)),
  'health.appointmentDone': ({ id, done }: { id: string; done: boolean }) =>
    svc.setAppointmentDone(ctx, id, done),
  'health.appointmentDelete': ({ id }: { id: string }) => svc.deleteAppointment(ctx, id),

  'health.patterns': () => svc.getPatterns(ctx),
});

const EVERY_TICK = 60_000;

export const jobs: Job[] = [
  {
    name: 'health-notices',
    everyMs: EVERY_TICK,
    run(ctx) {
      svc.noticeDoses(ctx);
      svc.noticeAppointments(ctx);
    },
  },
];
