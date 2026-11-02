import { eq } from 'drizzle-orm';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppCtx } from '../../app';
import { type DbHandle, openDatabase } from '../../db/client';

import { handlers as agendaHandlers } from '.';
import type { IcsFetcher } from './ics/fetch';
import * as ics from './ics';
import { calendars, events } from './schema';
import * as svc from './service';

const NOW = new Date('2026-10-18T15:00:00Z');
const OCTOBER = { from: '2026-10-01', to: '2026-11-01' };
const LINK = 'https://exemplo.com/segredo/calendar.ics';

const vcalendar = (...lines: string[]) =>
  ['BEGIN:VCALENDAR', 'X-WR-CALNAME:Trabalho', ...lines, 'END:VCALENDAR'].join('\r\n');
const vevent = (uid: string, title: string, start: string) => [
  'BEGIN:VEVENT',
  `UID:${uid}`,
  `SUMMARY:${title}`,
  `DTSTART:${start}`,
  'DURATION:PT1H',
  'END:VEVENT',
];

describe('agenda', () => {
  let dir: string;
  let handle: DbHandle;
  let ctx: AppCtx;
  let vault: Map<string, string>;

  const expectStatus = (run: () => unknown, status: number) =>
    expect(run).toThrow(expect.objectContaining({ status }));
  const titles = (range = OCTOBER) => svc.listOccurrences(ctx, range).map((o) => o.title);
  const daily = (over = {}) =>
    svc.createEvent(ctx, {
      title: 'Daily',
      startAt: '2026-10-19T12:00:00.000Z',
      endAt: '2026-10-19T12:30:00.000Z',
      rrule: 'FREQ=DAILY;COUNT=3',
      ...over,
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    dir = mkdtempSync(join(tmpdir(), 'sektor-agenda-'));
    handle = openDatabase(join(dir, 'a.db'), 'c'.repeat(64));
    vault = new Map();
    ctx = {
      db: handle.orm,
      timeZone: 'America/Sao_Paulo',
      keys: { get: () => null, set: () => undefined },
      secrets: {
        get: (name) => vault.get(name) ?? null,
        set: (name, value) => {
          if (value === null) vault.delete(name);
          else vault.set(name, value);
        },
      },
      notify: () => undefined,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('calendários', () => {
    it('nasce um calendário Pessoal, que não pode ser o último a sair', () => {
      const [personal] = svc.listCalendars(ctx);
      expect(personal).toMatchObject({ name: 'Pessoal', source: 'LOCAL', selected: true });
      expectStatus(() => svc.deleteCalendar(ctx, personal!.id), 400);
    });

    it('desmarcar esconde os eventos; apagar leva os eventos junto', () => {
      svc.listCalendars(ctx);
      const extra = svc.createCalendar(ctx, { name: 'Faculdade', color: 'rose' });
      svc.createEvent(ctx, {
        calendarId: extra.id,
        title: 'Prova',
        startAt: '2026-10-20T12:00:00.000Z',
        endAt: '2026-10-20T13:00:00.000Z',
      });
      expect(titles()).toEqual(['Prova']);
      svc.updateCalendar(ctx, extra.id, { selected: false });
      expect(titles()).toEqual([]);
      svc.updateCalendar(ctx, extra.id, { selected: true });
      svc.deleteCalendar(ctx, extra.id);
      expect(titles()).toEqual([]);
      expect(svc.listCalendars(ctx).map((c) => c.name)).toEqual(['Pessoal']);
    });
  });

  describe('eventos', () => {
    it('dia inteiro fica em datas, com fim exclusivo, e não escorrega de dia no fuso', () => {
      const event = svc.createEvent(ctx, {
        title: 'Folga',
        allDay: true,
        startAt: '2026-10-20',
        endAt: '2026-10-20',
      });
      expect(event).toMatchObject({ startAt: '2026-10-20', endAt: '2026-10-21' });
      const row = ctx.db.select().from(events).where(eq(events.id, event.id)).get()!;
      expect(row).toMatchObject({ startAt: null, endAt: null, startDate: '2026-10-20' });
      expect(svc.listOccurrences(ctx, { from: '2026-10-20', to: '2026-10-21' })).toHaveLength(1);
      expect(svc.listOccurrences(ctx, { from: '2026-10-21', to: '2026-10-22' })).toHaveLength(0);
      expect(svc.listOccurrences(ctx, { from: '2026-10-19', to: '2026-10-20' })).toHaveLength(0);
    });

    it('recusa regra inválida, fim antes do início e calendário de fora', () => {
      expectStatus(() => daily({ rrule: 'FREQ=NADA' }), 400);
      expectStatus(
        () =>
          agendaHandlers(ctx)['events.create']({
            title: 'X',
            startAt: '2026-10-20T13:00:00.000Z',
            endAt: '2026-10-20T12:00:00.000Z',
          }),
        400
      );
      expectStatus(() => daily({ calendarId: 'nao-existe' }), 404);
    });

    it('expande a série no relógio local e guarda os alertas', () => {
      const master = daily({ reminders: [10, 0] });
      const list = svc.listOccurrences(ctx, OCTOBER);
      expect(list.map((o) => o.startAt)).toEqual([
        '2026-10-19T12:00:00.000Z',
        '2026-10-20T12:00:00.000Z',
        '2026-10-21T12:00:00.000Z',
      ]);
      expect(list[0]).toMatchObject({
        eventId: master.id,
        isRecurring: true,
        isException: false,
        reminders: [0, 10],
      });
    });

    it('editar só este cria a exceção, e editar de novo reaproveita', () => {
      const master = daily();
      const occurrenceStart = '2026-10-20T12:00:00.000Z';
      const edit = (title: string) =>
        svc.updateEvent(ctx, master.id, {
          title,
          startAt: '2026-10-20T17:00:00.000Z',
          endAt: '2026-10-20T18:00:00.000Z',
          scope: 'single',
          occurrenceStart,
        });
      edit('Movida');
      edit('Movida de novo');
      const list = svc.listOccurrences(ctx, OCTOBER);
      expect(list.map((o) => o.title).sort()).toEqual(['Daily', 'Daily', 'Movida de novo']);
      const moved = list.find((o) => o.isException)!;
      expect(moved).toMatchObject({ eventId: master.id, occurrenceStart });
      expect(moved.startAt).toBe('2026-10-20T17:00:00.000Z');
    });

    it('apagar só este cancela a ocorrência; editar depois a traz de volta', () => {
      const master = daily();
      const occurrenceStart = '2026-10-20T12:00:00.000Z';
      svc.deleteEvent(ctx, master.id, { scope: 'single', occurrenceStart });
      expect(titles()).toHaveLength(2);
      const row = ctx.db.select().from(events).where(eq(events.recurringEventId, master.id)).get()!;
      expect(row).toMatchObject({ status: 'CANCELLED', originalStart: occurrenceStart });
      svc.updateEvent(ctx, master.id, { title: 'Volta', scope: 'single', occurrenceStart });
      expect(titles()).toHaveLength(3);
    });

    it('mudar a série leva as exceções junto, e cancelada não ressuscita', () => {
      const master = daily();
      svc.deleteEvent(ctx, master.id, {
        scope: 'single',
        occurrenceStart: '2026-10-20T12:00:00.000Z',
      });
      svc.updateEvent(ctx, master.id, {
        startAt: '2026-10-19T13:00:00.000Z',
        endAt: '2026-10-19T13:30:00.000Z',
      });
      expect(svc.listOccurrences(ctx, OCTOBER).map((o) => o.startAt)).toEqual([
        '2026-10-19T13:00:00.000Z',
        '2026-10-21T13:00:00.000Z',
      ]);
    });

    it('série de dia inteiro: exceção e cancelamento por data', () => {
      const master = svc.createEvent(ctx, {
        title: 'Plantão',
        allDay: true,
        startAt: '2026-10-19',
        endAt: '2026-10-20',
        rrule: 'FREQ=DAILY;COUNT=3',
      });
      svc.deleteEvent(ctx, master.id, { scope: 'single', occurrenceStart: '2026-10-20' });
      expect(svc.listOccurrences(ctx, OCTOBER).map((o) => o.startAt)).toEqual([
        '2026-10-19',
        '2026-10-21',
      ]);
    });

    it('apagar a série apaga as exceções, marcando deleted_at', () => {
      const master = daily();
      svc.deleteEvent(ctx, master.id, {
        scope: 'single',
        occurrenceStart: '2026-10-20T12:00:00.000Z',
      });
      svc.deleteEvent(ctx, master.id, { scope: 'all' });
      expect(titles()).toEqual([]);
      const rows = ctx.db.select().from(events).all();
      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.deletedAt)).toBe(true);
      expectStatus(() => svc.getEvent(ctx, master.id), 404);
    });

    it('sem repetição, editar a data é direto e o escopo não importa', () => {
      const event = svc.createEvent(ctx, {
        title: 'Reunião',
        startAt: '2026-10-20T12:00:00.000Z',
        endAt: '2026-10-20T13:00:00.000Z',
      });
      svc.updateEvent(ctx, event.id, { title: 'Reunião nova', scope: 'single' });
      expect(titles()).toEqual(['Reunião nova']);
    });

    it('virar dia inteiro troca as colunas de horário', () => {
      const event = svc.createEvent(ctx, {
        title: 'Reunião',
        startAt: '2026-10-20T12:00:00.000Z',
        endAt: '2026-10-20T13:00:00.000Z',
      });
      expectStatus(() => svc.updateEvent(ctx, event.id, { allDay: true }), 400);
      expect(
        svc.updateEvent(ctx, event.id, { allDay: true, startAt: '2026-10-20', endAt: '2026-10-21' })
      ).toMatchObject({ allDay: true, startAt: '2026-10-20' });
    });
  });

  describe('agenda por link', () => {
    const fetcherOf =
      (text: () => string, etag = '"a"'): IcsFetcher =>
      async () => ({ notModified: false, text: text(), etag });

    const add = (fetcher: IcsFetcher, url = LINK) => ics.addIcsCalendar(ctx, { url }, fetcher);

    it('o link vai para o cofre e nunca para o banco', async () => {
      const calendar = await add(fetcherOf(() => vcalendar(...vevent('A', 'Sprint', '20261020T120000Z'))));
      expect(calendar).toMatchObject({
        name: 'Trabalho',
        source: 'ICS',
        host: 'exemplo.com',
        readOnly: true,
      });
      expect(vault.get(`ics:${calendar.id}`)).toBe(LINK);
      expect(JSON.stringify(calendar)).not.toContain('segredo');

      handle.raw.pragma('wal_checkpoint(TRUNCATE)');
      const everything = JSON.stringify([
        ctx.db.select().from(calendars).all(),
        ctx.db.select().from(events).all(),
      ]);
      expect(everything).not.toContain('segredo');
      expect(readFileSync(join(dir, 'a.db')).includes('segredo')).toBe(false);
    });

    it('é só de leitura', async () => {
      await add(fetcherOf(() => vcalendar(...vevent('A', 'Sprint', '20261020T120000Z'))));
      const [occurrence] = svc.listOccurrences(ctx, OCTOBER);
      const { eventId, calendarId } = occurrence!;
      expectStatus(() => svc.updateEvent(ctx, eventId, { title: 'X' }), 400);
      expectStatus(() => svc.deleteEvent(ctx, eventId, { scope: 'all' }), 400);
      expectStatus(
        () =>
          svc.createEvent(ctx, {
            calendarId,
            title: 'X',
            startAt: '2026-10-20T12:00:00.000Z',
            endAt: '2026-10-20T13:00:00.000Z',
          }),
        400
      );
    });

    it('recusa link que não é http(s) e link repetido', async () => {
      const fetcher = fetcherOf(() => vcalendar());
      await expect(add(fetcher, 'file:///etc/passwd')).rejects.toMatchObject({ status: 400 });
      await add(fetcher);
      await expect(add(fetcher)).rejects.toMatchObject({ status: 409 });
    });

    it('sincroniza: cria, atualiza e apaga só o que mudou', async () => {
      let text = vcalendar(
        ...vevent('A', 'Sprint', '20261020T120000Z'),
        ...vevent('B', 'Retro', '20261021T120000Z')
      );
      const fetcher = fetcherOf(() => text);
      await add(fetcher);
      const before = ctx.db.select().from(events).where(eq(events.externalId, 'A')).get()!;

      text = vcalendar(
        ...vevent('A', 'Sprint', '20261020T120000Z'),
        ...vevent('C', 'Nova', '20261022T120000Z')
      );
      vi.setSystemTime(new Date('2026-10-18T15:30:00Z'));
      await ics.syncAllIcs(ctx, fetcher);
      expect(titles()).toEqual(['Sprint', 'Nova']);
      const after = ctx.db.select().from(events).where(eq(events.externalId, 'A')).get()!;
      expect(after.updatedAt).toBe(before.updatedAt);
      expect(after.id).toBe(before.id);

      // A chave que some e volta não esbarra no índice único: a linha apagada não conta.
      text = vcalendar(...vevent('B', 'Retro de volta', '20261021T120000Z'));
      await ics.syncAllIcs(ctx, fetcher);
      expect(titles()).toEqual(['Retro de volta']);
    });

    it('usa o ETag na mesma janela e relê quando a janela anda', async () => {
      const etags: (string | null | undefined)[] = [];
      const fetcher: IcsFetcher = async (_, options) => {
        etags.push(options?.etag);
        return { notModified: false, text: vcalendar(), etag: '"a"' };
      };
      await add(fetcher);
      await ics.syncAllIcs(ctx, fetcher);
      vi.setSystemTime(new Date('2026-10-20T15:00:00Z'));
      await ics.syncAllIcs(ctx, fetcher);
      expect(etags).toEqual([undefined, '"a"', null]);
    });

    it('erro de leitura fica no calendário, sem o link, e não para as outras', async () => {
      const good = await add(fetcherOf(() => vcalendar()), 'https://exemplo.com/um.ics');
      const bad = await add(fetcherOf(() => vcalendar()), 'https://exemplo.com/dois.ics');
      const spy = vi.spyOn(console, 'error');
      await ics.syncAllIcs(ctx, async (link) => {
        if (link.includes('dois')) throw new Error(`falhou em ${link}`);
        return { notModified: true };
      });
      const list = svc.listCalendars(ctx);
      expect(list.find((c) => c.id === good.id)!.lastError).toBeNull();
      expect(list.find((c) => c.id === bad.id)!.lastError).toBe('Falha ao ler a agenda.');
      expect(spy).not.toHaveBeenCalled();
    });

    it('apagar a agenda tira o link do cofre', async () => {
      const calendar = await add(fetcherOf(() => vcalendar(...vevent('A', 'S', '20261020T120000Z'))));
      await agendaHandlers(ctx)['calendars.delete']({ id: calendar.id });
      expect(vault.size).toBe(0);
      expect(titles()).toEqual([]);
    });

    it('trocar o link relê e refaz os eventos', async () => {
      const calendar = await add(fetcherOf(() => vcalendar(...vevent('A', 'Velha', '20261020T120000Z'))));
      await ics.replaceIcsUrl(
        ctx,
        calendar.id,
        'https://exemplo.com/novo.ics',
        fetcherOf(() => vcalendar(...vevent('B', 'Nova', '20261020T120000Z')))
      );
      expect(titles()).toEqual(['Nova']);
      expect(vault.get(`ics:${calendar.id}`)).toBe('https://exemplo.com/novo.ics');
    });
  });
});
