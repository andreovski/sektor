import { describe, expect, it } from 'vitest';

import {
  alertLabel,
  bodyOf,
  endBeforeStart,
  formFromOccurrence,
  newEventForm,
  repeatFromRRule,
  rruleOf,
  shiftSeries,
  withStart,
} from './form';
import type { EventOccurrence } from './view';

const SP = 'America/Sao_Paulo';
const NOW = new Date('2026-10-18T15:20:00Z'); // 12h20

const blank = (date = '2026-10-18') =>
  newEventForm({ date, now: NOW, timeZone: SP, calendarId: 'c' });

describe('formulário do evento', () => {
  it('hoje começa na próxima hora cheia; outro dia, às 9h; a hora clicada manda', () => {
    expect(blank()).toMatchObject({ startTime: '13:00', endTime: '14:00' });
    expect(blank('2026-10-20')).toMatchObject({ startTime: '09:00', endTime: '10:00' });
    expect(
      newEventForm({ date: '2026-10-20', now: NOW, timeZone: SP, calendarId: 'c', hour: 23 })
    ).toMatchObject({ startTime: '23:00', endDate: '2026-10-21', endTime: '00:00' });
  });

  it('mudar o início leva o fim junto e a repetição semanal segue o dia', () => {
    const next = withStart(blank('2026-10-19'), '2026-10-20', '15:00');
    expect(next).toMatchObject({ endDate: '2026-10-20', endTime: '16:00', weekdays: [2] });
  });

  it('fim antes do início é recusado', () => {
    expect(endBeforeStart({ ...blank(), endTime: '12:00' })).toBe(true);
  });

  it('gera a regra e reconhece a regra de volta', () => {
    const weekly = { ...blank('2026-10-19'), repeat: 'biweekly' as const };
    expect(rruleOf(weekly)).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO');
    expect(rruleOf({ ...weekly, repeat: 'daily', repeatEnd: 'date', untilDate: '2026-12-01' })).toBe(
      'FREQ=DAILY;UNTIL=20261201T235959Z'
    );
    expect(repeatFromRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO', '2026-10-19').repeat).toBe('biweekly');
    expect(repeatFromRRule('FREQ=DAILY;COUNT=3', '2026-10-19')).toMatchObject({
      repeat: 'custom',
      customRRule: 'FREQ=DAILY;COUNT=3',
    });
  });

  it('corpo: dia inteiro em datas com fim exclusivo, com hora em instante', () => {
    expect(bodyOf({ ...blank(), allDay: true, endDate: '2026-10-19' }, SP)).toMatchObject({
      startAt: '2026-10-18',
      endAt: '2026-10-20',
    });
    expect(bodyOf(blank(), SP)).toMatchObject({
      title: 'Novo evento',
      startAt: '2026-10-18T16:00:00.000Z',
      endAt: '2026-10-18T17:00:00.000Z',
    });
  });

  it('volta da ocorrência de dia inteiro com o último dia inclusive', () => {
    const event = {
      allDay: true,
      startAt: '2026-11-02',
      endAt: '2026-11-04',
      title: 'Folga',
      location: null,
      notes: null,
      rrule: null,
      calendarId: 'c',
      reminders: [],
      color: null,
    } as unknown as EventOccurrence;
    expect(formFromOccurrence(event, SP)).toMatchObject({
      startDate: '2026-11-02',
      endDate: '2026-11-03',
    });
  });

  it('mudança na ocorrência desloca a série, sem mover para o dia clicado', () => {
    const moved = shiftSeries(
      { startAt: '2026-10-05T12:00:00.000Z', endAt: '2026-10-05T13:00:00.000Z', allDay: false },
      { startAt: '2026-10-19T12:00:00.000Z' },
      { startAt: '2026-10-19T13:00:00.000Z', endAt: '2026-10-19T14:30:00.000Z', allDay: false }
    );
    expect(moved).toEqual({
      startAt: '2026-10-05T13:00:00.000Z',
      endAt: '2026-10-05T14:30:00.000Z',
    });
    expect(
      shiftSeries(
        { startAt: '2026-10-05', endAt: '2026-10-06', allDay: true },
        { startAt: '2026-10-19' },
        { startAt: '2026-10-19', endAt: '2026-10-21', allDay: true }
      )
    ).toEqual({ startAt: '2026-10-05', endAt: '2026-10-07' });
  });

  it('alertLabel', () => {
    expect(alertLabel(0)).toBe('Na hora do evento');
    expect(alertLabel(15)).toBe('15 minutos antes');
    expect(alertLabel(60)).toBe('1 hora antes');
    expect(alertLabel(2880)).toBe('2 dias antes');
  });
});
