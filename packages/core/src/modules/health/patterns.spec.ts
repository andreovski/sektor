import { addDays } from '@sektor/finance-engine';
import { describe, expect, it } from 'vitest';

import {
  bestWeekday,
  gratitudeAndMood,
  MIN_DAYS,
  type PatternDay,
  sleepAndMood,
  waterAndEnergy,
} from './patterns';

const day = (i: number, fields: Partial<PatternDay>): PatternDay => ({
  // 02/11/2026 é uma segunda.
  date: addDays('2026-11-02', i),
  mood: null,
  energy: null,
  gratitude: null,
  sleepMinutes: null,
  waterMl: 0,
  ...fields,
});
const days = (n: number, fields: (i: number) => Partial<PatternDay>) =>
  Array.from({ length: n }, (_, i) => day(i, fields(i)));

describe('padrões', () => {
  it('com poucos dados, diz que ainda é cedo', () => {
    const few = days(MIN_DAYS - 1, (i) => ({
      mood: 3,
      energy: 3,
      gratitude: i % 2 ? 'x' : null,
      sleepMinutes: 400 + i,
      waterMl: 500 + i,
    }));
    for (const pattern of [sleepAndMood, waterAndEnergy, gratitudeAndMood, bestWeekday]) {
      const result = pattern(few);
      expect(result.status).toBe('early');
      expect(result.summary).toContain('cedo');
      expect(result.samples).toBe(MIN_DAYS - 1);
      expect(result.groups).toEqual([]);
    }
  });

  it('dias sem o par não contam como dado', () => {
    expect(sleepAndMood(days(30, () => ({ mood: 4 }))).samples).toBe(0);
    expect(waterAndEnergy(days(30, () => ({ energy: 4, waterMl: 0 }))).samples).toBe(0);
  });

  it('dormir mais anda com humor melhor', () => {
    const result = sleepAndMood(
      days(20, (i) => (i % 2 ? { sleepMinutes: 480, mood: 5 } : { sleepMinutes: 360, mood: 2 }))
    );
    expect(result.status).toBe('found');
    expect(result.summary).toBe(
      'Depois de noites de 8h00 ou mais, seu humor ficou em 5,0. Nas mais curtas, em 2,0.'
    );
    expect(result.groups.map((g) => g.count)).toEqual([10, 10]);
  });

  it('sem diferença real, não inventa padrão', () => {
    const result = waterAndEnergy(days(20, (i) => ({ waterMl: i % 2 ? 2500 : 1000, energy: 3 })));
    expect(result.status).toBe('flat');
    expect(result.summary).toContain('não mudou');
  });

  it('dias iguais demais não dão para comparar', () => {
    const result = sleepAndMood(days(20, () => ({ sleepMinutes: 420, mood: 4 })));
    expect(result.status).toBe('early');
    expect(result.summary).toContain('parecidas');
  });

  it('gratidão separa os dias com e sem texto, ignorando espaços', () => {
    const result = gratitudeAndMood(
      days(20, (i) => (i % 2 ? { gratitude: 'família', mood: 5 } : { gratitude: '  ', mood: 3 }))
    );
    expect(result.status).toBe('found');
    expect(result.groups[0]).toMatchObject({ label: 'Com gratidão', average: 5, count: 10 });
  });

  it('valores repetidos ainda dividem os dias em dois lados', () => {
    const result = waterAndEnergy(
      days(20, (i) => (i % 3 === 0 ? { waterMl: 2250, energy: 5 } : { waterMl: 1000, energy: 2 }))
    );
    expect(result.status).toBe('found');
    expect(result.groups.map((g) => g.count)).toEqual([7, 13]);
  });

  it('dois dias empatados no topo não elegem um melhor', () => {
    const tied = bestWeekday(days(28, (i) => ({ mood: i % 7 === 1 || i % 7 === 4 ? 5 : 3 })));
    expect(tied.status).toBe('flat');
  });

  it('água corta no meio dos dias da pessoa', () => {
    const result = waterAndEnergy(
      days(20, (i) => (i < 10 ? { waterMl: 1000, energy: 2 } : { waterMl: 2000, energy: 4 }))
    );
    expect(result.groups[0]!.label).toBe('2,0 L ou mais');
    expect(result.status).toBe('found');
  });

  it('melhor dia pede semanas suficientes e destaque real', () => {
    const friday = bestWeekday(days(28, (i) => ({ mood: i % 7 === 4 ? 5 : 3 })));
    expect(friday.status).toBe('found');
    expect(friday.summary).toContain('Sexta');
    expect(friday.groups).toHaveLength(7);

    const flat = bestWeekday(days(28, () => ({ mood: 3 })));
    expect(flat.status).toBe('flat');

    const fewWeeks = bestWeekday(days(14, () => ({ mood: 3 })));
    expect(fewWeeks.status).toBe('early');
    expect(fewWeeks.summary).toContain('semanas');
  });
});
