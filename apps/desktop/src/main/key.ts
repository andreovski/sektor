import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A chave do banco fica cifrada pelo cofre do sistema, e só o main a abre. */
export function databaseKey(): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('O cofre do sistema não está disponível.');
  }
  const path = join(app.getPath('userData'), 'database.key');
  if (existsSync(path)) return safeStorage.decryptString(readFileSync(path));
  const key = randomBytes(32).toString('hex');
  writeFileSync(path, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}
