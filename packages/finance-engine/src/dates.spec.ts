import { describe, expect, it } from 'vitest';

import {
  addDays,
  addMonthsClamped,
  dateStringInZone,
  diffInDays,
  monthRange,
  startOfDayInZone,
  wallTimeToInstant,
} from './dates';

describe('datas de calendário', () => {
  it('soma dias atravessando mês e ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('soma meses prendendo no último dia', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonthsClamped('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('conta dias entre datas', () => {
    expect(diffInDays('2026-10-01', '2026-10-31')).toBe(30);
  });

  it('dá o primeiro e o último dia do mês', () => {
    expect(monthRange('2026-02')).toEqual({ first: '2026-02-01', last: '2026-02-28' });
  });
});

describe('fusos', () => {
  it('meia-noite em São Paulo é 03:00 UTC', () => {
    expect(startOfDayInZone('2026-10-18', 'America/Sao_Paulo').toISOString()).toBe(
      '2026-10-18T03:00:00.000Z'
    );
  });

  it('respeita horário de verão em Nova York', () => {
    expect(
      wallTimeToInstant(
        { year: 2026, month: 7, day: 1, hour: 9, minute: 0 },
        'America/New_York'
      ).toISOString()
    ).toBe('2026-07-01T13:00:00.000Z');
    expect(
      wallTimeToInstant(
        { year: 2026, month: 12, day: 1, hour: 9, minute: 0 },
        'America/New_York'
      ).toISOString()
    ).toBe('2026-12-01T14:00:00.000Z');
  });

  it('dá o dia no fuso', () => {
    expect(dateStringInZone(new Date('2026-10-18T02:00:00Z'), 'America/Sao_Paulo')).toBe(
      '2026-10-17'
    );
  });
});
