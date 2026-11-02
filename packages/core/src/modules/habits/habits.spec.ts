import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';

import type { HabitBody } from './service';
import * as svc from './service';

// Segunda, 02/11/2026, meio-dia em São Paulo.
const NOW = new Date('2026-11-02T15:00:00Z');
const AT_21H = new Date('2026-11-03T00:00:00Z');
const BEFORE_20H = new Date('2026-11-02T22:00:00Z');

const body = (over: Partial<HabitBody> = {}): HabitBody => ({
  name: 'Ler',
  kind: 'CONTINUOUS',
  frequency: 'DAILY',
  color: 'green',
  ...over,
});

describe('hábitos', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  const notify = vi.fn();
  const expectStatus = (run: () => unknown, status: number) =>
    expect(run).toThrow(expect.objectContaining({ status }));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    notify.mockClear();
    dir = mkdtempSync(join(tmpdir(), 'sektor-habits-'));
    handle = openDatabase(join(dir, 'h.db'), 'c'.repeat(64));
    ctx = { db: handle.orm, timeZone: 'America/Sao_Paulo', notify } as unknown as AppCtx;
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('marca e desmarca, e dá para marcar de novo o mesmo dia', () => {
    const { id } = svc.createHabit(ctx, body());
    expect(svc.toggleCheck(ctx, id, '2026-11-02').doneToday).toBe(true);
    expect(svc.toggleCheck(ctx, id, '2026-11-02').doneToday).toBe(false);
    expect(svc.toggleCheck(ctx, id, '2026-11-02').doneToday).toBe(true);
  });

  it('marca dias anteriores e recusa o futuro', () => {
    const { id } = svc.createHabit(ctx, body());
    svc.toggleCheck(ctx, id, '2026-11-01');
    const view = svc.toggleCheck(ctx, id, '2026-11-02');
    expect(view).toMatchObject({ streak: 2, longestStreak: 2, rate: 1 });
    expect(view.grid).toHaveLength(28);
    expect(view.grid.at(-1)).toMatchObject({ date: '2026-11-02', done: true });
    expectStatus(() => svc.toggleCheck(ctx, id, '2026-11-03'), 400);
  });

  it('desafio exige prazo e encerra nele', () => {
    expectStatus(() => svc.createHabit(ctx, body({ kind: 'CHALLENGE' })), 400);
    expectStatus(
      () => svc.createHabit(ctx, body({ kind: 'CHALLENGE', endOn: '2026-11-01' })),
      400
    );
    const { id } = svc.createHabit(ctx, body({ kind: 'CHALLENGE', endOn: '2026-11-03' }));
    svc.toggleCheck(ctx, id, '2026-11-02');
    expect(svc.listHabits(ctx)[0]!.challenge).toEqual({ done: 1, target: 2, daysLeft: 1 });

    vi.setSystemTime(new Date('2026-11-10T15:00:00Z'));
    const ended = svc.listHabits(ctx)[0]!;
    expect(ended).toMatchObject({ ended: true, due: false, atRisk: false, streak: 1 });
    expectStatus(() => svc.toggleCheck(ctx, id, '2026-11-10'), 400);
    expect(svc.habitsToday(ctx).total).toBe(0);
  });

  it('reordena e recusa lista desatualizada', () => {
    const a = svc.createHabit(ctx, body({ name: 'A' }));
    const b = svc.createHabit(ctx, body({ name: 'B' }));
    const c = svc.createHabit(ctx, body({ name: 'C' }));
    expect(svc.reorderHabits(ctx, [c.id, a.id, b.id]).map((h) => h.name)).toEqual(['C', 'A', 'B']);
    expectStatus(() => svc.reorderHabits(ctx, [c.id, a.id]), 409);
    const d = svc.createHabit(ctx, body({ name: 'D' }));
    expect(d.position).toBe(3);
  });

  it('apagar some da lista e das marcas', () => {
    const { id } = svc.createHabit(ctx, body());
    svc.toggleCheck(ctx, id, '2026-11-02');
    svc.deleteHabit(ctx, id);
    expect(svc.listHabits(ctx)).toEqual([]);
    expectStatus(() => svc.toggleCheck(ctx, id, '2026-11-02'), 404);
  });

  it('habits.today traz só o que vale hoje, com o resumo', () => {
    const read = svc.createHabit(ctx, body({ name: 'Ler' }));
    svc.createHabit(ctx, body({ name: 'Correr', frequency: 'TIMES', timesPerWeek: 1 }));
    const met = svc.createHabit(ctx, body({ name: 'Nadar', frequency: 'TIMES', timesPerWeek: 1 }));
    svc.toggleCheck(ctx, met.id, '2026-11-01');
    svc.toggleCheck(ctx, read.id, '2026-11-02');
    const today = svc.habitsToday(ctx);
    expect(today).toMatchObject({ date: '2026-11-02', done: 1, total: 2 });
    expect(today.habits.map((h) => h.name)).toEqual(['Ler', 'Correr']);
  });

  describe('aviso das 20h', () => {
    it('avisa uma vez por dia, com a sequência', () => {
      const { id } = svc.createHabit(ctx, body());
      svc.toggleCheck(ctx, id, '2026-10-31');
      svc.toggleCheck(ctx, id, '2026-11-01');
      svc.riskNotice(ctx, AT_21H);
      svc.riskNotice(ctx, AT_21H);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0]![1]).toContain('2 dias');
    });

    it('fica quieto antes das 20h locais', () => {
      const { id } = svc.createHabit(ctx, body());
      svc.toggleCheck(ctx, id, '2026-11-01');
      svc.riskNotice(ctx, BEFORE_20H);
      expect(notify).not.toHaveBeenCalled();
    });

    it('não avisa quem já marcou nem quem não tem sequência', () => {
      const a = svc.createHabit(ctx, body({ name: 'A' }));
      svc.createHabit(ctx, body({ name: 'B' }));
      svc.toggleCheck(ctx, a.id, '2026-11-01');
      svc.toggleCheck(ctx, a.id, '2026-11-02');
      svc.riskNotice(ctx, AT_21H);
      expect(notify).not.toHaveBeenCalled();
    });

    it('junta vários hábitos em um aviso só', () => {
      for (const name of ['A', 'B']) {
        const { id } = svc.createHabit(ctx, body({ name }));
        svc.toggleCheck(ctx, id, '2026-11-01');
      }
      svc.riskNotice(ctx, AT_21H);
      expect(notify).toHaveBeenCalledTimes(1);
      expect(notify.mock.calls[0]![1]).toContain('A, B');
    });
  });
});
