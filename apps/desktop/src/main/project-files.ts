import { PROJECT_FILE_MAX_BYTES } from '@sektor/core/src/modules/projects/contract';
import { type BrowserWindow, dialog, shell } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import type { ProjectFilesResult } from '../preload/api';

import { ask } from './core-process';

type Core = () => Electron.UtilityProcess;

const LIMIT_MB = PROJECT_FILE_MAX_BYTES / (1024 * 1024);
const FOLDER = 'arquivos-de-projeto';

// Abrir estes roda código, e a cópia perde a marca de "baixado da internet" que faria o Mac perguntar.
const RUNS_CODE =
  /^\.(app|applescript|bat|cmd|com|command|dmg|exe|jar|js|mpkg|msi|pkg|ps1|py|rb|scpt|sh|terminal|tool|workflow)$/;

export const storedNameOf = (hash: string, name: string) => {
  const extension = extname(name).toLowerCase();
  return hash + (/^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '');
};

const cleanName = (name: string) =>
  basename(name.replace(/\\/g, '/')).trim().slice(0, 255) || 'arquivo';

const tooBig = (name: string) => `${name} passa de ${LIMIT_MB} MB.`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function projectFileChannels(dataDir: () => string, core: Core) {
  const folder = () => join(dataDir(), FOLDER);

  /** A cópia vem antes da linha no banco; se o banco recusar, cópia nova não fica para trás. */
  async function store(projectId: string, rawName: string, bytes: Buffer) {
    const name = cleanName(rawName);
    if (bytes.length > PROJECT_FILE_MAX_BYTES) throw new Error(tooBig(name));
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const storedName = storedNameOf(contentHash, name);
    const target = join(folder(), storedName);
    const isNew = !existsSync(target);
    if (isNew) {
      await mkdir(folder(), { recursive: true });
      const partial = `${target}.${randomUUID()}.tmp`;
      await writeFile(partial, bytes);
      await rename(partial, target);
    }
    try {
      await ask(core(), {
        type: 'project-file-add',
        projectId,
        name,
        sizeBytes: bytes.length,
        contentHash,
        storedName,
      });
    } catch (error) {
      if (isNew) await rm(target, { force: true });
      throw error;
    }
  }

  async function storeAll(jobs: { name: string; run(): Promise<void> }[]) {
    const result: ProjectFilesResult = { added: 0, errors: [] };
    for (const job of jobs) {
      try {
        await job.run();
        result.added += 1;
      } catch (error) {
        result.errors.push(messageOf(error));
      }
    }
    return result;
  }

  return {
    async pick(window: BrowserWindow, projectId: string) {
      const { canceled, filePaths } = await dialog.showOpenDialog(window, {
        title: 'Anexar ao projeto',
        buttonLabel: 'Anexar',
        properties: ['openFile', 'multiSelections'],
      });
      if (canceled) return { added: 0, errors: [] };
      return storeAll(
        filePaths.map((path) => ({
          name: basename(path),
          async run() {
            if ((await stat(path)).size > PROJECT_FILE_MAX_BYTES) {
              throw new Error(tooBig(basename(path)));
            }
            await store(projectId, basename(path), await readFile(path));
          },
        }))
      );
    },

    /** Arquivo solto na tela: a página manda o conteúdo, e nenhum caminho do disco passa por ela. */
    add(input: { projectId: string; name: string; bytes: ArrayBuffer }) {
      return storeAll([
        {
          name: input.name,
          run() {
            if (!(input.bytes instanceof ArrayBuffer) || typeof input.name !== 'string') {
              throw new Error('Arquivo inválido.');
            }
            return store(input.projectId, input.name, Buffer.from(input.bytes));
          },
        },
      ]);
    },

    async open(id: string): Promise<string | null> {
      try {
        const storedName = await ask<string>(core(), { type: 'project-file-find', fileId: id });
        const path = join(folder(), basename(storedName));
        if (!existsSync(path)) return 'Este arquivo não está mais neste computador.';
        if (RUNS_CODE.test(extname(path))) {
          shell.showItemInFolder(path);
          return null;
        }
        return (await shell.openPath(path)) || null;
      } catch (error) {
        return messageOf(error);
      }
    },

    async remove(id: string): Promise<string | null> {
      try {
        await ask(core(), { type: 'project-file-remove', fileId: id });
        await sweepProjectFiles(dataDir, core);
        return null;
      } catch (error) {
        return messageOf(error);
      }
    },
  };
}

/** Tira da pasta as cópias que só linhas apagadas usam. Roda ao remover e ao abrir o app. */
export async function sweepProjectFiles(dataDir: () => string, core: Core) {
  try {
    const orphans = await ask<string[]>(core(), { type: 'project-file-orphans' });
    await Promise.all(
      orphans.map((name) => rm(join(dataDir(), FOLDER, basename(name)), { force: true }))
    );
  } catch (error) {
    console.error('[arquivos de projeto]', error);
  }
}
