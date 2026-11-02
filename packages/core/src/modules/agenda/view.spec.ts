import { describe, expect, it } from 'vitest';

import {
  coversWholeDay,
  eventsByDay,
  type EventOccurrence,
  layoutColumns,
  listDayTitle,
  monthGrid,
  occurrenceSpan,
  readTaskDue,
  segmentOnDay,
  startOfWeek,
  taskOccurrence,
  tasksInRange,
  whenLines,
} from './view';

const SP = 'America/Sao_Paulo';

const occurrence = (over: Partial<EventOccurrence>): EventOccurrence => ({
  eventId: 'e',
  occurrenceStart: '',
  startAt: '2026-10-19T12:00:00.000Z',
  endAt: '2026-10-19T13:00:00.000Z',
  allDay: false,
  title: 'Evento',
  notes: null,
  location: null,
  color: null,
  rrule: null,
  isRecurring: false,
  isException: false,
  source: 'LOCAL',
  calendarId: 'c',
  reminders: [],
  ...over,
});

const byId = (items: ReturnType<typeof layoutColumns>) =>
  Object.fromEntries(items.map((item) => [item.id, item]));

describe('calendário', () => {
  it('semana começa no domingo e o mês cobre as pontas', () => {
    expect(startOfWeek('2026-11-04')).toBe('2026-11-01');
    const grid = monthGrid('2026-10-15');
    expect(grid[0]![0]).toBe('2026-09-27');
    expect(grid.at(-1)!.at(-1)).toBe('2026-10-31');
    expect(monthGrid('2026-11-15').at(-1)!.at(-1)).toBe('2026-12-05');
  });

  it('dia inteiro tem fim exclusivo; com hora, usa o fuso e meia-noite não ocupa o dia seguinte', () => {
    expect(
      occurrenceSpan(occurrence({ allDay: true, startAt: '2026-11-02', endAt: '2026-11-04' }), SP)
    ).toEqual({ first: '2026-11-02', last: '2026-11-03' });
    expect(
      occurrenceSpan(
        occurrence({ startAt: '2026-10-20T01:00:00.000Z', endAt: '2026-10-20T03:00:00.000Z' }),
        SP
      )
    ).toEqual({ first: '2026-10-19', last: '2026-10-19' });
  });

  it('evento de vários dias entra em cada dia, cortado pela janela', () => {
    const event = occurrence({ allDay: true, startAt: '2026-10-18', endAt: '2026-10-23' });
    const map = eventsByDay([event], ['2026-10-20', '2026-10-21'], SP);
    expect(map.get('2026-10-20')).toHaveLength(1);
    expect(map.get('2026-10-21')).toHaveLength(1);
  });

  it('segmento atravessa a meia-noite e o dia do meio vai para a faixa de cima', () => {
    const event = occurrence({
      startAt: '2026-10-19T22:00:00.000Z',
      endAt: '2026-10-22T02:00:00.000Z',
    });
    expect(segmentOnDay(event, '2026-10-19', SP)).toEqual({ start: 1140, end: 1440 });
    expect(segmentOnDay(event, '2026-10-20', SP)).toEqual({ start: 0, end: 1440 });
    expect(coversWholeDay(event, '2026-10-20', SP)).toBe(true);
    expect(coversWholeDay(event, '2026-10-19', SP)).toBe(false);
  });
});

describe('layoutColumns', () => {
  it('sozinho ocupa tudo; encostados não se sobrepõem', () => {
    const placed = byId(
      layoutColumns([
        { id: 'a', start: 60, end: 120 },
        { id: 'b', start: 120, end: 180 },
      ])
    );
    expect(placed.a).toMatchObject({ column: 0, columns: 1 });
    expect(placed.b).toMatchObject({ column: 0, columns: 1 });
  });

  it('sobrepostos ficam lado a lado', () => {
    const placed = byId(
      layoutColumns([
        { id: 'b', start: 90, end: 150 },
        { id: 'a', start: 60, end: 120 },
      ])
    );
    expect(placed.a).toMatchObject({ column: 0, columns: 2 });
    expect(placed.b).toMatchObject({ column: 1, columns: 2 });
  });

  it('o vizinho livre deixa esticar', () => {
    const placed = byId(
      layoutColumns([
        { id: 'a', start: 0, end: 120 },
        { id: 'b', start: 0, end: 60 },
        { id: 'c', start: 0, end: 30 },
        { id: 'd', start: 60, end: 120 },
      ])
    );
    expect(placed.d).toMatchObject({ column: 1, columns: 3, span: 2 });
  });

  it('evento curtíssimo conta com a altura mínima', () => {
    const placed = byId(
      layoutColumns(
        [
          { id: 'a', start: 60, end: 65 },
          { id: 'b', start: 70, end: 90 },
        ],
        20
      )
    );
    expect(placed.a).toMatchObject({ column: 0, columns: 2 });
  });
});

describe('tarefas sobrepostas', () => {
  it('lê o prazo e ignora o que não serve', () => {
    expect(readTaskDue({ id: 'a', title: 'T', dueDate: '2026-10-20', dueTime: '14:30' })).toEqual({
      id: 'a',
      title: 'T',
      dueDate: '2026-10-20',
      dueTime: '14:30',
      done: false,
    });
    expect(readTaskDue({ id: 'a', title: 'T', dueDate: null })).toBeNull();
    expect(readTaskDue('lixo')).toBeNull();
  });

  it('sem hora vira dia inteiro; com hora, bloco de 30 min no fuso', () => {
    expect(
      taskOccurrence({ id: 'a', title: 'T', dueDate: '2026-10-20', dueTime: null, done: false }, SP)
    ).toMatchObject({ allDay: true, startAt: '2026-10-20', endAt: '2026-10-21', taskId: 'a' });
    expect(
      taskOccurrence({ id: 'a', title: 'T', dueDate: '2026-10-20', dueTime: '14:00', done: false }, SP)
    ).toMatchObject({
      allDay: false,
      startAt: '2026-10-20T17:00:00.000Z',
      endAt: '2026-10-20T17:30:00.000Z',
    });
  });

  it('filtra pela janela e tira as concluídas; lista inválida vira vazia', () => {
    const list = [
      { id: 'a', title: 'Dentro', dueDate: '2026-10-20' },
      { id: 'b', title: 'Fora', dueDate: '2026-11-20' },
      { id: 'c', title: 'Feita', dueDate: '2026-10-20', completedAt: 1 },
    ];
    expect(
      tasksInRange(list, '2026-10-01', '2026-11-01', SP).map((task) => task.title)
    ).toEqual(['Dentro']);
    expect(tasksInRange(null, '2026-10-01', '2026-11-01', SP)).toEqual([]);
  });
});

describe('textos', () => {
  it('whenLines', () => {
    expect(whenLines(occurrence({}), SP)).toEqual([
      'Segunda-feira, 19 de outubro de 2026',
      '09:00 – 10:00 · 1 h',
    ]);
    expect(
      whenLines(occurrence({ allDay: true, startAt: '2026-10-19', endAt: '2026-10-22' }), SP)[1]
    ).toBe('Dia inteiro');
  });

  it('listDayTitle', () => {
    expect(listDayTitle('2026-10-18', '2026-10-18')).toBe('Hoje · domingo, 18 de outubro');
    expect(listDayTitle('2026-10-19', '2026-10-18')).toBe('Amanhã · segunda-feira, 19 de outubro');
    expect(listDayTitle('2027-01-05', '2026-10-18')).toBe('Terça-feira, 5 de janeiro de 2027');
  });
});
