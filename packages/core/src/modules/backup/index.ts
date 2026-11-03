import { eq } from 'drizzle-orm';
import { accessSync, constants, existsSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

import type { AppCtx, Job } from '../../app';
import { appMeta } from '../../db/schema';
import { AppError, todayIn } from '../../services/context';
import { parse } from '../finance';
import { PROJECT_FILES_FOLDER } from '../projects/file-vault';

import { backupFileHashes, type DbStore, liveFileHashes, writeBackup } from './engine';
import { backupFilesFolder, countBackupFiles, sweepBackupFiles, syncProjectFiles } from './files';
import {
  generatePassword,
  RECOVERY_FILE,
  type RecoveryEnvelope,
  sealKey,
} from './recovery';
import { backupDate, dailyName, manualName, namesToRotate } from './rotation';

export { type DbStore, stageRestore, type StageResult } from './engine';

const KEY = {
  folder: 'backup.folder',
  recovery: 'backup.recovery',
  lastAt: 'backup.lastAt',
  lastFile: 'backup.lastFile',
  error: 'backup.error',
  errorDay: 'backup.errorDay',
  filesAbsent: 'backup.filesAbsent',
  name: 'settings.name',
  timeZone: 'settings.timeZone',
};

const readMeta = (ctx: AppCtx, key: string) =>
  ctx.db.select().from(appMeta).where(eq(appMeta.key, key)).get()?.value ?? null;

function writeMeta(ctx: AppCtx, key: string, value: string | null) {
  if (value === null) return void ctx.db.delete(appMeta).where(eq(appMeta.key, key)).run();
  const updatedAt = Date.now();
  ctx.db
    .insert(appMeta)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({ target: appMeta.key, set: { value, updatedAt } })
    .run();
}

/** Fuso salvo nos ajustes; sem ele, vale o do sistema. */
export const savedTimeZone = (ctx: AppCtx) => readMeta(ctx, KEY.timeZone);

function validZone(zone: string) {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

const settingsInput = z.object({
  name: z.string().trim().max(60).optional(),
  // Vazio volta para o fuso do sistema.
  timeZone: z
    .string()
    .refine((zone) => zone === '' || validZone(zone), 'Fuso horário inválido.')
    .optional(),
});

function writeRecoveryFile(ctx: AppCtx, folder: string) {
  const envelope = readMeta(ctx, KEY.recovery);
  if (envelope) writeFileSync(join(folder, RECOVERY_FILE), envelope, { mode: 0o600 });
}

function issueRecovery(ctx: AppCtx, store: DbStore, folder: string) {
  const password = generatePassword();
  const envelope: RecoveryEnvelope = sealKey(store.keyHex, password);
  writeMeta(ctx, KEY.recovery, JSON.stringify(envelope));
  writeRecoveryFile(ctx, folder);
  return password;
}

/** Depois do banco, que não espera por eles. Devolve o problema, ou null. */
function syncFiles(ctx: AppCtx, store: DbStore, folder: string) {
  const local = join(dirname(store.path), PROJECT_FILES_FOLDER);
  const target = backupFilesFolder(folder, store.keyHex);
  const { absent, failed, lastError } = syncProjectFiles(liveFileHashes(store), local, target, store.keyHex);
  writeMeta(ctx, KEY.filesAbsent, absent ? String(absent) : null);
  return failed ? `${failed} arquivo(s) de projeto ficaram de fora: ${lastError}` : null;
}

function run(ctx: AppCtx, store: DbStore, folder: string, name: string) {
  const result = writeBackup(store, folder, name);
  if (!existsSync(join(folder, RECOVERY_FILE))) writeRecoveryFile(ctx, folder);
  writeMeta(ctx, KEY.lastAt, String(Date.now()));
  writeMeta(ctx, KEY.lastFile, name);
  const problem = syncFiles(ctx, store, folder);
  writeMeta(ctx, KEY.error, problem);
  return { ...result, problem };
}

/** Sem conseguir ler um dos backups guardados, não dá para saber o que ele usa: nada sai. */
function sweepFiles(store: DbStore, folder: string) {
  try {
    const target = backupFilesFolder(folder, store.keyHex);
    const backups = readdirSync(folder).filter(backupDate);
    if (!backups.length || !existsSync(target)) return;
    const keep = new Set(liveFileHashes(store));
    for (const name of backups) {
      for (const hash of backupFileHashes(join(folder, name), store.keyHex)) keep.add(hash);
    }
    sweepBackupFiles(target, keep);
  } catch (error) {
    console.error('[backup] faxina dos arquivos adiada:', (error as Error).message);
  }
}

function assertFolder(folder: string) {
  try {
    accessSync(folder, constants.W_OK);
  } catch {
    throw new AppError(409, `A pasta de backup não está acessível: ${folder}`);
  }
}

/** Fecha o dia: um backup por data, com nova tentativa a cada hora se falhar. */
function runDaily(ctx: AppCtx, store: DbStore) {
  const folder = readMeta(ctx, KEY.folder);
  if (!folder) return;
  const today = todayIn(ctx);
  try {
    assertFolder(folder);
    const problem = existsSync(join(folder, dailyName(today)))
      ? syncFiles(ctx, store, folder)
      : run(ctx, store, folder, dailyName(today)).problem;
    const expired = namesToRotate(readdirSync(folder));
    for (const name of expired) rmSync(join(folder, name));
    if (expired.length) sweepFiles(store, folder);
    if (problem) throw new Error(problem);
    writeMeta(ctx, KEY.error, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeMeta(ctx, KEY.error, message);
    if (readMeta(ctx, KEY.errorDay) !== today) {
      writeMeta(ctx, KEY.errorDay, today);
      ctx.notify('Backup do Sektor', 'O backup de hoje falhou. Veja em Ajustes.');
    }
  }
}

function listFiles(folder: string) {
  try {
    return readdirSync(folder)
      .flatMap((name) => {
        const date = backupDate(name);
        return date ? [{ name, date, bytes: statSync(join(folder, name)).size }] : [];
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  } catch {
    return [];
  }
}

/** Escolher a pasta passa pelo main, que abre o diálogo: a tela não dita caminho nenhum. */
export function chooseFolder(ctx: AppCtx, store: DbStore, folder: string) {
  assertFolder(folder);
  writeMeta(ctx, KEY.folder, folder);
  writeRecoveryFile(ctx, folder);
  const recoveryPassword = readMeta(ctx, KEY.recovery) ? null : issueRecovery(ctx, store, folder);
  try {
    run(ctx, store, folder, manualName(todayIn(ctx)));
  } catch (error) {
    // A senha nova só existe nesta resposta: uma falha no backup não pode engoli-la.
    writeMeta(ctx, KEY.error, error instanceof Error ? error.message : String(error));
  }
  return { folder, recoveryPassword };
}

export const handlers = (ctx: AppCtx, store: DbStore, systemTimeZone: string) => ({
  'settings.get': () => {
    const timeZone = readMeta(ctx, KEY.timeZone) ?? '';
    return { name: readMeta(ctx, KEY.name) ?? '', timeZone, systemTimeZone };
  },
  'settings.set': (value: z.input<typeof settingsInput>) => {
    const { name, timeZone } = parse(settingsInput as never, value) as z.output<typeof settingsInput>;
    if (name !== undefined) writeMeta(ctx, KEY.name, name || null);
    if (timeZone !== undefined) {
      writeMeta(ctx, KEY.timeZone, timeZone || null);
      ctx.timeZone = timeZone || systemTimeZone;
    }
  },

  'backup.status': () => {
    const folder = readMeta(ctx, KEY.folder);
    return {
      folder,
      hasRecovery: readMeta(ctx, KEY.recovery) !== null,
      lastAt: Number(readMeta(ctx, KEY.lastAt)) || null,
      lastFile: readMeta(ctx, KEY.lastFile),
      error: readMeta(ctx, KEY.error),
      files: folder ? listFiles(folder) : [],
      projectFiles: folder ? countBackupFiles(backupFilesFolder(folder, store.keyHex)) : 0,
      projectFilesAbsent: Number(readMeta(ctx, KEY.filesAbsent)) || 0,
    };
  },
  'backup.run': () => {
    const folder = readMeta(ctx, KEY.folder);
    if (!folder) throw new AppError(409, 'Escolha a pasta de backup primeiro.');
    assertFolder(folder);
    return run(ctx, store, folder, manualName(todayIn(ctx)));
  },
  /** A senha só aparece nesta resposta. A anterior continua abrindo os envelopes já copiados. */
  'backup.newRecovery': () => {
    const folder = readMeta(ctx, KEY.folder);
    if (!folder) throw new AppError(409, 'Escolha a pasta de backup primeiro.');
    assertFolder(folder);
    return { recoveryPassword: issueRecovery(ctx, store, folder) };
  },
});

export const jobs = (store: DbStore): Job[] => [
  { name: 'backup.daily', everyMs: 60 * 60_000, run: (ctx) => runDaily(ctx, store) },
];
