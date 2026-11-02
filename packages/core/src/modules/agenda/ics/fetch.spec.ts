import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  fetchIcs,
  icsHost,
  isPrivateAddress,
  normalizeIcsUrl,
  publicLookup,
} from './fetch';

describe('normalizeIcsUrl', () => {
  it('troca webcal por https e recusa o que não é http(s)', () => {
    expect(
      normalizeIcsUrl(' webcal://outlook.office365.com/owa/calendar/x/reachcalendar.ics ')
    ).toBe('https://outlook.office365.com/owa/calendar/x/reachcalendar.ics');
    expect(normalizeIcsUrl('https://example.com/a.ics')).toBe('https://example.com/a.ics');
    expect(normalizeIcsUrl('file:///etc/passwd')).toBeNull();
    expect(normalizeIcsUrl('ftp://example.com/a.ics')).toBeNull();
    expect(normalizeIcsUrl('https://user:senha@example.com/a.ics')).toBeNull();
    expect(normalizeIcsUrl('não é link')).toBeNull();
  });

  it('icsHost mostra só o domínio', () => {
    expect(icsHost('https://outlook.office365.com/owa/calendar/segredo/calendar.ics')).toBe(
      'outlook.office365.com'
    );
  });
});

describe('isPrivateAddress', () => {
  it('bloqueia rede interna e deixa a internet', () => {
    for (const address of [
      '127.0.0.1',
      '10.0.0.5',
      '192.168.1.1',
      '172.20.0.1',
      '169.254.169.254',
      '::1',
      'fd12::1',
      'fe80::1',
      '::ffff:10.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
      '100.64.0.1',
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ['52.96.0.1', '8.8.8.8', '2603:1036::1', '::ffff:808:808']) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});

const ICS = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';

describe('fetchIcs', () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/ok') {
        if (req.headers['if-none-match'] === '"v1"') return res.writeHead(304).end();
        return res.writeHead(200, { etag: '"v1"' }).end(ICS);
      }
      if (req.url === '/pagina') return res.writeHead(200).end('<!doctype html>');
      if (req.url === '/some') return res.writeHead(404).end();
      if (req.url === '/volta') return res.writeHead(302, { location: '/ok' }).end();
      if (req.url === '/laco') return res.writeHead(302, { location: '/laco' }).end();
      if (req.url === '/interno') {
        return res.writeHead(302, { location: 'http://169.254.169.254/x' }).end();
      }
      if (req.url === '/grande') return res.writeHead(200).end(Buffer.alloc(11 * 1024 * 1024));
      if (req.url === '/lento') return;
      res.writeHead(500).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const open = () => ({ trustedHost: new URL(base).host });

  it('recusa endereço privado sem abrir conexão, também por nome', async () => {
    for (const link of [
      `${base}/ok`,
      'http://localhost:1/a.ics',
      'http://[::1]/a.ics',
      'http://[::ffff:127.0.0.1]/a.ics',
      'http://2130706433/a.ics',
      'http://sektor.internal/a.ics',
    ]) {
      await expect(fetchIcs(link), link).rejects.toThrow('Esse endereço não é público.');
    }
  });

  it('o lookup da conexão recusa nome que resolve para a rede interna', async () => {
    const result = await new Promise<Error | null>((resolve) =>
      publicLookup('localhost', {}, (error) => resolve(error))
    );
    expect(result?.message).toBe('Esse endereço não é público.');
  });

  it('segue o redirecionamento e respeita o ETag', async () => {
    expect(await fetchIcs(`${base}/volta`, open())).toEqual({
      notModified: false,
      text: ICS,
      etag: '"v1"',
    });
    expect(await fetchIcs(`${base}/ok`, { ...open(), etag: '"v1"' })).toEqual({ notModified: true });
  });

  it('redirecionamento para a rede interna é recusado', async () => {
    await expect(fetchIcs(`${base}/interno`, open())).rejects.toThrow('não é público');
  });

  it('nenhuma mensagem de erro leva o link', async () => {
    const link = `${base}/segredo-do-link`;
    for (const path of ['/pagina', '/some', '/laco', '/grande', '/segredo-do-link']) {
      const error = await fetchIcs(`${base}${path}`, open()).catch((e: Error) => e);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).not.toContain('segredo');
      expect((error as Error).message).not.toContain(link);
      expect((error as Error).message).not.toContain('127.0.0.1');
    }
  });

  it('dá nome a cada falha', async () => {
    await expect(fetchIcs(`${base}/pagina`, open())).rejects.toThrow('não é de uma agenda');
    await expect(fetchIcs(`${base}/some`, open())).rejects.toThrow('não existe mais');
    await expect(fetchIcs(`${base}/laco`, open())).rejects.toThrow('redireciona demais');
    await expect(fetchIcs(`${base}/grande`, open())).rejects.toThrow('grande demais');
    await expect(fetchIcs(`${base}/lento`, { ...open(), timeoutMs: 100 })).rejects.toThrow(
      'demorou demais'
    );
  });
});
