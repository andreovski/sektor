import { appMeta, type DbHandle, openDatabase } from '@sektor/core';
import { eq } from 'drizzle-orm';

import type { CoreCommand, CoreEvent, RpcRequest, RpcResponse } from './protocol';

// Núcleo do app: único processo que abre o banco e fala com a rede.
const parent = process.parentPort;
let db: DbHandle | null = null;
let dbPath = '';

const emit = (event: CoreEvent) => parent.postMessage(event);

function bumpOpens(handle: DbHandle): number {
  const row = handle.orm.select().from(appMeta).where(eq(appMeta.key, 'opens')).get();
  const opens = Number(row?.value ?? 0) + 1;
  handle.orm
    .insert(appMeta)
    .values({ key: 'opens', value: String(opens), updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: appMeta.key,
      set: { value: String(opens), updatedAt: Date.now() },
    })
    .run();
  return opens;
}

function smoke(wrongKeyHex: string) {
  const handle = db!;
  const wrote = `prova-${Date.now()}`;
  handle.orm
    .insert(appMeta)
    .values({ key: 'smoke', value: wrote, updatedAt: Date.now() })
    .onConflictDoUpdate({ target: appMeta.key, set: { value: wrote, updatedAt: Date.now() } })
    .run();
  const read = handle.orm.select().from(appMeta).where(eq(appMeta.key, 'smoke')).get();
  let wrongKeyRefused = false;
  try {
    openDatabase(dbPath, wrongKeyHex).raw.close();
  } catch {
    wrongKeyRefused = true;
  }
  // Fecha para o WAL ir ao arquivo principal, que é o que o main confere.
  handle.raw.pragma('wal_checkpoint(TRUNCATE)');
  emit({ type: 'smoke-result', wrote, read: read?.value ?? null, wrongKeyRefused });
}

function serve(port: Electron.MessagePortMain) {
  port.on('message', (event) => {
    const { id } = event.data as RpcRequest;
    const dbVersion = db!.raw.pragma('user_version', { simple: true }) as number;
    const opens = Number(
      db!.orm.select().from(appMeta).where(eq(appMeta.key, 'opens')).get()?.value ?? 0
    );
    port.postMessage({ id, result: { dbVersion, opens } } satisfies RpcResponse);
  });
  port.start();
}

parent.on('message', (event) => {
  const command = event.data as CoreCommand;
  try {
    if (command.type === 'init') {
      dbPath = command.dbPath;
      db = openDatabase(command.dbPath, command.keyHex);
      bumpOpens(db);
      emit({ type: 'ready' });
    } else if (command.type === 'smoke') {
      smoke(command.wrongKeyHex);
    } else if (event.ports[0]) {
      serve(event.ports[0]);
    }
  } catch (error) {
    emit({ type: 'failed', message: error instanceof Error ? error.message : String(error) });
  }
});
