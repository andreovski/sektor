import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  fileKeyOf,
  hashOf,
  keyFolderOf,
  migrateProjectFiles,
  openFile,
  sealedNameOf,
  sealFile,
  tryOpenFile,
  writeSealed,
} from './file-vault';

const KEY_HEX = 'a'.repeat(64);
const KEY = fileKeyOf(KEY_HEX);
const OTHER = fileKeyOf('b'.repeat(64));
const SECRET = 'proposta sigilosa da oficina';
const plain = Buffer.from(SECRET);
const hash = hashOf(plain);

describe('cifra dos arquivos', () => {
  it('a chave tem rótulo próprio: não é a do banco nem a pasta do backup', () => {
    expect(KEY.toString('hex')).not.toBe(KEY_HEX);
    expect(KEY).toHaveLength(32);
    expect(keyFolderOf(KEY_HEX)).toMatch(/^[0-9a-f]{16}$/);
    expect(KEY.toString('hex')).not.toContain(keyFolderOf(KEY_HEX));
  });

  it('o texto conhecido não aparece, e o nonce muda a cada gravação', () => {
    const sealed = sealFile(KEY, hash, plain);
    expect(sealed.includes(SECRET)).toBe(false);
    expect(sealed.equals(sealFile(KEY, hash, plain))).toBe(false);
    expect(openFile(KEY, hash, sealed).toString()).toBe(SECRET);
  });

  it('recusa um byte alterado, outra chave e outro nome', () => {
    const sealed = sealFile(KEY, hash, plain);
    for (const at of [0, 10, 25, sealed.length - 1]) {
      const copy = Buffer.from(sealed);
      copy[at]! ^= 1;
      expect(() => openFile(KEY, hash, copy)).toThrow();
    }
    expect(() => openFile(OTHER, hash, sealed)).toThrow();
    expect(() => openFile(KEY, 'f'.repeat(64), sealed)).toThrow();
    expect(() => openFile(KEY, hash, sealed.subarray(0, 20))).toThrow();
  });

  it('arquivo vazio também fecha e abre', () => {
    const empty = Buffer.alloc(0);
    expect(openFile(KEY, hashOf(empty), sealFile(KEY, hashOf(empty), empty))).toHaveLength(0);
  });
});

describe('migração dos arquivos em claro', () => {
  let folder: string;
  const target = () => join(folder, sealedNameOf(hash));
  const old = () => join(folder, `${hash}.pdf`);

  beforeEach(() => {
    folder = join(mkdtempSync(join(tmpdir(), 'sektor-cofre-')), 'arquivos');
    mkdirSync(folder);
  });
  afterEach(() => {
    chmodSync(folder, 0o700);
    rmSync(join(folder, '..'), { recursive: true, force: true });
  });

  it('cifra, apaga o original e, rodando de novo, não faz nada', () => {
    writeFileSync(old(), plain);
    expect(migrateProjectFiles(folder, KEY)).toEqual({ migrated: 1, failed: 0, skipped: 0 });
    expect(readdirSync(folder)).toEqual([sealedNameOf(hash)]);
    expect(readFileSync(target()).includes(SECRET)).toBe(false);
    const before = readFileSync(target());
    expect(migrateProjectFiles(folder, KEY)).toEqual({ migrated: 0, failed: 0, skipped: 0 });
    expect(readFileSync(target())).toEqual(before);
  });

  it('parou depois de cifrar e antes de apagar: termina sem cifrar de novo', () => {
    writeFileSync(old(), plain);
    writeSealed(target(), KEY, hash, plain);
    const before = readFileSync(target());
    expect(migrateProjectFiles(folder, KEY).migrated).toBe(1);
    expect(existsSync(old())).toBe(false);
    expect(readFileSync(target())).toEqual(before);
  });

  it('cifrado danificado ao lado do original: refaz a partir do original', () => {
    writeFileSync(old(), plain);
    writeFileSync(target(), 'pela metade');
    expect(migrateProjectFiles(folder, KEY).migrated).toBe(1);
    expect(existsSync(old())).toBe(false);
    expect(tryOpenFile(target(), KEY, hash)?.toString()).toBe(SECRET);
  });

  it('gravação interrompida some, e o original continua', () => {
    writeFileSync(old(), plain);
    writeFileSync(`${target()}.parte.tmp`, 'xx');
    migrateProjectFiles(folder, KEY);
    expect(readdirSync(folder)).toEqual([sealedNameOf(hash)]);
  });

  it('sem conseguir gravar, o original fica, e a próxima abertura termina', () => {
    writeFileSync(old(), plain);
    chmodSync(folder, 0o500);
    expect(migrateProjectFiles(folder, KEY)).toEqual({ migrated: 0, failed: 1, skipped: 0 });
    expect(readFileSync(old())).toEqual(plain);
    chmodSync(folder, 0o700);
    expect(migrateProjectFiles(folder, KEY).migrated).toBe(1);
  });

  it('conteúdo que não bate com o nome fica como está, e nome estranho nem é lido', () => {
    writeFileSync(old(), 'outro conteúdo');
    writeFileSync(join(folder, 'anotacao.txt'), 'minha');
    expect(migrateProjectFiles(folder, KEY)).toEqual({ migrated: 0, failed: 0, skipped: 1 });
    expect(readdirSync(folder).sort()).toEqual([`${hash}.pdf`, 'anotacao.txt'].sort());
  });

  it('dois originais do mesmo conteúdo viram um só, e .sek antigo em claro é cifrado', () => {
    writeFileSync(old(), plain);
    writeFileSync(join(folder, `${hash}.txt`), plain);
    expect(migrateProjectFiles(folder, KEY).failed).toBe(0);
    expect(readdirSync(folder)).toEqual([sealedNameOf(hash)]);

    rmSync(target());
    writeFileSync(target(), plain);
    expect(migrateProjectFiles(folder, KEY).migrated).toBe(1);
    expect(tryOpenFile(target(), KEY, hash)?.toString()).toBe(SECRET);
  });

  it('pasta que não existe não é erro', () => {
    expect(migrateProjectFiles(join(folder, 'nada'), KEY).migrated).toBe(0);
  });
});
