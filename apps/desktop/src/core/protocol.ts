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
};
export type CoreCommand =
  | CoreInit
  | CoreSmoke
  | CoreBackupFolder
  | CoreStageRestore
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
