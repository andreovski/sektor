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
  | { status: 'ok'; missingFiles: number }
  | { status: 'needs-password' }
  | { status: 'error'; message: string };

export type GoogleLoginResult =
  | { status: 'ok'; email: string }
  | { status: 'canceled' | 'denied' | 'timeout' | 'not-configured' }
  | { status: 'error'; message: string };

export type ProjectFilesResult = { added: number; errors: string[] };

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
  pickProjectFiles(projectId: string): Promise<ProjectFilesResult>;
  addProjectFile(projectId: string, name: string, bytes: ArrayBuffer): Promise<ProjectFilesResult>;
  /** Devolve a mensagem de erro, ou nulo se abriu. */
  openProjectFile(id: string): Promise<string | null>;
  removeProjectFile(id: string): Promise<string | null>;
  /** Abre o navegador e espera a volta. `hint` sugere a conta. */
  googleLogin(hint?: string): Promise<GoogleLoginResult>;
  googleCancelLogin(): Promise<void>;
}

declare global {
  interface Window {
    sektor: SektorApi;
  }
}
