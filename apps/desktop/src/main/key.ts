import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Chave do banco e chaves das integrações ficam cifradas pelo cofre do sistema. Só o main as abre.

function assertVault() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('O cofre do sistema não está disponível.');
  }
}

export function databaseKey(): string {
  assertVault();
  const path = join(app.getPath('userData'), 'database.key');
  if (existsSync(path)) return safeStorage.decryptString(readFileSync(path));
  const key = randomBytes(32).toString('hex');
  writeFileSync(path, safeStorage.encryptString(key), { mode: 0o600 });
  return key;
}

const secretsPath = () => join(app.getPath('userData'), 'secrets.bin');

export function loadSecrets(): Record<string, string> {
  const path = secretsPath();
  if (!existsSync(path)) return {};
  assertVault();
  return JSON.parse(safeStorage.decryptString(readFileSync(path)));
}

export function saveSecrets(secrets: Record<string, string>) {
  assertVault();
  writeFileSync(secretsPath(), safeStorage.encryptString(JSON.stringify(secrets)), { mode: 0o600 });
}
