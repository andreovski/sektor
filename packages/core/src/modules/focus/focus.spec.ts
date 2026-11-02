import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';

import { focusSecondsAt } from './clock';
import { focusSessions } from './schema';
import * as focus from './service';

// Terça, 03/11/2026, 12h em São Paulo.
const NOW = new Date('2026-11-03T15:00:00Z').getTime();
const MIN = 60_000;

describe('foco', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  let notes: string[];

  const advance = (ms: number) => vi.setSystemTime(Date.now() + ms);
  const session = (minutes = 30) => {
    focus.startSession(ctx, { mode: 'FREE' });
    advance(minutes * MIN);
    return focus.finishSession(ctx);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-focus-'));
    handle = openDatabase(join(dir, 'f.db'), 'b'.repeat(64));
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

  it('o relógio sai de startedAt: reler a sessão dá o mesmo tempo', () => {
    focus.startSession(ctx, { mode: 'POMODORO' });
    advance(10 * MIN);
    expect(focus.activeSession(ctx)).toMatchObject({
      mode: 'POMODORO',
      plannedSeconds: 1500,
      elapsedSeconds: 600,
    });
  });

  it('só uma sessão aberta por vez, inclusive no banco', () => {
    focus.startSession(ctx, { mode: 'FREE' });
    expect(() => focus.startSession(ctx, { mode: 'FREE' })).toThrow(
      expect.objectContaining({ status: 409 })
    );
    const raw = () =>
      ctx.db
        .insert(focusSessions)
        .values({ id: 'x', createdAt: 1, updatedAt: 1, mode: 'FREE', day: '2026-11-03', startedAt: 1 })
        .run();
    expect(raw).toThrow();
  });

  it('a pausa não conta, e sair dela soma ao acumulado', () => {
    focus.startSession(ctx, { mode: 'FREE' });
    advance(5 * MIN);
    focus.pauseSession(ctx);
    advance(20 * MIN);
    expect(focus.activeSession(ctx)).toMatchObject({ paused: true, elapsedSeconds: 300 });
    focus.resumeSession(ctx);
    advance(5 * MIN);
    expect(focus.activeSession(ctx)).toMatchObject({ paused: false, elapsedSeconds: 600 });
    expect(focus.finishSession(ctx)).toMatchObject({ focusSeconds: 600, discarded: false });
  });

  it('terminar durante a pausa não conta o tempo parado', () => {
    focus.startSession(ctx, { mode: 'FREE' });
    advance(5 * MIN);
    focus.pauseSession(ctx);
    advance(MIN);
    expect(focus.finishSession(ctx).focusSeconds).toBe(300);
  });

  it('a pausa curta acaba sozinha: o relógio volta sem ninguém gravar', () => {
    focus.startSession(ctx, { mode: 'POMODORO' });
    advance(10 * MIN);
    focus.breakSession(ctx, 5);
    advance(2 * MIN);
    expect(focus.activeSession(ctx)).toMatchObject({ paused: true, elapsedSeconds: 600 });
    advance(13 * MIN);
    expect(focus.activeSession(ctx)).toMatchObject({ paused: false, elapsedSeconds: 1200 });
  });

  it('menos de 30 s não entra no histórico nem na soma', () => {
    focus.startSession(ctx, { mode: 'FREE' });
    advance(29_000);
    expect(focus.finishSession(ctx)).toMatchObject({ focusSeconds: 29, discarded: true });
    expect(focus.history(ctx)).toEqual([]);
    expect(focus.panel(ctx).todaySeconds).toBe(0);
    expect(focus.activeSession(ctx)).toBeNull();
    focus.startSession(ctx, { mode: 'FREE' });
    advance(30_000);
    expect(focus.finishSession(ctx)).toMatchObject({ discarded: false });
    expect(focus.history(ctx)).toHaveLength(1);
  });

  it('guarda o que ficou e apaga marcando', () => {
    const { id } = session();
    expect(focus.noteSession(ctx, id, '  fechei o relatório ').note).toBe('fechei o relatório');
    expect(focus.history(ctx)[0]!.note).toBe('fechei o relatório');
    focus.deleteSession(ctx, id);
    expect(focus.history(ctx)).toEqual([]);
    expect(() => focus.noteSession(ctx, id, 'x')).toThrow(expect.objectContaining({ status: 404 }));
    expect(ctx.db.select().from(focusSessions).all()).toHaveLength(1);
  });

  it('painel: semana de segunda a domingo, melhor dia, 14 dias e sessão aberta', () => {
    session(60);
    advance(-8 * 24 * 60 * MIN); // segunda, 26/10
    session(120);
    advance(8 * 24 * 60 * MIN - 60 * MIN);
    focus.startSession(ctx, { mode: 'FREE' });
    advance(30 * MIN);
    const panel = focus.panel(ctx);
    expect(panel.todaySeconds).toBe(5400);
    expect(panel.weekSeconds).toBe(5400);
    expect(panel.bestDay).toEqual({ date: '2026-10-26', seconds: 7200 });
    expect(panel.last14).toHaveLength(14);
    expect(panel.last14.at(-1)).toEqual({ date: '2026-11-03', seconds: 5400 });
    expect(panel.last14[0]!.date).toBe('2026-10-21');
  });

  it('meta diária: 4 h por padrão, configurável, e focus.summary mede por ela', () => {
    expect(focus.summary(ctx)).toMatchObject({ goalSeconds: 14400, goalProgress: 0, active: null });
    focus.setGoalMinutes(ctx, 120);
    session(60);
    expect(focus.summary(ctx)).toMatchObject({ goalSeconds: 7200, goalProgress: 0.5 });
    focus.startSession(ctx, { mode: 'DEEP_WORK' });
    advance(MIN);
    expect(focus.summary(ctx).active).toMatchObject({ mode: 'DEEP_WORK', elapsedSeconds: 60 });
  });

  it('avisa uma vez quando chega ao tempo planejado', () => {
    focus.startSession(ctx, { mode: 'POMODORO', plannedMinutes: 25 });
    advance(24 * MIN);
    focus.runClock(ctx);
    expect(notes).toEqual([]);
    advance(2 * MIN);
    focus.runClock(ctx);
    focus.runClock(ctx);
    expect(notes).toEqual(['Tempo concluído']);
  });

  it('fecha a sessão esquecida aberta em 12 h de foco', () => {
    focus.startSession(ctx, { mode: 'FREE' });
    advance(30 * 60 * MIN);
    focus.runClock(ctx);
    expect(focus.activeSession(ctx)).toBeNull();
    expect(focus.history(ctx)[0]!.focusSeconds).toBe(focus.MAX_SESSION_SECONDS);
  });

  it('sessão esquecida com tempo planejado fica no planejado', () => {
    focus.startSession(ctx, { mode: 'POMODORO', plannedMinutes: 25 });
    advance(30 * 60 * MIN);
    focus.runClock(ctx);
    expect(focus.activeSession(ctx)).toBeNull();
    expect(focus.history(ctx)[0]!.focusSeconds).toBe(25 * 60);
  });

  it('esquecida em pausa depois do planejado também fica no planejado', () => {
    focus.startSession(ctx, { mode: 'POMODORO', plannedMinutes: 25 });
    advance(40 * MIN);
    focus.pauseSession(ctx);
    advance(13 * 60 * MIN);
    focus.runClock(ctx);
    expect(focus.history(ctx)[0]!.focusSeconds).toBe(25 * 60);
  });

  it('sem tarefas e projetos, a ligação fica vazia e a sessão guarda o id', () => {
    handle.raw.exec('PRAGMA foreign_keys = OFF; DROP TABLE tasks; DROP TABLE projects;');
    expect(focus.linkables(ctx)).toEqual({ tasks: [], projects: [] });
    focus.startSession(ctx, { mode: 'FREE', taskId: 't1' });
    expect(focus.activeSession(ctx)).toMatchObject({ taskId: 't1', label: null });
  });

  it('com tarefas e projetos, lista os abertos e mostra o nome', () => {
    handle.raw.exec(`
      INSERT INTO task_lists (id, created_at, updated_at, name) VALUES ('l', 1, 1, 'Lista');
      INSERT INTO projects (id, created_at, updated_at, name) VALUES ('p1', 1, 1, 'Sektor');
      INSERT INTO tasks (id, created_at, updated_at, list_id, title) VALUES ('t1', 1, 1, 'l', 'Relatório');
      INSERT INTO tasks (id, created_at, updated_at, list_id, title, status, completed_at)
      VALUES ('t2', 2, 2, 'l', 'Feita', 'DONE', 5);
    `);
    expect(focus.linkables(ctx)).toEqual({
      tasks: [{ id: 't1', label: 'Relatório' }],
      projects: [{ id: 'p1', label: 'Sektor' }],
    });
    focus.startSession(ctx, { mode: 'FREE', projectId: 'p1' });
    expect(focus.activeSession(ctx)!.label).toBe('Sektor');
  });

  it('conta pura do relógio não anda depois do fim', () => {
    const state = { startedAt: 0, endedAt: 60_000, pausedAt: null, pausedUntil: null, pausedMs: 0 };
    expect(focusSecondsAt(state, 999_999)).toBe(60);
  });
});
