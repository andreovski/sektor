import { vi } from 'vitest';

import type { PluggyAccount, PluggyBill, PluggyTransaction } from './pluggy-types';

/**
 * Pluggy de mentira: troca o fetch global e responde às rotas que o app usa, com um banco (item),
 * contas e lançamentos em memória. Cada chamada fica em `calls`.
 */
export class FakePluggy {
  calls: { method: string; url: string; body?: Record<string, string> }[] = [];
  clientId = 'pluggy-client';
  clientSecret = 'pluggy-secret';
  itemId = '11111111-1111-4111-8111-111111111111';
  itemStatus = 'UPDATED';
  accounts: PluggyAccount[] = [
    {
      id: '22222222-2222-4222-8222-222222222222',
      type: 'BANK',
      subtype: 'CHECKING_ACCOUNT',
      number: '0001/12345-6',
      name: 'Conta Corrente',
      balance: 1500,
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      type: 'CREDIT',
      subtype: 'CREDIT_CARD',
      number: '1234',
      name: 'Cartão Platinum',
      balance: 320.4,
      creditData: {
        balanceCloseDate: '2026-10-25T03:00:00.000Z',
        balanceDueDate: '2026-11-05T03:00:00.000Z',
      },
    },
  ];
  /** Lançamentos por conta (id da conta na Pluggy). */
  transactions = new Map<string, PluggyTransaction[]>();
  /** Faturas fechadas por conta de cartão. */
  bills = new Map<string, PluggyBill[]>();

  install() {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => this.handle(String(input), init))
    );
    return this;
  }

  uninstall() {
    vi.unstubAllGlobals();
  }

  add(accountId: string, tx: Partial<PluggyTransaction> & { id: string }) {
    const list = this.transactions.get(accountId) ?? [];
    list.push({
      description: 'Lançamento',
      amount: -10,
      date: '2026-10-15T03:00:00.000Z',
      type: 'DEBIT',
      status: 'POSTED',
      ...tx,
    });
    this.transactions.set(accountId, list);
  }

  private json(status: number, body: unknown) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      })
    );
  }

  private handle(raw: string, init?: RequestInit) {
    const url = new URL(raw);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, url: raw, body });
    if (url.host !== 'api.pluggy.ai') throw new Error(`fetch inesperado: ${raw}`);

    if (url.pathname === '/auth') {
      return body?.clientId === this.clientId && body?.clientSecret === this.clientSecret
        ? this.json(200, { apiKey: 'api-key-1' })
        : this.json(401, { code: 401, codeDescription: 'CLIENT_KEYS_UNAUTHORIZED' });
    }
    const headers = new Headers(init?.headers);
    if (headers.get('x-api-key') !== 'api-key-1') return this.json(403, { code: 403 });

    if (url.pathname === '/connect_token') return this.json(200, { accessToken: 'connect-1' });
    if (url.pathname === '/connectors') {
      return this.json(200, { results: [{ id: 200, name: 'MeuPluggy' }] });
    }
    let match = url.pathname.match(/^\/items\/(.+)$/);
    if (match) {
      if (match[1] !== this.itemId) return this.json(404, { code: 404 });
      return this.json(200, {
        id: this.itemId,
        status: this.itemStatus,
        connector: { id: 200, name: 'Banco Teste', imageUrl: 'https://cdn/banco.png' },
      });
    }
    if (url.pathname === '/accounts') {
      if (url.searchParams.get('itemId') !== this.itemId) return this.json(200, { results: [] });
      return this.json(200, { results: this.accounts });
    }
    match = url.pathname.match(/^\/accounts\/(.+)$/);
    if (match) {
      const account = this.accounts.find((a) => a.id === match![1]);
      return account ? this.json(200, account) : this.json(404, { code: 404 });
    }
    if (url.pathname === '/bills') {
      const all = this.bills.get(url.searchParams.get('accountId')!) ?? [];
      return this.json(200, { results: all, total: all.length, page: 1, totalPages: 1 });
    }
    if (url.pathname === '/v2/transactions') {
      const from = url.searchParams.get('dateFrom') ?? '0000-00-00';
      const all = (this.transactions.get(url.searchParams.get('accountId')!) ?? []).filter(
        (tx) => tx.date.slice(0, 10) >= from
      );
      // Duas por página, para exercitar o cursor.
      const offset = Number(url.searchParams.get('after') ?? 0);
      const next =
        offset + 2 < all.length
          ? `${url.search.replace(/&after=\d+/, '')}&after=${offset + 2}`
          : null;
      return this.json(200, { results: all.slice(offset, offset + 2), next });
    }
    return this.json(404, { code: 404, message: `rota falsa ausente: ${url.pathname}` });
  }
}
