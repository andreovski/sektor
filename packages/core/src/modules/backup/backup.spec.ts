import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App, createApp } from '../../app';
import { LATEST_SCHEMA_VERSION, migrate, openDatabase } from '../../db/client';

import { addFile, removeFile } from '../projects/service';
import { fileKeyOf, hashOf, sealedNameOf, tryOpenFile, writeSealed } from '../projects/file-vault';

import { stageRestore } from './engine';
import { backupFilesFolder } from './files';
import { generatePassword, openKey, RECOVERY_FILE, sealKey } from './recovery';
import { dailyName, namesToRotate } from './rotation';

const KEY = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);
const shiftDay = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe('rotação', () => {
  it('depois de meses sobram 7 diários e 4 semanais, e o manual fica', () => {
    let names = ['sektor-2026-01-01-manual-101010.db', 'sektor-recuperacao.json'];
    let day = '2026-01-01';
    for (let i = 0; i < 120; i++) {
      names.push(dailyName(day));
      const gone = namesToRotate(names);
      names = names.filter((name) => !gone.includes(name));
      day = shiftDay(day, 1);
    }
    const last = shiftDay(day, -1);
    const daily = names.filter((name) => /^sektor-\d{4}-\d{2}-\d{2}\.db$/.test(name));
    expect(daily).toHaveLength(11);
    expect(names).toContain(dailyName(last));
    expect(names).toContain('sektor-2026-01-01-manual-101010.db');
    const old = daily.sort().slice(0, 4).map((n) => new Date(n.slice(7, 17)).getUTCDay());
    expect(old).toEqual([0, 0, 0, 0]);
  });
});

describe('senha de recuperação', () => {
  it('abre com a senha, com digitação relaxada, e recusa outra', () => {
    const password = generatePassword();
    expect(password).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){5}[0-9A-HJKMNP-TV-Z]{4}$/);
    const envelope = sealKey(KEY, password);
    expect(JSON.stringify(envelope)).not.toContain(KEY);
    expect(openKey(envelope, password)).toBe(KEY);
    expect(openKey(envelope, ` ${password.toLowerCase().replaceAll('-', ' ')} `)).toBe(KEY);
    expect(openKey(envelope, generatePassword())).toBeNull();
    expect(openKey({ ...envelope, data: 'AAAA' }, password)).toBeNull();
  });
});

describe('backup', () => {
  let dir: string;
  let folder: string;
  let app: App;
  const notes: string[] = [];

  const start = (name = 'sektor.db', keyHex = KEY) =>
    createApp({
      dbPath: join(dir, name),
      keyHex,
      timeZone: 'America/Sao_Paulo',
      secrets: { get: () => null, set: () => undefined },
      notify: (title) => notes.push(title),
    });
  const value = async (method: string, input?: unknown) => {
    const result = await app.call(method, input);
    if (!result.ok) throw new Error(result.message);
    return result.value as never;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sektor-backup-'));
    folder = join(dir, 'pasta');
    mkdirSync(folder);
    app = start();
    notes.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    app.handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const firstFile = () => join(folder, readdirSync(folder).find((name) => name.endsWith('.db'))!);

  it('escolher a pasta faz o primeiro backup, cifrado, e dá a senha uma vez', () => {
    const { recoveryPassword } = app.chooseBackupFolder(folder);
    expect(recoveryPassword).toBeTruthy();
    expect(app.chooseBackupFolder(folder).recoveryPassword).toBeNull();
    const bytes = readFileSync(firstFile());
    expect(bytes.subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    expect(() => openDatabase(firstFile(), OTHER)).toThrow();
    const copy = join(dir, 'copia.db');
    copyFileSync(firstFile(), copy);
    const opened = openDatabase(copy, KEY);
    expect(opened.raw.prepare('SELECT count(*) AS n FROM app_meta').get()).toBeTruthy();
    opened.raw.close();
    expect(readFileSync(join(folder, RECOVERY_FILE), 'utf8')).not.toContain(recoveryPassword!);
    expect(readdirSync(folder).some((name) => name.endsWith('.parcial'))).toBe(false);
  });

  it('o job faz um backup por dia e apaga o que saiu da rotação', async () => {
    app.chooseBackupFolder(folder);
    writeFileSync(join(folder, 'sektor-2020-01-01.db'), 'velho');
    for (let i = 2; i <= 9; i++) writeFileSync(join(folder, `sektor-2030-01-0${i}.db`), 'x');
    await app.tick();
    expect(readdirSync(folder)).not.toContain('sektor-2030-01-02.db');
    expect(readdirSync(folder)).toContain('sektor-2030-01-09.db');
  });

  it('pasta que sumiu vira erro na tela e um aviso por dia', async () => {
    app.chooseBackupFolder(folder);
    rmSync(folder, { recursive: true });
    await app.tick();
    await app.tick();
    const status: { error: string } = await value('backup.status');
    expect(status.error).toContain('não está acessível');
    expect(notes).toEqual(['Backup do Sektor']);
    await expect(value('backup.run')).rejects.toThrow('não está acessível');
  });

  it('restaura na mesma máquina sem senha', async () => {
    app.chooseBackupFolder(folder);
    const stagePath = join(dir, 'stage.db');
    const before = readFileSync(firstFile());
    expect(
      stageRestore({ file: firstFile(), stagePath, currentKeyHex: KEY, targetKeyHex: KEY })
    ).toEqual({ status: 'ok', keyChanged: false, missingFiles: 0 });
    expect(readFileSync(firstFile())).toEqual(before);
    const opened = openDatabase(stagePath, KEY);
    opened.raw.close();
  });

  it('restaura em outra máquina com a senha, e sem o cofre', async () => {
    await value('settings.set', { name: 'André' });
    const { recoveryPassword } = app.chooseBackupFolder(folder);
    const file = firstFile();
    const stagePath = join(dir, 'stage.db');
    const base = { file, stagePath, targetKeyHex: OTHER };

    for (const currentKeyHex of [OTHER, null]) {
      expect(stageRestore({ ...base, currentKeyHex })).toEqual({ status: 'needs-password' });
      expect(existsSync(stagePath)).toBe(false);
      expect(
        stageRestore({ ...base, currentKeyHex, password: generatePassword() })
      ).toMatchObject({ status: 'error', message: 'Senha de recuperação incorreta.' });
      expect(
        stageRestore({ ...base, currentKeyHex, password: recoveryPassword! })
      ).toEqual({ status: 'ok', keyChanged: true, missingFiles: 0 });
    }
    expect(() => openDatabase(stagePath, KEY)).toThrow();
    const restored = openDatabase(stagePath, OTHER);
    const rows = restored.raw.prepare('SELECT key FROM app_meta').all() as { key: string }[];
    expect(rows.map((row) => row.key)).toContain('settings.name');
    expect(rows.filter((row) => row.key.startsWith('backup.'))).toEqual([]);
    restored.raw.close();
  });

  it('recusa arquivo que não é backup e backup de versão mais nova', async () => {
    app.chooseBackupFolder(folder);
    const stagePath = join(dir, 'stage.db');
    const file = firstFile();
    const junk = join(folder, 'lixo.db');
    writeFileSync(junk, 'não é banco'.repeat(1000));
    const password = 'senha';
    expect(
      stageRestore({ file: junk, stagePath, currentKeyHex: KEY, targetKeyHex: KEY, password })
    ).toMatchObject({ status: 'error' });

    const copy = join(dir, 'nova.db');
    copyFileSync(file, copy);
    const newer = openDatabase(copy, KEY);
    newer.raw.pragma(`user_version = ${LATEST_SCHEMA_VERSION + 1}`);
    newer.raw.close();
    expect(
      stageRestore({ file: copy, stagePath, currentKeyHex: KEY, targetKeyHex: KEY })
    ).toMatchObject({ status: 'error', message: expect.stringContaining('mais nova') });
    expect(existsSync(stagePath)).toBe(false);
  });

  it('copia o banco antes de migrar, e só quando há o que migrar', () => {
    const { raw } = app.handle;
    const version = raw.pragma('user_version', { simple: true }) as number;
    const path = join(dir, 'sektor.db');
    migrate(raw, path);
    expect(existsSync(join(dir, 'antes-da-migracao'))).toBe(false);
    migrate(raw, path, [{ version: version + 1, sql: 'CREATE TABLE nova (x)' }]);
    const [copy] = readdirSync(join(dir, 'antes-da-migracao'));
    expect(copy).toMatch(new RegExp(`^sektor-v${version}-\\d+\\.db$`));
    const file = join(dir, 'antes-da-migracao', copy!);
    expect(readFileSync(file).subarray(0, 15).toString('latin1')).not.toBe('SQLite format 3');
    const old = openDatabase(file, KEY);
    expect(old.raw.prepare(`SELECT 1 FROM sqlite_master WHERE name = 'nova'`).get()).toBeUndefined();
    old.raw.close();
  });

  it('ajustes: nome e fuso valem na hora e sobrevivem ao reabrir', async () => {
    await expect(value('settings.set', { timeZone: 'Lua/Base' })).rejects.toThrow();
    await value('settings.set', { name: ' André ', timeZone: 'Asia/Tokyo' });
    expect(app.ctx.timeZone).toBe('Asia/Tokyo');
    app.handle.raw.close();
    app = start();
    expect(app.ctx.timeZone).toBe('Asia/Tokyo');
    expect(await value('settings.get')).toEqual({
      name: 'André',
      timeZone: 'Asia/Tokyo',
      systemTimeZone: 'America/Sao_Paulo',
    });
    await value('settings.set', { timeZone: '' });
    expect(app.ctx.timeZone).toBe('America/Sao_Paulo');
  });
});

describe('arquivos de projeto no backup', () => {
  let dir: string;
  let folder: string;
  let app: App;
  let projectId: string;
  const local = () => join(dir, 'arquivos-de-projeto');
  const copies = () => backupFilesFolder(folder, KEY);
  const fileKey = fileKeyOf(KEY);

  const call = async (method: string, input?: unknown) => {
    const result = await app.call(method, input);
    if (!result.ok) throw new Error(result.message);
    return result.value as never;
  };

  function attach(text: string) {
    const bytes = Buffer.from(text);
    const contentHash = hashOf(bytes);
    writeSealed(join(local(), sealedNameOf(contentHash)), fileKey, contentHash, bytes);
    return addFile(app.ctx, {
      projectId,
      name: `${text}.txt`,
      sizeBytes: bytes.length,
      contentHash,
      storedName: sealedNameOf(contentHash),
    }).id;
  }
  const copyOf = (text: string) => join(copies(), sealedNameOf(hashOf(Buffer.from(text))));

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sektor-backup-arquivos-'));
    folder = join(dir, 'pasta');
    mkdirSync(folder);
    app = createApp({
      dbPath: join(dir, 'sektor.db'),
      keyHex: KEY,
      timeZone: 'America/Sao_Paulo',
      secrets: { get: () => null, set: () => undefined },
      notify: () => undefined,
    });
    const project: { id: string } = await call('projects.create', { name: 'Oficina' });
    projectId = project.id;
  });
  afterEach(() => {
    app.handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const lastBackup = () =>
    join(folder, readdirSync(folder).filter((name) => name.endsWith('.db')).sort().at(-1)!);

  it('copia cifrado, e só o que falta', async () => {
    attach('contrato sigiloso');
    app.chooseBackupFolder(folder);
    const first = copyOf('contrato sigiloso');
    expect(readFileSync(first).includes('contrato sigiloso')).toBe(false);
    expect(readFileSync(first)).toEqual(readFileSync(join(local(), first.split('/').at(-1)!)));

    const old = new Date('2020-01-01T00:00:00Z');
    utimesSync(first, old, old);
    attach('segundo');
    await call('backup.run');
    expect(statSync(first).mtime).toEqual(old);
    expect(existsSync(copyOf('segundo'))).toBe(true);
    const status: { projectFiles: number; error: string | null } = await call('backup.status');
    expect(status).toMatchObject({ projectFiles: 2, error: null });
  });

  it('o job de cada hora completa o que entrou depois do backup do dia', async () => {
    app.chooseBackupFolder(folder);
    await app.tick();
    attach('à tarde');
    app.handle.raw.prepare(`DELETE FROM app_meta WHERE key = 'job:backup.daily'`).run();
    await app.tick();
    expect(existsSync(copyOf('à tarde'))).toBe(true);
  });

  it('arquivo adulterado aqui não vai para o backup, e o banco sai assim mesmo', async () => {
    attach('bom');
    const hash = hashOf(Buffer.from('bom'));
    const path = join(local(), sealedNameOf(hash));
    const bytes = readFileSync(path);
    bytes[bytes.length - 1]! ^= 1;
    writeFileSync(path, bytes);
    app.chooseBackupFolder(folder);
    expect(existsSync(copyOf('bom'))).toBe(false);
    expect(readdirSync(folder).some((name) => name.endsWith('.db'))).toBe(true);
    const status: { error: string } = await call('backup.status');
    expect(status.error).toContain('1 arquivo(s) de projeto');
  });

  it('arquivo que sumiu daqui aparece no status, sem virar erro', async () => {
    attach('sumiu');
    rmSync(join(local(), sealedNameOf(hashOf(Buffer.from('sumiu')))));
    app.chooseBackupFolder(folder);
    const status: { error: string | null; projectFilesAbsent: number } = await call('backup.status');
    expect(status).toMatchObject({ error: null, projectFilesAbsent: 1 });
  });

  describe('rotação', () => {
    /** Dois backups no mesmo segundo são o mesmo arquivo: sobra só o mais novo. */
    const keepOnlyLatest = () => {
      const latest = lastBackup();
      for (const name of readdirSync(folder)) {
        if (name.endsWith('.db') && join(folder, name) !== latest) rmSync(join(folder, name));
      }
    };
    const rotate = async (junk?: string) => {
      const source = lastBackup();
      for (let i = 1; i <= 9; i++) copyFileSync(source, join(folder, `sektor-2030-01-0${i}.db`));
      if (junk) writeFileSync(join(folder, junk), 'de outra chave');
      app.handle.raw.prepare(`DELETE FROM app_meta WHERE key = 'job:backup.daily'`).run();
      await app.tick();
    };

    it('arquivo apagado fica enquanto um backup guardado o referencia', async () => {
      const id = attach('retido');
      app.chooseBackupFolder(folder);
      removeFile(app.ctx, id);
      await rotate();
      expect(existsSync(copyOf('retido'))).toBe(true);
    });

    it('sem backup nenhum que o use, sai; o que está em uso fica', async () => {
      const gone = attach('fora');
      attach('fica');
      app.chooseBackupFolder(folder);
      expect(existsSync(copyOf('fora'))).toBe(true);
      removeFile(app.ctx, gone);
      await call('backup.run');
      keepOnlyLatest();
      await rotate();
      expect(existsSync(copyOf('fora'))).toBe(false);
      expect(existsSync(copyOf('fica'))).toBe(true);
    });

    it('um backup que não abre segura a faxina', async () => {
      const id = attach('fora');
      app.chooseBackupFolder(folder);
      removeFile(app.ctx, id);
      await call('backup.run');
      keepOnlyLatest();
      await rotate('sektor-2029-01-01-manual-101010.db');
      expect(existsSync(copyOf('fora'))).toBe(true);
    });
  });

  describe('restauração', () => {
    const stage = (overrides = {}) => {
      const files = { local: join(dir, 'nova-local'), staged: join(dir, 'preparados') };
      return {
        files,
        result: stageRestore({
          file: lastBackup(),
          stagePath: join(dir, 'stage.db'),
          currentKeyHex: KEY,
          targetKeyHex: KEY,
          files,
          ...overrides,
        }),
      };
    };

    it('em outra máquina, recifra com a chave nova', () => {
      attach('do contrato');
      const { recoveryPassword } = app.chooseBackupFolder(folder);
      const { result, files } = stage({
        currentKeyHex: OTHER,
        targetKeyHex: OTHER,
        password: recoveryPassword,
      });
      expect(result).toEqual({ status: 'ok', keyChanged: true, missingFiles: 0 });
      const hash = hashOf(Buffer.from('do contrato'));
      const staged = join(files.staged, sealedNameOf(hash));
      expect(readFileSync(staged).includes('do contrato')).toBe(false);
      expect(tryOpenFile(staged, fileKeyOf(OTHER), hash)?.toString()).toBe('do contrato');
      expect(tryOpenFile(staged, fileKey, hash)).toBeNull();
    });

    it('na mesma máquina: o que já está aqui nem é tocado, e o que saiu volta do backup', () => {
      attach('aqui');
      attach('apagado daqui');
      app.chooseBackupFolder(folder);
      rmSync(join(local(), sealedNameOf(hashOf(Buffer.from('apagado daqui')))));
      const { result } = stage({ files: { local: local(), staged: join(dir, 'preparados') } });
      expect(result).toEqual({ status: 'ok', keyChanged: false, missingFiles: 0 });
      expect(readdirSync(join(dir, 'preparados'))).toEqual([
        sealedNameOf(hashOf(Buffer.from('apagado daqui'))),
      ]);
    });

    it('cofre perdido: o que só existe aqui é recifrado, com a chave que a senha trouxe', () => {
      attach('só aqui');
      const { recoveryPassword } = app.chooseBackupFolder(folder);
      rmSync(copyOf('só aqui'));
      const staged = join(dir, 'preparados');
      const { result } = stage({
        currentKeyHex: null,
        targetKeyHex: OTHER,
        password: recoveryPassword,
        files: { local: local(), staged },
      });
      expect(result).toMatchObject({ status: 'ok', missingFiles: 0 });
      const hash = hashOf(Buffer.from('só aqui'));
      expect(tryOpenFile(join(staged, sealedNameOf(hash)), fileKeyOf(OTHER), hash)).toBeTruthy();
    });

    it('arquivo faltando ou adulterado não impede o banco: conta', () => {
      attach('um');
      attach('dois');
      attach('três');
      app.chooseBackupFolder(folder);
      rmSync(copyOf('um'));
      const bytes = readFileSync(copyOf('dois'));
      bytes[bytes.length - 1]! ^= 1;
      writeFileSync(copyOf('dois'), bytes);
      const { result } = stage();
      expect(result).toEqual({ status: 'ok', keyChanged: false, missingFiles: 2 });
      const restored = openDatabase(join(dir, 'stage.db'), KEY);
      restored.raw.close();
    });

    it('backup antigo, sem a subpasta: tudo conta como faltando, sem erro', () => {
      attach('antigo');
      app.chooseBackupFolder(folder);
      rmSync(join(folder, 'arquivos-de-projeto'), { recursive: true });
      expect(stage().result).toMatchObject({ status: 'ok', missingFiles: 1 });
    });

    it('cópia em claro de antes da migração não conta como faltando', () => {
      attach('em claro');
      app.chooseBackupFolder(folder);
      const hash = hashOf(Buffer.from('em claro'));
      rmSync(join(local(), sealedNameOf(hash)));
      rmSync(copyOf('em claro'));
      writeFileSync(join(local(), `${hash}.txt`), 'em claro');
      const { result } = stage({ files: { local: local(), staged: join(dir, 'preparados') } });
      expect(result).toMatchObject({ status: 'ok', missingFiles: 0 });
    });

    it('recusa de restauração não deixa preparados para trás', () => {
      attach('x');
      app.chooseBackupFolder(folder);
      const { result } = stage({ currentKeyHex: OTHER, targetKeyHex: OTHER });
      expect(result.status).toBe('needs-password');
      expect(existsSync(join(dir, 'preparados'))).toBe(false);
    });
  });
});

describe('tick', () => {
  it('job de 60 s roda a cada tick, com o relógio oscilando para menos', async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-18T15:00:00Z') });
    const dir = mkdtempSync(join(tmpdir(), 'sektor-tick-'));
    const app = createApp({
      dbPath: join(dir, 't.db'),
      keyHex: KEY,
      timeZone: 'UTC',
      secrets: { get: () => null, set: () => undefined },
      notify: () => undefined,
    });
    await app.tick();
    const read = () =>
      Number(
        (
          app.handle.raw.prepare(`SELECT value FROM app_meta WHERE key = 'job:reminders'`).get() as {
            value: string;
          }
        ).value
      );
    for (let i = 0; i < 5; i++) {
      const before = read();
      vi.setSystemTime(Date.now() + 59_900);
      await app.tick();
      expect(read()).toBeGreaterThan(before);
    }
    const before = read();
    vi.setSystemTime(Date.now() + 30_000);
    await app.tick();
    expect(read()).toBe(before);
    vi.useRealTimers();
    app.handle.raw.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
