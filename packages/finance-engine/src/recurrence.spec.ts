import { describe, expect, it } from 'vitest';

import {
  buildRRule,
  dateOccurrences,
  describeRRule,
  eventOccurrences,
  nextEventOccurrence,
  parseSimpleRRule,
} from './recurrence';

describe('buildRRule / parseSimpleRRule', () => {
  it('monta e lê de volta uma regra semanal', () => {
    const rule = buildRRule({ freq: 'WEEKLY', byWeekday: [3, 1], count: 10 });
    expect(rule).toBe('FREQ=WEEKLY;BYDAY=MO,WE;COUNT=10');
    expect(parseSimpleRRule(rule)).toEqual({ freq: 'WEEKLY', byWeekday: [1, 3], count: 10 });
  });

  it('monta regra com fim numa data', () => {
    const rule = buildRRule({ freq: 'MONTHLY', interval: 2, until: '2027-06-30' });
    expect(rule).toBe('FREQ=MONTHLY;INTERVAL=2;UNTIL=20270630T235959Z');
    expect(parseSimpleRRule(rule)).toMatchObject({ until: '2027-06-30', interval: 2 });
  });
});

describe('describeRRule', () => {
  it('descreve em português', () => {
    expect(describeRRule('FREQ=WEEKLY;BYDAY=MO,WE')).toBe('Toda semana: segunda, quarta');
    expect(describeRRule('FREQ=MONTHLY;INTERVAL=2;COUNT=6')).toBe('A cada 2 meses, 6 vezes');
    expect(describeRRule('FREQ=DAILY;UNTIL=20261231T235959Z')).toBe('Todo dia, até 31/12/2026');
  });
});

describe('dateOccurrences', () => {
  it('gera o salário todo dia 5', () => {
    expect(dateOccurrences('FREQ=MONTHLY', '2026-01-05', '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-05',
      '2026-02-05',
      '2026-03-05',
      '2026-04-05',
    ]);
  });

  it('respeita COUNT', () => {
    expect(
      dateOccurrences('FREQ=WEEKLY;COUNT=3', '2026-10-01', '2026-01-01', '2027-01-01')
    ).toHaveLength(3);
  });
});

describe('eventOccurrences', () => {
  const tz = 'America/New_York';

  it('mantém o horário de parede através do horário de verão', () => {
    const dtstart = new Date('2026-10-26T13:00:00Z'); // segunda 9h (EDT)
    const starts = eventOccurrences(
      'FREQ=WEEKLY',
      dtstart,
      new Date('2026-10-25T00:00:00Z'),
      new Date('2026-11-10T00:00:00Z'),
      tz
    ).map((d) => d.toISOString());
    expect(starts).toEqual([
      '2026-10-26T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z', // depois do fim do horário de verão, ainda 9h
      '2026-11-09T14:00:00.000Z',
    ]);
  });

  it('inclui a ocorrência que começou antes do intervalo e ainda dura', () => {
    const dtstart = new Date('2026-10-18T23:00:00Z');
    const starts = eventOccurrences(
      'FREQ=DAILY',
      dtstart,
      new Date('2026-10-20T00:00:00Z'),
      new Date('2026-10-20T12:00:00Z'),
      'UTC',
      2 * 3_600_000
    ).map((d) => d.toISOString());
    expect(starts).toEqual(['2026-10-19T23:00:00.000Z']);
  });

  it('acha a próxima ocorrência', () => {
    const next = nextEventOccurrence(
      'FREQ=DAILY;COUNT=2',
      new Date('2026-10-18T12:00:00Z'),
      new Date('2026-10-18T12:00:00Z'),
      'UTC'
    );
    expect(next?.toISOString()).toBe('2026-10-19T12:00:00.000Z');
    expect(
      nextEventOccurrence(
        'FREQ=DAILY;COUNT=2',
        new Date('2026-10-18T12:00:00Z'),
        new Date('2026-10-19T12:00:00Z'),
        'UTC'
      )
    ).toBeNull();
  });
});
