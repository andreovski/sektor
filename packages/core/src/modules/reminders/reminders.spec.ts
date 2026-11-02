import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';
import { jobs as agendaJobs } from '../agenda';
import * as agenda from '../agenda/service';
import { handlers as tasksHandlers } from '../tasks';

import { jobs } from '.';
import { reminders } from './schema';
import * as svc from './service';

const NOW = new Date('2026-10-18T15:00:00Z');

describe('lembretes', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  let sent: { title: string; body: string }[];

  const at = (iso: string) => {
    const date = new Date(iso);
    vi.setSystemTime(date);
    return svc.runReminders(ctx, date);
  };
  const only = () => ctx.db.select().from(reminders).get()!;
  const nextFire = () => {
    const value = only().nextFireAt;
    return value ? new Date(value).toISOString() : null;
  };
  const dailyEvent = (over = {}) =>
    agenda.createEvent(ctx, {
      title: 'Daily',
      startAt: '2026-10-19T12:00:00.000Z',
      endAt: '2026-10-19T12:15:00.000Z',
      rrule: 'FREQ=DAILY',
      reminders: [10],
      ...over,
    });
  const water = (over = {}) =>
    svc.createCustom(ctx, {
      title: 'Beber água',
      schedule: 'DAILY',
      startDate: '2026-10-18',
      time: '13:00',
      ...over,
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-rem-'));
    handle = openDatabase(join(dir, 'r.db'), 'd'.repeat(64));
    sent = [];
    ctx = {
      db: handle.orm,
      timeZone: 'America/Sao_Paulo',
      keys: { get: () => null, set: () => undefined },
      secrets: { get: () => null, set: () => undefined },
      notify: (title, body) => sent.push({ title, body }),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('dispara o lembrete de cada ocorrência uma vez e agenda a próxima', () => {
    dailyEvent();
    expect(nextFire()).toBe('2026-10-19T11:50:00.000Z');

    expect(at('2026-10-19T11:50:30Z')).toBe(1);
    expect(sent[0]).toEqual({ title: 'Daily', body: '09:00 · em 10 min' });
    expect(at('2026-10-19T11:51:30Z')).toBe(0);
    expect(nextFire()).toBe('2026-10-20T11:50:00.000Z');
  });

  it('marca antes de avisar: aviso que falha não repete', () => {
    dailyEvent();
    ctx.notify = () => {
      throw new Error('sem bandeja');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(at('2026-10-19T11:50:30Z')).toBe(0);
    expect(spy).toHaveBeenCalled();
    expect(only().lastFiredFor).toBe(new Date('2026-10-19T12:00:00Z').getTime());
    expect(nextFire()).toBe('2026-10-20T11:50:00.000Z');
  });

  it('pula a ocorrência cancelada e descarta o que atrasou mais de 1 h', () => {
    const event = dailyEvent({ reminders: [0] });
    agenda.deleteEvent(ctx, event.id, {
      scope: 'single',
      occurrenceStart: '2026-10-19T12:00:00.000Z',
    });
    expect(nextFire()).toBe('2026-10-20T12:00:00.000Z');

    // App fechado por 3 horas: não manda o atrasado, só agenda o próximo.
    expect(at('2026-10-20T15:00:00Z')).toBe(0);
    expect(sent).toHaveLength(0);
    expect(nextFire()).toBe('2026-10-21T12:00:00.000Z');
  });

  it('com menos de 1 h de atraso ainda avisa', () => {
    dailyEvent({ reminders: [0] });
    expect(at('2026-10-19T12:59:00Z')).toBe(1);
  });

  it('a ocorrência movida avisa no horário novo', () => {
    const event = dailyEvent({ reminders: [0] });
    agenda.updateEvent(ctx, event.id, {
      scope: 'single',
      occurrenceStart: '2026-10-19T12:00:00.000Z',
      startAt: '2026-10-19T17:00:00.000Z',
      endAt: '2026-10-19T18:00:00.000Z',
    });
    expect(nextFire()).toBe('2026-10-19T17:00:00.000Z');
  });

  it('evento simples avisa uma vez; mudar o horário agenda de novo; apagar leva o lembrete', () => {
    const event = agenda.createEvent(ctx, {
      title: 'Consulta',
      location: 'Centro',
      startAt: '2026-10-19T12:00:00.000Z',
      endAt: '2026-10-19T13:00:00.000Z',
      reminders: [30],
    });
    expect(at('2026-10-19T11:30:10Z')).toBe(1);
    expect(sent[0]!.body).toBe('09:00 · em 30 min · Centro');
    expect(nextFire()).toBeNull();

    agenda.updateEvent(ctx, event.id, {
      startAt: '2026-10-20T12:00:00.000Z',
      endAt: '2026-10-20T13:00:00.000Z',
    });
    expect(nextFire()).toBe('2026-10-20T11:30:00.000Z');

    agenda.deleteEvent(ctx, event.id, { scope: 'all' });
    expect(svc.listReminders(ctx)).toEqual([]);
  });

  it('dia inteiro conta da meia-noite local', () => {
    agenda.createEvent(ctx, {
      title: 'Feriado',
      allDay: true,
      startAt: '2026-10-20',
      endAt: '2026-10-21',
      reminders: [60],
    });
    expect(nextFire()).toBe('2026-10-20T02:00:00.000Z');
    expect(at('2026-10-20T02:00:10Z')).toBe(1);
    expect(sent[0]!.body).toBe('Dia inteiro, em 1 h');
  });

  it('avulso: uma vez acaba; pausar para; retomar recalcula sem disparar o perdido', () => {
    water();
    expect(nextFire()).toBe('2026-10-18T16:00:00.000Z');
    const { id } = only();

    expect(svc.pauseReminder(ctx, id)).toMatchObject({ state: 'PAUSED', nextFireAt: null });
    expect(at('2026-10-18T16:00:30Z')).toBe(0);

    vi.setSystemTime(new Date('2026-10-18T17:00:00Z'));
    expect(svc.resumeReminder(ctx, id)).toMatchObject({
      state: 'ACTIVE',
      nextFireAt: '2026-10-19T16:00:00.000Z',
    });
    svc.deleteReminder(ctx, id);
    expect(ctx.db.select().from(reminders).where(eq(reminders.id, id)).get()!.deletedAt).toBeTruthy();
    expect(svc.listReminders(ctx)).toEqual([]);

    const once = water({ schedule: 'ONCE', startDate: '2026-10-19', notes: 'Copo cheio' });
    expect(at('2026-10-19T16:00:10Z')).toBe(1);
    expect(sent.at(-1)).toEqual({ title: 'Beber água', body: 'Copo cheio' });
    expect(svc.listReminders(ctx).find((r) => r.id === once.id)).toMatchObject({ state: 'DONE' });
  });

  it('recusa uma vez no passado', () => {
    expect(() => water({ schedule: 'ONCE', time: '08:00' })).toThrow(
      expect.objectContaining({ status: 400 })
    );
    expect(ctx.db.select().from(reminders).all()).toEqual([]);
  });

  it('o job de lembretes roda de minuto em minuto', () => {
    expect(jobs).toEqual([expect.objectContaining({ name: 'reminders', everyMs: 60_000 })]);
    expect(agendaJobs).toEqual([
      expect.objectContaining({ name: 'agenda-ics', everyMs: 15 * 60_000 }),
    ]);
  });

  it('a cada N horas segue no intervalo', () => {
    water({
      schedule: 'INTERVAL',
      intervalHours: 2,
      windowStart: '08:00',
      windowEnd: '14:00',
      time: null,
    });
    expect(nextFire()).toBe('2026-10-18T17:00:00.000Z'); // 14h
    at('2026-10-18T17:00:10Z');
    expect(nextFire()).toBe('2026-10-19T11:00:00.000Z'); // 8h do dia seguinte
  });

  it('não aceita lembrete repetido no mesmo evento', () => {
    const event = dailyEvent();
    expect(() => svc.createForEvent(ctx, { eventId: event.id, minutesBefore: 10 })).toThrow(
      expect.objectContaining({ status: 409 })
    );
    expect(svc.createForEvent(ctx, { eventId: event.id, minutesBefore: 5 }).state).toBe('ACTIVE');
  });

  describe('tarefas', () => {
    const task = (over = {}) =>
      tasksHandlers(ctx)['tasks.create']({ title: 'Pagar boleto', dueDate: '2026-10-19', ...over });
    const remind = (t: { id: string; title: string; dueDate: string | null; dueTime: string | null }, minutesBefore = 0) =>
      svc.createForTask(ctx, {
        taskId: t.id,
        title: t.title,
        dueDate: t.dueDate!,
        dueTime: t.dueTime,
        minutesBefore,
      });

    it('só com data avisa às 9h locais, uma vez', () => {
      remind(task());
      expect(nextFire()).toBe('2026-10-19T12:00:00.000Z');
      expect(at('2026-10-19T12:00:20Z')).toBe(1);
      expect(sent[0]).toEqual({ title: 'Pagar boleto', body: 'Tarefa para hoje' });
      expect(at('2026-10-19T12:01:20Z')).toBe(0);
    });

    it('com hora avisa antes do prazo', () => {
      remind(task({ dueTime: '14:00' }), 15);
      expect(nextFire()).toBe('2026-10-19T16:45:00.000Z');
      at('2026-10-19T16:45:10Z');
      expect(sent[0]!.body).toBe('Tarefa para 14:00');
    });

    it('segue a tarefa: concluída não avisa, prazo novo reagenda, apagada leva o lembrete', () => {
      const t = task();
      remind(t);
      const api = tasksHandlers(ctx);

      api['tasks.update']({ id: t.id, title: 'Pagar conta', dueDate: '2026-10-20' });
      expect(at('2026-10-19T12:00:20Z')).toBe(0);
      expect(nextFire()).toBe('2026-10-20T12:00:00.000Z');
      expect(only().title).toBe('Pagar conta');

      api['tasks.complete']({ id: t.id });
      expect(at('2026-10-20T12:00:20Z')).toBe(0);

      api['tasks.delete']({ id: t.id });
      at('2026-10-20T12:02:00Z');
      expect(svc.listReminders(ctx)).toEqual([]);
    });
  });
});
