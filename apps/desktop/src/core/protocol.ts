import type { RpcResult, StageResult } from '@sektor/core';

/** Mensagens entre main e núcleo. A chave do banco nunca vai por argumento ou ambiente. */
export type CoreInit = {
  type: 'init';
  dbPath: string;
  keyHex: string;
  timeZone: string;
  secrets: Record<string, string>;
};
export type CoreSmoke = { type: 'smoke'; wrongKeyHex: string };
/** Só com o núcleo do app aberto. */
export type CoreBackupFolder = { type: 'backup-folder'; id: number; folder: string };
/** Roda num núcleo auxiliar: funciona mesmo com o banco atual sem abrir. */
export type CoreStageRestore = {
  type: 'stage-restore';
  id: number;
  file: string;
  stagePath: string;
  currentKeyHex: string | null;
  targetKeyHex: string;
  password?: string;
  files: { local: string; staged: string };
};
/** O fim do login do Google: o código vem do servidor local do main, nunca da tela. */
export type CoreGoogleConnect = {
  type: 'google-connect';
  id: number;
  code: string;
  verifier: string;
  redirectUri: string;
};
/** A pasta dos arquivos de projeto é do main; quem sabe o que está em uso é o banco. */
export type CoreProjectFile =
  | {
      type: 'project-file-add';
      id: number;
      projectId: string;
      name: string;
      sizeBytes: number;
      contentHash: string;
      storedName: string;
    }
  | { type: 'project-file-find'; id: number; fileId: string }
  | { type: 'project-file-remove'; id: number; fileId: string }
  | { type: 'project-file-orphans'; id: number };
export type CoreCommand =
  | CoreInit
  | CoreProjectFile
  | CoreSmoke
  | CoreBackupFolder
  | CoreStageRestore
  | CoreGoogleConnect
  | { type: 'port' };

export type CoreReply<T = unknown> = {
  type: 'reply';
  id: number;
} & ({ ok: true; value: T } | { ok: false; message: string });

export type SmokeResult = {
  type: 'smoke-result';
  wrote: string;
  read: string | null;
  wrongKeyRefused: boolean;
  backupCiphered: boolean;
  backupRestored: StageResult['status'];
};

export type CoreEvent =
  | { type: 'ready' }
  | { type: 'failed'; message: string }
  | { type: 'secrets'; secrets: Record<string, string> }
  | { type: 'notify'; title: string; body: string }
  | CoreReply
  | SmokeResult;

export type RpcRequest = { id: number; method: string; input: unknown };
export type RpcResponse = { id: number; result: RpcResult };
