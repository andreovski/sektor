import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { type DbHandle, openDatabase } from './client';
import { accounts, bankAccounts, bankMovements, pluggyItems, transactions } from './schema';

const KEY = 'a'.repeat(64);
const stamp = { createdAt: 1, updatedAt: 1 };
let dir: string;
let db: DbHandle;

function open() {
  dir = mkdtempSync(join(tmpdir(), 'sektor-test-'));
  db = openDatabase(join(dir, 'test.db'), KEY);
  return db.orm;
}

function account(id = 'a1') {
  return { ...stamp, id, name: 'Conta', type: 'CHECKING' as const };
}

afterEach(() => {
  db.raw.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('banco', () => {
  it('aplica todas as migrações', () => {
    open();
    expect(db.raw.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(2);
  });

  it('recusa valor zero ou negativo', () => {
    const orm = open();
    orm.insert(accounts).values(account()).run();
    expect(() =>
      orm
        .insert(transactions)
        .values({
          ...stamp,
          id: 't1',
          kind: 'EXPENSE',
          amountCents: 0,
          date: '2026-11-02',
          accountId: 'a1',
          description: 'x',
        })
        .run()
    ).toThrow();
  });

  it('recusa conta que não existe', () => {
    const orm = open();
    expect(() =>
      orm
        .insert(transactions)
        .values({
          ...stamp,
          id: 't1',
          kind: 'EXPENSE',
          amountCents: 100,
          date: '2026-11-02',
          accountId: 'nao-existe',
          description: 'x',
        })
        .run()
    ).toThrow();
  });

  it('não importa duas vezes o mesmo lançamento do banco', () => {
    const orm = open();
    orm.insert(pluggyItems).values({ ...stamp, id: 'i1', itemId: 'x', name: 'Banco' }).run();
    orm
      .insert(bankAccounts)
      .values({ ...stamp, id: 'b1', itemId: 'i1', externalId: 'e', name: 'C', type: 'BANK' })
      .run();
    const movement = {
      ...stamp,
      bankAccountId: 'b1',
      externalId: 'tx',
      kind: 'EXPENSE' as const,
      amountCents: 100,
      date: '2026-11-02',
      description: 'x',
      status: 'PENDING' as const,
    };
    orm.insert(bankMovements).values({ ...movement, id: 'm1' }).run();
    expect(() =>
      orm.insert(bankMovements).values({ ...movement, id: 'm2' }).run()
    ).toThrow();
  });
});
