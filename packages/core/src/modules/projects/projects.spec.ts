import Database from 'better-sqlite3-multiple-ciphers';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DbHandle, openDatabase } from '../../db/client';
import type { Ctx } from '../../services/context';
import * as agenda from '../agenda/service';
import * as tasks from '../tasks/service';

import { PROJECT_FILE_MAX_BYTES } from './contract';
import { addProjectFile } from './index';
import { byDueDate, formatBytes, noteTitle, upcomingOfProject } from './logic';
import { parseInline, parseMarkdown } from './markdown';
import * as svc from './service';

// 18/10/2026, meio-dia em São Paulo.
const NOW = new Date('2026-10-18T15:00:00Z');
const hash = (char: string) => char.repeat(64);

describe('página do projeto', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: Ctx;

  const file = (projectId: string, char: string, name = 'briefing.pdf') =>
    addProjectFile(ctx, {
      projectId,
      name,
      sizeBytes: 10,
      contentHash: hash(char),
      storedName: `${hash(char)}.pdf`,
    });
  const expectStatus = (run: () => unknown, status: number) =>
    expect(run).toThrow(expect.objectContaining({ status }));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-projects-'));
    handle = openDatabase(join(dir, 't.db'), 'c'.repeat(64));
    ctx = { db: handle.orm, timeZone: 'America/Sao_Paulo' };
    tasks.listTaskLists(ctx);
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('o status acompanha a conclusão, nos dois sentidos', () => {
    const { id } = tasks.createProject(ctx, { name: 'Site', startDate: '2026-10-01' });
    expect(tasks.getProject(ctx, id)).toMatchObject({
      status: 'ACTIVE',
      startDate: '2026-10-01',
      completedAt: null,
      createdAt: NOW.getTime(),
    });

    expect(tasks.updateProject(ctx, id, { status: 'PAUSED' })).toMatchObject({
      status: 'PAUSED',
      completedAt: null,
    });
    expect(tasks.updateProject(ctx, id, { completed: false }).status).toBe('PAUSED');

    expect(tasks.updateProject(ctx, id, { status: 'DONE' })).toMatchObject({
      status: 'DONE',
      completedAt: NOW.getTime(),
    });
    expect(tasks.listProjects(ctx)).toEqual([]);
    expect(tasks.updateProject(ctx, id, { completed: false })).toMatchObject({
      status: 'ACTIVE',
      completedAt: null,
    });
    expect(tasks.updateProject(ctx, id, { completed: true }).status).toBe('DONE');
  });

  it('a migração marca como concluído quem já tinha `completed_at`', () => {
    const raw = new Database(':memory:');
    raw.exec(`
      CREATE TABLE projects (id TEXT PRIMARY KEY, completed_at INTEGER);
      CREATE TABLE agenda_events (id TEXT PRIMARY KEY);
      INSERT INTO projects VALUES ('aberto', NULL), ('feito', 1);
      INSERT INTO agenda_events VALUES ('evento');
    `);
    raw.exec(readFileSync(join(__dirname, '../../db/migrations/0120_project_page.sql'), 'utf8'));
    expect(raw.prepare('SELECT id, status FROM projects ORDER BY id').all()).toEqual([
      { id: 'aberto', status: 'ACTIVE' },
      { id: 'feito', status: 'DONE' },
    ]);
    expect(raw.prepare('SELECT project_id FROM agenda_events').get()).toEqual({ project_id: null });
    expect(() => raw.exec(`UPDATE projects SET status = 'OUTRO'`)).toThrow();
    raw.close();
  });

  it('recusa entrega antes do início', () => {
    expectStatus(
      () => tasks.createProject(ctx, { name: 'X', startDate: '2026-11-02', dueDate: '2026-11-01' }),
      400
    );
    const { id } = tasks.createProject(ctx, { name: 'X', dueDate: '2026-11-01' });
    expectStatus(() => tasks.updateProject(ctx, id, { startDate: '2026-11-02' }), 400);
  });

  it('conta tarefas, atrasadas, notas e arquivos do próprio projeto', () => {
    const { id } = tasks.createProject(ctx, { name: 'Site' });
    const other = tasks.createProject(ctx, { name: 'Outro' });
    tasks.createTask(ctx, { title: 'Sem prazo', projectId: id });
    tasks.createTask(ctx, { title: 'Amanhã', projectId: id, dueDate: '2026-10-19' });
    tasks.createTask(ctx, { title: 'Hoje', projectId: id, dueDate: '2026-10-18' });
    tasks.createTask(ctx, { title: 'Atrasada', projectId: id, dueDate: '2026-10-10' });
    const done = tasks.createTask(ctx, { title: 'Feita', projectId: id, dueDate: '2026-10-01' });
    tasks.completeTask(ctx, done.id);
    tasks.createTask(ctx, { title: 'De fora', projectId: other.id, dueDate: '2026-10-01' });
    svc.createNote(ctx, { projectId: id });
    file(id, 'a');

    const page = svc.projectPage(ctx, id, NOW);
    expect(page.counts).toEqual({ open: 4, overdue: 1, notes: 1, files: 1 });
    expect(page.project.progress).toMatchObject({ total: 5, done: 1, percent: 20 });
    expect(page.upcomingTasks.map((task) => task.title)).toEqual([
      'Atrasada',
      'Hoje',
      'Amanhã',
      'Sem prazo',
    ]);
    expectStatus(() => svc.projectPage(ctx, 'nada'), 404);
  });

  it('liga evento ao projeto, com a série inteira junto', () => {
    const { id } = tasks.createProject(ctx, { name: 'Site' });
    const hour = (day: number, h: number) => `2026-10-${day}T${h}:00:00.000Z`;
    agenda.createEvent(ctx, {
      title: 'Solto',
      allDay: false,
      startAt: hour(20, 15),
      endAt: hour(20, 16),
    });
    const linked = agenda.createEvent(ctx, {
      title: 'Reunião',
      allDay: false,
      startAt: hour(20, 15),
      endAt: hour(20, 16),
      projectId: id,
    });
    expect(linked.projectId).toBe(id);
    const series = agenda.createEvent(ctx, {
      title: 'Semanal',
      allDay: false,
      startAt: hour(19, 15),
      endAt: hour(19, 16),
      rrule: 'FREQ=WEEKLY',
      projectId: id,
    });
    agenda.updateEvent(ctx, series.id, {
      scope: 'single',
      occurrenceStart: hour(19, 15),
      title: 'Semanal mudada',
    });

    expect(svc.projectPage(ctx, id, NOW).upcomingEvents.map((event) => event.title)).toEqual([
      'Semanal mudada',
      'Reunião',
      'Semanal',
      'Semanal',
      'Semanal',
    ]);

    agenda.updateEvent(ctx, linked.id, { projectId: null, scope: 'all' });
    expect(agenda.getEvent(ctx, linked.id).projectId).toBeNull();
    expectStatus(
      () =>
        agenda.createEvent(ctx, {
          title: 'X',
          allDay: false,
          startAt: hour(20, 15),
          endAt: hour(20, 16),
          projectId: 'nada',
        }),
      404
    );
  });

  it('notas: fixada primeiro, salva, apaga de leve', () => {
    const { id } = tasks.createProject(ctx, { name: 'Site' });
    const first = svc.createNote(ctx, { projectId: id, body: 'primeira' });
    vi.setSystemTime(NOW.getTime() + 1000);
    const second = svc.createNote(ctx, { projectId: id, body: 'segunda' });
    expect(svc.listNotes(ctx, id).map((note) => note.id)).toEqual([second.id, first.id]);

    svc.updateNote(ctx, first.id, { pinned: true });
    svc.updateNote(ctx, second.id, { body: 'nova' });
    expect(svc.listNotes(ctx, id)).toMatchObject([
      { id: first.id, pinned: true },
      { id: second.id, body: 'nova' },
    ]);

    svc.deleteNote(ctx, first.id);
    expect(svc.listNotes(ctx, id)).toHaveLength(1);
    expectStatus(() => svc.updateNote(ctx, first.id, { body: 'x' }), 404);
    expect(handle.raw.prepare('SELECT count(*) n FROM project_notes').get()).toEqual({ n: 2 });
    expectStatus(() => svc.createNote(ctx, { projectId: 'nada' }), 404);
  });

  it('arquivos: mesmo conteúdo uma vez por projeto, e a cópia só sai sem ninguém usando', () => {
    const { id } = tasks.createProject(ctx, { name: 'Site' });
    const other = tasks.createProject(ctx, { name: 'Outro' });
    const mine = file(id, 'a');
    expectStatus(() => file(id, 'a', 'outro-nome.pdf'), 409);
    const theirs = file(other.id, 'a');
    expect(svc.listFiles(ctx, id).map((row) => row.name)).toEqual(['briefing.pdf']);
    expect(svc.fileStoredName(ctx, mine.id)).toBe(`${hash('a')}.pdf`);

    svc.removeFile(ctx, mine.id);
    expect(svc.listFiles(ctx, id)).toEqual([]);
    expectStatus(() => svc.fileStoredName(ctx, mine.id), 404);
    expect(svc.orphanStoredNames(ctx)).toEqual([]);

    file(id, 'a');
    svc.removeFile(ctx, theirs.id);
    expect(svc.orphanStoredNames(ctx)).toEqual([]);

    expect(() => file(id, 'b', 'x'.repeat(300))).toThrow();
    expectStatus(() => file('nada', 'c'), 404);
    expect(() =>
      addProjectFile(ctx, {
        projectId: id,
        name: 'grande',
        sizeBytes: PROJECT_FILE_MAX_BYTES + 1,
        contentHash: hash('d'),
        storedName: hash('d'),
      })
    ).toThrow();
  });

  it('apagar o projeto solta tarefas e eventos e leva notas e arquivos', () => {
    const { id } = tasks.createProject(ctx, { name: 'Site' });
    const task = tasks.createTask(ctx, { title: 'Fica', projectId: id });
    const event = agenda.createEvent(ctx, {
      title: 'Fica',
      allDay: true,
      startAt: '2026-10-20',
      endAt: '2026-10-21',
      projectId: id,
    });
    const note = svc.createNote(ctx, { projectId: id });
    file(id, 'a');

    tasks.deleteProject(ctx, id);

    expect(tasks.getTask(ctx, task.id).projectId).toBeNull();
    expect(agenda.getEvent(ctx, event.id).projectId).toBeNull();
    expect(svc.listNotes(ctx, id)).toEqual([]);
    expect(svc.listFiles(ctx, id)).toEqual([]);
    expectStatus(() => svc.updateNote(ctx, note.id, { body: 'x' }), 404);
    expect(svc.orphanStoredNames(ctx)).toEqual([`${hash('a')}.pdf`]);
  });
});

describe('regras puras', () => {
  it('ordena por prazo, com sem-prazo no fim', () => {
    const task = (dueDate: string | null, dueTime: string | null, sortOrder = 0) =>
      ({ dueDate, dueTime, sortOrder }) as never;
    const sorted = byDueDate([
      task(null, null),
      task('2026-10-02', null),
      task('2026-10-02', '09:00'),
      task('2026-10-01', null, 2),
      task('2026-10-01', null, 1),
    ]);
    expect(sorted.map((t: { dueTime: string | null; sortOrder: number }) => [t.dueTime, t.sortOrder])).toEqual([
      [null, 1],
      [null, 2],
      ['09:00', 0],
      [null, 0],
      [null, 0],
    ]);
  });

  it('deixa de fora o evento que já acabou e o de outro projeto', () => {
    const event = (title: string, startAt: string, endAt: string, allDay = false, projectId = 'p') =>
      ({ title, startAt, endAt, allDay, projectId }) as never;
    const list = upcomingOfProject(
      [
        event('Depois', '2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z'),
        event('Acabou', '2026-10-18T10:00:00.000Z', '2026-10-18T11:00:00.000Z'),
        event('Agora', '2026-10-18T14:00:00.000Z', '2026-10-18T16:00:00.000Z'),
        event('Ontem o dia todo', '2026-10-17', '2026-10-18', true),
        event('Hoje o dia todo', '2026-10-18', '2026-10-19', true),
        event('De fora', '2026-10-20T10:00:00.000Z', '2026-10-20T11:00:00.000Z', false, 'q'),
      ],
      'p',
      '2026-10-18',
      NOW
    );
    expect(list.map((e: { title: string }) => e.title)).toEqual([
      'Hoje o dia todo',
      'Agora',
      'Depois',
    ]);
  });

  it('escreve tamanhos e títulos de nota', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1,5 KB');
    expect(formatBytes(25 * 1024 * 1024)).toBe('25 MB');
    expect(noteTitle('\n\n## **Plano** de ação\nresto')).toBe('Plano de ação');
    expect(noteTitle('- item')).toBe('item');
    expect(noteTitle('  \n')).toBe('Nota vazia');
  });

  it('entende o Markdown simples', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'italic', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'd' },
    ]);
    const blocks = parseMarkdown(
      '# Título\n\nlinha um\nlinha dois\n- a\n- b\n1. c\n> citação\n```\n# não é título\n```'
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'code',
    ]);
    expect(blocks[3]).toMatchObject({ ordered: true });
    expect(blocks[5]).toEqual({ kind: 'code', text: '# não é título' });
    expect(parseMarkdown('<script>alert(1)</script>')).toEqual([
      { kind: 'paragraph', inline: [{ kind: 'text', text: '<script>alert(1)</script>' }] },
    ]);
  });
});
