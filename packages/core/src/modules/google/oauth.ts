import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

// Entrada de app para computador: PKCE, navegador do sistema e retorno numa porta local que só
// existe durante o login. Sem dependência do resto do núcleo: quem roda isto é o processo main.

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const FIVE_MINUTES = 5 * 60_000;

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
export const GOOGLE_SCOPES = ['openid', 'email', CALENDAR_SCOPE, TASKS_SCOPE];

export type LoopbackResult =
  | { status: 'ok'; code: string; verifier: string; redirectUri: string }
  | { status: 'denied' | 'timeout' | 'canceled' | 'failed' };

export interface LoopbackOptions {
  clientId: string;
  /** Abre o endereço no navegador do sistema. */
  open(url: string): Promise<unknown>;
  /** Sugere a conta, em "entrar de novo". */
  hint?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const base64url = (data: Buffer) => data.toString('base64url');

export function authorizationUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  verifier: string,
  hint?: string
) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GOOGLE_SCOPES.join(' '),
    state,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent select_account',
    ...(hint ? { login_hint: hint } : {}),
  });
  return `${AUTH_URL}?${params}`;
}

const PAGE = (text: string) =>
  `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Sektor</title>` +
  `<body style="font-family:system-ui;text-align:center;padding:4rem"><p>${text}</p></body></html>`;

function answer(response: ServerResponse, status: number, text: string) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
    connection: 'close',
  });
  response.end(PAGE(text));
}

/**
 * Abre a porta, manda a pessoa ao Google e espera o retorno. A porta fecha ao terminar ou em 5
 * minutos. Pedido com `state` errado não encerra nada: quem não conhece o `state` não derruba o login.
 */
export function loopbackLogin(options: LoopbackOptions): Promise<LoopbackResult> {
  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(48));

  return new Promise((resolve) => {
    let finished = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: LoopbackResult) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      server.close();
      server.closeAllConnections();
      resolve(result);
    };
    const onAbort = () => finish({ status: 'canceled' });

    const onRequest = (request: IncomingMessage, response: ServerResponse, redirectUri: string) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/callback') return answer(response, 404, 'Nada aqui.');
      if (url.searchParams.get('state') !== state) {
        return answer(response, 400, 'Este pedido não veio do Sektor.');
      }
      const code = url.searchParams.get('code');
      if (code) {
        answer(response, 200, 'Pronto. Pode fechar esta aba e voltar ao Sektor.');
        response.once('finish', () => finish({ status: 'ok', code, verifier, redirectUri }));
        return;
      }
      answer(response, 200, 'Entrada cancelada. Pode fechar esta aba.');
      response.once('finish', () => finish({ status: 'denied' }));
    };

    const server = createServer((request, response) => {
      const { port } = server.address() as AddressInfo;
      onRequest(request, response, `http://127.0.0.1:${port}/callback`);
    });
    server.once('error', () => finish({ status: 'failed' }));

    if (options.signal?.aborted) return finish({ status: 'canceled' });
    options.signal?.addEventListener('abort', onAbort);
    timer = setTimeout(() => finish({ status: 'timeout' }), options.timeoutMs ?? FIVE_MINUTES);

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const redirectUri = `http://127.0.0.1:${port}/callback`;
      options
        .open(authorizationUrl(options.clientId, redirectUri, state, verifier, options.hint))
        .catch(() => finish({ status: 'failed' }));
    });
  });
}
