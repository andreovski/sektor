import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  fileKeyOf,
  hashOfSealedName,
  hasPlainCopy,
  keyFolderOf,
  openFile,
  PROJECT_FILES_FOLDER,
  sealedNameOf,
  tryOpenFile,
  writeAtomic,
  writeSealed,
} from '../projects/file-vault';

// Uma subpasta por chave: quem restaura em outra máquina volta a fazer backup com outra chave, e o
// mesmo hash cifrado de outro jeito não pode tomar o lugar do arquivo que os backups antigos usam.
export const backupFilesFolder = (folder: string, keyHex: string) =>
  join(folder, PROJECT_FILES_FOLDER, keyFolderOf(keyHex));

export interface FileSync {
  copied: number;
  /** Em uso no banco, mas fora desta máquina: não há o que copiar. */
  absent: number;
  failed: number;
  lastError: string | null;
}

/** Copia o que falta, já cifrado. Mesmo hash e mesmo tamanho não são lidos de novo. */
export function syncProjectFiles(hashes: string[], local: string, target: string, keyHex: string) {
  const key = fileKeyOf(keyHex);
  const result: FileSync = { copied: 0, absent: 0, failed: 0, lastError: null };
  for (const hash of hashes) {
    const name = sealedNameOf(hash);
    const source = join(local, name);
    const copy = join(target, name);
    try {
      if (!existsSync(source)) {
        result.absent += 1;
      } else if (!existsSync(copy) || statSync(copy).size !== statSync(source).size) {
        const bytes = readFileSync(source);
        openFile(key, hash, bytes);
        writeAtomic(copy, bytes);
        result.copied += 1;
      }
    } catch (error) {
      result.failed += 1;
      result.lastError = (error as Error).message;
    }
  }
  return result;
}

/** Quantos arquivos há nesta pasta, para a tela. */
export function countBackupFiles(target: string) {
  try {
    return readdirSync(target).filter((name) => hashOfSealedName(name)).length;
  } catch {
    return 0;
  }
}

/** Tira só o que nenhum backup guardado e nenhuma linha viva usa. */
export function sweepBackupFiles(target: string, keep: Set<string>) {
  let removed = 0;
  for (const name of readdirSync(target)) {
    const hash = hashOfSealedName(name);
    if (hash ? keep.has(hash) : !name.endsWith('.tmp')) continue;
    rmSync(join(target, name), { force: true });
    if (hash) removed += 1;
  }
  return removed;
}

export interface StageFiles {
  hashes: string[];
  /** Pasta dos arquivos desta máquina. */
  local: string;
  /** Onde ficam os preparados, até o main trocá-los no próximo início. */
  staged: string;
  backupFolder: string;
  sourceKeyHex: string;
  targetKeyHex: string;
}

function stageOne(hash: string, options: StageFiles) {
  const { local, staged, backupFolder, sourceKeyHex, targetKeyHex } = options;
  const name = sealedNameOf(hash);
  const targetKey = fileKeyOf(targetKeyHex);
  if (tryOpenFile(join(local, name), targetKey, hash) || hasPlainCopy(local, hash)) return true;
  const sourceKey = fileKeyOf(sourceKeyHex);
  const places = [join(backupFilesFolder(backupFolder, sourceKeyHex), name), join(local, name)];
  for (const place of places) {
    const plain = tryOpenFile(place, sourceKey, hash);
    if (!plain) continue;
    writeSealed(join(staged, name), targetKey, hash, plain);
    return true;
  }
  return false;
}

/** Prepara os arquivos com a chave desta máquina e devolve quantos faltaram. Falta não impede nada. */
export function stageProjectFiles(options: StageFiles) {
  rmSync(options.staged, { recursive: true, force: true });
  mkdirSync(options.staged, { recursive: true });
  let missing = 0;
  for (const hash of options.hashes) {
    try {
      if (!stageOne(hash, options)) missing += 1;
    } catch {
      missing += 1;
    }
  }
  return missing;
}
