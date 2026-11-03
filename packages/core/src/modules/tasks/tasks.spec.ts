import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type DbHandle, openDatabase } from '../../db/client';
import type { Ctx } from '../../services/context';

import { taskLists, tasks } from './schema';
import * as svc from './service';

// 18/10/2026, meio-dia em São Paulo.
const NOW = new Date('2026-10-18T15:00:00Z');

describe('tarefas', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: Ctx;

  const view = (name: 'today' | 'next7' | 'overdue' | 'nodate' | 'completed') =>
    svc.listTasks(ctx, { view: name }).map((t) => t.title);
  const expectStatus = (run: () => unknown, status: number) =>
    expect(run).toThrow(expect.objectContaining({ status }));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-tasks-'));
    handle = openDatabase(join(dir, 't.db'), 'c'.repeat(64));
    ctx = { db: handle.orm, timeZone: 'America/Sao_Paulo' };
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('cria na Entrada, com etiquetas, e filtra pelas visões', () => {
    const [inbox] = svc.listTaskLists(ctx);
    expect(inbox).toMatchObject({ isInbox: true, name: 'Entrada' });
    expect(svc.listTaskLists(ctx)).toHaveLength(1);

    const created = svc.createTask(ctx, {
      title: 'Comprar pão',
      dueDate: '2026-10-18',
      tags: ['Casa', 'casa', 'mercado'],
    });
    expect(created).toMatchObject({
      listId: inbox!.id,
      tags: ['casa', 'mercado'],
      dueTime: null,
      status: 'TODO',
    });

    svc.createTask(ctx, { title: 'Atrasada', dueDate: '2026-10-15' });
    svc.createTask(ctx, { title: 'Semana', dueDate: '2026-10-22' });
    svc.createTask(ctx, { title: 'Longe', dueDate: '2026-10-25' });
    svc.createTask(ctx, { title: 'Algum dia' });

    expect(view('today').sort()).toEqual(['Atrasada', 'Comprar pão']);
    expect(view('overdue')).toEqual(['Atrasada']);
    expect(view('next7')).toEqual(['Comprar pão', 'Semana']);
    expect(view('nodate')).toEqual(['Algum dia']);

    expect(svc.listTags(ctx).map((t) => [t.name, t.taskCount])).toEqual([
      ['casa', 1],
      ['mercado', 1],
    ]);
    expect(svc.listTasks(ctx, { tag: 'mercado' }).map((t) => t.title)).toEqual(['Comprar pão']);
    expect(svc.listTaskLists(ctx)[0]!.openCount).toBe(5);
    expect(svc.taskCounts(ctx)).toEqual({
      today: 2,
      next7: 2,
      overdue: 1,
      nodate: 1,
      all: 5,
      completed: 0,
    });
  });

  it('prazo com hora atrasa quando a hora passa; sem hora, só no dia seguinte', () => {
    svc.createTask(ctx, { title: 'Manhã', dueDate: '2026-10-18', dueTime: '09:00' });
    svc.createTask(ctx, { title: 'Noite', dueDate: '2026-10-18', dueTime: '20:00' });
    svc.createTask(ctx, { title: 'Dia', dueDate: '2026-10-18' });
    expect(view('overdue')).toEqual(['Manhã']);
    // Com hora primeiro, na ordem do relógio.
    expect(view('today')).toEqual(['Manhã', 'Noite', 'Dia']);
  });

  it('hoje é o do fuso: 1h em UTC ainda é ontem em São Paulo', () => {
    vi.setSystemTime(new Date('2026-10-19T01:00:00Z'));
    svc.createTask(ctx, { title: 'Hoje', dueDate: '2026-10-18' });
    expect(view('overdue')).toEqual([]);
    expect(view('today')).toEqual(['Hoje']);
  });

  it('tirar a data tira a hora', () => {
    const task = svc.createTask(ctx, { title: 'y', dueDate: '2026-10-20', dueTime: '10:00' });
    expect(svc.updateTask(ctx, task.id, { dueDate: null })).toMatchObject({
      dueDate: null,
      dueTime: null,
    });
    expect(svc.updateTask(ctx, task.id, { dueTime: '11:00' }).dueTime).toBeNull();
  });

  it('subtarefas vêm dentro da mãe e vão até um nível', () => {
    const parent = svc.createTask(ctx, { title: 'Viagem' });
    const child = svc.createTask(ctx, { title: 'Passaporte', parentTaskId: parent.id });
    expectStatus(() => svc.createTask(ctx, { title: 'Neto', parentTaskId: child.id }), 400);
    expectStatus(() => svc.createTask(ctx, { title: 'Órfã', parentTaskId: 'nada' }), 404);

    const other = svc.createTask(ctx, { title: 'Outra' });
    expectStatus(() => svc.updateTask(ctx, parent.id, { parentTaskId: other.id }), 400);

    const [listed] = svc.listTasks(ctx);
    expect(listed!.subtasks.map((s) => s.title)).toEqual(['Passaporte']);
    expect(svc.listTasks(ctx).map((t) => t.title)).toEqual(['Viagem', 'Outra']);
  });

  it('concluir recorrente cria a próxima com etiquetas, projeto e subtarefas', () => {
    const project = svc.createProject(ctx, { name: 'Casa' });
    const task = svc.createTask(ctx, {
      title: 'Regar plantas',
      dueDate: '2026-10-18',
      dueTime: '08:30',
      rrule: 'FREQ=WEEKLY',
      tags: ['casa'],
      projectId: project.id,
    });
    svc.createTask(ctx, { title: 'Varanda', parentTaskId: task.id });

    const result = svc.completeTask(ctx, task.id);
    expect(result.task.completedAt).not.toBeNull();
    expect(result.task.status).toBe('DONE');
    expect(result.next).toMatchObject({
      title: 'Regar plantas',
      dueDate: '2026-10-25',
      dueTime: '08:30',
      tags: ['casa'],
      status: 'TODO',
      projectId: project.id,
    });
    expect(result.next!.subtasks.map((s) => s.title)).toEqual(['Varanda']);
    expect(result.next!.subtasks[0]!.completedAt).toBeNull();
    expect(view('completed')).toEqual(['Regar plantas']);

    // Concluir de novo não cria outra.
    expect(svc.completeTask(ctx, task.id).next).toBeNull();
  });

  it('repetição em dias escolhidos e série que acaba', () => {
    const task = svc.createTask(ctx, {
      title: 'Treino',
      dueDate: '2026-10-19',
      rrule: 'FREQ=WEEKLY;BYDAY=MO,TH',
    });
    expect(svc.completeTask(ctx, task.id).next!.dueDate).toBe('2026-10-22');

    const end = svc.createTask(ctx, {
      title: 'Última',
      dueDate: '2026-10-19',
      rrule: 'FREQ=DAILY;UNTIL=20261019T235959Z',
    });
    expect(svc.completeTask(ctx, end.id).next).toBeNull();
  });

  it('reordena, move de lista, desfaz conclusão e apaga', () => {
    const list = svc.createTaskList(ctx, { name: 'Trabalho' });
    const a = svc.createTask(ctx, { title: 'A', listId: list.id });
    const b = svc.createTask(ctx, { title: 'B', listId: list.id });
    const sub = svc.createTask(ctx, { title: 'Sub', parentTaskId: a.id });
    svc.reorderTasks(ctx, { listId: list.id, orderedIds: [b.id, a.id] });
    expect(svc.listTasks(ctx, { listId: list.id }).map((t) => t.title)).toEqual(['B', 'A']);

    const inbox = svc.inboxId(ctx);
    expectStatus(() => svc.reorderTasks(ctx, { listId: inbox, orderedIds: [a.id] }), 400);

    const moved = svc.updateTask(ctx, a.id, { listId: inbox });
    expect(moved.listId).toBe(inbox);
    expect(moved.subtasks[0]!.listId).toBe(inbox);
    expectStatus(() => svc.updateTask(ctx, sub.id, { listId: list.id }), 400);

    svc.updateTask(ctx, b.id, { completed: true });
    expect(svc.updateTask(ctx, b.id, { completed: false }).completedAt).toBeNull();

    svc.deleteTask(ctx, a.id);
    expectStatus(() => svc.getTask(ctx, a.id), 404);
    expectStatus(() => svc.getTask(ctx, sub.id), 404);
    // Apagar é marcar: a linha continua lá.
    expect(ctx.db.select().from(tasks).where(eq(tasks.id, a.id)).get()!.deletedAt).not.toBeNull();

    expectStatus(() => svc.deleteTaskList(ctx, inbox), 400);
    svc.deleteTaskList(ctx, list.id);
    expect(svc.listTaskLists(ctx).map((l) => l.name)).toEqual(['Entrada']);
    expectStatus(() => svc.getTask(ctx, b.id), 404);
  });

  it('Entrada apagada à mão volta, e não nascem duas', () => {
    svc.inboxId(ctx);
    ctx.db.update(taskLists).set({ deletedAt: Date.now() }).run();
    svc.inboxId(ctx);
    expect(svc.listTaskLists(ctx)).toHaveLength(1);
  });

  it('etiqueta tirada sai da tarefa e pode voltar', () => {
    const task = svc.createTask(ctx, { title: 'T', tags: ['a', 'b'] });
    expect(svc.updateTask(ctx, task.id, { tags: ['b'] }).tags).toEqual(['b']);
    expect(svc.updateTask(ctx, task.id, { tags: ['a', 'b'] }).tags).toEqual(['a', 'b']);
    expect(svc.listTags(ctx).map((t) => t.taskCount)).toEqual([1, 1]);
  });

  describe('status', () => {
    it('Concluída e data de conclusão andam juntas', () => {
      const task = svc.createTask(ctx, { title: 'K' });
      expect(svc.updateTask(ctx, task.id, { status: 'IN_PROGRESS' })).toMatchObject({
        status: 'IN_PROGRESS',
        completedAt: null,
      });
      expect(svc.updateTask(ctx, task.id, { status: 'DONE' }).completedAt).not.toBeNull();
      expect(svc.updateTask(ctx, task.id, { status: 'REVIEW' })).toMatchObject({
        status: 'REVIEW',
        completedAt: null,
      });
      svc.completeTask(ctx, task.id);
      expect(svc.reopenTask(ctx, task.id).status).toBe('TODO');
    });

    it('arrastar recorrente para Concluída também cria a próxima', () => {
      const task = svc.createTask(ctx, {
        title: 'Lixo',
        dueDate: '2026-10-18',
        rrule: 'FREQ=DAILY',
      });
      svc.updateTask(ctx, task.id, { status: 'DONE' });
      expect(svc.listTasks(ctx).map((t) => t.dueDate)).toEqual(['2026-10-19']);
    });

    it('nasce com status e filtra por ele', () => {
      svc.createTask(ctx, { title: 'Ideia', status: 'BACKLOG' });
      svc.createTask(ctx, { title: 'Feita', status: 'DONE' });
      expect(svc.listTasks(ctx, { status: 'BACKLOG' }).map((t) => t.title)).toEqual(['Ideia']);
      expect(svc.listTasks(ctx, { status: 'DONE' }).map((t) => t.title)).toEqual(['Feita']);
      expect(svc.listTasks(ctx).map((t) => t.title)).toEqual(['Ideia']);
      expect(svc.listTasks(ctx, { includeCompleted: true })).toHaveLength(2);
    });
  });

  it('filtros de leitura para os outros módulos', () => {
    const project = svc.createProject(ctx, { name: 'P' });
    svc.createTask(ctx, { title: 'Dentro', dueDate: '2026-11-02', projectId: project.id });
    svc.createTask(ctx, { title: 'Fora', dueDate: '2026-11-20', notes: '100% certo' });
    expect(
      svc.listTasks(ctx, { dueFrom: '2026-11-01', dueTo: '2026-11-05' }).map((t) => t.title)
    ).toEqual(['Dentro']);
    expect(svc.listTasks(ctx, { projectId: project.id })[0]!.project).toMatchObject({ name: 'P' });
    expect(svc.listTasks(ctx, { search: 'dentr' }).map((t) => t.title)).toEqual(['Dentro']);
    expect(svc.listTasks(ctx, { search: '100%' }).map((t) => t.title)).toEqual(['Fora']);
    expect(svc.listTasks(ctx, { search: '1_0' })).toEqual([]);
    expect(svc.listTasks(ctx, { limit: 1 })).toHaveLength(1);
  });

  it('captura cria a tarefa interpretada, com o que a visão aberta manda', () => {
    const project = svc.createProject(ctx, { name: 'Reforma da Cozinha' });
    const task = svc.captureTask(ctx, { text: 'pagar a luz sexta #casa @reforma !alta' });
    expect(task).toMatchObject({
      title: 'pagar a luz',
      dueDate: '2026-10-23',
      listId: project.listId,
      projectId: project.id,
      tags: ['casa'],
      priority: 'HIGH',
    });
    expect(
      svc.captureTask(ctx, { text: 'sem data', defaultDueDate: '2026-10-18', defaultTag: 'x' })
    ).toMatchObject({ dueDate: '2026-10-18', tags: ['x'], projectId: null });
    const mercado = svc.createTaskList(ctx, { name: 'Mercado' });
    expect(svc.captureTask(ctx, { text: 'leite @mercado', projectId: project.id })).toMatchObject({
      listId: mercado.id,
      projectId: null,
    });
    expect(svc.captureTask(ctx, { text: 'do projeto', projectId: project.id }).listId).toBe(
      project.listId
    );
    expectStatus(() => svc.captureTask(ctx, { text: '#casa !alta' }), 400);
    expectStatus(() => svc.captureTask(ctx, { text: 'x @inexistente' }), 400);
  });

  describe('projetos', () => {
    it('progresso e próxima tarefa saem das tarefas', () => {
      const project = svc.createProject(ctx, {
        name: 'TCC',
        type: 'ACADEMIC',
        dueDate: '2026-12-01',
        color: 'violet',
        description: 'Monografia',
      });
      expect(project).toMatchObject({
        type: 'ACADEMIC',
        progress: { total: 0, done: 0, percent: 0 },
        nextTask: null,
      });

      const a = svc.createTask(ctx, { title: 'Sem prazo', projectId: project.id });
      const b = svc.createTask(ctx, { title: 'Longe', projectId: project.id, dueDate: '2026-11-20' });
      const c = svc.createTask(ctx, { title: 'Perto', projectId: project.id, dueDate: '2026-10-20' });
      svc.createTask(ctx, { title: 'Subtarefa não conta', parentTaskId: a.id });
      svc.completeTask(ctx, c.id);

      expect(svc.getProject(ctx, project.id)).toMatchObject({
        progress: { total: 3, done: 1, percent: 33 },
        nextTask: { id: b.id, title: 'Longe' },
      });
      svc.completeTask(ctx, b.id);
      expect(svc.getProject(ctx, project.id).nextTask?.id).toBe(a.id);
      svc.deleteTask(ctx, a.id);
      expect(svc.getProject(ctx, project.id).progress).toEqual({ total: 2, done: 2, percent: 100 });
    });

    it('concluídos ficam ocultos e voltam', () => {
      const open = svc.createProject(ctx, { name: 'Aberto' });
      const done = svc.createProject(ctx, { name: 'Pronto' });
      svc.updateProject(ctx, done.id, { completed: true });
      expect(svc.listProjects(ctx).map((p) => p.id)).toEqual([open.id]);
      expect(svc.listProjects(ctx, { includeCompleted: true }).map((p) => p.name)).toEqual([
        'Aberto',
        'Pronto',
      ]);
      svc.updateProject(ctx, done.id, { completed: false });
      expect(svc.listProjects(ctx)).toHaveLength(2);
    });

    it('trocar o projeto leva as subtarefas; apagar solta as tarefas', () => {
      const project = svc.createProject(ctx, { name: 'P' });
      const task = svc.createTask(ctx, { title: 'T' });
      const sub = svc.createTask(ctx, { title: 'S', parentTaskId: task.id });
      expect(sub.projectId).toBeNull();
      expect(svc.updateTask(ctx, task.id, { projectId: project.id }).subtasks[0]!.projectId).toBe(
        project.id
      );
      expectStatus(() => svc.updateTask(ctx, sub.id, { projectId: null }), 400);
      expectStatus(() => svc.createTask(ctx, { title: 'x', projectId: 'nada' }), 404);

      svc.deleteProject(ctx, project.id);
      expect(svc.getTask(ctx, task.id).project).toBeNull();
      expectStatus(() => svc.getProject(ctx, project.id), 404);
    });

    it('todo projeto tem uma lista, e a tarefa segue a lista', () => {
      const project = svc.createProject(ctx, { name: 'Site', color: 'blue' });
      const list = svc.listTaskLists(ctx).find((l) => l.id === project.listId)!;
      expect(list).toMatchObject({ name: 'Site', color: 'blue', project: { id: project.id } });
      svc.updateProject(ctx, project.id, { name: 'Site novo' });
      expect(svc.listTaskLists(ctx).find((l) => l.id === list.id)?.name).toBe('Site novo');

      const inList = svc.createTask(ctx, { title: 'Na lista', listId: list.id });
      expect(inList.projectId).toBe(project.id);
      const inbox = svc.listTaskLists(ctx).find((l) => l.isInbox)!;
      expect(svc.updateTask(ctx, inList.id, { listId: inbox.id }).projectId).toBeNull();
      expect(svc.updateTask(ctx, inList.id, { projectId: project.id }).listId).toBe(list.id);
      expect(svc.updateTask(ctx, inList.id, { projectId: null }).listId).toBe(inbox.id);

      expectStatus(() => svc.deleteTaskList(ctx, list.id), 400);
      expectStatus(() => svc.createProject(ctx, { name: 'Outro', listId: list.id }), 400);
      expectStatus(() => svc.createProject(ctx, { name: 'Outro', listId: inbox.id }), 400);
    });

    it('projeto pode usar uma lista que já existe, e trocar de lista', () => {
      const yuni = svc.createTaskList(ctx, { name: 'Yuni' });
      const old = svc.createTask(ctx, { title: 'Já estava', listId: yuni.id });
      const project = svc.createProject(ctx, { name: 'Yuni Digital', listId: yuni.id });
      expect(project.listId).toBe(yuni.id);
      expect(svc.getTask(ctx, old.id).projectId).toBe(project.id);
      expect(svc.listTaskLists(ctx).filter((l) => l.name === 'Yuni Digital')).toEqual([]);

      const other = svc.createTaskList(ctx, { name: 'Outra' });
      const moved = svc.createTask(ctx, { title: 'Na outra', listId: other.id });
      svc.updateProject(ctx, project.id, { listId: other.id });
      expect(svc.getTask(ctx, old.id).projectId).toBeNull();
      expect(svc.getTask(ctx, moved.id).projectId).toBe(project.id);
      expect(svc.getProject(ctx, project.id).progress.total).toBe(1);
    });
  });

  it('captura grava a hora do prazo', () => {
    const task = svc.captureTask(ctx, { text: 'entregar relatório amanhã 15h' });
    expect(task).toMatchObject({
      title: 'entregar relatório',
      dueDate: '2026-10-19',
      dueTime: '15:00',
    });
    const today = svc.captureTask(ctx, { text: 'ligar 9h', defaultDueDate: '2026-10-18' });
    expect(today).toMatchObject({ title: 'ligar', dueDate: '2026-10-18', dueTime: '09:00' });
  });

  describe('recorrente', () => {
    const repeat = (over = {}) =>
      svc.createTask(ctx, { title: 'Pagar', dueDate: '2026-10-20', rrule: 'FREQ=WEEKLY', ...over });
    const open = () =>
      ctx.db
        .select()
        .from(tasks)
        .all()
        .filter((t) => !t.deletedAt && !t.completedAt)
        .map((t) => t.dueDate);

    it('concluir, reabrir e concluir não duplica a próxima', () => {
      const task = repeat();
      expect(svc.completeTask(ctx, task.id).next?.dueDate).toBe('2026-10-27');
      svc.reopenTask(ctx, task.id);
      expect(open()).toEqual(['2026-10-20']);
      svc.completeTask(ctx, task.id);
      expect(open()).toEqual(['2026-10-27']);
    });

    it('reabrir pelo updateTask remove a próxima intacta', () => {
      const task = repeat();
      svc.updateTask(ctx, task.id, { completed: true });
      svc.updateTask(ctx, task.id, { completed: false });
      expect(open()).toEqual(['2026-10-20']);
    });

    it('a próxima mexida fica, e concluir de novo a reaproveita', () => {
      const task = repeat();
      const next = svc.completeTask(ctx, task.id).next!;
      vi.setSystemTime(NOW.getTime() + 1000);
      svc.updateTask(ctx, next.id, { title: 'Pagar a luz' });
      svc.reopenTask(ctx, task.id);
      expect(open().sort()).toEqual(['2026-10-20', '2026-10-27']);
      expect(svc.completeTask(ctx, task.id).next?.id).toBe(next.id);
      expect(open()).toEqual(['2026-10-27']);
    });

    it('as subtarefas da próxima saem junto', () => {
      const task = repeat();
      svc.createTask(ctx, { title: 'Sub', parentTaskId: task.id });
      svc.completeTask(ctx, task.id);
      svc.reopenTask(ctx, task.id);
      expect(open().filter(Boolean)).toEqual(['2026-10-20']);
      const live = ctx.db.select().from(tasks).all().filter((t) => !t.deletedAt);
      expect(live.map((t) => t.title).sort()).toEqual(['Pagar', 'Sub']);
    });

    it('mensal no dia 31 volta ao dia original depois do mês curto', () => {
      const dates: (string | null)[] = [];
      let id = svc.createTask(ctx, {
        title: 'Aluguel',
        dueDate: '2026-12-31',
        rrule: 'FREQ=MONTHLY',
      }).id;
      for (let i = 0; i < 4; i++) {
        const next = svc.completeTask(ctx, id).next!;
        dates.push(next.dueDate);
        id = next.id;
      }
      expect(dates).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
    });

    it('mudar o prazo muda a âncora', () => {
      const task = repeat({ dueDate: '2026-12-31', rrule: 'FREQ=MONTHLY' });
      const next = svc.completeTask(ctx, task.id).next!;
      svc.updateTask(ctx, next.id, { dueDate: '2027-02-10' });
      expect(svc.completeTask(ctx, next.id).next?.dueDate).toBe('2027-03-10');
    });
  });
});
