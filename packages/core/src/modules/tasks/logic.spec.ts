import { describe, expect, it } from 'vitest';

import type { TaskListResponse, TaskResponse } from './contract';
import {
  addTag,
  applyOrder,
  boardColumns,
  bodyFromForm,
  canCapture,
  captureDefaults,
  completedLabel,
  dueInfo,
  findTask,
  formFromTask,
  groupByStatus,
  moveId,
  normalizeTag,
  priorityBars,
  queryForTarget,
  relativeDay,
  repeatValue,
  resolveListParam,
  smartView,
  sortLists,
  visibleSubtasks,
  weekdaysOf,
} from './logic';

const TODAY = '2026-10-18';

function task(fields: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: 't',
    listId: 'l',
    projectId: null,
    project: null,
    parentTaskId: null,
    title: 'Tarefa',
    notes: null,
    status: 'TODO',
    priority: null,
    dueDate: null,
    dueTime: null,
    rrule: null,
    sortOrder: 0,
    completedAt: null,
    tags: [],
    subtasks: [],
    ...fields,
  };
}

describe('listas inteligentes', () => {
  it('mapeia cada nome para a visão do núcleo', () => {
    expect(smartView('hoje')?.view).toBe('today');
    expect(smartView('programadas')?.view).toBe('next7');
    expect(smartView('atrasadas')?.view).toBe('overdue');
    expect(smartView('sem-prazo')?.view).toBe('nodate');
    expect(smartView('todas')?.view).toBeUndefined();
    expect(smartView('concluidas')?.view).toBe('completed');
    expect(smartView('outra')).toBeUndefined();
  });

  it('distingue lista de visão e monta a consulta', () => {
    expect(queryForTarget(resolveListParam('hoje', 'casa'))).toEqual({ view: 'today', tag: 'casa' });
    expect(queryForTarget(resolveListParam('abc'))).toEqual({ listId: 'abc', tag: undefined });
  });

  it('não oferece captura onde a tarefa sumiria', () => {
    expect(canCapture(resolveListParam('atrasadas'))).toBe(false);
    expect(canCapture(resolveListParam('concluidas'))).toBe(false);
    expect(canCapture(resolveListParam('hoje'))).toBe(true);
    expect(canCapture(resolveListParam('abc'))).toBe(true);
  });

  it('a captura herda da visão aberta: hoje ganha a data, lista a lista, etiqueta vai junto', () => {
    expect(captureDefaults(resolveListParam('hoje'), TODAY)).toEqual({ defaultDueDate: TODAY });
    expect(captureDefaults(resolveListParam('abc', 'casa'), TODAY)).toEqual({
      listId: 'abc',
      defaultTag: 'casa',
    });
    expect(captureDefaults(resolveListParam('todas'), TODAY)).toEqual({});
  });

  it('põe a Entrada primeiro e respeita a ordem', () => {
    const list = (id: string, sortOrder: number, isInbox = false): TaskListResponse => ({
      id,
      name: id,
      color: null,
      sortOrder,
      isInbox,
      openCount: 0,
      project: null,
    });
    expect(sortLists([list('b', 1), list('c', 0), list('i', 9, true)]).map((l) => l.id)).toEqual([
      'i',
      'c',
      'b',
    ]);
  });
});

describe('prazo', () => {
  it('sem prazo não tem rótulo', () => {
    expect(dueInfo(task(), TODAY, '12:00')).toBeNull();
  });

  it('dia sem hora: hoje não está atrasado, ontem está', () => {
    expect(dueInfo(task({ dueDate: TODAY }), TODAY, '23:59')).toEqual({
      label: 'Hoje',
      overdue: false,
    });
    expect(dueInfo(task({ dueDate: '2026-10-17' }), TODAY, '00:00')).toEqual({
      label: 'Ontem',
      overdue: true,
    });
  });

  it('com hora: atrasa quando o horário passa e mostra a hora', () => {
    const due = task({ dueDate: TODAY, dueTime: '14:00' });
    expect(dueInfo(due, TODAY, '13:59')).toEqual({ label: 'Hoje, 14:00', overdue: false });
    expect(dueInfo(due, TODAY, '14:01')?.overdue).toBe(true);
  });

  it('concluída nunca fica atrasada', () => {
    expect(dueInfo(task({ dueDate: '2026-01-01', completedAt: 1 }), TODAY, '12:00')?.overdue).toBe(
      false
    );
  });

  it('amanhã, dias próximos e outro ano', () => {
    expect(relativeDay('2026-10-19', TODAY)).toBe('Amanhã');
    expect(relativeDay('2026-10-22', TODAY)).toContain('22');
    expect(relativeDay('2027-01-05', TODAY)).toContain('2027');
  });
});

describe('data de conclusão', () => {
  const zone = 'America/Sao_Paulo';
  const now = new Date('2026-10-18T15:00:00Z');

  it('hoje, ontem e dias anteriores com dia/mês', () => {
    const at = (iso: string) => ({ completedAt: new Date(iso).getTime() });
    expect(completedLabel(at('2026-10-18T14:30:00Z'), now, zone)).toBe('Concluída hoje às 11:30');
    expect(completedLabel(at('2026-10-17T12:05:00Z'), now, zone)).toBe('Concluída ontem às 09:05');
    expect(completedLabel(at('2026-10-02T21:00:00Z'), now, zone)).toBe(
      'Concluída em 02/10 às 18:00'
    );
    expect(completedLabel(at('2025-10-02T21:00:00Z'), now, zone)).toBe(
      'Concluída em 02/10/2025 às 18:00'
    );
    expect(completedLabel({ completedAt: null }, now, zone)).toBeNull();
  });

  it('usa o fuso (madrugada em UTC ainda é ontem em São Paulo)', () => {
    expect(
      completedLabel({ completedAt: new Date('2026-10-18T02:00:00Z').getTime() }, now, zone)
    ).toBe('Concluída ontem às 23:00');
  });
});

describe('prioridade', () => {
  it('três barras', () => {
    expect([null, 'LOW', 'MEDIUM', 'HIGH'].map((p) => priorityBars(p as never))).toEqual([
      0, 1, 2, 3,
    ]);
  });
});

describe('ordem e grupos', () => {
  it('move um id para a posição de outro', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
    expect(moveId(['a'], 'a', 'x')).toEqual(['a']);
  });

  it('aplica a ordem local e mantém os que não estavam nela', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(applyOrder(items, ['c', 'a']).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(applyOrder(items, null)).toBe(items);
  });

  it('mostra só subtarefas abertas, salvo na visão de concluídas', () => {
    const parent = task({ subtasks: [task({ id: 'a' }), task({ id: 'b', completedAt: 1 })] });
    expect(visibleSubtasks(parent, false).map((s) => s.id)).toEqual(['a']);
    expect(visibleSubtasks(parent, true)).toHaveLength(2);
  });

  it('agrupa por status, o que anda primeiro, sem grupos vazios', () => {
    const groups = groupByStatus([
      task({ id: '1', status: 'BACKLOG' }),
      task({ id: '2', status: 'IN_PROGRESS' }),
      task({ id: '3', status: 'BACKLOG' }),
    ]);
    expect(groups.map((g) => [g.title, g.tasks.length])).toEqual([
      ['Em progresso', 1],
      ['Backlog', 2],
    ]);
  });

  it('Kanban tem as cinco colunas, respeita o arraste local e põe a concluída mais nova em cima', () => {
    const columns = boardColumns(
      [
        task({ id: '1' }),
        task({ id: '2', status: 'DONE', completedAt: 1 }),
        task({ id: '3', status: 'DONE', completedAt: 2 }),
      ],
      { '1': 'REVIEW' }
    );
    expect(columns.map((c) => c.title)).toEqual([
      'Backlog',
      'A fazer',
      'Em progresso',
      'Em revisão',
      'Concluída',
    ]);
    expect(columns[1]!.tasks).toEqual([]);
    expect(columns[3]!.tasks.map((t) => t.id)).toEqual(['1']);
    expect(columns[4]!.tasks.map((t) => t.id)).toEqual(['3', '2']);
  });

  it('acha tarefas e subtarefas pelo id', () => {
    const data = [task({ id: 'p', subtasks: [task({ id: 's', parentTaskId: 'p' })] })];
    expect(findTask([undefined, data], 's')?.parentTaskId).toBe('p');
    expect(findTask([data], 'p')?.id).toBe('p');
    expect(findTask([data], null)).toBeNull();
  });
});

describe('etiquetas', () => {
  it('normaliza e não repete', () => {
    expect(normalizeTag('  ##casa nova ')).toBe('casa-nova');
    expect(addTag(['casa'], 'Casa')).toEqual(['casa']);
    expect(addTag(['casa'], '#mercado')).toEqual(['casa', 'mercado']);
    expect(addTag(['casa'], '   ')).toEqual(['casa']);
    const ten = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(addTag(ten, 'mais')).toBe(ten);
  });
});

describe('formulário', () => {
  it('repetição simples vira a opção; complexa é preservada', () => {
    expect(repeatValue(null)).toBe('');
    expect(repeatValue('FREQ=WEEKLY')).toBe('WEEKLY');
    expect(repeatValue('FREQ=WEEKLY;BYDAY=MO,WE')).toBe('WEEKLY');
    expect(repeatValue('FREQ=DAILY;INTERVAL=2')).toBe('FREQ=DAILY;INTERVAL=2');
    expect(repeatValue('FREQ=MONTHLY;COUNT=3')).toBe('FREQ=MONTHLY;COUNT=3');
  });

  it('semanal em dias escolhidos vira BYDAY; sem dias, só semanal', () => {
    const form = formFromTask(null, { listId: 'l', today: TODAY, date: TODAY });
    expect(bodyFromForm({ ...form, repeat: 'WEEKLY' }).rrule).toBe('FREQ=WEEKLY');
    expect(bodyFromForm({ ...form, repeat: 'WEEKLY', weekdays: [3, 1] }).rrule).toBe(
      'FREQ=WEEKLY;BYDAY=MO,WE'
    );
    expect(weekdaysOf('FREQ=WEEKLY;BYDAY=MO,WE')).toEqual([1, 3]);
    expect(weekdaysOf('FREQ=DAILY')).toEqual([]);
  });

  it('lê uma tarefa com hora e devolve o mesmo corpo', () => {
    const form = formFromTask(
      task({
        title: 'A',
        notes: 'n',
        dueDate: '2026-10-22',
        dueTime: '14:30',
        rrule: 'FREQ=DAILY;INTERVAL=2',
        tags: ['x'],
        priority: 'HIGH',
        status: 'REVIEW',
        projectId: 'p',
      }),
      { listId: 'outra', today: TODAY }
    );
    expect(form).toMatchObject({
      hasDate: true,
      hasTime: true,
      time: '14:30',
      listId: 'l',
    });
    expect(bodyFromForm(form)).toEqual({
      title: 'A',
      notes: 'n',
      dueDate: '2026-10-22',
      dueTime: '14:30',
      rrule: 'FREQ=DAILY;INTERVAL=2',
      tags: ['x'],
      priority: 'HIGH',
      status: 'REVIEW',
      listId: 'l',
    });
  });

  it('nova tarefa começa com os padrões', () => {
    expect(formFromTask(null, { listId: 'l', today: TODAY })).toMatchObject({
      hasDate: false,
      date: TODAY,
      status: 'TODO',
      time: '09:00',
    });
  });

  it('sem data descarta hora e repetição', () => {
    const form = formFromTask(null, { listId: 'l', today: TODAY });
    expect(
      bodyFromForm({ ...form, title: ' X ', hasTime: true, repeat: 'DAILY' })
    ).toMatchObject({ title: 'X', dueDate: null, dueTime: null, rrule: null, listId: 'l' });
  });
});
