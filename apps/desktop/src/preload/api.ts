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

export interface QuickCaptureSettings {
  enabled: boolean;
  /** No formato de acelerador do Electron, como `Alt+Space`. */
  accelerator: string;
  /** O atalho está registrado agora (falso se outro app ficou com ele). */
  active: boolean;
  openAtLogin: boolean;
}

export type QuickCaptureResult = { ok: true } | { ok: false; message: string };

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
  setTheme(theme: 'dark' | 'light' | 'system'): Promise<void>;
  pickProjectFiles(projectId: string): Promise<ProjectFilesResult>;
  addProjectFile(projectId: string, name: string, bytes: ArrayBuffer): Promise<ProjectFilesResult>;
  /** Devolve a mensagem de erro, ou nulo se abriu. */
  openProjectFile(id: string): Promise<string | null>;
  removeProjectFile(id: string): Promise<string | null>;
  /** Abre o navegador e espera a volta. `hint` sugere a conta. */
  googleLogin(hint?: string): Promise<GoogleLoginResult>;
  googleCancelLogin(): Promise<void>;
  /** Abre a nota numa janelinha por cima de tudo, ou traz a que já está aberta. */
  popOutNote(noteId: string): Promise<void>;
  /** Fecha a janela de onde veio o pedido (o pop-up da nota, que não tem moldura). */
  closeWindow(): Promise<void>;
  /** O campo da Início aberto pelo atalho global, por cima de qualquer app. */
  quickCapture: {
    settings(): Promise<QuickCaptureSettings>;
    setEnabled(enabled: boolean): Promise<QuickCaptureResult>;
    setShortcut(accelerator: string): Promise<QuickCaptureResult>;
    /** Desliga o atalho atual enquanto Ajustes grava um novo. */
    pause(paused: boolean): Promise<void>;
    hide(): Promise<void>;
    /** A altura do campo, para a janela acompanhar. */
    resize(height: number): Promise<void>;
    /** Fecha a captura e abre o app nessa rota. */
    openInApp(route: string): Promise<void>;
    onShown(listener: () => void): void;
  };
  setOpenAtLogin(open: boolean): Promise<void>;
  /** O main pede para a janela principal ir a uma rota (vindo da captura rápida). */
  onNavigate(listener: (route: string) => void): void;
  /** Abre o login do banco pedido pelo widget da Pluggy; devolve os parâmetros da volta, ou nulo. */
  pluggyOauth(url: string): Promise<Record<string, string> | null>;
  /** Abre no navegador o link que o widget pede (o site do Meu Pluggy, por exemplo). */
  pluggyOpenLink(url: string): Promise<void>;
  /** Anota no registro o tipo de cada mensagem do widget (sem o conteúdo). */
  pluggyLog(text: string): Promise<void>;
}

declare global {
  interface Window {
    sektor: SektorApi;
  }
}
