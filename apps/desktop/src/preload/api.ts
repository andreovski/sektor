/** O que a página enxerga do main. Nada de Node: só estas funções, em `window.sektor`. */
export interface CoreFailure {
  kind: 'vault' | 'database' | 'core';
  message: string;
  dataDir: string;
}

export type FolderChoice =
  | { canceled: true }
  | { canceled: false; folder: string; recoveryPassword: string | null };

export type RestoreResult =
  | { status: 'ok' }
  | { status: 'needs-password' }
  | { status: 'error'; message: string };

export interface SektorApi {
  info(): Promise<{ version: string; dataDir: string }>;
  failure(): Promise<CoreFailure | null>;
  onFailure(listener: (failure: CoreFailure) => void): void;
  pickBackupFolder(): Promise<FolderChoice>;
  /** O caminho fica no main; a página só recebe o nome para mostrar. */
  pickRestoreFile(): Promise<string | null>;
  restore(password?: string): Promise<RestoreResult>;
  openDataDir(): Promise<void>;
  relaunch(): Promise<void>;
}

declare global {
  interface Window {
    sektor: SektorApi;
  }
}
