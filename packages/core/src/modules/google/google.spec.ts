import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App, createApp, type Job } from '../../app';
import { calendars, events } from '../agenda/schema';
import { tasks } from '../tasks/schema';

import { forgetAccessToken, MISSING_PERMISSION_MESSAGE, NOT_CALENDAR_USER_MESSAGE, RECONNECT_MESSAGE } from './client';
import { CLIENT, FakeGoogle } from './fake-google';
import { jobs } from '.';
import { loopbackLogin } from './oauth';
import { googleAccounts } from './schema';
import { settled, status as statusOf } from './service';
import { parseExdates, toneOf } from './calendar';

const OCTOBER = { from: '2026-10-01', to: '2026-11-15' };
type Status = ReturnType<typeof statusOf>;

describe('Google', () => {
  let dir: string;
  let app: App;
  let google: FakeGoogle;
  let vault: Map<string, string>;

  const open = (config: typeof CLIENT | null = CLIENT) =>
    createApp({
      dbPath: join(dir, 'g.db'),
      keyHex: 'c'.repeat(64),
      timeZone: 'America/Sao_Paulo',
      notify: () => undefined,
      google: config,
      secrets: {
        get: (name) => vault.get(name) ?? null,
        set: (name, value) => {
          if (value === null) vault.delete(name);
          else vault.set(name, value);
        },
      },
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sektor-google-'));
    vault = new Map();
    google = new FakeGoogle().install();
    app = open();
  });

  afterEach(async () => {
    await settled(app.ctx);
    google.uninstall();
    app.handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const rpc = async (method: string, input?: unknown): Promise<any> => {
    const result = await app.call(method, input);
    if (!result.ok) throw Object.assign(new Error(result.message), { status: result.status });
    return result.value;
  };
  const status = (): Promise<Status> => rpc('google.status');
  const sync = () => rpc('google.sync');
  const titles = async () =>
    ((await rpc('events.list', OCTOBER)) as { title: string }[]).map((o) => o.title);
  const forgetTokens = () => {
    for (const account of app.ctx.db.select().from(googleAccounts).all()) forgetAccessToken(account.id);
  };

  /** O login inteiro: porta local de verdade, consentimento falso, PKCE conferido na troca. */
  async function connect(sub = 'google-sub-1') {
    google.nextAccount = sub;
    const login = await loopbackLogin({
      clientId: CLIENT.clientId,
      open: (url) => google.consent(url),
    });
    if (login.status !== 'ok') throw new Error(login.status);
    return app.connectGoogle(login);
  }

  const calendarNamed = async (name: string) =>
    (await status()).calendars.find((calendar) => calendar.name === name)!;
  const meeting = (id: string, summary: string, day = '2026-10-20') => ({
    id,
    summary,
    start: { dateTime: `${day}T13:00:00Z`, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: `${day}T14:00:00Z`, timeZone: 'America/Sao_Paulo' },
  });

  describe('conta', () => {
    it('conecta com PKCE, guarda o refresh token só no cofre e mostra a conta', async () => {
      expect(await connect()).toEqual({ email: 'andre@example.com' });
      const [account] = (await status()).accounts;
      expect(account).toMatchObject({ email: 'andre@example.com', syncTasks: true, needsReconnect: false });
      expect(vault.get(`google:${account!.id}`)).toBe('refresh-123');

      const row = app.ctx.db.select().from(googleAccounts).all();
      expect(JSON.stringify(row)).not.toContain('refresh-123');
      const dump = app.handle.raw.prepare("SELECT value FROM app_meta").all();
      expect(JSON.stringify(dump)).not.toContain('refresh-123');
    });

    it('código com verificador errado é recusado, sem conta', async () => {
      google.nextAccount = 'google-sub-1';
      const login = await loopbackLogin({
        clientId: CLIENT.clientId,
        open: (url) => google.consent(url),
      });
      if (login.status !== 'ok') throw new Error(login.status);
      await expect(app.connectGoogle({ ...login, verifier: 'outro' })).rejects.toMatchObject({
        status: 400,
      });
      expect((await status()).accounts).toEqual([]);
    });

    it('sem as credenciais no build não fala com o Google', async () => {
      app.handle.raw.close();
      app = open(null);
      expect((await status()).configured).toBe(false);
      await sync();
      await app.syncGoogle();
      expect(google.calls).toEqual([]);
    });

    it('não conecta conta sem a agenda ou as tarefas', async () => {
      google.account('google-sub-1').scopes = ['openid', 'https://www.googleapis.com/auth/calendar'];
      await expect(connect()).rejects.toThrow(MISSING_PERMISSION_MESSAGE);
      expect((await status()).accounts).toEqual([]);
      expect(vault.size).toBe(0);
    });

    it('roda como job de 5 minutos', () => {
      const job = jobs.find((item: Job) => item.name === 'google')!;
      expect(job.everyMs).toBe(5 * 60_000);
    });
  });

  describe('token vencido ou revogado', () => {
    it('marca a conta, não derruba nada e volta ao entrar de novo', async () => {
      await connect();
      const local = await rpc('events.create', {
        title: 'Só local',
        startAt: '2026-10-20T10:00:00Z',
        endAt: '2026-10-20T11:00:00Z',
        calendarId: (await rpc('calendars.list')).find((c: any) => c.source === 'LOCAL').id,
      });
      expect(local.id).toBeTruthy();

      // Modo de teste do Google: o token vence em 7 dias.
      google.revoked.add('refresh-123');
      forgetTokens();
      await expect(sync()).resolves.toBeTruthy();
      const [account] = (await status()).accounts;
      expect(account).toMatchObject({ needsReconnect: true, lastError: RECONNECT_MESSAGE });

      // Editar continua valendo, e a mudança espera.
      const primary = await calendarNamed('André');
      const created = await rpc('events.create', {
        title: 'Espera',
        startAt: '2026-10-21T10:00:00Z',
        endAt: '2026-10-21T11:00:00Z',
        calendarId: primary.id,
      });
      await settled(app.ctx);
      expect(await titles()).toContain('Espera');
      expect((await status()).pending).toBeGreaterThan(0);

      // A rodada seguinte nem chama o Google.
      google.calls = [];
      await sync();
      expect(google.calls).toEqual([]);

      await connect();
      const [fixed] = (await status()).accounts;
      expect(fixed).toMatchObject({ needsReconnect: false, lastError: null });
      expect(google.events.get('primary@gmail.com')!.some((e) => e.summary === 'Espera')).toBe(true);
      expect(created.id).toBeTruthy();
    });

    it('backup em outra máquina traz a conta sem o token: pede para entrar', async () => {
      await connect();
      vault.clear();
      forgetTokens();
      await sync();
      expect((await status()).accounts[0]).toMatchObject({ needsReconnect: true });
    });

    it('uma conta revogada não para a outra', async () => {
      await connect();
      await connect('google-sub-2');
      google.changeEvent('work@company.com', meeting('w1', 'Reunião'));
      google.revoked.add('refresh-123');
      forgetTokens();
      await sync();
      const accounts = (await status()).accounts;
      expect(accounts.map((a) => [a.needsReconnect])).toEqual([[true], [false]]);
      expect(await titles()).toEqual(['Reunião']);
    });

    it('permissão tirada na conta Google pede para entrar de novo e para de chamar', async () => {
      await connect();
      google.account('google-sub-1').scopes = ['openid'];
      forgetTokens();
      await sync();
      expect((await status()).accounts[0]).toMatchObject({
        needsReconnect: true,
        lastError: MISSING_PERMISSION_MESSAGE,
      });
      google.calls = [];
      await sync();
      expect(google.calls).toEqual([]);
    });

    it('conta sem Google Agenda mostra o motivo, sem pedir para entrar de novo', async () => {
      await connect();
      google.account('google-sub-1').noCalendar = true;
      await sync();
      expect((await status()).accounts[0]).toMatchObject({
        needsReconnect: false,
        lastError: NOT_CALENDAR_USER_MESSAGE,
      });
      google.account('google-sub-1').noCalendar = false;
      await sync();
      expect((await status()).accounts[0]!.lastError).toBeNull();
    });
  });

  describe('agenda', () => {
    it('importa série com exceção, envia evento local e refaz a leitura quando o token vence', async () => {
      google.changeEvent('primary@gmail.com', {
        id: 'series',
        summary: 'Inglês',
        start: { dateTime: '2026-10-20T22:00:00Z', timeZone: 'America/Sao_Paulo' },
        end: { dateTime: '2026-10-20T23:00:00Z', timeZone: 'America/Sao_Paulo' },
        recurrence: ['RRULE:FREQ=WEEKLY;COUNT=3'],
      });
      google.changeEvent('primary@gmail.com', {
        id: 'series_20261027T220000Z',
        status: 'cancelled',
        recurringEventId: 'series',
        originalStartTime: { dateTime: '2026-10-27T22:00:00Z' },
      });
      google.changeEvent('family@group', {
        id: 'family-1',
        summary: 'Aniversário',
        start: { date: '2026-10-25' },
        end: { date: '2026-10-26' },
      });
      await connect();

      const first = await status();
      expect(first.calendars.map((c) => [c.name, c.selected, c.readOnly, c.color])).toEqual([
        ['André', true, false, 'blue'],
        ['Família', false, false, 'green'],
        ['Feriados', false, true, 'amber'],
      ]);
      expect(first.defaultCalendarId).toBe(first.calendars[0]!.id);

      let list = await rpc('events.list', OCTOBER);
      expect(list.map((o: any) => [o.title, o.startAt, o.source])).toEqual([
        ['Inglês', '2026-10-20T22:00:00.000Z', 'GOOGLE'],
        ['Inglês', '2026-11-03T22:00:00.000Z', 'GOOGLE'],
      ]);

      // Marcar o calendário da família já traz o evento de dia inteiro.
      const family = await calendarNamed('Família');
      await rpc('google.setCalendarSelected', { id: family.id, selected: true });
      list = await rpc('events.list', OCTOBER);
      expect(list.find((o: any) => o.title === 'Aniversário')).toMatchObject({
        allDay: true,
        startAt: '2026-10-25',
      });

      // Evento novo vai ao calendário padrão, e sobe sem esperar o job.
      const created = await rpc('events.create', {
        title: 'Médico',
        startAt: '2026-10-22T13:00:00Z',
        endAt: '2026-10-22T14:00:00Z',
      });
      await settled(app.ctx);
      expect(created.source).toBe('GOOGLE');
      const pushed = google.events.get('primary@gmail.com')!.find((e) => e.summary === 'Médico');
      expect(pushed.start).toEqual({ dateTime: '2026-10-22T13:00:00.000Z', timeZone: 'America/Sao_Paulo' });
      const row = app.ctx.db.select().from(events).where(eq(events.id, created.id)).get()!;
      expect(row).toMatchObject({ syncState: 'SYNCED', externalId: pushed.id });

      // Cancelar uma ocorrência vira PATCH na instância.
      const series = list.find((o: any) => o.title === 'Inglês');
      await rpc('events.delete', {
        id: series.eventId,
        scope: 'single',
        occurrenceStart: '2026-11-03T22:00:00.000Z',
      });
      await settled(app.ctx);
      expect(
        google.calls.some(
          (c) =>
            c.method === 'PATCH' &&
            c.url.includes('series_20261103T220000Z') &&
            c.body.status === 'cancelled'
        )
      ).toBe(true);

      // Mudar só uma ocorrência leva o horário à instância.
      await rpc('events.update', {
        id: series.eventId,
        scope: 'single',
        occurrenceStart: '2026-10-20T22:00:00.000Z',
        title: 'Inglês remarcado',
      });
      await settled(app.ctx);
      expect(
        google.events.get('primary@gmail.com')!.find((e) => e.id === 'series_20261020T220000Z')
      ).toMatchObject({ summary: 'Inglês remarcado' });

      // Token vencido: leitura completa, sem duplicar e sem trocar o id que os lembretes usam.
      const masterBefore = app.ctx.db.select().from(events).where(eq(events.externalId, 'series')).get()!;
      google.syncTokenGone = true;
      await sync();
      const masters = app.ctx.db.select().from(events).where(eq(events.externalId, 'series')).all();
      expect(masters.map((m) => m.id)).toEqual([masterBefore.id]);

      await rpc('events.delete', { id: created.id });
      await settled(app.ctx);
      expect(google.events.get('primary@gmail.com')!.find((e) => e.id === pushed.id).status).toBe('cancelled');
    });

    it('lê com syncToken e, depois de 410, tira o que sumiu de lá', async () => {
      google.changeEvent('primary@gmail.com', meeting('a', 'Fica'));
      google.changeEvent('primary@gmail.com', meeting('b', 'Some', '2026-10-21'));
      await connect();
      expect(await titles()).toEqual(['Fica', 'Some']);

      google.calls = [];
      google.changeEvent('primary@gmail.com', meeting('c', 'Novo', '2026-10-22'));
      await sync();
      const read = google.calls.find((c) => c.url.includes('/events?'))!;
      expect(new URL(read.url).searchParams.get('syncToken')).toMatch(/^token-/);
      expect(new URL(read.url).searchParams.get('timeMin')).toBeNull();
      expect(await titles()).toEqual(['Fica', 'Some', 'Novo']);

      google.cancelEvent('primary@gmail.com', 'a');
      await sync();
      expect(await titles()).toEqual(['Some', 'Novo']);

      // Sumiu de vez, sem aviso de cancelamento: só a leitura completa percebe.
      google.events.set(
        'primary@gmail.com',
        google.events.get('primary@gmail.com')!.filter((e) => e.id !== 'b')
      );
      google.syncTokenGone = true;
      await sync();
      expect(await titles()).toEqual(['Novo']);
    });

    it('série em outro fuso segue o fuso dela, e EXDATE vira exclusão e volta no envio', async () => {
      // Nova York sai do horário de verão em 1º/11/2026: em São Paulo, 11h vira 12h.
      const recurrence = [
        'RRULE:FREQ=WEEKLY;COUNT=4',
        'EXDATE;TZID=America/New_York:20261021T100000',
      ];
      google.changeEvent('primary@gmail.com', {
        id: 'ny',
        summary: 'Standup',
        start: { dateTime: '2026-10-14T14:00:00Z', timeZone: 'America/New_York' },
        end: { dateTime: '2026-10-14T15:00:00Z', timeZone: 'America/New_York' },
        recurrence,
      });
      await connect();
      const list = await rpc('events.list', OCTOBER);
      expect(list.map((o: any) => o.startAt)).toEqual([
        '2026-10-14T14:00:00.000Z',
        '2026-10-28T14:00:00.000Z',
        '2026-11-04T15:00:00.000Z',
      ]);

      await rpc('events.update', { id: list[0].eventId, title: 'Standup novo' });
      await settled(app.ctx);
      const patched = google.calls.find((c) => c.method === 'PATCH')!;
      expect(patched.body.recurrence).toEqual(recurrence);
      expect(patched.body.start.timeZone).toBe('America/New_York');
    });

    it('editar não deixa dia inteiro e horário juntos no Google', async () => {
      google.changeEvent('primary@gmail.com', meeting('x', 'Vira dia inteiro'));
      await connect();
      const [event] = await rpc('events.list', OCTOBER);
      await rpc('events.update', {
        id: event.eventId,
        allDay: true,
        startAt: '2026-10-20',
        endAt: '2026-10-21',
      });
      await settled(app.ctx);
      const row = app.ctx.db.select().from(events).where(eq(events.externalId, 'x')).get()!;
      expect(row.syncState).toBe('SYNCED');
      expect(google.events.get('primary@gmail.com')![0].start.date).toBe('2026-10-20');
    });

    it('calendário só de leitura não aceita escrita, e o nome vem do Google', async () => {
      google.changeEvent('holidays', meeting('h', 'Feriado'));
      await connect();
      const holidays = await calendarNamed('Feriados');
      await rpc('google.setCalendarSelected', { id: holidays.id, selected: true });
      await expect(
        rpc('events.create', {
          title: 'x',
          startAt: '2026-10-20T10:00:00Z',
          endAt: '2026-10-20T11:00:00Z',
          calendarId: holidays.id,
        })
      ).rejects.toMatchObject({ status: 400 });
      const [event] = await rpc('events.list', OCTOBER);
      await expect(rpc('events.update', { id: event.eventId, title: 'y' })).rejects.toMatchObject({
        status: 400,
      });
      await expect(rpc('calendars.update', { id: holidays.id, name: 'z' })).rejects.toMatchObject({
        status: 400,
      });
      await expect(rpc('calendars.delete', { id: holidays.id })).rejects.toMatchObject({ status: 400 });
    });

    it('mudar de calendário apaga no antigo e cria no novo, nos dois sentidos', async () => {
      google.changeEvent('primary@gmail.com', meeting('m', 'Muda'));
      await connect();
      const family = await calendarNamed('Família');
      const local = (await rpc('calendars.list')).find((c: any) => c.source === 'LOCAL');
      const [event] = await rpc('events.list', OCTOBER);

      await rpc('events.update', { id: event.eventId, calendarId: family.id });
      await settled(app.ctx);
      expect(google.events.get('primary@gmail.com')!.find((e) => e.id === 'm').status).toBe('cancelled');
      expect(google.events.get('family@group')!.map((e) => e.summary)).toEqual(['Muda']);

      await rpc('events.update', { id: event.eventId, calendarId: local.id });
      await settled(app.ctx);
      expect(google.events.get('family@group')![0].status).toBe('cancelled');
      const row = app.ctx.db.select().from(events).where(eq(events.id, event.eventId)).get()!;
      expect(row).toMatchObject({ source: 'LOCAL', externalId: null, syncState: 'SYNCED' });
    });

    it('recusa de um evento fica nele e não para os outros', async () => {
      await connect();
      const primary = await calendarNamed('André');
      const make = (title: string) =>
        rpc('events.create', {
          title,
          startAt: '2026-10-20T10:00:00Z',
          endAt: '2026-10-20T11:00:00Z',
          calendarId: primary.id,
        });
      const stub = globalThis.fetch;
      vi.stubGlobal('fetch', (url: string, init?: RequestInit) =>
        String(init?.body).includes('Recusado')
          ? Promise.resolve(new Response('{}', { status: 400 }))
          : stub(url, init)
      );
      await make('Recusado');
      await make('Aceito');
      await settled(app.ctx);
      const rows = app.ctx.db.select().from(events).all();
      expect(rows.find((r) => r.title === 'Recusado')?.syncState).toBe('ERROR');
      expect(rows.find((r) => r.title === 'Aceito')?.syncState).toBe('SYNCED');
      expect((await calendarNamed('André')).lastError).toContain('Recusado');
    });
  });

  describe('mudança local pendente vence', () => {
    /** Conecta sem deixar o envio correr: as edições ficam pendentes até a próxima sincronização. */
    const offline = () => {
      const account = app.ctx.db.select().from(googleAccounts).get()!;
      app.ctx.db
        .update(googleAccounts)
        .set({ needsReconnect: true })
        .where(eq(googleAccounts.id, account.id))
        .run();
      return async () => {
        await settled(app.ctx);
        app.ctx.db
          .update(googleAccounts)
          .set({ needsReconnect: false })
          .where(eq(googleAccounts.id, account.id))
          .run();
      };
    };

    it('edição local contra edição no Google', async () => {
      google.changeEvent('primary@gmail.com', meeting('e', 'Original'));
      await connect();
      const [event] = await rpc('events.list', OCTOBER);
      const online = offline();
      await rpc('events.update', { id: event.eventId, title: 'Daqui' });
      google.changeEvent('primary@gmail.com', { id: 'e', summary: 'De lá' });
      await online();
      await sync();
      expect(await titles()).toEqual(['Daqui']);
      expect(google.events.get('primary@gmail.com')![0].summary).toBe('Daqui');
    });

    it('edição local contra exclusão no Google: o evento volta', async () => {
      google.changeEvent('primary@gmail.com', meeting('e', 'Original'));
      await connect();
      const [event] = await rpc('events.list', OCTOBER);
      const online = offline();
      await rpc('events.update', { id: event.eventId, title: 'Daqui' });
      google.cancelEvent('primary@gmail.com', 'e');
      google.events.set('primary@gmail.com', []);
      await online();
      await sync();
      expect(await titles()).toEqual(['Daqui']);
      const remote = google.events.get('primary@gmail.com')!;
      expect(remote.map((e) => e.summary)).toEqual(['Daqui']);
      expect(app.ctx.db.select().from(events).where(eq(events.id, event.eventId)).get()!.externalId).toBe(
        remote[0].id
      );
    });

    it('exclusão local contra edição no Google: fica apagado', async () => {
      google.changeEvent('primary@gmail.com', meeting('e', 'Original'));
      await connect();
      const [event] = await rpc('events.list', OCTOBER);
      const online = offline();
      await rpc('events.delete', { id: event.eventId });
      google.changeEvent('primary@gmail.com', { id: 'e', summary: 'De lá' });
      await online();
      await sync();
      expect(await titles()).toEqual([]);
      expect(google.events.get('primary@gmail.com')![0].status).toBe('cancelled');
    });

    it('edição feita durante o envio segue pendente', async () => {
      google.changeEvent('primary@gmail.com', meeting('e', 'Original'));
      await connect();
      const [event] = await rpc('events.list', OCTOBER);
      const stub = globalThis.fetch;
      let edited = false;
      vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH' && !edited) {
          edited = true;
          await rpc('events.update', { id: event.eventId, title: 'Segunda edição' });
        }
        return stub(url, init);
      });
      await rpc('events.update', { id: event.eventId, title: 'Primeira edição' });
      await settled(app.ctx);
      await settled(app.ctx);
      expect(google.events.get('primary@gmail.com')![0].summary).toBe('Segunda edição');
    });

    it('tarefa: edição contra edição, contra exclusão, e exclusão contra edição', async () => {
      google.changeTask('default-list', { id: 'a', title: 'A' });
      google.changeTask('default-list', { id: 'b', title: 'B' });
      google.changeTask('default-list', { id: 'c', title: 'C' });
      await connect();
      const local = (id: string) =>
        app.ctx.db.select().from(tasks).where(eq(tasks.externalId, id)).get()!;
      const [a, b, c] = [local('a'), local('b'), local('c')];
      const online = offline();
      await rpc('tasks.update', { id: a.id, title: 'A daqui' });
      await rpc('tasks.update', { id: b.id, title: 'B daqui' });
      await rpc('tasks.delete', { id: c.id });
      google.changeTask('default-list', { id: 'a', title: 'A de lá' });
      google.changeTask('default-list', { id: 'b', deleted: true });
      google.changeTask('default-list', { id: 'c', title: 'C de lá' });
      await online();
      await sync();

      const remote = google.tasks.get('default-list')!;
      expect(remote.find((t) => t.id === 'a').title).toBe('A daqui');
      expect(remote.find((t) => t.id === 'c').deleted).toBe(true);
      expect(remote.find((t) => t.title === 'B daqui' && !t.deleted)).toBeTruthy();
      const open = await rpc('tasks.list');
      expect(open.map((t: any) => t.title).sort()).toEqual(['A daqui', 'B daqui']);
    });
  });

  describe('tarefas', () => {
    it('sincroniza nos dois sentidos, por updatedMin, com exclusão lógica enviada', async () => {
      const local = await rpc('tasks.create', { title: 'Ligar para o banco', dueDate: '2026-10-20' });
      await rpc('tasks.update', { id: local.id, dueTime: '15:30' });
      google.changeTask('shopping', { id: 'milk', title: 'Leite', due: '2026-10-19T00:00:00.000Z' });
      google.changeTask('shopping', {
        id: 'eggs',
        title: 'Ovos',
        status: 'completed',
        completed: '2026-10-17T10:00:00.000Z',
      });
      google.changeTask('shopping', { id: 'brand', title: 'Integral', parent: 'milk' });
      await connect();

      // A Entrada é a lista padrão; a tarefa local subiu só com o dia.
      const sent = google.tasks.get('default-list')!.find((t) => t.title === 'Ligar para o banco');
      expect(sent).toMatchObject({ due: '2026-10-20T00:00:00.000Z', status: 'needsAction' });

      const lists = await rpc('taskLists.list');
      const shopping = lists.find((l: any) => l.name === 'Compras');
      const open = await rpc('tasks.list', { listId: shopping.id });
      expect(open.map((t: any) => [t.title, t.dueDate, t.subtasks.map((s: any) => s.title)])).toEqual([
        ['Leite', '2026-10-19', ['Integral']],
      ]);
      const done = await rpc('tasks.list', { listId: shopping.id, view: 'completed' });
      expect(done.map((t: any) => [t.title, t.status])).toEqual([['Ovos', 'DONE']]);

      // A hora é só daqui: uma mudança de título no Google não a apaga.
      google.changeTask('default-list', { id: sent.id, title: 'Ligar para o gerente' });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await sync();
      expect(await rpc('tasks.get', { id: local.id })).toMatchObject({
        title: 'Ligar para o gerente',
        dueTime: '15:30',
      });

      // Leitura incremental.
      google.calls = [];
      await sync();
      const read = google.calls.find((c) => /lists\/default-list\/tasks\?/.test(c.url))!;
      expect(new URL(read.url).searchParams.get('updatedMin')).toBeTruthy();

      // Concluir aqui conclui lá.
      await rpc('tasks.complete', { id: open[0].id });
      await settled(app.ctx);
      expect(google.tasks.get('shopping')!.find((t) => t.id === 'milk')).toMatchObject({ status: 'completed' });

      // Lista nova vira lista no Google.
      const work = await rpc('taskLists.create', { name: 'Trabalho' });
      const inWork = await rpc('tasks.create', { title: 'Relatório', listId: work.id });
      await settled(app.ctx);
      expect(google.taskLists.some((l) => l.title === 'Trabalho')).toBe(true);

      // Trocar de lista: sai de uma e nasce na outra.
      await rpc('tasks.update', { id: local.id, listId: work.id });
      await settled(app.ctx);
      expect(google.tasks.get('default-list')!.find((t) => t.id === sent.id).deleted).toBe(true);
      const workId = google.taskLists.find((l) => l.title === 'Trabalho')!.id;
      expect(google.tasks.get(workId)!.map((t) => t.title).sort()).toEqual([
        'Ligar para o gerente',
        'Relatório',
      ]);

      // Apagada no Google: some aqui.
      google.changeTask('shopping', { id: 'brand', deleted: true });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await sync();
      expect(await rpc('tasks.get', { id: open[0].subtasks[0].id }).catch((e) => e.status)).toBe(404);

      // Apagar aqui é lógico, e vai ao Google.
      await rpc('tasks.delete', { id: inWork.id });
      await settled(app.ctx);
      expect(google.tasks.get(workId)!.find((t) => t.title === 'Relatório').deleted).toBe(true);
      expect(app.ctx.db.select().from(tasks).where(eq(tasks.id, inWork.id)).get()).toMatchObject({
        syncState: 'SYNCED',
      });

      // Apagar a lista apaga no Google.
      await rpc('taskLists.delete', { id: work.id });
      await settled(app.ctx);
      expect(google.taskLists.some((l) => l.id === workId)).toBe(false);
    });

    it('subtarefa nova sobe sob a mãe, e trocar de mãe usa o move', async () => {
      await connect();
      const mother = await rpc('tasks.create', { title: 'Mãe' });
      const other = await rpc('tasks.create', { title: 'Outra' });
      const sub = await rpc('tasks.create', { title: 'Filha', parentTaskId: mother.id });
      await settled(app.ctx);
      const remote = google.tasks.get('default-list')!;
      const id = (title: string) => remote.find((t) => t.title === title).id;
      expect(remote.find((t) => t.title === 'Filha').parent).toBe(id('Mãe'));

      await rpc('tasks.update', { id: sub.id, parentTaskId: other.id });
      await settled(app.ctx);
      expect(remote.find((t) => t.title === 'Filha').parent).toBe(id('Outra'));
    });

    it('concluir no Google uma tarefa recorrente gera a próxima', async () => {
      await connect();
      const task = await rpc('tasks.create', {
        title: 'Remédio',
        dueDate: '2026-10-20',
        rrule: 'FREQ=DAILY',
      });
      await settled(app.ctx);
      const remote = google.tasks.get('default-list')!.find((t) => t.title === 'Remédio');
      google.changeTask('default-list', {
        id: remote.id,
        status: 'completed',
        completed: '2026-10-20T10:00:00.000Z',
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      await sync();
      expect((await rpc('tasks.get', { id: task.id })).status).toBe('DONE');
      const open = await rpc('tasks.list');
      expect(open.map((t: any) => [t.title, t.dueDate])).toEqual([['Remédio', '2026-10-21']]);
    });

    it('voltar a uma conta casa o que já existe, sem duplicar', async () => {
      google.changeTask('shopping', { id: 'milk', title: 'Leite' });
      await connect();
      const [account] = (await status()).accounts;
      await rpc('google.disconnect', { id: account!.id });
      await connect();
      const shopping = (await rpc('taskLists.list')).filter((l: any) => l.name === 'Compras');
      expect(shopping).toHaveLength(1);
      expect((await rpc('tasks.list')).map((t: any) => t.title)).toEqual(['Leite']);
      expect(google.tasks.get('shopping')!.map((t) => t.title)).toEqual(['Leite']);
    });

    it('troca a conta das tarefas e deixa sem nenhuma', async () => {
      const local = await rpc('tasks.create', { title: 'Comprar pão' });
      await connect();
      await connect('google-sub-2');
      const before = app.ctx.db.select().from(tasks).where(eq(tasks.id, local.id)).get()!;
      expect(before.externalId).toBeTruthy();
      const second = (await status()).accounts[1]!;

      const switched: Status = await rpc('google.setTasksAccount', { accountId: second.id });
      expect(switched.tasksAccountId).toBe(second.id);
      expect(switched.accounts.map((a) => a.syncTasks)).toEqual([false, true]);

      const none: Status = await rpc('google.setTasksAccount', { accountId: null });
      expect(none.tasksAccountId).toBeNull();
      const after = app.ctx.db.select().from(tasks).where(eq(tasks.id, local.id)).get()!;
      expect(after.externalId).toBeNull();
    });
  });

  describe('várias contas', () => {
    async function connectBoth() {
      google.changeEvent('primary@gmail.com', meeting('p1', 'Pessoal'));
      google.changeEvent('work@company.com', meeting('w1', 'Reunião', '2026-10-21'));
      await connect();
      await connect('google-sub-2');
      return status();
    }

    it('junta as agendas; calendário repetido chega desmarcado e a cor daqui vence', async () => {
      const data = await connectBoth();
      expect(data.accounts.map((a) => [a.email, a.syncTasks])).toEqual([
        ['andre@example.com', true],
        ['trabalho@example.com', false],
      ]);
      const family = data.calendars.filter((c) => c.name === 'Família');
      expect(family.map((c) => [c.selected, c.alsoIn])).toEqual([
        [false, [family[1]!.id]],
        [false, [family[0]!.id]],
      ]);
      expect(data.defaultCalendarId).toBe(data.calendars[0]!.id);
      expect(await titles()).toEqual(['Pessoal', 'Reunião']);

      const work = await calendarNamed('Trabalho');
      await rpc('events.create', {
        title: 'Planejamento',
        startAt: '2026-10-22T13:00:00Z',
        endAt: '2026-10-22T14:00:00Z',
        calendarId: work.id,
      });
      await settled(app.ctx);
      expect(google.events.get('work@company.com')!.some((e) => e.summary === 'Planejamento')).toBe(true);
      expect(google.events.get('primary@gmail.com')!.some((e) => e.summary === 'Planejamento')).toBe(false);

      await rpc('calendars.update', { id: work.id, color: 'violet' });
      await rpc('calendars.setDefault', { id: work.id });
      await sync();
      const after = await status();
      expect(after.calendars.find((c) => c.id === work.id)!.color).toBe('violet');
      expect(after.defaultCalendarId).toBe(work.id);

      // Entrar de novo com a mesma conta só renova o token.
      await connect();
      expect((await status()).accounts).toHaveLength(2);
    });

    it('desconectar mantém a outra conta e os calendários locais, e não apaga no Google', async () => {
      const data = await connectBoth();
      const [first, second] = data.accounts;
      const local = (await rpc('calendars.list')).find((c: any) => c.source === 'LOCAL');
      await rpc('events.create', {
        title: 'Meu',
        startAt: '2026-10-23T10:00:00Z',
        endAt: '2026-10-23T11:00:00Z',
        calendarId: local.id,
      });
      await rpc('google.disconnect', { id: first!.id });

      const after = await status();
      expect(after.accounts.map((a) => a.id)).toEqual([second!.id]);
      expect(after.tasksAccountId).toBeNull();
      expect(after.defaultCalendarId).toBe(after.calendars.find((c) => c.name === 'Trabalho')!.id);
      expect(await titles()).toEqual(['Reunião', 'Meu']);
      expect(vault.has(`google:${first!.id}`)).toBe(false);
      expect(google.revokeCalls).toEqual(['refresh-123']);
      expect(google.events.get('primary@gmail.com')![0].status).toBe('confirmed');

      await rpc('google.disconnect', { id: second!.id });
      expect(await titles()).toEqual(['Meu']);
      const remaining = (await rpc('calendars.list')).map((c: any) => c.source);
      expect(remaining).toEqual(['LOCAL']);
      await rpc('events.create', {
        title: 'Depois',
        startAt: '2026-10-24T10:00:00Z',
        endAt: '2026-10-24T11:00:00Z',
      });
      expect(await titles()).toContain('Depois');
    });

    it('calendário tirado da lista do Google some daqui', async () => {
      await connectBoth();
      google.account('google-sub-1').calendarIds = ['family@group'];
      await sync();
      const names = (await rpc('calendars.list')).map((c: any) => c.name);
      expect(names).not.toContain('André');
      expect(app.ctx.db.select().from(calendars).all().length).toBeGreaterThan(names.length);
    });
  });

  it('nada do cofre ou do token aparece no que a tela recebe', async () => {
    await connect();
    const text = JSON.stringify(await status());
    expect(text).not.toContain('refresh-123');
    expect(text).not.toContain('access-google-sub-1');
    expect(text).not.toContain(CLIENT.clientSecret);
  });

  it('lê EXDATE com data, UTC e fuso; escolhe o tom mais perto', () => {
    expect(
      parseExdates(
        ['EXDATE;VALUE=DATE:20261027,20261103', 'EXDATE:20261027T220000Z', 'EXDATE;TZID=Asia/Tokyo:20261028T090000'],
        'UTC'
      )
    ).toEqual(['2026-10-27', '2026-11-03', '2026-10-27T22:00:00.000Z', '2026-10-28T00:00:00.000Z']);
    expect(toneOf('#4285f4')).toBe('blue');
    expect(toneOf('#0b8043')).toBe('green');
    expect(toneOf('#888888')).toBe('blue');
    expect(toneOf(undefined)).toBe('blue');
  });
});
