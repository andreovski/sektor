import { app, safeStorage } from 'electron';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Chave do banco e chaves das integrações ficam cifradas pelo cofre do sistema. Só o main as abre.

// Nos testes das telas não há cofre, que abriria um diálogo no Mac. `SEKTOR_TEST_VAULT` simula as
// falhas: `off` é o cofre indisponível, `locked` é o que não abre mais o que foi cifrado.
let plain = false;
export const useTestVault = () => {
  plain = true;
};

function assertVault() {
  const available = plain
    ? process.env.SEKTOR_TEST_VAULT !== 'off'
    : safeStorage.isEncryptionAvailable();
  if (!available) throw new Error('O cofre do sistema não está disponível.');
}

export function seal(text: string): Buffer {
  assertVault();
  return plain ? Buffer.from(text) : safeStorage.encryptString(text);
}

function unseal(data: Buffer): string {
  assertVault();
  if (plain && process.env.SEKTOR_TEST_VAULT === 'locked') {
    throw new Error('O cofre do sistema não abriu a chave.');
  }
  return plain ? data.toString() : safeStorage.decryptString(data);
}

export const keyPath = () => join(app.getPath('userData'), 'database.key');
export const dbPath = () => join(app.getPath('userData'), 'sektor.db');

/** Sem chave e com banco existente nunca cria outra: o banco só abriria com a chave que sumiu. */
export function databaseKey(): string {
  assertVault();
  const path = keyPath();
  if (existsSync(path)) return unseal(readFileSync(path));
  if (existsSync(dbPath())) throw new Error('A chave do banco sumiu da pasta de dados.');
  const key = randomBytes(32).toString('hex');
  writeFileSync(path, seal(key), { mode: 0o600 });
  return key;
}

const secretsPath = () => join(app.getPath('userData'), 'secrets.bin');

export function loadSecrets(): Record<string, string> {
  const path = secretsPath();
  if (!existsSync(path)) return {};
  return JSON.parse(unseal(readFileSync(path)));
}

export function saveSecrets(secrets: Record<string, string>) {
  writeFileSync(secretsPath(), seal(JSON.stringify(secrets)), { mode: 0o600 });
}
