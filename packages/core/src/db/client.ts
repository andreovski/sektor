import Database from 'better-sqlite3-multiple-ciphers';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import * as schema from './schema';

// Migrações embutidas no bundle: o app empacotado não depende de arquivos soltos. A ordem dos
// nomes (`NNNN_nome.sql`) é a versão guardada em `user_version`.
const files = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
});
const MIGRATIONS = Object.keys(files)
  .sort()
  .map((name) => files[name]!);

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
    migrate(raw);
  } catch (error) {
    raw.close();
    throw error;
  }
  return { raw, orm: drizzle(raw, { schema }) };
}

function migrate(raw: Database.Database) {
  const current = raw.pragma('user_version', { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    raw.transaction(() => {
      raw.exec(MIGRATIONS[version]!);
      raw.pragma(`user_version = ${version + 1}`);
    })();
  }
}
