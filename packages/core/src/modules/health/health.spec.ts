import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';

import { handlers, jobs } from '.';
import { adherence, type Schedule, sleepMinutes, slotsOn } from './schedule';
import * as svc from './service';

// Segunda, 02/11/2026, 10:00 em São Paulo.
const NOW = new Date('2026-11-02T13:00:00Z');
const at = (date: string, time: string) => new Date(`${date}T${time}:00-03:00`);

const daily: Schedule = {
  schedule: 'DAILY',
  weekdays: [],
  intervalDays: null,
  times: ['08:00', '20:00'],
  startDate: '2026-10-01',
  endDate: null,
};

describe('regras puras', () => {
  it('sono atravessa a meia-noite', () => {
    expect(sleepMinutes('23:30', '07:15')).toBe(465);
    expect(sleepMinutes('00:30', '08:00')).toBe(450);
    expect(sleepMinutes('13:00', '14:30')).toBe(90);
  });

  it('agenda: todo dia, dias da semana, a cada X dias, se precisar, início e fim', () => {
    expect(slotsOn(daily, '2026-09-30')).toEqual([]);
    expect(slotsOn(daily, '2026-10-01')).toEqual(daily.times);
    expect(slotsOn({ ...daily, endDate: '2026-10-05' }, '2026-10-06')).toEqual([]);
    const weekdays = { ...daily, schedule: 'WEEKDAYS' as const, weekdays: [1, 3] };
    expect(slotsOn(weekdays, '2026-11-02')).toEqual(daily.times);
    expect(slotsOn(weekdays, '2026-11-03')).toEqual([]);
    const interval = { ...daily, schedule: 'INTERVAL' as const, intervalDays: 3 };
    expect(slotsOn(interval, '2026-10-04')).toEqual(daily.times);
    expect(slotsOn(interval, '2026-10-05')).toEqual([]);
    expect(slotsOn({ ...daily, schedule: 'AS_NEEDED' }, '2026-10-05')).toEqual([]);
  });

  it('aderência: só conta hoje o que já venceu ou foi tomado', () => {
    const taken = new Map([['2026-11-01', 2], ['2026-11-02', 1]]);
    expect(adherence(daily, taken, '2026-11-01', '2026-11-02', '10:00')).toEqual({
      expected: 3,
      taken: 3,
      percent: 100,
    });
    expect(adherence(daily, new Map(), '2026-11-01', '2026-11-02', '10:00').percent).toBe(0);
    expect(adherence(daily, new Map(), '2026-11-02', '2026-11-02', '07:00').percent).toBeNull();
    // Tomar a mais não passa de 100%.
    expect(adherence(daily, new Map([['2026-11-01', 9]]), '2026-11-01', '2026-11-01', '10:00').taken).toBe(2);
  });
});

describe('saúde', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  let rpc: ReturnType<typeof handlers>;
  const notify = vi.fn();
  const expectStatus = (run: () => unknown, status: number) =>
    expect(run).toThrow(expect.objectContaining({ status }));

  const med = (fields: Partial<Parameters<typeof rpc['health.medSave']>[0]> = {}) =>
    rpc['health.medSave']({
      name: 'Vitamina D',
      kind: 'SUPPLEMENT',
      dose: '1 cápsula',
      schedule: 'DAILY',
      times: ['08:00'],
      startDate: '2026-10-01',
      ...fields,
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    notify.mockClear();
    dir = mkdtempSync(join(tmpdir(), 'sektor-health-'));
    handle = openDatabase(join(dir, 'h.db'), 'c'.repeat(64));
    ctx = {
      db: handle.orm,
      timeZone: 'America/Sao_Paulo',
      notify,
      keys: null as never,
      secrets: null as never,
    };
    rpc = handlers(ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('check-in parcial não apaga o resto e recusa fora da escala e dia futuro', () => {
    rpc['health.checkinSave']({ date: '2026-11-02', mood: 4 });
    rpc['health.checkinSave']({ date: '2026-11-02', energy: 2 });
    const day = rpc['health.checkinSave']({ date: '2026-11-02', gratitude: '  café  ' });
    expect(day.checkin).toEqual({ mood: 4, energy: 2, gratitude: 'café' });
    expectStatus(() => rpc['health.checkinSave']({ date: '2026-11-02', mood: 6 }), 400);
    expectStatus(() => rpc['health.checkinSave']({ date: '2026-11-03', mood: 3 }), 400);
    expectStatus(() => rpc['health.checkinSave']({ date: '2026-02-31', mood: 3 }), 400);
  });

  it('sono calcula a duração e aparece na média', () => {
    rpc['health.sleepSave']({ date: '2026-11-02', bedTime: '23:00', wakeTime: '07:00', quality: 4 });
    rpc['health.sleepSave']({ date: '2026-11-01', bedTime: '00:30', wakeTime: '06:30' });
    expect(rpc['health.today']().sleep?.minutes).toBe(480);
    const history = rpc['health.sleepList']();
    expect(history.averageWeek).toBe(420);
    expect(history.entries.map((e) => e.date)).toEqual(['2026-11-02', '2026-11-01']);
    expectStatus(
      () => rpc['health.sleepSave']({ date: '2026-11-02', bedTime: '07:00', wakeTime: '07:00' }),
      400
    );
    rpc['health.sleepDelete']({ date: '2026-11-02' });
    expect(rpc['health.today']().sleep).toBeNull();
  });

  it('água soma por copo, não fica negativa e o copo novo não reescreve o passado', () => {
    rpc['health.waterAdd']({ date: '2026-11-02', glasses: 1 });
    expect(rpc['health.waterAdd']({ date: '2026-11-02', glasses: 1 }).water).toMatchObject({
      ml: 500,
      glasses: 2,
      goalGlasses: 8,
    });
    rpc['health.settingsSave']({ glassMl: 500, goalMl: 3000 });
    expect(rpc['health.today']().water).toMatchObject({ ml: 500, glasses: 1, goalGlasses: 6 });
    expect(rpc['health.waterAdd']({ date: '2026-11-02', glasses: -5 }).water.ml).toBe(0);
    expectStatus(() => rpc['health.settingsSave']({ glassMl: 1, goalMl: 3000 }), 400);
  });

  it('diário salva, acha sem acento nem maiúscula e some ao esvaziar', () => {
    rpc['health.diarySave']({ date: '2026-11-01', text: 'Dia corrido.\nDor no CORAÇÃO da rotina' });
    rpc['health.diarySave']({ date: '2026-11-02', text: 'Tudo calmo' });
    expect(rpc['health.diaryGet']({ date: '2026-11-02' }).text).toBe('Tudo calmo');
    const [hit] = rpc['health.diaryList']({ query: 'coracao' });
    expect(hit?.date).toBe('2026-11-01');
    expect(hit?.snippet.slice(hit.match!.start, hit.match!.start + hit.match!.length)).toBe('CORAÇÃO');
    expect(rpc['health.diaryList']({ query: 'inexistente' })).toEqual([]);
    expect(rpc['health.diaryList']()).toHaveLength(2);
    rpc['health.diarySave']({ date: '2026-11-02', text: '   ' });
    expect(rpc['health.diaryList']()).toHaveLength(1);
  });

  it('marca e desmarca a dose, e a remarcação convive com a apagada', () => {
    const { id } = med();
    const set = (taken: boolean) =>
      rpc['health.doseSet']({ medId: id, date: '2026-11-02', time: '08:00', taken });
    expect(rpc['health.today']().doses[0]).toMatchObject({ taken: false, late: true });
    set(true);
    set(true);
    expect(rpc['health.today']().doses[0]).toMatchObject({ taken: true, late: false });
    set(false);
    expect(rpc['health.today']().doses[0]?.taken).toBe(false);
    set(true);
    expect(rpc['health.today']().doses).toHaveLength(1);
    expectStatus(
      () => rpc['health.doseSet']({ medId: id, date: '2026-11-02', time: '09:00', taken: true }),
      400
    );
    expectStatus(
      () => rpc['health.doseSet']({ medId: id, date: '2026-11-03', time: '08:00', taken: true }),
      400
    );
  });

  it('valida a rotina do remédio', () => {
    expectStatus(() => med({ times: [] }), 400);
    expectStatus(() => med({ schedule: 'WEEKDAYS', weekdays: [] }), 400);
    expectStatus(() => med({ schedule: 'INTERVAL' }), 400);
    expectStatus(() => med({ endDate: '2026-09-01' }), 400);
    expect(med({ schedule: 'AS_NEEDED', times: ['08:00'] }).times).toEqual([]);
  });

  it('"Tomei agora" vale só no uso se precisar e pode ser desfeito', () => {
    const asNeeded = med({ name: 'Dipirona', schedule: 'AS_NEEDED', times: [] });
    const first = rpc['health.takeNow']({ medId: asNeeded.id });
    rpc['health.takeNow']({ medId: asNeeded.id });
    expect(rpc['health.today']().asNeeded[0]?.uses).toHaveLength(2);
    expect(rpc['health.medList']().items[0]).toMatchObject({ uses: 2, adherence: null });
    rpc['health.takeUndo']({ id: first.id });
    expect(rpc['health.today']().asNeeded[0]?.uses).toHaveLength(1);
    expectStatus(() => rpc['health.takeNow']({ medId: med().id }), 400);
  });

  it('aderência da lista, e mudar a rotina recomeça a conta', () => {
    const { id } = med({ startDate: '2026-10-30' });
    rpc['health.doseSet']({ medId: id, date: '2026-10-30', time: '08:00', taken: true });
    rpc['health.doseSet']({ medId: id, date: '2026-11-01', time: '08:00', taken: true });
    const list = rpc['health.medList']();
    expect(list.items[0]?.adherence).toEqual({ expected: 4, taken: 2, percent: 50 });
    expect(list.overall.percent).toBe(50);

    rpc['health.medSave']({ ...list.items[0]!, id, times: ['09:30'] });
    expect(rpc['health.medList']().items[0]?.adherence?.expected).toBe(4);

    rpc['health.medSave']({ ...list.items[0]!, id, times: ['08:00', '21:00'] });
    expect(rpc['health.medList']().items[0]?.adherenceFrom).toBe('2026-11-02');
  });

  it('dose de hoje já tomada acompanha a troca de horário e não volta a avisar', () => {
    const created = med();
    rpc['health.doseSet']({ medId: created.id, date: '2026-11-02', time: '08:00', taken: true });
    rpc['health.medSave']({ ...created, times: ['09:00'] });
    expect(rpc['health.today']().doses[0]).toMatchObject({ time: '09:00', taken: true });
    svc.noticeDoses(ctx);
    expect(notify).not.toHaveBeenCalled();
  });

  it('avisa a dose uma vez só, e não avisa a tomada nem a de longe', () => {
    const { id } = med({ times: ['09:50', '20:00'] });
    med({ name: 'Antiga', times: ['02:00'] });
    jobs[0]!.run(ctx);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Hora da dose', 'Vitamina D (1 cápsula), 09:50');
    jobs[0]!.run(ctx);
    svc.noticeDoses(ctx, at('2026-11-02', '10:05'));
    expect(notify).toHaveBeenCalledTimes(1);

    rpc['health.doseSet']({ medId: id, date: '2026-11-02', time: '20:00', taken: true });
    svc.noticeDoses(ctx, at('2026-11-02', '20:01'));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('dose perto da meia-noite é avisada no dia seguinte, e várias viram um aviso só', () => {
    med({ times: ['23:58'] });
    med({ name: 'Ômega 3', times: ['23:59'] });
    vi.setSystemTime(at('2026-11-03', '00:03'));
    svc.noticeDoses(ctx);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toBe('2 doses para tomar');
  });

  it('consulta: avisa na véspera, uma vez, e feita não avisa', () => {
    const save = (title: string, extra = {}) =>
      rpc['health.appointmentSave']({ kind: 'CONSULTATION', title, date: '2026-11-03', ...extra });
    const consult = save('Cardiologista', { time: '14:00', location: 'Clínica X' });
    const done = save('Dentista');
    rpc['health.appointmentDone']({ id: done.id, done: true });
    svc.noticeAppointments(ctx, at('2026-11-02', '08:00'));
    expect(notify).not.toHaveBeenCalled();
    svc.noticeAppointments(ctx);
    svc.noticeAppointments(ctx);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('Amanhã: Cardiologista', 'Consulta, às 14:00, Clínica X');

    rpc['health.appointmentSave']({ ...consult, kind: 'CONSULTATION', date: '2026-11-10' });
    svc.noticeAppointments(ctx, at('2026-11-09', '09:00'));
    expect(notify).toHaveBeenCalledTimes(2);

    expectStatus(() => save('Retorno errado', { returnDate: '2026-11-01' }), 400);
  });

  it('o retorno também é avisado na véspera, mesmo com a consulta feita', () => {
    const { id } = rpc['health.appointmentSave']({
      kind: 'EXAM',
      title: 'Sangue',
      date: '2026-11-01',
      returnDate: '2026-11-03',
    });
    rpc['health.appointmentDone']({ id, done: true });
    svc.noticeAppointments(ctx);
    expect(notify).toHaveBeenCalledWith('Amanhã: retorno de Sangue', 'Retorno marcado');
  });

  it('lista consultas pendentes e feitas, e health.today traz a próxima', () => {
    const past = rpc['health.appointmentSave']({ kind: 'EXAM', title: 'A', date: '2026-10-01' });
    rpc['health.appointmentSave']({ kind: 'EXAM', title: 'B', date: '2026-12-01' });
    const list = rpc['health.appointmentList']();
    expect(list.pending.map((a) => [a.title, a.overdue])).toEqual([
      ['A', true],
      ['B', false],
    ]);
    expect(rpc['health.today']().nextAppointment?.title).toBe('B');
    rpc['health.appointmentDelete']({ id: past.id });
    expect(rpc['health.appointmentList']().pending).toHaveLength(1);
  });

  it('apagar remédio tira das doses', () => {
    const { id } = med();
    rpc['health.medDelete']({ id });
    expect(rpc['health.today']().doses).toEqual([]);
    expectStatus(() => rpc['health.medDelete']({ id }), 404);
  });

  it('padrões leem o banco', () => {
    const { patterns } = rpc['health.patterns']();
    expect(patterns.map((p) => p.status)).toEqual(['early', 'early', 'early', 'early']);
  });

  it('nada do módulo escreve no console', () => {
    for (const file of readdirSync(__dirname)) {
      if (file.endsWith('.spec.ts')) continue;
      expect(readFileSync(join(__dirname, file), 'utf8')).not.toMatch(/console\./);
    }
  });
});
