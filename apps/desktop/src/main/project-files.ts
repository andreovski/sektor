import { PROJECT_FILE_MAX_BYTES } from '@sektor/core/src/modules/projects/contract';
import {
  hashOf,
  migrateProjectFiles,
  PROJECT_FILES_FOLDER,
  sealedNameOf,
  tryOpenFile,
  writeSealed,
} from '@sektor/core/src/modules/projects/file-vault';
import { type BrowserWindow, dialog, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

import type { ProjectFilesResult } from '../preload/api';

import { ask } from './core-process';

type Core = () => Electron.UtilityProcess;

const LIMIT_MB = PROJECT_FILE_MAX_BYTES / (1024 * 1024);
const OPENED_FOLDER = 'arquivos-abertos';
// O programa que abriu pode reler o arquivo depois de receber o caminho: a cópia fica um tempo.
const OPENED_COPY_MS = 30 * 60_000;

// Abrir estes roda código, e a cópia perde a marca de "baixado da internet" que faria o Mac perguntar.
const RUNS_CODE =
  /^\.(app|applescript|bat|cmd|com|command|dmg|exe|jar|js|mpkg|msi|pkg|ps1|py|rb|scpt|sh|terminal|tool|workflow)$/;

const runsCode = (name: string) =>
  RUNS_CODE.test(extname(name.replace(/[.\s]+$/, '')).toLowerCase());

const cleanName = (name: string) => {
  const clean = basename(name.replace(/\\/g, '/')).trim().slice(0, 255);
  return clean && clean !== '.' && clean !== '..' ? clean : 'arquivo';
};

const tooBig = (name: string) => `${name} passa de ${LIMIT_MB} MB.`;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Roda ao abrir e ao sair: nada decifrado sobrevive ao app, nem depois de uma queda. */
export function clearOpenedCopies(dataDir: string) {
  try {
    rmSync(join(dataDir, OPENED_FOLDER), { recursive: true, force: true });
  } catch (error) {
    console.error('[arquivos de projeto]', error);
  }
}

export function projectFileChannels(
  dataDir: () => string,
  core: Core,
  fileKey: () => Buffer,
  openedCopyMs = OPENED_COPY_MS
) {
  const folder = () => join(dataDir(), PROJECT_FILES_FOLDER);

  /** A cópia vem antes da linha no banco; se o banco recusar, cópia nova não fica para trás. */
  async function store(projectId: string, rawName: string, bytes: Buffer) {
    const name = cleanName(rawName);
    if (bytes.length > PROJECT_FILE_MAX_BYTES) throw new Error(tooBig(name));
    const contentHash = hashOf(bytes);
    const storedName = sealedNameOf(contentHash);
    const target = join(folder(), storedName);
    // Sobra de outra chave tem o mesmo nome e não abre: é regravada.
    const isNew = !tryOpenFile(target, fileKey(), contentHash);
    if (isNew) writeSealed(target, fileKey(), contentHash, bytes);
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

  /** Decifra numa pasta só nossa, somente leitura: editar ali não pareceria salvar no projeto. */
  async function openedCopy(name: string, plain: Buffer) {
    const root = join(dataDir(), OPENED_FOLDER);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const dir = join(root, randomUUID());
    await mkdir(dir, { mode: 0o700 });
    const path = join(dir, cleanName(name));
    await writeFile(path, plain, { mode: 0o400 });
    setTimeout(() => void rm(dir, { recursive: true, force: true }), openedCopyMs).unref();
    return path;
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
        const { storedName, name } = await ask<{ storedName: string; name: string }>(core(), {
          type: 'project-file-find',
          fileId: id,
        });
        const hash = storedName.slice(0, 64);
        const sealed = join(folder(), sealedNameOf(hash));
        // A migração da abertura pode ter falhado neste arquivo: tenta de novo antes de desistir.
        if (!existsSync(sealed)) migrateProjectFiles(folder(), fileKey());
        if (!existsSync(sealed)) return 'Este arquivo não está mais neste computador.';
        const plain = tryOpenFile(sealed, fileKey(), hash);
        if (!plain) return 'Este arquivo foi alterado ou danificado e não pode ser aberto.';
        const path = await openedCopy(name, plain);
        if (runsCode(name)) {
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
      orphans.map((name) => rm(join(dataDir(), PROJECT_FILES_FOLDER, basename(name)), { force: true }))
    );
  } catch (error) {
    console.error('[arquivos de projeto]', error);
  }
}
