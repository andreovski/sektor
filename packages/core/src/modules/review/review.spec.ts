import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';
import * as focus from '../focus/service';

import { periodOf } from './period';
import * as review from './service';

// Quarta, 04/11/2026, 12h em São Paulo.
const NOW = new Date('2026-11-04T15:00:00Z');

describe('revisão', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  let notes: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-review-'));
    handle = openDatabase(join(dir, 'r.db'), 'b'.repeat(64));
    notes = [];
    ctx = {
      db: handle.orm,
      timeZone: 'America/Sao_Paulo',
      notify: (title: string) => notes.push(title),
    } as unknown as AppCtx;
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('semana vai de segunda a domingo, e não anda para o futuro', () => {
    expect(periodOf('week', undefined, '2026-11-04')).toEqual({
      kind: 'week',
      key: '2026-11-02',
      from: '2026-11-02',
      to: '2026-11-08',
      previous: '2026-10-26',
      next: null,
    });
    expect(periodOf('week', '2026-11-08', '2026-11-04').key).toBe('2026-11-02');
    expect(periodOf('week', '2026-10-26', '2026-11-04').next).toBe('2026-11-02');
    expect(periodOf('month', '2026-02', '2026-11-04')).toMatchObject({
      to: '2026-02-28',
      previous: '2026-01',
      next: '2026-03',
    });
    expect(periodOf('month', undefined, '2026-11-04').next).toBeNull();
    expect(periodOf('year', '2025', '2026-11-04')).toMatchObject({
      from: '2025-01-01',
      to: '2025-12-31',
      next: '2026',
    });
    expect(() => periodOf('month', '2026', '2026-11-04')).toThrow(
      expect.objectContaining({ status: 400 })
    );
  });

  it('sem os outros módulos, marca como indisponível em vez de zero', () => {
    handle.raw.exec(`PRAGMA foreign_keys = OFF; DROP TABLE tasks; DROP TABLE habit_checks;
      DROP TABLE health_days; DROP TABLE transactions;`);
    const { totals, available, days } = review.getPeriod(ctx, 'week');
    expect(available).toEqual({ tasks: false, habits: false, mood: false, expenses: false });
    expect(totals).toEqual({
      tasks: null,
      focusSeconds: 0,
      habits: null,
      mood: null,
      expenseCents: null,
    });
    expect(days).toHaveLength(7);
    expect(days.map((d) => d.future)).toEqual([false, false, false, true, true, true, true]);
  });

  it('soma por dia, no período e, no ano, por mês', () => {
    focus.startSession(ctx, { mode: 'FREE' });
    vi.setSystemTime(new Date(NOW.getTime() + 3_600_000));
    focus.finishSession(ctx);
    handle.raw.exec(`
      INSERT INTO accounts (id, created_at, updated_at, name, type) VALUES ('a', 1, 1, 'C', 'CHECKING');
      INSERT INTO transactions (id, created_at, updated_at, kind, amount_cents, date, account_id, description, status)
      VALUES ('1', 1, 1, 'EXPENSE', 1500, '2026-11-03', 'a', 'x', 'DONE'),
             ('2', 1, 1, 'EXPENSE', 500, '2026-11-03', 'a', 'x', 'DONE'),
             ('3', 1, 1, 'EXPENSE', 900, '2026-11-03', 'a', 'x', 'PLANNED'),
             ('4', 1, 1, 'INCOME', 900, '2026-11-03', 'a', 'x', 'DONE'),
             ('5', 1, 1, 'EXPENSE', 700, '2026-11-09', 'a', 'x', 'DONE');
    `);
    const week = review.getPeriod(ctx, 'week');
    expect(week.totals).toMatchObject({ focusSeconds: 3600, expenseCents: 2000 });
    expect(week.days[1]).toMatchObject({ key: '2026-11-03', expenseCents: 2000 });
    expect(week.days[2]).toMatchObject({ key: '2026-11-04', focusSeconds: 3600 });

    const year = review.getPeriod(ctx, 'year');
    expect(year.days).toHaveLength(12);
    expect(year.days[10]).toMatchObject({ key: '2026-11', focusSeconds: 3600, expenseCents: 2700 });
    expect(year.days[11]!.future).toBe(true);
    expect(year.review).toBeNull();
  });

  it('lê tarefas, hábitos e humor das tabelas dos outros módulos', () => {
    // 01h de 03/11 em UTC ainda é dia 02 em São Paulo.
    const lateMonday = Date.UTC(2026, 10, 3, 1);
    const sundayBefore = Date.UTC(2026, 10, 2, 2);
    handle.raw.exec(`
      INSERT INTO task_lists (id, created_at, updated_at, name) VALUES ('l', 1, 1, 'Lista');
      INSERT INTO tasks (id, created_at, updated_at, deleted_at, list_id, title, status, completed_at) VALUES
        ('t1', 1, 1, NULL, 'l', 'a', 'DONE', ${lateMonday}),
        ('t2', 1, 1, NULL, 'l', 'b', 'DONE', ${sundayBefore}),
        ('t3', 1, 1, 5, 'l', 'c', 'DONE', ${lateMonday});
      INSERT INTO habits (id, created_at, updated_at, name, start_on) VALUES ('h', 1, 1, 'Ler', '2026-10-01');
      INSERT INTO habit_checks (id, created_at, updated_at, deleted_at, habit_id, date) VALUES
        ('c1', 1, 1, NULL, 'h', '2026-11-02'),
        ('c2', 1, 1, 5, 'h', '2026-11-03');
      INSERT INTO health_days (id, created_at, updated_at, date, mood) VALUES
        ('d1', 1, 1, '2026-11-02', 4),
        ('d2', 1, 1, '2026-11-03', 5),
        ('d3', 1, 1, '2026-11-04', NULL);
    `);
    const { totals, available, days } = review.getPeriod(ctx, 'week');
    expect(available).toEqual({ tasks: true, habits: true, mood: true, expenses: true });
    expect(totals).toMatchObject({ tasks: 1, habits: 1, mood: 4.5 });
    expect(days[0]).toMatchObject({ tasks: 1, habits: 1, mood: 4 });
    expect(days[2]!.mood).toBeNull();
  });

  it('salva, relê, atualiza e não perde a tarefa já criada', () => {
    const input = {
      weekStart: '2026-11-04',
      wentWell: ' foco ',
      blocked: '',
      priorities: ['Fechar proposta', ' ', 'Ligar para o banco'],
    };
    const saved = review.saveReview(ctx, input);
    expect(saved).toMatchObject({ weekStart: '2026-11-02', wentWell: 'foco' });
    expect(saved.priorities).toEqual([
      { text: 'Fechar proposta', taskId: null },
      { text: 'Ligar para o banco', taskId: null },
    ]);
    review.linkPriority(ctx, '2026-11-02', 'Fechar proposta', 't1');
    const again = review.saveReview(ctx, { ...input, priorities: ['Fechar proposta', 'Outra'] });
    expect(again.id).toBe(saved.id);
    expect(again.priorities).toEqual([
      { text: 'Fechar proposta', taskId: 't1' },
      { text: 'Outra', taskId: null },
    ]);
    expect(review.getPeriod(ctx, 'week').review?.id).toBe(saved.id);
    expect(() => review.linkPriority(ctx, '2026-11-02', 'Sumiu', 't2')).toThrow(
      expect.objectContaining({ status: 409 })
    );
  });

  it('lembra no domingo às 18h, uma vez, e não se a semana já foi revisada', () => {
    vi.setSystemTime(new Date('2026-11-08T20:59:00Z')); // domingo, 17h59
    review.remind(ctx);
    expect(notes).toEqual([]);
    vi.setSystemTime(new Date('2026-11-08T21:00:00Z')); // domingo, 18h
    review.remind(ctx);
    review.remind(ctx);
    expect(notes).toEqual(['Revisão da semana']);
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z')); // segunda
    review.remind(ctx);
    expect(notes).toHaveLength(1);
    review.saveReview(ctx, { weekStart: '2026-11-09', wentWell: '', blocked: '', priorities: [] });
    vi.setSystemTime(new Date('2026-11-15T22:00:00Z'));
    review.remind(ctx);
    expect(notes).toHaveLength(1);
  });
});
