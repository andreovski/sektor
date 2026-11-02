import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import * as schema from './schema';

// Migrações embutidas no bundle: o app empacotado não depende de arquivos soltos. A ordem dos
// nomes dá a sequência, e `user_version` guarda o número do último arquivo aplicado.
const files = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const MIGRATIONS = Object.keys(files)
  .sort()
  .map((name) => ({
    version: Number(/(\d+)_[^/]+\.sql$/.exec(name)?.[1]),
    sql: files[name]!,
  }));

export const LATEST_SCHEMA_VERSION = Math.max(...MIGRATIONS.map(({ version }) => version));

export interface DbHandle {
  raw: Database.Database;
  orm: ReturnType<typeof drizzle<typeof schema>>;
}

/** Abre o arquivo com a chave de 32 bytes em hexadecimal. Chave errada lança aqui. */
export function openDatabase(path: string, keyHex: string): DbHandle {
  if (!/^[0-9a-f]{64}$/.test(keyHex)) throw new Error('Chave do banco inválida.');
  const raw = new Database(path);
  try {
    raw.pragma(`hexkey='${keyHex}'`);
    // O SQLite só lê o arquivo aqui: é onde uma chave errada aparece.
    raw.pragma('journal_mode = WAL');
    raw.pragma('foreign_keys = ON');
    migrate(raw, path);
  } catch (error) {
    raw.close();
    throw error;
  }
  return { raw, orm: drizzle(raw, { schema }) };
}

/** Migração que falha pode deixar o banco pela metade: antes dela, uma cópia cifrada ao lado. */
export function migrate(raw: Database.Database, path: string, migrations = MIGRATIONS) {
  const current = raw.pragma('user_version', { simple: true }) as number;
  const pending = migrations.filter(({ version }) => version > current);
  if (current > 0 && pending.length) {
    const folder = join(dirname(path), 'antes-da-migracao');
    mkdirSync(folder, { recursive: true });
    raw.prepare('VACUUM INTO ?').run(join(folder, `sektor-v${current}-${Date.now()}.db`));
  }
  for (const { version, sql } of pending) {
    raw.transaction(() => {
      raw.exec(sql);
      raw.pragma(`user_version = ${version}`);
    })();
  }
}
