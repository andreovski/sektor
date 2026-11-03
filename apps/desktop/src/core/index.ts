import { type App, appMeta, AppError, createApp, openDatabase, stageRestore } from '@sektor/core';
import {
  addProjectFile,
  orphanProjectFiles,
  projectFileToOpen,
  removeProjectFile,
} from '@sektor/core';
import { eq } from 'drizzle-orm';
import { mkdtempSync, openSync, readdirSync, readSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type {
  CoreCommand,
  CoreEvent,
  CoreGoogleConnect,
  CoreReply,
  RpcRequest,
  RpcResponse,
} from './protocol';

// Núcleo do app: único processo que abre o banco e fala com a rede.
const parent = process.parentPort;
const MINUTE = 60_000;
let app: App | null = null;
let dbPath = '';
let dbKey = '';

// Vêm de `.env.local` em tempo de build. Só existem aqui e no main, nunca na tela.
const GOOGLE =
  __GOOGLE_CLIENT_ID__ && __GOOGLE_CLIENT_SECRET__
    ? { clientId: __GOOGLE_CLIENT_ID__, clientSecret: __GOOGLE_CLIENT_SECRET__ }
    : null;

const emit = (event: CoreEvent) => parent.postMessage(event);

const tick = () => {
  app?.tick().catch((error) => console.error('[tick]', error));
};

function init(command: Extract<CoreCommand, { type: 'init' }>) {
  dbPath = command.dbPath;
  dbKey = command.keyHex;
  const secrets = { ...command.secrets };
  app = createApp({
    dbPath,
    keyHex: command.keyHex,
    timeZone: command.timeZone,
    secrets: {
      get: (name) => secrets[name] ?? null,
      set(name, value) {
        if (value === null) delete secrets[name];
        else secrets[name] = value;
        emit({ type: 'secrets', secrets });
      },
    },
    notify: (title, body) => emit({ type: 'notify', title, body }),
    google: GOOGLE,
  });
  emit({ type: 'ready' });
  tick();
  app.syncGoogle().catch((error) => console.error('[google]', (error as Error).message));
  setInterval(tick, MINUTE);
}

/** Backup de verdade no pacote: sai cifrado e volta com a senha, em outra chave. */
function smokeBackup(otherKeyHex: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sektor-smoke-backup-'));
  try {
    const { recoveryPassword } = app!.chooseBackupFolder(dir);
    const file = join(dir, readdirSync(dir).find((name) => name.endsWith('.db'))!);
    const header = Buffer.alloc(15);
    readSync(openSync(file, 'r'), header, 0, 15, 0);
    const restored = stageRestore({
      file,
      stagePath: join(dir, 'stage'),
      currentKeyHex: otherKeyHex,
      targetKeyHex: otherKeyHex,
      password: recoveryPassword!,
    });
    return {
      backupCiphered: header.toString('latin1') !== 'SQLite format 3',
      backupRestored: restored.status,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function smoke(wrongKeyHex: string) {
  const { orm, raw } = app!.handle;
  const wrote = `prova-${Date.now()}`;
  orm
    .insert(appMeta)
    .values({ key: 'smoke', value: wrote, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: wrote, updatedAt: Date.now() } })
    .run();
  const read = orm.select().from(appMeta).where(eq(appMeta.key, 'smoke')).get();
  let wrongKeyRefused = false;
  try {
    openDatabase(dbPath, wrongKeyHex).raw.close();
  } catch {
    wrongKeyRefused = true;
  }
  // O WAL vai para o arquivo principal, que é o que o main confere.
  raw.pragma('wal_checkpoint(TRUNCATE)');
  emit({
    type: 'smoke-result',
    wrote,
    read: read?.value ?? null,
    wrongKeyRefused,
    ...smokeBackup(wrongKeyHex),
  });
}

function serve(port: Electron.MessagePortMain) {
  port.on('message', (event) => {
    const { id, method, input } = event.data as RpcRequest;
    const answer = app
      ? app.call(method, input)
      : Promise.resolve({ ok: false as const, status: 503, message: 'O banco não abriu.' });
    void answer.then((result) => {
      port.postMessage({ id, result } satisfies RpcResponse);
    });
  });
  port.start();
}

function reply(id: number, run: () => unknown) {
  let answer: CoreReply;
  try {
    answer = { type: 'reply', id, ok: true, value: run() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    answer = { type: 'reply', id, ok: false, message };
  }
  emit(answer);
}

function connectGoogle({ id, code, verifier, redirectUri }: CoreGoogleConnect) {
  app!.connectGoogle({ code, verifier, redirectUri }).then(
    (value) => emit({ type: 'reply', id, ok: true, value }),
    (error) => {
      if (!(error instanceof AppError)) console.error('[google]', (error as Error).message);
      const message = error instanceof AppError ? error.message : 'Algo deu errado. Tente de novo.';
      emit({ type: 'reply', id, ok: false, message });
    }
  );
}

parent.on('message', (event) => {
  const command = event.data as CoreCommand;
  try {
    if (command.type === 'init') init(command);
    else if (command.type === 'smoke') smoke(command.wrongKeyHex);
    else if (command.type === 'backup-folder') {
      reply(command.id, () => app!.chooseBackupFolder(command.folder));
    } else if (command.type === 'google-connect') {
      connectGoogle(command);
    } else if (command.type === 'project-file-add') {
      const { id, type: _type, ...body } = command;
      reply(id, () => addProjectFile(app!.ctx, body));
    } else if (command.type === 'project-file-find') {
      reply(command.id, () => projectFileToOpen(app!.ctx, command.fileId));
    } else if (command.type === 'project-file-remove') {
      reply(command.id, () => removeProjectFile(app!.ctx, command.fileId));
    } else if (command.type === 'project-file-orphans') {
      reply(command.id, () => orphanProjectFiles(app!.ctx));
    } else if (command.type === 'stage-restore') {
      const { id, type: _type, ...options } = command;
      reply(id, () => stageRestore(options));
    } else if (event.ports[0]) serve(event.ports[0]);
  } catch (error) {
    emit({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
});
