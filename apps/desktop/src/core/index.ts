import { type App, appMeta, createApp, openDatabase } from '@sektor/core';
import { eq } from 'drizzle-orm';

import type { CoreCommand, CoreEvent, RpcRequest, RpcResponse } from './protocol';

// Núcleo do app: único processo que abre o banco e fala com a rede.
const parent = process.parentPort;
const MINUTE = 60_000;
let app: App | null = null;
let dbPath = '';

const emit = (event: CoreEvent) => parent.postMessage(event);

function init(command: Extract<CoreCommand, { type: 'init' }>) {
  dbPath = command.dbPath;
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
  });
  emit({ type: 'ready' });
  void app.tick();
  setInterval(() => void app?.tick(), MINUTE);
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
  emit({ type: 'smoke-result', wrote, read: read?.value ?? null, wrongKeyRefused });
}

function serve(port: Electron.MessagePortMain) {
  port.on('message', (event) => {
    const { id, method, input } = event.data as RpcRequest;
    void app!.call(method, input).then((result) => {
      port.postMessage({ id, result } satisfies RpcResponse);
    });
  });
  port.start();
}

parent.on('message', (event) => {
  const command = event.data as CoreCommand;
  try {
    if (command.type === 'init') init(command);
    else if (command.type === 'smoke') smoke(command.wrongKeyHex);
    else if (event.ports[0]) serve(event.ports[0]);
  } catch (error) {
    emit({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
});
