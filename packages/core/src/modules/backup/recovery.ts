import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

// Senha de recuperação: cifra uma cópia da chave do banco, que fica ao lado dos backups. É a única
// saída quando o cofre do sistema some, e a senha nunca é gravada em lugar nenhum.

export const RECOVERY_FILE = 'sektor-recuperacao.json';

const FORMAT = 'sektor-recuperacao';
const AAD = Buffer.from(`${FORMAT}-v1`);
const SCRYPT = { N: 32768, r: 8, p: 1 };
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface RecoveryEnvelope {
  format: typeof FORMAT;
  version: 1;
  scrypt: typeof SCRYPT;
  salt: string;
  iv: string;
  tag: string;
  data: string;
}

/** 24 símbolos de 32 possíveis, 120 bits: quem achar o arquivo não adivinha por força bruta. */
export function generatePassword() {
  const symbols = [...randomBytes(24)].map((byte) => ALPHABET[byte & 31]);
  return symbols.join('').replace(/(.{4})(?=.)/g, '$1-');
}

/** Tolera minúsculas, espaços e as letras que se confundem com números. */
const normalize = (password: string) =>
  password
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replaceAll('O', '0')
    .replace(/[IL]/g, '1');

const derive = (password: string, salt: Buffer, params: typeof SCRYPT) =>
  scryptSync(normalize(password), salt, 32, { ...params, maxmem: 128 * params.N * params.r * 2 });

export function sealKey(keyHex: string, password: string): RecoveryEnvelope {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', derive(password, salt, SCRYPT), iv);
  cipher.setAAD(AAD);
  const data = Buffer.concat([cipher.update(keyHex, 'utf8'), cipher.final()]);
  return {
    format: FORMAT,
    version: 1,
    scrypt: SCRYPT,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

/** Devolve a chave, ou null se a senha estiver errada ou o arquivo não for o nosso. */
export function openKey(envelope: RecoveryEnvelope, password: string): string | null {
  try {
    if (envelope.format !== FORMAT || envelope.version !== 1) return null;
    const { N, r, p } = envelope.scrypt;
    if (N > 2 ** 20 || r > 16 || p > 4) return null;
    const key = derive(password, Buffer.from(envelope.salt, 'base64'), { N, r, p });
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const data = Buffer.from(envelope.data, 'base64');
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
