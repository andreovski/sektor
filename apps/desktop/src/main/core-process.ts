import { utilityProcess } from 'electron';
import { join } from 'node:path';

import type { CoreCommand, CoreEvent, CoreReply } from '../core/protocol';

export const forkCore = (serviceName: string) =>
  utilityProcess.fork(join(__dirname, 'core.js'), [], { serviceName, stdio: 'inherit' });

type Request<C> = C extends { id: number } ? Omit<C, 'id'> : never;

let nextId = 1;

/** Pergunta com resposta. Rejeita se o núcleo morrer antes de responder. */
export function ask<T>(core: Electron.UtilityProcess, command: Request<CoreCommand>): Promise<T> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onMessage = (event: CoreEvent) => {
      if (event.type !== 'reply' || (event as CoreReply).id !== id) return;
      done();
      if (event.ok) resolve(event.value as T);
      else reject(new Error(event.message));
    };
    const onExit = () => {
      done();
      reject(new Error('O núcleo parou antes de responder.'));
    };
    const done = () => {
      core.off('message', onMessage);
      core.off('exit', onExit);
    };
    core.on('message', onMessage);
    core.on('exit', onExit);
    core.postMessage({ ...command, id } as CoreCommand);
  });
}
