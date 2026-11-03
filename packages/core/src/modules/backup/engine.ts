import Database from 'better-sqlite3-multiple-ciphers';
import { copyFileSync, existsSync, openSync, closeSync, readFileSync, readSync, renameSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { LATEST_SCHEMA_VERSION } from '../../db/client';

import { stageProjectFiles } from './files';
import { openKey, RECOVERY_FILE, type RecoveryEnvelope } from './recovery';

/** O banco em uso. Só o backup enxerga a chave. */
export interface DbStore {
  raw: Database.Database;
  path: string;
  keyHex: string;
}

function openWith(path: string, keyHex: string, readonly = false) {
  const db = new Database(path, { fileMustExist: true, readonly });
  db.pragma(`hexkey='${keyHex}'`);
  return db;
}

/** A chave abre o arquivo? O SQLite só lê a página ao consultar: chave errada lança aqui. */
function opens(path: string, keyHex: string) {
  let db: Database.Database | null = null;
  try {
    db = openWith(path, keyHex);
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

function hasPlainHeader(path: string) {
  const header = Buffer.alloc(15);
  const fd = openSync(path, 'r');
  try {
    readSync(fd, header, 0, 15, 0);
  } finally {
    closeSync(fd);
  }
  return header.toString('latin1') === 'SQLite format 3';
}

const FILE_HASHES = `SELECT DISTINCT content_hash AS hash FROM project_files WHERE deleted_at IS NULL`;
const hashesIn = (db: Database.Database) => {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'project_files'`).get();
  if (!table) return [];
  return (db.prepare(FILE_HASHES).all() as { hash: string }[]).map((row) => row.hash);
};

/** Arquivos de projeto em uso no banco aberto. */
export const liveFileHashes = (store: DbStore) => hashesIn(store.raw);

/** Arquivos que um backup usa. Lança se a chave for outra: quem chama não pode supor nada. */
export function backupFileHashes(path: string, keyHex: string) {
  const db = openWith(path, keyHex, true);
  try {
    return hashesIn(db);
  } finally {
    db.close();
  }
}

/** Grava com a mesma chave do banco. Só um arquivo conferido ganha o nome final. */
export function writeBackup(store: DbStore, folder: string, name: string) {
  const file = join(folder, name);
  const partial = `${file}.parcial`;
  rmSync(partial, { force: true });
  try {
    store.raw.prepare('VACUUM INTO ?').run(partial);
    if (hasPlainHeader(partial)) throw new Error('O backup saiu sem cifra.');
    if (!opens(partial, store.keyHex)) throw new Error('O backup gravado não abriu.');
    renameSync(partial, file);
  } finally {
    rmSync(partial, { force: true });
  }
  return { file, bytes: statSync(file).size };
}

export type StageResult =
  | { status: 'ok'; keyChanged: boolean; missingFiles: number }
  | { status: 'needs-password' }
  | { status: 'error'; message: string };

export interface StageOptions {
  file: string;
  /** Cópia preparada, na pasta de dados; o main a troca pelo banco no próximo início. */
  stagePath: string;
  /** Chave atual da máquina, ou null quando o cofre a perdeu. */
  currentKeyHex: string | null;
  /** Chave com que a cópia deve ficar. */
  targetKeyHex: string;
  password?: string;
  /** Arquivos de projeto: a pasta desta máquina e onde preparar os que vierem do backup. */
  files?: { local: string; staged: string };
}

function keyFromRecovery(file: string, password: string): StageResult | string {
  const path = join(dirname(file), RECOVERY_FILE);
  if (!existsSync(path)) {
    return {
      status: 'error',
      message: `Não achamos ${RECOVERY_FILE} ao lado do backup. Coloque-o na mesma pasta.`,
    };
  }
  let envelope: RecoveryEnvelope;
  try {
    envelope = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { status: 'error', message: `${RECOVERY_FILE} está danificado.` };
  }
  return openKey(envelope, password) ?? { status: 'error', message: 'Senha de recuperação incorreta.' };
}

function checkAndRekey(db: Database.Database, sourceKey: string, targetKey: string): string | null {
  if (db.pragma('quick_check', { simple: true }) !== 'ok') return 'O arquivo de backup está danificado.';
  const meta = db.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'app_meta'`).get();
  if (!meta) return 'Este arquivo não é um backup do Sektor.';
  if ((db.pragma('user_version', { simple: true }) as number) > LATEST_SCHEMA_VERSION) {
    return 'Este backup veio de uma versão mais nova do Sektor. Atualize o app antes de restaurar.';
  }
  if (sourceKey === targetKey) return null;
  // Chave nova é outra máquina: a pasta e o envelope do backup não valem aqui.
  db.prepare(`DELETE FROM app_meta WHERE key LIKE 'backup.%'`).run();
  db.pragma('journal_mode = DELETE');
  db.pragma(`hexrekey='${targetKey}'`);
  return null;
}

/** Confere o backup e prepara a cópia com a chave desta máquina. O arquivo escolhido não é tocado. */
export function stageRestore(options: StageOptions): StageResult {
  const { file, stagePath, currentKeyHex, targetKeyHex, password } = options;
  if (!existsSync(file)) return { status: 'error', message: 'Arquivo de backup não encontrado.' };
  rmSync(stagePath, { force: true });
  let done = false;
  try {
    copyFileSync(file, stagePath);
    let sourceKey = currentKeyHex;
    if (!sourceKey || !opens(stagePath, sourceKey)) {
      if (!password) return { status: 'needs-password' };
      const key = keyFromRecovery(file, password);
      if (typeof key !== 'string') return key;
      if (!opens(stagePath, key)) {
        return { status: 'error', message: 'A senha não corresponde a este backup.' };
      }
      sourceKey = key;
    }
    const db = openWith(stagePath, sourceKey);
    try {
      const problem = checkAndRekey(db, sourceKey, targetKeyHex);
      if (problem) return { status: 'error', message: problem };
    } finally {
      db.close();
    }
    if (!opens(stagePath, targetKeyHex)) {
      return { status: 'error', message: 'A cópia preparada não abriu. Nada foi trocado.' };
    }
    const missingFiles = options.files
      ? stageProjectFiles({
          ...options.files,
          hashes: backupFileHashes(stagePath, targetKeyHex),
          backupFolder: dirname(file),
          sourceKeyHex: sourceKey,
          targetKeyHex,
        })
      : 0;
    done = true;
    return { status: 'ok', keyChanged: sourceKey !== targetKeyHex, missingFiles };
  } finally {
    if (!done) {
      rmSync(stagePath, { force: true });
      if (options.files) rmSync(options.files.staged, { recursive: true, force: true });
    }
  }
}
