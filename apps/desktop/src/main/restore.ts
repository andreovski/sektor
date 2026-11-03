import { app } from 'electron';
import { PROJECT_FILES_FOLDER } from '@sektor/core/src/modules/projects/file-vault';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { dbPath, keyPath } from './key';

// A troca do banco só acontece no início seguinte, antes de o núcleo abrir qualquer coisa. O que
// estava em uso vai para `antes-da-restauracao`: nada é apagado.

type Marker = { sealedKey: string | null };

const dataPath = (name: string) => join(app.getPath('userData'), name);
const markerPath = () => dataPath('restauracao-pendente.json');
export const stagePath = () => dataPath('sektor.restaurando.db');
export const filesPath = () => dataPath(PROJECT_FILES_FOLDER);
export const stagedFilesPath = () => dataPath('arquivos-restaurando');

export function scheduleRestore(sealedKey: Buffer | null) {
  const marker: Marker = { sealedKey: sealedKey?.toString('base64') ?? null };
  writeFileSync(markerPath(), JSON.stringify(marker), { mode: 0o600 });
}

/** Chave nova: nada cifrado pela antiga abre mais, e o que vale foi preparado à parte. O em claro fica. */
function setAsideSealedFiles(keep: string) {
  if (!existsSync(filesPath())) return;
  const sealed = readdirSync(filesPath()).filter((name) => name.endsWith('.sek'));
  if (sealed.length) mkdirSync(keep, { recursive: true });
  for (const name of sealed) renameSync(join(filesPath(), name), join(keep, name));
}

function moveStagedFiles() {
  if (!existsSync(stagedFilesPath())) return;
  mkdirSync(filesPath(), { recursive: true });
  for (const name of readdirSync(stagedFilesPath())) {
    renameSync(join(stagedFilesPath(), name), join(filesPath(), name));
  }
  rmSync(stagedFilesPath(), { recursive: true, force: true });
}

export function applyPendingRestore() {
  if (!existsSync(markerPath())) return;
  const marker = JSON.parse(readFileSync(markerPath(), 'utf8')) as Marker;
  if (existsSync(stagePath())) {
    const keep = dataPath('antes-da-restauracao');
    mkdirSync(keep, { recursive: true });
    const stamp = Date.now();
    for (const suffix of ['', '-wal', '-shm']) {
      const path = `${dbPath()}${suffix}`;
      if (existsSync(path)) renameSync(path, join(keep, `sektor-${stamp}.db${suffix}`));
    }
    if (marker.sealedKey) {
      if (existsSync(keyPath())) renameSync(keyPath(), join(keep, `database-${stamp}.key`));
      writeFileSync(keyPath(), Buffer.from(marker.sealedKey, 'base64'), { mode: 0o600 });
      setAsideSealedFiles(join(keep, `arquivos-${stamp}`));
    }
    renameSync(stagePath(), dbPath());
  }
  moveStagedFiles();
  rmSync(markerPath());
}
