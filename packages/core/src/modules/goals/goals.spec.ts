import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';
import * as cat from '../../services/categories';
import * as fin from '../../services/finance';
import * as habits from '../habits/service';

import type { GoalBody } from './service';
import * as svc from './service';

const NOW = new Date('2026-11-02T15:00:00Z');

const body = (over: Partial<GoalBody> = {}): GoalBody => ({
  title: 'Correr 100 km',
  area: 'SAUDE',
  target: 100,
  unit: 'km',
  deadline: '2027-01-31',
  color: 'blue',
  source: 'MANUAL',
  ...over,
});

describe('metas', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  const expectStatus = (run: () => unknown, status: number) =>
    expect(run).toThrow(expect.objectContaining({ status }));

  // Se o módulo de tarefas já existir, troca as tabelas pelo mínimo combinado no contrato.
  const dropTasks = () =>
    handle.raw.exec('PRAGMA foreign_keys = OFF; DROP TABLE IF EXISTS tasks; DROP TABLE IF EXISTS projects; PRAGMA foreign_keys = ON;');
  const createTasks = () => {
    dropTasks();
    handle.raw.exec(`
      CREATE TABLE projects (id text PRIMARY KEY, name text NOT NULL, deleted_at integer);
      CREATE TABLE tasks (id text PRIMARY KEY, project_id text, completed_at integer, deleted_at integer);
      INSERT INTO projects (id, name) VALUES ('p1', 'Mudança');
      INSERT INTO tasks VALUES
        ('t1', 'p1', 1, NULL), ('t2', 'p1', 1, NULL), ('t3', 'p1', NULL, NULL),
        ('t4', 'p1', 1, 5), ('t5', 'outro', 1, NULL);
    `);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-goals-'));
    handle = openDatabase(join(dir, 'g.db'), 'd'.repeat(64));
    ctx = { db: handle.orm, timeZone: 'America/Sao_Paulo', notify: () => {} } as unknown as AppCtx;
    cat.ensureCategories(ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('progresso manual com ritmo, e sem aceitar alvo ligado', () => {
    const goal = svc.createGoal(ctx, body({ manualValue: 40 }));
    expect(goal).toMatchObject({ current: 40, money: false });
    expect(goal.pace).toMatchObject({ remaining: 60, progress: 0.4, period: 'month' });
    expect(svc.setProgress(ctx, goal.id, 100).pace.status).toBe('done');
    expect(svc.listGoals(ctx)).toHaveLength(1);
  });

  it('meta em dinheiro guarda centavos inteiros', () => {
    expectStatus(() => svc.createGoal(ctx, body({ unit: 'R$', target: 10.5 })), 400);
    const goal = svc.createGoal(ctx, body({ unit: 'R$', target: 1000_00 }));
    expect(goal.money).toBe(true);
    expectStatus(() => svc.setProgress(ctx, goal.id, 1.5), 400);
  });

  it('sem o módulo de tarefas, não quebra e não lista projetos', () => {
    dropTasks();
    expect(svc.goalSources(ctx).projects).toEqual([]);
    expectStatus(
      () => svc.createGoal(ctx, body({ source: 'PROJECT_TASKS', sourceId: 'p1' })),
      404
    );
  });

  it('conta tarefas concluídas do projeto, sem as apagadas', () => {
    createTasks();
    expect(svc.goalSources(ctx).projects).toEqual([{ id: 'p1', label: 'Mudança', total: 3 }]);
    const goal = svc.createGoal(ctx, body({ source: 'PROJECT_TASKS', sourceId: 'p1', target: 4 }));
    expect(goal).toMatchObject({ current: 2, unit: 'tarefas', sourceLabel: 'Mudança' });
  });

  it('lê as tabelas reais do módulo de tarefas', () => {
    handle.raw.exec(`
      INSERT INTO task_lists (id, created_at, updated_at, name) VALUES ('l1', 1, 1, 'Geral');
      INSERT INTO projects (id, created_at, updated_at, name) VALUES ('p1', 1, 1, 'Mudança');
      INSERT INTO tasks (id, created_at, updated_at, list_id, project_id, title, status, completed_at)
      VALUES ('t1', 1, 1, 'l1', 'p1', 'A', 'DONE', 1), ('t2', 1, 1, 'l1', 'p1', 'B', 'TODO', NULL);
    `);
    expect(svc.goalSources(ctx).projects).toEqual([{ id: 'p1', label: 'Mudança', total: 2 }]);
    const goal = svc.createGoal(ctx, body({ source: 'PROJECT_TASKS', sourceId: 'p1', target: 2 }));
    expect(goal).toMatchObject({ current: 1, sourceLabel: 'Mudança' });
  });

  it('se o módulo some depois, a meta avisa e continua na lista', () => {
    createTasks();
    svc.createGoal(ctx, body({ source: 'PROJECT_TASKS', sourceId: 'p1', target: 4 }));
    dropTasks();
    expect(svc.listGoals(ctx)[0]).toMatchObject({ current: 0, sourceMissing: true });
    expectStatus(() => svc.setProgress(ctx, svc.listGoals(ctx)[0]!.id, 1), 409);
  });

  it('acompanha a sequência do hábito e avisa quando o hábito é apagado', () => {
    const habit = habits.createHabit(ctx, {
      name: 'Ler',
      kind: 'CONTINUOUS',
      frequency: 'DAILY',
      color: 'green',
    });
    habits.toggleCheck(ctx, habit.id, '2026-11-01');
    habits.toggleCheck(ctx, habit.id, '2026-11-02');
    const goal = svc.createGoal(
      ctx,
      body({ source: 'HABIT_STREAK', sourceId: habit.id, target: 30, deadline: '2026-11-10' })
    );
    expect(goal).toMatchObject({ current: 2, unit: 'dias', sourceLabel: 'Ler' });
    expect(goal.pace).toMatchObject({ status: 'unreachable', perPeriod: null });
    habits.deleteHabit(ctx, habit.id);
    expect(svc.listGoals(ctx)[0]!.sourceMissing).toBe(true);
  });

  it('o saldo da conta bate com o do financeiro', () => {
    const reserve = fin.createAccount(ctx, {
      name: 'Reserva',
      type: 'SAVINGS',
      initialBalanceCents: 500_00,
    });
    const main = fin.createAccount(ctx, {
      name: 'Corrente',
      type: 'CHECKING',
      initialBalanceCents: 2000_00,
    });
    const category = cat.listCategories(ctx).find((c) => c.kind === 'EXPENSE' && !c.systemKey)!;
    fin.createTransactions(ctx, {
      kind: 'TRANSFER',
      amountCents: 300_00,
      date: '2026-11-01',
      accountId: main.id,
      toAccountId: reserve.id,
      description: 'Guardar',
    } as never);
    fin.createTransactions(ctx, {
      kind: 'EXPENSE',
      amountCents: 50_00,
      date: '2026-11-01',
      accountId: reserve.id,
      categoryId: category.id,
      description: 'Saque',
    } as never);
    fin.createTransactions(ctx, {
      kind: 'INCOME',
      amountCents: 999_00,
      date: '2026-12-20',
      accountId: reserve.id,
      categoryId: cat.listCategories(ctx).find((c) => c.kind === 'INCOME' && !c.systemKey)!.id,
      description: 'Previsto',
      status: 'PLANNED',
    } as never);

    const goal = svc.createGoal(
      ctx,
      body({ source: 'ACCOUNT_BALANCE', sourceId: reserve.id, target: 1000_00, unit: 'x' })
    );
    const balance = fin.listAccounts(ctx).find((a) => a.id === reserve.id)!;
    expect(goal).toMatchObject({ current: 750_00, unit: 'R$', money: true });
    expect(JSON.stringify(balance)).toContain(String(750_00));
    expect(svc.goalSources(ctx).accounts.map((a) => a.balanceCents).sort()).toContain(750_00);
  });

  it('não lista cartão como lugar para guardar', () => {
    fin.createAccount(ctx, {
      name: 'Cartão',
      type: 'CREDIT_CARD',
      initialBalanceCents: 0,
      closingDay: 25,
      dueDay: 5,
    });
    expect(svc.goalSources(ctx).accounts).toEqual([]);
  });

  it('ordena por prazo, sem prazo depois, concluídas no fim', () => {
    svc.createGoal(ctx, body({ title: 'Pronta', manualValue: 100 }));
    svc.createGoal(ctx, body({ title: 'Sem prazo', deadline: null }));
    svc.createGoal(ctx, body({ title: 'Longe', deadline: '2027-06-01' }));
    svc.createGoal(ctx, body({ title: 'Perto', deadline: '2026-12-01' }));
    expect(svc.listGoals(ctx).map((g) => g.title)).toEqual(['Perto', 'Longe', 'Sem prazo', 'Pronta']);
  });

  it('edita e apaga', () => {
    const { id } = svc.createGoal(ctx, body());
    expect(svc.updateGoal(ctx, id, body({ title: 'Outra', target: 50 }))).toMatchObject({
      title: 'Outra',
      target: 50,
    });
    svc.deleteGoal(ctx, id);
    expect(svc.listGoals(ctx)).toEqual([]);
    expectStatus(() => svc.setProgress(ctx, id, 1), 404);
  });
});
