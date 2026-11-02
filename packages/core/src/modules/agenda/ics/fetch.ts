import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';

import { looksLikeIcs } from './parse';

// Busca do arquivo ICS. O link é segredo (quem tem o link vê a agenda): ele nunca entra em log nem
// em mensagem de erro. Como é um endereço digitado, só vale https para a internet, nem depois de
// um redirecionamento (http só no servidor local dos testes, o `trustedHost`). A conferência do IP
// fica na própria conexão (`publicLookup`): conferir antes e deixar o fetch resolver de novo abriria
// a brecha do DNS que muda de resposta.

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;

export class IcsFetchError extends Error {}

const NOT_PUBLIC = 'Esse endereço não é público.';

/** webcal:// vira https://; devolve null se não for um link https válido. */
export function normalizeIcsUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^webcals?:\/\//i, 'https://');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.toString();
}

/** Só o domínio, para mostrar na tela ("outlook.office365.com"). */
export function icsHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** "::ffff:a00:1" e "::ffff:10.0.0.1" -> "10.0.0.1". */
function mappedIpv4(address: string): string | null {
  const v6 = address.toLowerCase();
  const prefix = ['::ffff:', '64:ff9b::'].find((p) => v6.startsWith(p));
  if (!prefix) return null;
  const rest = v6.slice(prefix.length);
  if (isIP(rest) === 4) return rest;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(rest);
  if (!hex) return null;
  const [high, low] = [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16)];
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function isPrivateAddress(address: string): boolean {
  const v4 = isIP(address) === 4 ? address : mappedIpv4(address);
  if (v4) {
    const [a = 0, b = 0] = v4.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89a-f]/.test(v6) || /^ff/.test(v6);
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number
) => void;

/** O `lookup` da conexão: recusa o nome que aponta para a rede interna, a cada conexão aberta. */
export function publicLookup(
  hostname: string,
  options: { all?: boolean; family?: number },
  callback: LookupCallback
) {
  lookup(hostname, { family: options.family ?? 0, all: true }, (error, list) => {
    if (error) return callback(error, '');
    if (!list.length || list.some((item) => isPrivateAddress(item.address))) {
      return callback(new IcsFetchError(NOT_PUBLIC), '');
    }
    if (options.all) return callback(null, list);
    callback(null, list[0]!.address, list[0]!.family);
  });
}

/** Barra o que não passa pelo `lookup`: IP escrito direto no link e nomes internos. */
function assertPublicHost(url: URL) {
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new IcsFetchError(NOT_PUBLIC);
  }
  if (isIP(host) && isPrivateAddress(host)) throw new IcsFetchError(NOT_PUBLIC);
}

interface RawResponse {
  status: number;
  location: string | null;
  etag: string | null;
  text: string;
}

function request(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<RawResponse> {
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      { headers, signal, lookup: publicLookup as never },
      (response) => {
        const status = response.statusCode ?? 0;
        const meta = {
          status,
          location: response.headers.location ?? null,
          etag: response.headers.etag ?? null,
        };
        if (status < 200 || status >= 300) {
          response.resume();
          return resolve({ ...meta, text: '' });
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > MAX_BYTES) {
            req.destroy(new IcsFetchError('A agenda é grande demais (mais de 10 MB).'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({ ...meta, text: new TextDecoder('utf-8').decode(Buffer.concat(chunks)) })
        );
        response.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

export type IcsFetchResult =
  | { notModified: true }
  | { notModified: false; text: string; etag: string | null };

export interface IcsFetchOptions {
  etag?: string | null;
  /** Só os testes, que sobem um servidor em 127.0.0.1. */
  trustedHost?: string;
  timeoutMs?: number;
}

export type IcsFetcher = (link: string, options?: IcsFetchOptions) => Promise<IcsFetchResult>;

/** Baixa o ICS. Com `etag`, um 304 do servidor volta como `notModified`. */
export const fetchIcs: IcsFetcher = async (link, options = {}) => {
  const { etag, trustedHost, timeoutMs = TIMEOUT_MS } = options;
  let url = new URL(link);
  const signal = AbortSignal.timeout(timeoutMs);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.host !== trustedHost) {
      assertPublicHost(url);
      if (url.protocol !== 'https:') throw new IcsFetchError('O link precisa usar https.');
    }
    let response: RawResponse;
    try {
      response = await request(
        url,
        {
          accept: 'text/calendar, text/plain;q=0.9, */*;q=0.5',
          'user-agent': 'Sektor/1.0 (agenda por link)',
          ...(etag ? { 'if-none-match': etag } : {}),
        },
        signal
      );
    } catch (error) {
      // O erro do Node traz o endereço: nada dele sobe, só a nossa mensagem.
      if (error instanceof IcsFetchError) throw error;
      if (signal.aborted) throw new IcsFetchError('O link demorou demais para responder.');
      if ((error as NodeJS.ErrnoException).code === 'ENOTFOUND') {
        throw new IcsFetchError('Não achamos o servidor desse link. Confira o endereço.');
      }
      throw new IcsFetchError('Não deu para abrir o link.');
    }

    const { status } = response;
    if (status >= 300 && status < 400 && status !== 304) {
      if (!response.location) break;
      let next: URL;
      try {
        next = new URL(response.location, url);
      } catch {
        break;
      }
      if (next.protocol !== 'https:' && next.protocol !== 'http:') break;
      url = next;
      continue;
    }
    if (status === 304) return { notModified: true };
    if (status === 404 || status === 410) {
      throw new IcsFetchError(
        'O link não existe mais. A agenda pode ter deixado de ser publicada: publique de novo e troque o link.'
      );
    }
    if (status === 401 || status === 403) {
      throw new IcsFetchError('O servidor recusou o acesso a esse link.');
    }
    if (status < 200 || status >= 300) {
      throw new IcsFetchError(`O servidor da agenda respondeu ${status}.`);
    }
    if (!looksLikeIcs(response.text)) {
      throw new IcsFetchError(
        'Esse link não é de uma agenda (ICS). No Outlook, copie o link que termina em .ics.'
      );
    }
    return { notModified: false, text: response.text, etag: response.etag };
  }
  throw new IcsFetchError('O link redireciona demais.');
};
