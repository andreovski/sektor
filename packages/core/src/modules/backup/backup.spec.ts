import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type App, createApp } from '../../app';
import { LATEST_SCHEMA_VERSION, migrate, openDatabase } from '../../db/client';

import { stageRestore } from './engine';
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
    ).toEqual({ status: 'ok', keyChanged: false });
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
      ).toEqual({ status: 'ok', keyChanged: true });
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
