import { createHash } from 'node:crypto';
import { vi } from 'vitest';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Google de mentira: troca o fetch global e responde às rotas que o núcleo usa, com estado em
 * memória. Porta local passa direto, para o teste do login usar um servidor de verdade.
 */
export interface FakeAccount {
  sub: string;
  email: string;
  refreshToken: string;
  calendarIds: string[];
  name?: string;
  noCalendar?: boolean;
  /** Permissões dadas no consentimento (padrão: todas). */
  scopes?: string[];
}

const ALL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
];

export const CLIENT = { clientId: 'client-id', clientSecret: 'client-secret' };

export class FakeGoogle {
  calls: { method: string; url: string; body?: any }[] = [];
  accounts: FakeAccount[] = [
    {
      sub: 'google-sub-1',
      email: 'andre@example.com',
      refreshToken: 'refresh-123',
      calendarIds: ['primary@gmail.com', 'family@group', 'holidays'],
    },
    {
      sub: 'google-sub-2',
      email: 'trabalho@example.com',
      name: 'Bia Souza',
      refreshToken: 'refresh-456',
      calendarIds: ['work@company.com', 'family@group'],
    },
  ];
  nextAccount = 'google-sub-1';
  /** Refresh tokens vencidos ou revogados: o Google responde invalid_grant. */
  revoked = new Set<string>();
  revokeCalls: string[] = [];
  calendars = [
    { id: 'primary@gmail.com', summary: 'André', primary: true, backgroundColor: '#4285f4', accessRole: 'owner' },
    { id: 'family@group', summary: 'Família', backgroundColor: '#0b8043', accessRole: 'writer' },
    { id: 'holidays', summary: 'Feriados', backgroundColor: '#f6bf26', accessRole: 'reader' },
    { id: 'work@company.com', summary: 'Trabalho', primary: true, backgroundColor: '#f4511e', accessRole: 'owner' },
  ];
  events = new Map<string, any[]>([
    ['primary@gmail.com', []],
    ['family@group', []],
    ['holidays', []],
    ['work@company.com', []],
  ]);
  syncTokenGone = false;
  taskLists = [
    { id: 'default-list', title: 'Minhas tarefas' },
    { id: 'shopping', title: 'Compras' },
  ];
  tasks = new Map<string, any[]>([
    ['default-list', []],
    ['shopping', []],
  ]);
  /** Tempo do Google, que só anda: é ele que decide `syncToken` e `updatedMin`. */
  private clock = 1;
  private seq = 0;
  private codes = new Map<string, { sub: string; challenge: string; redirectUri: string }>();
  private realFetch = globalThis.fetch;

  install() {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        return url.startsWith('http://127.0.0.1') ? this.realFetch(url, init) : this.handle(url, init);
      })
    );
    return this;
  }

  uninstall() {
    vi.unstubAllGlobals();
  }

  /** A tela de consentimento: a pessoa aceita, e o navegador volta para a porta local. */
  async consent(authorizeUrl: string) {
    const url = new URL(authorizeUrl);
    const params = url.searchParams;
    if (url.host !== 'accounts.google.com') throw new Error('endereço errado');
    const code = `code-${++this.seq}`;
    this.codes.set(code, {
      sub: this.nextAccount,
      challenge: params.get('code_challenge')!,
      redirectUri: params.get('redirect_uri')!,
    });
    const back = new URL(params.get('redirect_uri')!);
    back.searchParams.set('code', code);
    back.searchParams.set('state', params.get('state')!);
    return this.realFetch(back);
  }

  account(sub: string) {
    return this.accounts.find((a) => a.sub === sub)!;
  }

  /** Muda ou cria um evento no Google: entra na próxima leitura incremental. */
  changeEvent(calendarId: string, event: any) {
    const list = this.events.get(calendarId)!;
    const current = list.find((e) => e.id === event.id);
    if (current) Object.assign(current, event, { tick: ++this.clock, etag: `"${this.clock}"` });
    else list.push({ status: 'confirmed', ...event, tick: ++this.clock, etag: `"${this.clock}"` });
  }

  /** Apaga: o evento fica `cancelled`, como no Google. */
  cancelEvent(calendarId: string, id: string) {
    this.changeEvent(calendarId, { id, status: 'cancelled' });
  }

  changeTask(listId: string, task: any) {
    const list = this.tasks.get(listId)!;
    const current = list.find((t) => t.id === task.id);
    const stamp = { updated: this.stampNow(), etag: `"${++this.seq}"` };
    if (current) Object.assign(current, task, stamp);
    else list.push({ status: 'needsAction', ...task, ...stamp });
  }

  /** Atrasa o relógio de `updated`, para o `updatedMin` poder cortar o que já foi lido. */
  private stampNow() {
    return new Date().toISOString();
  }

  private callerOf(init?: RequestInit) {
    const header = new Headers(init?.headers).get('authorization') ?? '';
    return this.account(header.replace('Bearer access-', '')) ?? this.accounts[0]!;
  }

  private json(status: number, data: unknown) {
    return new Response(data === null ? null : JSON.stringify(data), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }

  private token(body: any) {
    if (body.client_id !== CLIENT.clientId || body.client_secret !== CLIENT.clientSecret) {
      return this.json(401, { error: 'invalid_client' });
    }
    if (body.grant_type === 'authorization_code') {
      const code = this.codes.get(body.code);
      const challenge = createHash('sha256').update(body.code_verifier ?? '').digest('base64url');
      if (!code || code.challenge !== challenge || code.redirectUri !== body.redirect_uri) {
        return this.json(400, { error: 'invalid_grant' });
      }
      this.codes.delete(body.code);
      const account = this.account(code.sub);
      this.revoked.delete(account.refreshToken);
      return this.json(200, {
        access_token: `access-${account.sub}`,
        expires_in: 3600,
        refresh_token: account.refreshToken,
        scope: (account.scopes ?? ALL_SCOPES).join(' '),
      });
    }
    const account = this.accounts.find((a) => a.refreshToken === body.refresh_token);
    if (!account || this.revoked.has(account.refreshToken)) {
      return this.json(400, { error: 'invalid_grant' });
    }
    return this.json(200, {
      access_token: `access-${account.sub}`,
      expires_in: 3600,
      scope: (account.scopes ?? ALL_SCOPES).join(' '),
    });
  }

  private eventsRoute(url: URL, method: string, calendarId: string, eventId: string | undefined, body: any) {
    const list = this.events.get(calendarId)!;
    if (!eventId && method === 'GET') {
      const token = url.searchParams.get('syncToken');
      if (token && this.syncTokenGone) {
        this.syncTokenGone = false;
        return this.json(410, { error: 'gone' });
      }
      const since = token ? Number(token.replace('token-', '')) : -1;
      const showing = token
        ? list.filter((e) => (e.tick ?? 0) > since)
        : list.filter((e) => e.status !== 'cancelled' || e.recurringEventId);
      return this.json(200, { items: showing, nextSyncToken: `token-${this.clock}` });
    }
    if (!eventId && method === 'POST') {
      const created = {
        ...body,
        id: `g-${++this.seq}`,
        etag: `"${++this.clock}"`,
        status: 'confirmed',
        tick: this.clock,
      };
      list.push(created);
      return this.json(200, created);
    }
    const existing = list.find((e) => e.id === eventId);
    if (method === 'PATCH') {
      const stamp = { etag: `"${++this.clock}"`, tick: this.clock };
      // A instância da série passa a existir ao ser mudada; evento comum que não existe é 404.
      if (!existing && !eventId!.includes('_')) return this.json(404, { error: 'notFound' });
      const merge = (a: any = {}, b: any = {}) => ({ ...a, ...b });
      const updated = {
        ...(existing ?? { id: eventId }),
        ...body,
        ...(body.start && { start: merge(existing?.start, body.start) }),
        ...(body.end && { end: merge(existing?.end, body.end) }),
        ...stamp,
      };
      if (updated.start?.date && updated.start?.dateTime) return this.json(400, { error: 'badRequest' });
      if (!existing) list.push(updated);
      else Object.assign(existing, updated);
      return this.json(200, updated);
    }
    if (method === 'DELETE') {
      if (!existing || existing.status === 'cancelled') return this.json(410, { error: 'gone' });
      existing.status = 'cancelled';
      existing.tick = ++this.clock;
      return this.json(204, null);
    }
    return this.json(404, { error: 'no route' });
  }

  private tasksRoute(url: URL, method: string, listId: string, taskId: string | undefined, action: string | undefined, body: any) {
    const list = this.tasks.get(listId);
    if (!list) return this.json(404, { error: 'list not found' });
    if (!taskId && method === 'GET') {
      const since = url.searchParams.get('updatedMin');
      const items = list.filter((t) => !since || t.updated >= since);
      return this.json(200, { items });
    }
    const stamp = { updated: this.stampNow(), etag: `"${++this.seq}"` };
    if (!taskId && method === 'POST') {
      const created = {
        ...body,
        ...stamp,
        id: `t-${++this.seq}`,
        parent: url.searchParams.get('parent') ?? undefined,
      };
      list.push(created);
      return this.json(200, created);
    }
    const existing = list.find((t) => t.id === taskId);
    if (!existing || existing.deleted) return this.json(404, { error: 'not found' });
    if (action === 'move') {
      existing.parent = url.searchParams.get('parent') ?? undefined;
      Object.assign(existing, stamp);
      return this.json(200, existing);
    }
    if (method === 'PATCH') {
      Object.assign(existing, body, stamp);
      return this.json(200, existing);
    }
    if (method === 'DELETE') {
      Object.assign(existing, { deleted: true }, stamp);
      return this.json(204, null);
    }
    return this.json(404, { error: 'no route' });
  }

  private async handle(raw: string, init?: RequestInit): Promise<Response> {
    const url = new URL(raw);
    const method = init?.method ?? 'GET';
    let body: any;
    if (typeof init?.body === 'string') body = JSON.parse(init.body);
    else if (init?.body instanceof URLSearchParams) body = Object.fromEntries(init.body);
    this.calls.push({ method, url: raw, body });
    const path = decodeURIComponent(url.pathname);

    if (url.host === 'oauth2.googleapis.com' && path === '/token') return this.token(body);
    if (url.host === 'oauth2.googleapis.com' && path === '/revoke') {
      this.revokeCalls.push(body.token);
      return this.json(200, {});
    }

    const caller = this.callerOf(init);
    if (url.host === 'openidconnect.googleapis.com') {
      return this.json(200, { sub: caller.sub, email: caller.email, name: caller.name });
    }

    const granted = caller.scopes ?? ALL_SCOPES;
    const needed = path.startsWith('/calendar/') ? ALL_SCOPES[2]! : path.startsWith('/tasks/') ? ALL_SCOPES[3]! : null;
    if (needed && !granted.includes(needed)) {
      return this.json(403, {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          errors: [{ domain: 'global', reason: 'insufficientPermissions' }],
        },
      });
    }
    if (path.startsWith('/calendar/') && caller.noCalendar) {
      return this.json(403, { error: { errors: [{ domain: 'calendar', reason: 'notACalendarUser' }] } });
    }
    if (path === '/calendar/v3/users/me/calendarList') {
      return this.json(200, { items: this.calendars.filter((c) => caller.calendarIds.includes(c.id)) });
    }
    let match = path.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/);
    if (match) return this.eventsRoute(url, method, match[1]!, match[2], body);

    if (path === '/tasks/v1/users/@me/lists/@default') return this.json(200, this.taskLists[0]);
    if (path === '/tasks/v1/users/@me/lists' && method === 'GET') {
      return this.json(200, { items: this.taskLists });
    }
    if (path === '/tasks/v1/users/@me/lists' && method === 'POST') {
      const list = { id: `list-${++this.seq}`, title: body.title };
      this.taskLists.push(list);
      this.tasks.set(list.id, []);
      return this.json(200, list);
    }
    match = path.match(/^\/tasks\/v1\/users\/@me\/lists\/([^/]+)$/);
    if (match) {
      const list = this.taskLists.find((l) => l.id === match![1]);
      if (!list) return this.json(404, { error: 'not found' });
      if (method === 'PATCH') {
        list.title = body.title;
        return this.json(200, list);
      }
      if (method === 'DELETE') {
        this.taskLists = this.taskLists.filter((l) => l.id !== list.id);
        this.tasks.delete(list.id);
        return this.json(204, null);
      }
    }
    match = path.match(/^\/tasks\/v1\/lists\/([^/]+)\/tasks(?:\/([^/]+?))?(?:\/(move))?$/);
    if (match) return this.tasksRoute(url, method, match[1]!, match[2], match[3], body);

    return this.json(404, { error: `fake google: no route for ${method} ${path}` });
  }
}
