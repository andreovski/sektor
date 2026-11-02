import { AppError } from '../services/context';

import type { PluggyAccount, PluggyBill, PluggyItem, PluggyTransaction } from './pluggy-types';

// Chamadas à API da Pluggy com a chave da própria pessoa. Os testes trocam o fetch global.

export const PLUGGY_URL = 'https://api.pluggy.ai';

export class PluggyApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string
  ) {
    super(`Pluggy API ${status}: ${body.slice(0, 300)}`);
  }
}

export const INVALID_KEYS_MESSAGE =
  'A Pluggy não aceitou o Client ID e o Client Secret. Confira as chaves no painel da Pluggy.';

export interface PluggyKeys {
  clientId: string;
  clientSecret: string;
}

/** Quem guarda as chaves: no app, o cofre do sistema. Nunca o banco de dados. */
export interface KeyStore {
  get(): PluggyKeys | null;
  set(keys: PluggyKeys | null): void;
}

/** A Pluggy mantém a chave por 2 h; renovamos antes. */
const API_KEY_TTL_MS = 100 * 60_000;
let apiKey: { key: string; expiresAt: number } | null = null;

export function forgetPluggyKey() {
  apiKey = null;
}

/** Troca Client ID e Secret por uma chave da API. 401/403 viram a mensagem de chaves inválidas. */
export async function authenticatePluggy(keys: PluggyKeys): Promise<string> {
  const response = await fetch(`${PLUGGY_URL}/auth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(keys),
  });
  const text = await response.text();
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    throw new AppError(400, INVALID_KEYS_MESSAGE);
  }
  if (!response.ok) throw new PluggyApiError(response.status, text);
  return (JSON.parse(text) as { apiKey: string }).apiKey;
}

async function currentKey(store: KeyStore): Promise<string> {
  if (apiKey && apiKey.expiresAt > Date.now()) return apiKey.key;
  const keys = store.get();
  if (!keys) throw new AppError(400, 'Salve antes as chaves da Pluggy.');
  const key = await authenticatePluggy(keys);
  apiKey = { key, expiresAt: Date.now() + API_KEY_TTL_MS };
  return key;
}

/** Chave vencida (401/403) é renovada uma vez. */
export async function pluggyFetch<T>(
  store: KeyStore,
  path: string,
  init: { method?: string; body?: unknown } = {},
  retried = false
): Promise<T> {
  const response = await fetch(`${PLUGGY_URL}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      'x-api-key': await currentKey(store),
      ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const text = await response.text();
  if ((response.status === 401 || response.status === 403) && !retried) {
    forgetPluggyKey();
    return pluggyFetch(store, path, init, true);
  }
  if (!response.ok) throw new PluggyApiError(response.status, text);
  return (text ? JSON.parse(text) : null) as T;
}

export const fetchItem = (store: KeyStore, itemId: string) =>
  pluggyFetch<PluggyItem>(store, `/items/${encodeURIComponent(itemId)}`);

export async function fetchAccounts(store: KeyStore, itemId: string): Promise<PluggyAccount[]> {
  const page = await pluggyFetch<{ results: PluggyAccount[] }>(
    store,
    `/accounts?itemId=${encodeURIComponent(itemId)}`
  );
  return page.results;
}

/** Todos os lançamentos da conta desde `dateFrom`, seguindo o cursor. */
export async function fetchTransactions(
  store: KeyStore,
  accountId: string,
  dateFrom: string
): Promise<PluggyTransaction[]> {
  const all: PluggyTransaction[] = [];
  let query: string | null =
    `?accountId=${encodeURIComponent(accountId)}&dateFrom=${encodeURIComponent(dateFrom)}`;
  // Teto de páginas: uma conta pessoal não tem tanto lançamento, e isto evita laço sem fim.
  for (let page = 0; query && page < 50; page++) {
    const result: { results: PluggyTransaction[]; next: string | null } = await pluggyFetch(
      store,
      `/v2/transactions${query}`
    );
    all.push(...result.results);
    query = result.next;
  }
  return all;
}

export async function fetchBills(store: KeyStore, accountId: string): Promise<PluggyBill[]> {
  const all: PluggyBill[] = [];
  for (let page = 1; page <= 20; page++) {
    const result: { results: PluggyBill[]; totalPages?: number } = await pluggyFetch(
      store,
      `/bills?accountId=${encodeURIComponent(accountId)}&page=${page}`
    );
    all.push(...result.results);
    if (!result.totalPages || page >= result.totalPages) break;
  }
  return all;
}

export async function createConnectToken(store: KeyStore): Promise<string> {
  const result = await pluggyFetch<{ accessToken: string }>(store, '/connect_token', {
    method: 'POST',
    // Sem avoidDuplicates: cada banco do Meu Pluggy é um item, todos com a mesma autorização, e a
    // Pluggy recusaria o segundo (ITEM_USER_ALREADY_EXISTS).
    body: { options: { clientUserId: 'sektor' } },
  });
  return result.accessToken;
}

/** Id do conector do Meu Pluggy (null se não achar: o widget lista tudo). */
export async function meuPluggyConnectorIds(store: KeyStore): Promise<number[] | null> {
  try {
    const result = await pluggyFetch<{ results: { id: number; name: string }[] }>(
      store,
      '/connectors?name=MeuPluggy'
    );
    const ids = result.results
      .filter((c) => c.name.toLowerCase().replace(/\s/g, '').includes('meupluggy'))
      .map((c) => c.id);
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}
