import { describe, expect, it } from 'vitest';

import { describeSchedule, leadText, nextScheduleFire, type ScheduleRule, slotsOf } from './schedule';

const SP = 'America/Sao_Paulo';
// 18/10/2026, domingo, 12h em São Paulo.
const NOW = new Date('2026-10-18T15:00:00Z');

const next = (rule: Partial<ScheduleRule>, after = NOW) =>
  nextScheduleFire({ schedule: 'DAILY', startDate: '2026-10-18', time: '08:00', ...rule }, after, SP)?.toISOString() ??
  null;

describe('próximo toque', () => {
  it('uma vez: na hora marcada, e depois acabou', () => {
    expect(next({ schedule: 'ONCE', startDate: '2026-10-20', time: '10:00' })).toBe(
      '2026-10-20T13:00:00.000Z'
    );
    expect(next({ schedule: 'ONCE', startDate: '2026-10-18', time: '10:00' })).toBeNull();
  });

  it('todo dia: hoje se ainda não passou, senão amanhã', () => {
    expect(next({ time: '13:00' })).toBe('2026-10-18T16:00:00.000Z');
    expect(next({ time: '08:00' })).toBe('2026-10-19T11:00:00.000Z');
  });

  it('não começa antes do primeiro dia', () => {
    expect(next({ startDate: '2026-11-01' })).toBe('2026-11-01T11:00:00.000Z');
  });

  it('dias úteis pulam o fim de semana', () => {
    const friday = new Date('2026-10-23T15:00:00Z');
    expect(next({ schedule: 'WEEKDAYS', startDate: '2026-10-01' }, friday)).toBe(
      '2026-10-26T11:00:00.000Z'
    );
  });

  it('semanal repete o dia da semana do primeiro dia', () => {
    expect(next({ schedule: 'WEEKLY', startDate: '2026-10-07' })).toBe('2026-10-21T11:00:00.000Z');
  });

  it('mensal usa o último dia nos meses curtos e volta ao dia 31', () => {
    const rule = { schedule: 'MONTHLY' as const, startDate: '2026-01-31' };
    expect(next(rule, new Date('2026-02-01T15:00:00Z'))).toBe('2026-02-28T11:00:00.000Z');
    expect(next(rule, new Date('2026-03-01T15:00:00Z'))).toBe('2026-03-31T11:00:00.000Z');
  });

  it('a cada N horas fica dentro do intervalo e passa para o dia seguinte', () => {
    const rule = {
      schedule: 'INTERVAL' as const,
      intervalHours: 3,
      windowStart: '08:00',
      windowEnd: '18:00',
      time: null,
    };
    expect(slotsOf({ ...rule, startDate: '2026-10-18' })).toEqual([480, 660, 840, 1020]);
    expect(next(rule)).toBe('2026-10-18T17:00:00.000Z'); // 14h
    expect(next(rule, new Date('2026-10-18T20:30:00Z'))).toBe('2026-10-19T11:00:00.000Z');
  });
});

describe('textos', () => {
  const base = { startDate: '2026-10-19', time: '08:30' };

  it('descreve cada agenda', () => {
    expect(describeSchedule({ ...base, schedule: 'ONCE' })).toBe('Uma vez, 19/10/2026 às 08:30');
    expect(describeSchedule({ ...base, schedule: 'DAILY' })).toBe('Todo dia às 08:30');
    expect(describeSchedule({ ...base, schedule: 'WEEKDAYS' })).toBe('Dias úteis às 08:30');
    expect(describeSchedule({ ...base, schedule: 'WEEKLY' })).toBe('Toda segunda às 08:30');
    expect(describeSchedule({ ...base, schedule: 'WEEKLY', startDate: '2026-10-18' })).toBe(
      'Todo domingo às 08:30'
    );
    expect(describeSchedule({ ...base, schedule: 'MONTHLY' })).toBe('Todo dia 19 do mês às 08:30');
    expect(
      describeSchedule({
        ...base,
        schedule: 'INTERVAL',
        intervalHours: 2,
        windowStart: '08:00',
        windowEnd: '18:00',
      })
    ).toBe('A cada 2 horas, das 08:00 às 18:00');
  });

  it('leadText', () => {
    expect(leadText(0)).toBe('agora');
    expect(leadText(10)).toBe('em 10 min');
    expect(leadText(120)).toBe('em 2 h');
    expect(leadText(90)).toBe('em 1 h 30 min');
    expect(leadText(1440)).toBe('amanhã');
  });
});
