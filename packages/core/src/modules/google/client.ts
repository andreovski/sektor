import { and, eq, isNull } from 'drizzle-orm';

import type { AppCtx } from '../../app';
import { CALENDAR_SCOPE, TASKS_SCOPE } from './oauth';
import { type GoogleAccountRow, googleAccounts } from './schema';

// Chamadas ao Google com fetch puro: são poucas rotas, e assim os testes trocam o fetch por um falso.

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

export { CALENDAR_SCOPE, TASKS_SCOPE };

export const RECONNECT_MESSAGE = 'O acesso ao Google expirou ou foi revogado. Entre de novo.';
export const NOT_CALENDAR_USER_MESSAGE =
  'Esta conta não tem o Google Agenda ativado. Abra calendar.google.com com ela uma vez e sincronize de novo.';
export const MISSING_PERMISSION_MESSAGE =
  'O Google não deu permissão para a agenda e as tarefas. Entre de novo e deixe todas as caixas marcadas.';

/** A mensagem só leva o código: o corpo fica para classificar e nunca vai para log nem tela. */
export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Google respondeu ${status}`);
  }
}

/** O refresh token sumiu, foi revogado ou expirou: só entrando de novo. */
export class GoogleAuthError extends Error {}

export const secretName = (accountId: string) => `google:${accountId}`;

export const hasScope = (granted: string, scope: string) => granted.split(/\s+/).includes(scope);

export const isNotFound = (error: unknown) =>
  error instanceof GoogleApiError && (error.status === 404 || error.status === 410);

export function isMissingPermission(error: unknown) {
  return (
    error instanceof GoogleApiError &&
    error.status === 403 &&
    /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes/.test(
      error.body
    )
  );
}

/** Falha que não é daquele item: vale parar a conta e tentar na próxima rodada. */
export const isAccountWide = (error: unknown) =>
  !(error instanceof GoogleApiError) ||
  error.status === 401 ||
  error.status === 429 ||
  error.status >= 500 ||
  isMissingPermission(error);

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function tokenRequest(ctx: AppCtx, params: Record<string, string>): Promise<TokenResponse> {
  if (!ctx.google) throw new Error('Google não configurado.');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: ctx.google.clientId,
      client_secret: ctx.google.clientSecret,
      ...params,
    }),
  });
  const text = await response.text();
  if (!response.ok) {
    if (text.includes('invalid_grant')) throw new GoogleAuthError('invalid_grant');
    throw new GoogleApiError(response.status, text);
  }
  return JSON.parse(text) as TokenResponse;
}

export const exchangeCode = (
  ctx: AppCtx,
  input: { code: string; verifier: string; redirectUri: string }
) =>
  tokenRequest(ctx, {
    grant_type: 'authorization_code',
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
  });

export async function fetchUserInfo(accessToken: string) {
  const response = await fetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new GoogleApiError(response.status, await response.text());
  return (await response.json()) as { sub: string; email: string; name?: string };
}

/** Melhor esforço: quem desconecta não pode ficar preso à rede. */
export async function revokeToken(token: string) {
  await fetch(REVOKE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }),
  }).catch(() => undefined);
}

const accessTokens = new Map<string, { token: string; expiresAt: number }>();

export const rememberAccessToken = (accountId: string, token: string, expiresIn: number) =>
  accessTokens.set(accountId, { token, expiresAt: Date.now() + expiresIn * 1000 });

export const forgetAccessToken = (accountId: string) => accessTokens.delete(accountId);

export function saveAccount(ctx: AppCtx, id: string, data: Partial<GoogleAccountRow>) {
  ctx.db
    .update(googleAccounts)
    .set({ ...data, updatedAt: Date.now() })
    .where(eq(googleAccounts.id, id))
    .run();
}

async function accessTokenFor(ctx: AppCtx, accountId: string) {
  const cached = accessTokens.get(accountId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  // Backup restaurado em outra máquina traz a conta, mas o cofre não vem junto.
  const refreshToken = ctx.secrets.get(secretName(accountId));
  if (!refreshToken) throw new GoogleAuthError('sem token');
  const token = await tokenRequest(ctx, {
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  rememberAccessToken(accountId, token.access_token, token.expires_in);
  if (token.scope) saveAccount(ctx, accountId, { scope: token.scope });
  return token.access_token;
}

interface FetchInit {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

async function send(token: string, url: string, init: FetchInit) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) query.set(key, value);
  }
  return fetch(query.size ? `${url}?${query}` : url, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

/** fetch com a conta. Devolve o JSON, ou null em 204. Um 401 renova o token uma vez. */
export async function googleFetch<T = unknown>(
  ctx: AppCtx,
  accountId: string,
  url: string,
  init: FetchInit = {}
): Promise<T> {
  let response = await send(await accessTokenFor(ctx, accountId), url, init);
  if (response.status === 401) {
    forgetAccessToken(accountId);
    response = await send(await accessTokenFor(ctx, accountId), url, init);
    if (response.status === 401) throw new GoogleAuthError('token recusado');
  }
  if (!response.ok) throw new GoogleApiError(response.status, await response.text());
  if (response.status === 204) return null as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : null) as T;
}

export const liveAccounts = (ctx: AppCtx) =>
  ctx.db
    .select()
    .from(googleAccounts)
    .where(isNull(googleAccounts.deletedAt))
    .orderBy(googleAccounts.createdAt)
    .all();

export const tasksAccount = (ctx: AppCtx) =>
  ctx.db
    .select()
    .from(googleAccounts)
    .where(and(eq(googleAccounts.syncTasks, true), isNull(googleAccounts.deletedAt)))
    .get();

function messageOf(error: unknown) {
  if (error instanceof GoogleApiError) {
    if (error.status === 403 && error.body.includes('notACalendarUser')) {
      return NOT_CALENDAR_USER_MESSAGE;
    }
    if (error.status === 429) return 'O Google pediu uma pausa. Tentamos de novo em instantes.';
    return `O Google respondeu com erro (${error.status}).`;
  }
  return 'Sem resposta do Google. Tentamos de novo em instantes.';
}

// O job roda a cada 5 minutos: o mesmo erro da mesma conta só vai para o log uma vez por hora.
const logged = new Map<string, { message: string; at: number }>();
const LOG_AGAIN_AFTER = 60 * 60_000;

/** Registra na conta, sem lançar: uma conta com problema não segura as outras. */
export function recordFailure(ctx: AppCtx, accountId: string, error: unknown) {
  if (error instanceof GoogleAuthError || isMissingPermission(error)) {
    forgetAccessToken(accountId);
    saveAccount(ctx, accountId, {
      needsReconnect: true,
      lastError: error instanceof GoogleAuthError ? RECONNECT_MESSAGE : MISSING_PERMISSION_MESSAGE,
    });
    return;
  }
  const message = messageOf(error);
  const last = logged.get(accountId);
  if (!last || last.message !== message || Date.now() - last.at > LOG_AGAIN_AFTER) {
    logged.set(accountId, { message, at: Date.now() });
    console.error('[google]', error instanceof Error ? error.message : 'falha');
  }
  saveAccount(ctx, accountId, { lastError: message });
}
