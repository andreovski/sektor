import { describe, expect, it } from 'vitest';

import { looksLikeIcs, parseDuration, parseIcs } from './parse';

// Recorte de um calendário publicado pelo Outlook (fuso com nome do Windows, série semanal com
// uma ocorrência movida e outra apagada, dia inteiro e texto dobrado em linhas).
const OUTLOOK = [
  'BEGIN:VCALENDAR',
  'METHOD:PUBLISH',
  'PRODID:Microsoft Exchange Server 2010',
  'VERSION:2.0',
  'X-WR-CALNAME:Calendário',
  'BEGIN:VTIMEZONE',
  'TZID:E. South America Standard Time',
  'BEGIN:STANDARD',
  'DTSTART:16010101T000000',
  'TZOFFSETFROM:-0300',
  'TZOFFSETTO:-0300',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E00800000000SERIE',
  'SUMMARY;LANGUAGE=pt-BR:Daily do time',
  'DTSTART;TZID=E. South America Standard Time:20261005T093000',
  'DTEND;TZID=E. South America Standard Time:20261005T094500',
  'RRULE:FREQ=WEEKLY;UNTIL=20261102T123000Z;INTERVAL=1;BYDAY=MO,WE;WKST=SU',
  'EXDATE;TZID=E. South America Standard Time:20261014T093000',
  'LOCATION:Microsoft Teams',
  'DESCRIPTION:Pauta:\\n- status\\, bloqueios\\; próximos passos',
  'DTSTAMP:20261023T190000Z',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:040000008200E00074C5B7101A82E00800000000SERIE',
  'RECURRENCE-ID;TZID=E. South America Standard Time:20261019T093000',
  'SUMMARY;LANGUAGE=pt-BR:Daily do time (remarcada)',
  'DTSTART;TZID=E. South America Standard Time:20261019T140000',
  'DTEND;TZID=E. South America Standard Time:20261019T141500',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:FERIADO',
  'SUMMARY:Folga coletiva',
  'DTSTART;VALUE=DATE:20261102',
  'DTEND;VALUE=DATE:20261104',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:ALLDAY-OUTLOOK',
  'SUMMARY:Treinamento',
  'DTSTART;TZID=E. South America Standard Time:20261020T000000',
  'DTEND;TZID=E. South America Standard Time:20261021T000000',
  'X-MICROSOFT-CDO-ALLDAYEVENT:TRUE',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:LONGO',
  'SUMMARY:Reunião com um título bem comprido que o Outlook dobra em mais de uma l',
  ' inha do arquivo',
  'DTSTART:20261021T170000Z',
  'DURATION:PT1H30M',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'UID:CANCELADA',
  'SUMMARY:Cancelada',
  'STATUS:CANCELLED',
  'DTSTART:20261021T170000Z',
  'DTEND:20261021T180000Z',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const window = {
  from: new Date('2026-10-01T00:00:00Z'),
  to: new Date('2026-12-01T00:00:00Z'),
  defaultTimeZone: 'America/Sao_Paulo',
};

describe('parseIcs', () => {
  const calendar = parseIcs(OUTLOOK, window);
  const titled = (title: string) => calendar.occurrences.filter((o) => o.title === title);

  it('lê o nome do calendário', () => {
    expect(calendar.name).toBe('Calendário');
  });

  it('expande a série no fuso do Windows, sem a apagada, a movida e depois do UNTIL', () => {
    const daily = titled('Daily do time').map((o) => o.startAt.toISOString());
    expect(daily).toEqual([
      '2026-10-05T12:30:00.000Z',
      '2026-10-07T12:30:00.000Z',
      '2026-10-12T12:30:00.000Z',
      // 14/10 apagada (EXDATE), 19/10 movida para as 14h
      '2026-10-21T12:30:00.000Z',
      '2026-10-26T12:30:00.000Z',
      '2026-10-28T12:30:00.000Z',
      '2026-11-02T12:30:00.000Z',
    ]);
    const first = titled('Daily do time')[0];
    expect(first.endAt.toISOString()).toBe('2026-10-05T12:45:00.000Z');
    expect(first.location).toBe('Microsoft Teams');
    expect(first.description).toBe('Pauta:\n- status, bloqueios; próximos passos');
  });

  it('a exceção troca a ocorrência e mantém a chave dela', () => {
    const [moved] = titled('Daily do time (remarcada)');
    expect(moved.startAt.toISOString()).toBe('2026-10-19T17:00:00.000Z');
    expect(moved.key).toBe(
      '040000008200E00074C5B7101A82E00800000000SERIE@2026-10-19T12:30:00.000Z'
    );
    // Herda o que a exceção não traz.
    expect(moved.location).toBe('Microsoft Teams');
  });

  it('dia inteiro fica em meia-noite UTC com fim exclusivo', () => {
    const [holiday] = titled('Folga coletiva');
    expect(holiday).toMatchObject({ allDay: true, key: 'FERIADO' });
    expect(holiday.startAt.toISOString()).toBe('2026-11-02T00:00:00.000Z');
    expect(holiday.endAt.toISOString()).toBe('2026-11-04T00:00:00.000Z');

    const [training] = titled('Treinamento');
    expect(training.allDay).toBe(true);
    expect(training.startAt.toISOString()).toBe('2026-10-20T00:00:00.000Z');
    expect(training.endAt.toISOString()).toBe('2026-10-21T00:00:00.000Z');
  });

  it('desdobra linhas, usa DURATION e ignora cancelados', () => {
    const long = calendar.occurrences.find((o) => o.key === 'LONGO')!;
    expect(long.title).toBe(
      'Reunião com um título bem comprido que o Outlook dobra em mais de uma linha do arquivo'
    );
    expect(long.endAt.toISOString()).toBe('2026-10-21T18:30:00.000Z');
    expect(titled('Cancelada')).toEqual([]);
  });

  it('só traz o que cai na janela', () => {
    const narrow = parseIcs(OUTLOOK, {
      ...window,
      from: new Date('2026-10-26T00:00:00Z'),
      to: new Date('2026-10-27T00:00:00Z'),
    });
    expect(narrow.occurrences.map((o) => o.title)).toEqual(['Daily do time']);
  });

  it('mantém a hora local quando o horário de verão muda (fuso IANA)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:NY',
      'SUMMARY:Standup NY',
      'DTSTART;TZID=America/New_York:20261029T090000',
      'DTEND;TZID=America/New_York:20261029T093000',
      'RRULE:FREQ=WEEKLY;COUNT=2',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const starts = parseIcs(ics, window).occurrences.map((o) => o.startAt.toISOString());
    // 29/10 ainda em EDT (-4), 05/11 já em EST (-5): sempre 9h em Nova York.
    expect(starts).toEqual(['2026-10-29T13:00:00.000Z', '2026-11-05T14:00:00.000Z']);
  });

  it('fuso desconhecido usa o VTIMEZONE de deslocamento fixo, senão o padrão', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VTIMEZONE',
      'TZID:(UTC-03:00) Brasília',
      'BEGIN:STANDARD',
      'TZOFFSETFROM:-0300',
      'TZOFFSETTO:-0300',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:A',
      'SUMMARY:A',
      'DTSTART;TZID="(UTC-03:00) Brasília":20261010T100000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:B',
      'SUMMARY:B',
      'DTSTART;TZID=Nome Inventado:20261010T100000',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:C',
      'SUMMARY:C',
      'DTSTART:20261010T100000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const { occurrences } = parseIcs(ics, { ...window, defaultTimeZone: 'Europe/Lisbon' });
    const at = (uid: string) => occurrences.find((o) => o.key === uid)!.startAt.toISOString();
    expect(at('A')).toBe('2026-10-10T13:00:00.000Z');
    // Lisboa em outubro está em WEST (+1).
    expect(at('B')).toBe('2026-10-10T09:00:00.000Z');
    expect(at('C')).toBe('2026-10-10T09:00:00.000Z');
    // Sem fim: 1 h.
    expect(occurrences.find((o) => o.key === 'A')!.endAt.toISOString()).toBe(
      '2026-10-10T14:00:00.000Z'
    );
  });

  it('série mensal pelo dia da semana e série de dia inteiro', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:M',
      'SUMMARY:Comitê',
      'DTSTART;TZID=E. South America Standard Time:20260908T150000',
      'DTEND;TZID=E. South America Standard Time:20260908T160000',
      'RRULE:FREQ=MONTHLY;BYDAY=2TU',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:D',
      'SUMMARY:Plantão',
      'DTSTART;VALUE=DATE:20261030',
      'DTEND;VALUE=DATE:20261031',
      'RRULE:FREQ=DAILY;UNTIL=20261101',
      'EXDATE;VALUE=DATE:20261031',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const { occurrences } = parseIcs(ics, window);
    expect(
      occurrences.filter((o) => o.title === 'Comitê').map((o) => o.startAt.toISOString())
    ).toEqual(['2026-10-13T18:00:00.000Z', '2026-11-10T18:00:00.000Z']);
    expect(occurrences.filter((o) => o.title === 'Plantão').map((o) => o.key)).toEqual([
      'D@2026-10-30',
      'D@2026-11-01',
    ]);
  });
});

describe('segurança', () => {
  it('regra de minutos não trava a leitura: fica só a primeira ocorrência', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:DENSA',
      'SUMMARY:Densa',
      'DTSTART:20261010T100000Z',
      'RRULE:FREQ=SECONDLY',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:QUEBRADA',
      'SUMMARY:Quebrada',
      'DTSTART:20261011T100000Z',
      'RRULE:FREQ=NADA',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const { occurrences } = parseIcs(ics, window);
    expect(occurrences.map((o) => o.title)).toEqual(['Densa', 'Quebrada']);
  });
});

describe('ajudantes', () => {
  it('parseDuration', () => {
    expect(parseDuration('PT1H30M')).toBe(5_400_000);
    expect(parseDuration('P1D')).toBe(86_400_000);
    expect(parseDuration('P1W')).toBe(7 * 86_400_000);
    expect(parseDuration('nada')).toBeNull();
  });

  it('looksLikeIcs', () => {
    expect(looksLikeIcs('\uFEFFBEGIN:VCALENDAR\r\n')).toBe(true);
    expect(looksLikeIcs('<!doctype html>')).toBe(false);
  });
});
