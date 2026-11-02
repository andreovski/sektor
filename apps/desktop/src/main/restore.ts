import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { dbPath, keyPath } from './key';

// A troca do banco só acontece no início seguinte, antes de o núcleo abrir qualquer coisa. O que
// estava em uso vai para `antes-da-restauracao`: nada é apagado.

type Marker = { sealedKey: string | null };

const dataPath = (name: string) => join(app.getPath('userData'), name);
const markerPath = () => dataPath('restauracao-pendente.json');
export const stagePath = () => dataPath('sektor.restaurando.db');

export function scheduleRestore(sealedKey: Buffer | null) {
  const marker: Marker = { sealedKey: sealedKey?.toString('base64') ?? null };
  writeFileSync(markerPath(), JSON.stringify(marker), { mode: 0o600 });
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
    }
    renameSync(stagePath(), dbPath());
  }
  rmSync(markerPath());
}
