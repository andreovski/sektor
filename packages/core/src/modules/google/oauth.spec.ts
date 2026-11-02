import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { describe, expect, it } from 'vitest';

import { CALENDAR_SCOPE, GOOGLE_SCOPES, loopbackLogin, type LoopbackResult, TASKS_SCOPE } from './oauth';

/** Fica com o endereço que iria ao navegador e deixa o teste fazer o papel do Google. */
function start(options: { timeoutMs?: number; signal?: AbortSignal; hint?: string } = {}) {
  let opened!: (url: URL) => void;
  const authorize = new Promise<URL>((resolve) => (opened = resolve));
  const result = loopbackLogin({
    clientId: 'id-do-app',
    open: async (url) => opened(new URL(url)),
    ...options,
  });
  return { authorize, result };
}

const back = (authorize: URL, query: Record<string, string>) => {
  const url = new URL(authorize.searchParams.get('redirect_uri')!);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return fetch(url);
};

const portIsClosed = (authorize: URL) =>
  new Promise<boolean>((resolve) => {
    const { hostname, port } = new URL(authorize.searchParams.get('redirect_uri')!);
    const socket = connect(Number(port), hostname);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(true));
  });

describe('login com porta local', () => {
  it('pede PKCE, os escopos certos e volta só para 127.0.0.1', async () => {
    const { authorize, result } = start({ hint: 'andre@example.com' });
    const url = await authorize;
    const params = url.searchParams;
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(params.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('access_type')).toBe('offline');
    expect(params.get('login_hint')).toBe('andre@example.com');
    expect(params.get('scope')!.split(' ')).toEqual(GOOGLE_SCOPES);
    expect(GOOGLE_SCOPES).toEqual(['openid', 'email', CALENDAR_SCOPE, TASKS_SCOPE]);

    await back(url, { code: 'abc', state: params.get('state')! });
    const done = (await result) as Extract<LoopbackResult, { status: 'ok' }>;
    expect(done).toMatchObject({ status: 'ok', code: 'abc', redirectUri: params.get('redirect_uri') });
    expect(createHash('sha256').update(done.verifier).digest('base64url')).toBe(
      params.get('code_challenge')
    );
    expect(await portIsClosed(url)).toBe(true);
  });

  it('state errado é recusado e não encerra o login', async () => {
    const { authorize, result } = start();
    const url = await authorize;
    const wrong = await back(url, { code: 'roubado', state: 'outro' });
    expect(wrong.status).toBe(400);
    expect((await back(url, { code: 'roubado' })).status).toBe(400);
    expect((await fetch(url.searchParams.get('redirect_uri')!.replace('callback', 'x'))).status).toBe(404);

    await back(url, { code: 'certo', state: url.searchParams.get('state')! });
    expect(await result).toMatchObject({ status: 'ok', code: 'certo' });
  });

  it('recusa no Google volta como denied, e a porta fecha', async () => {
    const { authorize, result } = start();
    const url = await authorize;
    await back(url, { error: 'access_denied', state: url.searchParams.get('state')! });
    expect(await result).toEqual({ status: 'denied' });
    expect(await portIsClosed(url)).toBe(true);
  });

  it('o tempo acaba e a porta fecha', async () => {
    const { authorize, result } = start({ timeoutMs: 40 });
    const url = await authorize;
    expect(await result).toEqual({ status: 'timeout' });
    expect(await portIsClosed(url)).toBe(true);
  });

  it('cancelar fecha a porta', async () => {
    const controller = new AbortController();
    const { authorize, result } = start({ signal: controller.signal });
    const url = await authorize;
    controller.abort();
    expect(await result).toEqual({ status: 'canceled' });
    expect(await portIsClosed(url)).toBe(true);
  });

  it('navegador que não abre encerra na hora', async () => {
    const result = await loopbackLogin({
      clientId: 'id',
      open: () => Promise.reject(new Error('sem navegador')),
    });
    expect(result).toEqual({ status: 'failed' });
  });
});
