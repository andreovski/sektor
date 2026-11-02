import { addDays } from '@sektor/finance-engine';
import { describe, expect, it } from 'vitest';

import {
  challengeProgress,
  completionRate,
  currentStreak,
  type Frequency,
  isAtRisk,
  isDue,
  longestStreak,
} from './streaks';

const DAILY: Frequency = { type: 'DAILY' };
const WEEKDAYS: Frequency = { type: 'WEEKDAYS' };
const times = (n: number): Frequency => ({ type: 'TIMES', times: n });

// 02/11/2026 é uma segunda-feira.
const MON = '2026-11-02';
const ago = (n: number, from = MON) => addDays(from, -n);
const marks = (...daysAgo: number[]) => new Set(daysAgo.map((n) => ago(n)));

describe('todo dia', () => {
  it('conta os dias seguidos terminando hoje', () => {
    expect(currentStreak(DAILY, marks(0, 1, 2), MON)).toBe(3);
  });

  it('hoje sem marca não quebra: segue contando até ontem', () => {
    expect(currentStreak(DAILY, marks(1, 2), MON)).toBe(2);
    expect(isAtRisk(DAILY, marks(1, 2), MON)).toBe(true);
  });

  it('ontem sem marca quebra', () => {
    expect(currentStreak(DAILY, marks(2, 3), MON)).toBe(0);
    expect(isAtRisk(DAILY, marks(2, 3), MON)).toBe(false);
  });

  it('maior sequência fica mesmo depois de quebrar', () => {
    expect(longestStreak(DAILY, marks(0, 5, 6, 7, 8), MON)).toBe(4);
  });

  it('sem marca nenhuma é zero, sem taxa de dia nenhum', () => {
    expect(currentStreak(DAILY, new Set(), MON)).toBe(0);
    expect(longestStreak(DAILY, new Set(), MON)).toBe(0);
    expect(completionRate(DAILY, new Set(), { today: MON, start: MON })).toBeNull();
  });
});

describe('dias úteis', () => {
  it('o fim de semana não quebra nem soma', () => {
    // Sexta (3 dias atrás) e segunda.
    expect(currentStreak(WEEKDAYS, marks(0, 3, 4), MON)).toBe(3);
  });

  it('marca no sábado não conta', () => {
    expect(currentStreak(WEEKDAYS, marks(0, 2, 3), MON)).toBe(2);
    expect(longestStreak(WEEKDAYS, marks(0, 2, 3), MON)).toBe(2);
  });

  it('no sábado a sequência de sexta segue viva e sem risco', () => {
    const saturday = '2026-11-07';
    const set = new Set(['2026-11-05', '2026-11-06']);
    expect(currentStreak(WEEKDAYS, set, saturday)).toBe(2);
    expect(isDue(WEEKDAYS, set, saturday)).toBe(false);
    expect(isAtRisk(WEEKDAYS, set, saturday)).toBe(false);
  });

  it('a taxa só mede dias úteis', () => {
    // De sexta a segunda há 2 dias úteis, e só um feito.
    expect(completionRate(WEEKDAYS, marks(0), { today: MON, start: ago(3) })).toBe(0.5);
  });
});

describe('X vezes em 7 dias', () => {
  const three = times(3);

  it('não há sequência antes de chegar a X', () => {
    expect(currentStreak(three, marks(0, 1), MON)).toBe(0);
  });

  it('ao chegar a X conta desde a primeira marca da janela', () => {
    expect(currentStreak(three, marks(0, 2, 4), MON)).toBe(5);
  });

  it('dias de folga dentro da janela não quebram', () => {
    // Seg, qua, sex por duas semanas: toda janela de 7 dias tem 3.
    const set = marks(0, 2, 4, 7, 9, 11);
    expect(currentStreak(three, set, MON)).toBe(12);
    expect(longestStreak(three, set, MON)).toBe(12);
  });

  it('corre risco no dia em que a marca mais antiga sai da janela', () => {
    const set = marks(1, 3, 6); // janela de hoje ainda cumprida: de 6 dias atrás até hoje
    expect(currentStreak(three, set, ago(0))).toBe(7);
    expect(isAtRisk(three, marks(1, 3, 7), MON)).toBe(true);
    expect(currentStreak(three, marks(1, 3, 7), MON)).toBe(7);
  });

  it('com a janela cumprida hoje não pede nada', () => {
    expect(isDue(three, marks(1, 2, 3), MON)).toBe(false);
  });

  it('quebra quando a marca de hoje já não bastaria', () => {
    expect(currentStreak(three, marks(1, 8, 9, 10), MON)).toBe(0);
    expect(longestStreak(three, marks(1, 8, 9, 10), MON)).toBeGreaterThanOrEqual(3);
  });

  it('a taxa compara com o proporcional e para em 100%', () => {
    expect(completionRate(three, marks(0, 2, 4), { today: MON, start: ago(6) })).toBe(1);
    expect(completionRate(three, marks(0, 1, 2, 3, 4, 5, 6), { today: MON, start: ago(6) })).toBe(1);
    expect(completionRate(times(2), marks(0), { today: MON, start: ago(6) })).toBe(0.5);
  });
});

describe('taxa em 28 dias', () => {
  it('hoje sem marca fica de fora; o dia ainda não acabou', () => {
    expect(completionRate(DAILY, marks(1, 2), { today: MON, start: ago(2) })).toBe(1);
  });

  it('hoje com marca entra', () => {
    expect(completionRate(DAILY, marks(0), { today: MON, start: ago(1) })).toBe(0.5);
  });

  it('não olha antes de 28 dias', () => {
    expect(completionRate(DAILY, marks(0, 30), { today: MON, start: ago(100) })).toBeCloseTo(1 / 28);
  });

  it('dia marcado antes do começo move o começo', () => {
    expect(completionRate(DAILY, marks(0, 3), { today: MON, start: MON })).toBe(0.5);
  });

  it('desafio encerrado mede até o prazo, com o último dia valendo', () => {
    const rate = completionRate(DAILY, marks(10, 11), {
      today: MON,
      start: ago(12),
      end: ago(10),
    });
    expect(rate).toBeCloseTo(2 / 3);
  });
});

describe('desafio', () => {
  it('conta o pedido pela frequência', () => {
    expect(challengeProgress(DAILY, marks(0), MON, addDays(MON, 9))).toEqual({ done: 1, target: 10 });
    expect(challengeProgress(WEEKDAYS, marks(0), MON, addDays(MON, 13))).toEqual({
      done: 1,
      target: 10,
    });
    expect(challengeProgress(times(3), marks(0), MON, addDays(MON, 13))).toEqual({
      done: 1,
      target: 6,
    });
  });
});
