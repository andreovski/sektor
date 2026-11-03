import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

// Cofre dos arquivos de projeto: AES-256-GCM, um nonce por gravação. A chave sai da chave do banco por
// HKDF, então a senha de recuperação vale para os dois. Formato: magia, nonce, tag e o texto cifrado.
// O hash do conteúdo em claro entra como dado autenticado: arquivo trocado de nome é recusado.

export const PROJECT_FILES_FOLDER = 'arquivos-de-projeto';

const EXTENSION = '.sek';
const MAGIC = Buffer.from('SEKTORF1');
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + NONCE_BYTES + TAG_BYTES;
const SEALED_NAME = /^([0-9a-f]{64})\.sek$/;
const OLD_NAME = /^([0-9a-f]{64})(\.[a-z0-9]{1,12})?$/;

const derive = (keyHex: string, label: string, bytes: number) =>
  Buffer.from(hkdfSync('sha256', Buffer.from(keyHex, 'hex'), Buffer.alloc(0), label, bytes));

export const fileKeyOf = (keyHex: string) => derive(keyHex, 'sektor/arquivos-de-projeto/v1', 32);

/** Identifica a chave sem revelar nada dela: separa no backup o que foi cifrado por chaves diferentes. */
export const keyFolderOf = (keyHex: string) =>
  derive(keyHex, 'sektor/arquivos-de-projeto/pasta/v1', 8).toString('hex');

export const hashOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export const sealedNameOf = (hash: string) => `${hash}${EXTENSION}`;
export const hashOfSealedName = (name: string) => SEALED_NAME.exec(name)?.[1] ?? null;

const additionalData = (hash: string) => Buffer.concat([MAGIC, Buffer.from(hash)]);

export function sealFile(key: Buffer, hash: string, plain: Buffer) {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(additionalData(hash));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([MAGIC, nonce, cipher.getAuthTag(), body]);
}

/** Lança se a chave for outra ou se um único byte tiver mudado. */
export function openFile(key: Buffer, hash: string, sealed: Buffer) {
  if (sealed.length < HEADER_BYTES || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Não é um arquivo cifrado do Sektor.');
  }
  const nonce = sealed.subarray(MAGIC.length, MAGIC.length + NONCE_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(additionalData(hash));
  decipher.setAuthTag(sealed.subarray(MAGIC.length + NONCE_BYTES, HEADER_BYTES));
  return Buffer.concat([decipher.update(sealed.subarray(HEADER_BYTES)), decipher.final()]);
}

/** O conteúdo em claro, ou null se o arquivo não existir ou não abrir com esta chave. */
export function tryOpenFile(path: string, key: Buffer, hash: string) {
  try {
    return openFile(key, hash, readFileSync(path));
  } catch {
    return null;
  }
}

/** Grava ao lado e troca pelo nome final: nunca fica um arquivo pela metade com o nome de verdade. */
export function writeAtomic(path: string, bytes: Buffer, check?: (partial: string) => void) {
  mkdirSync(dirname(path), { recursive: true });
  const partial = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(partial, bytes, { mode: 0o600 });
    check?.(partial);
    renameSync(partial, path);
  } finally {
    rmSync(partial, { force: true });
  }
}

/** Cifra e relê antes de o arquivo ganhar o nome final. */
export function writeSealed(path: string, key: Buffer, hash: string, plain: Buffer) {
  writeAtomic(path, sealFile(key, hash, plain), (partial) => {
    if (!tryOpenFile(partial, key, hash)?.equals(plain)) {
      throw new Error('O arquivo cifrado não abriu na conferência.');
    }
  });
}

function hasMagic(path: string) {
  const header = Buffer.alloc(MAGIC.length);
  const fd = openSync(path, 'r');
  try {
    return readSync(fd, header, 0, MAGIC.length, 0) === MAGIC.length && header.equals(MAGIC);
  } finally {
    closeSync(fd);
  }
}

const isPlainCopy = (folder: string, name: string, hash: string) => {
  const path = join(folder, name);
  return !(name === sealedNameOf(hash) && hasMagic(path)) && hashOf(readFileSync(path)) === hash;
};

/** Sobrou em claro de uma versão antiga? A próxima abertura do app cifra. */
export function hasPlainCopy(folder: string, hash: string) {
  try {
    return readdirSync(folder).some(
      (name) => OLD_NAME.exec(name)?.[1] === hash && isPlainCopy(folder, name, hash)
    );
  } catch {
    return false;
  }
}

export interface FileMigration {
  migrated: number;
  failed: number;
  skipped: number;
}

/**
 * Cifra o que ainda está em claro. Só apaga o original depois de reler a cópia cifrada; arquivo cujo
 * conteúdo não bate com o nome fica como está. Pode parar em qualquer ponto e rodar de novo.
 */
export function migrateProjectFiles(folder: string, key: Buffer): FileMigration {
  const result: FileMigration = { migrated: 0, failed: 0, skipped: 0 };
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return result;
  }
  for (const name of names) {
    const path = join(folder, name);
    try {
      // Gravação interrompida: nenhuma linha do banco aponta para ela. A de antes pode estar em claro.
      if (name.endsWith('.tmp')) {
        rmSync(path, { force: true });
        continue;
      }
      const hash = OLD_NAME.exec(name)?.[1];
      if (!hash) continue;
      if (name === sealedNameOf(hash) && hasMagic(path)) continue;
      const plain = readFileSync(path);
      if (hashOf(plain) !== hash) {
        result.skipped += 1;
        continue;
      }
      const target = join(folder, sealedNameOf(hash));
      const done = target !== path && tryOpenFile(target, key, hash)?.equals(plain);
      if (!done) writeSealed(target, key, hash, plain);
      if (target !== path) rmSync(path);
      result.migrated += 1;
    } catch (error) {
      result.failed += 1;
      console.error('[arquivos de projeto]', name, (error as Error).message);
    }
  }
  return result;
}
