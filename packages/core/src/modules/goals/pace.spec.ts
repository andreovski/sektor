import { describe, expect, it } from 'vitest';

import { computePace } from './pace';

const base = { startedOn: '2026-01-01', today: '2026-07-01', whole: true };

describe('ritmo da meta', () => {
  it('reparte o que falta por mês', () => {
    const pace = computePace({ ...base, target: 12000_00, current: 6000_00, deadline: '2026-12-31' });
    expect(pace).toMatchObject({ remaining: 6000_00, period: 'month', progress: 0.5, daysLeft: 183 });
    expect(pace.perPeriod).toBeGreaterThan(990_00);
    expect(pace.perPeriod).toBeLessThan(1010_00);
  });

  it('perto do prazo passa para semana e dia', () => {
    const week = computePace({ ...base, target: 100, current: 0, deadline: '2026-07-21' });
    expect(week.period).toBe('week');
    const day = computePace({ ...base, target: 100, current: 0, deadline: '2026-07-04' });
    expect(day).toMatchObject({ period: 'day', perPeriod: 25 });
  });

  it('no último dia pede tudo hoje', () => {
    const pace = computePace({ ...base, target: 10, current: 4, deadline: '2026-07-01' });
    expect(pace).toMatchObject({ daysLeft: 0, period: 'day', perPeriod: 6 });
  });

  it('arredonda para cima, com uma casa quando a unidade aceita', () => {
    const pace = computePace({
      ...base,
      whole: false,
      target: 10,
      current: 0,
      deadline: '2026-07-03',
    });
    expect(pace.perPeriod).toBe(3.4);
  });

  it('concluída, sem prazo e vencida não têm ritmo', () => {
    expect(computePace({ ...base, target: 10, current: 12, deadline: '2026-12-01' })).toMatchObject({
      status: 'done',
      progress: 1,
      remaining: 0,
      perPeriod: null,
    });
    expect(computePace({ ...base, target: 10, current: 1, deadline: null }).status).toBe('no_deadline');
    expect(computePace({ ...base, target: 10, current: 1, deadline: '2026-06-01' }).status).toBe(
      'overdue'
    );
  });

  it('saldo negativo não vira progresso negativo', () => {
    const pace = computePace({ ...base, target: 100, current: -50, deadline: '2026-12-31' });
    expect(pace).toMatchObject({ progress: 0, remaining: 150 });
  });

  it('compara com a linha reta do começo ao prazo', () => {
    const at = (current: number) =>
      computePace({ ...base, target: 100, current, deadline: '2026-12-31' }).status;
    expect(at(70)).toBe('ahead');
    expect(at(50)).toBe('on_track');
    expect(at(20)).toBe('behind');
  });

  it('sequência não acelera: diz quando não cabe mais', () => {
    const fits = computePace({ ...base, target: 30, current: 20, deadline: '2026-07-10', maxPerDay: 1 });
    expect(fits).toMatchObject({ period: null, perPeriod: null });
    expect(fits.status).not.toBe('unreachable');
    const late = computePace({ ...base, target: 30, current: 0, deadline: '2026-07-10', maxPerDay: 1 });
    expect(late.status).toBe('unreachable');
  });
});
