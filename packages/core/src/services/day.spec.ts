import { describe, expect, it } from 'vitest';

import { byEventStart, followToday } from './day';

describe('virada do dia', () => {
  it('quem olhava o dia que acabou passa ao novo', () => {
    expect(followToday('2026-11-02', '2026-11-02', '2026-11-03')).toBe('2026-11-03');
  });

  it('quem escolheu outro dia fica nele', () => {
    expect(followToday('2026-10-30', '2026-11-02', '2026-11-03')).toBe('2026-10-30');
  });

  it('sem virada, nada muda', () => {
    expect(followToday('2026-11-02', '2026-11-02', '2026-11-02')).toBe('2026-11-02');
  });
});

describe('ordem da agenda', () => {
  const event = (startAt: string, day: string, allDay = false) => ({ startAt, day, allDay });

  it('ordena por instante, mesmo com fusos diferentes no texto', () => {
    const late = event('2026-11-03T10:00:00-03:00', '2026-11-03'); // 13h UTC
    const early = event('2026-11-03T12:00:00.000Z', '2026-11-03');
    expect([late, early].sort(byEventStart)).toEqual([early, late]);
  });

  it('dia inteiro vem primeiro no próprio dia, sem cair no dia anterior', () => {
    const allDay = event('2026-11-03', '2026-11-03', true);
    const night = event('2026-11-03T01:00:00.000Z', '2026-11-02');
    const morning = event('2026-11-03T12:00:00.000Z', '2026-11-03');
    expect([morning, allDay, night].sort(byEventStart)).toEqual([night, allDay, morning]);
  });
});
