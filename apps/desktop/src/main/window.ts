import { app, BrowserWindow, nativeTheme, shell } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Só em desenvolvimento: no pacote, uma variável de ambiente não escolhe a página do app.
const devUrl = app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL;
const fileUrl = pathToFileURL(join(__dirname, '../renderer/index.html')).href;

/** A página do app, com qualquer hash. É ela, e só ela, que recebe a porta do núcleo. */
export function isAppUrl(url: string) {
  try {
    const parsed = new URL(url);
    if (devUrl) return parsed.origin === new URL(devUrl).origin;
    return parsed.href.split(/[?#]/)[0] === fileUrl;
  } catch {
    return false;
  }
}

/** Os endereços da Pluggy e do Meu Pluggy, que podem abrir a janela de login. */
export function isPluggyUrl(url: string | undefined) {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && (hostname === 'pluggy.ai' || hostname.endsWith('.pluggy.ai'));
  } catch {
    return false;
  }
}

/** A janela de login só anda dentro da Pluggy; o resto vai para o navegador, e nada abre outra. */
function guardPluggyWindow(child: BrowserWindow) {
  child.setMenuBarVisibility(false);
  const keep = (event: Electron.Event, url: string) => {
    if (isPluggyUrl(url) || url === 'about:blank') return;
    logWindowOpen(url, 'bloqueado na janela do Pluggy');
    event.preventDefault();
    if (url.startsWith('https://')) void shell.openExternal(url);
  };
  child.webContents.on('will-navigate', keep);
  child.webContents.on('will-redirect', keep);
  child.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * O login do banco (OAuth) que o widget da Pluggy pede para abrir. Fora do navegador o widget não
 * abre a janela sozinho: avisa a página, e quem abre é o app. A janela é isolada (sem preload) e
 * termina quando chega à página de retorno da Pluggy; os parâmetros dela voltam para o widget.
 */
export function openPluggyOauth(parent: BrowserWindow, url: string): Promise<Record<string, string> | null> {
  logWindowOpen(url, 'login do banco pedido pelo widget');
  return new Promise((resolve) => {
    let settled = false;
    const login = new BrowserWindow({
      parent,
      width: 520,
      height: 760,
      backgroundColor: BACKGROUNDS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
    });
    login.setMenuBarVisibility(false);
    const finish = (result: Record<string, string> | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
      if (!login.isDestroyed()) login.close();
    };
    const check = (target: string) => {
      if (!isPluggyCallback(target)) return false;
      finish(Object.fromEntries(new URL(target).searchParams.entries()));
      return true;
    };
    const watch = (event: Electron.Event, target: string) => {
      if (check(target)) return event.preventDefault();
      if (!target.startsWith('https://')) event.preventDefault();
    };
    login.webContents.on('will-navigate', watch);
    login.webContents.on('will-redirect', watch);
    login.webContents.on('did-navigate', (_event, target) => void check(target));
    login.webContents.setWindowOpenHandler(({ url: next }) => {
      if (next.startsWith('https://')) void shell.openExternal(next);
      return { action: 'deny' };
    });
    login.on('closed', () => finish(null));
    void login.loadURL(url);
  });
}

/** A página de retorno do OAuth da Pluggy, a mesma que o SDK procura no Cordova. */
function isPluggyCallback(url: string) {
  return (
    (url.startsWith('https://api.pluggy.ai/') || url.startsWith('https://api.pluggy.dev/')) &&
    url.includes('/oauthCallback.html')
  );
}

/** Para entender o que o widget tenta abrir: só a origem, nunca o caminho (pode ter token). */
export function logWindowOpen(url: string, where: string) {
  let origin = url;
  try {
    const parsed = new URL(url);
    // about:blank, blob: e data: têm origem "null": vale o esquema.
    origin = parsed.origin === 'null' ? `${parsed.protocol}…` : parsed.origin;
  } catch {
    // fica como veio
  }
  try {
    mkdirSync(app.getPath('logs'), { recursive: true });
    appendFileSync(join(app.getPath('logs'), 'janelas.log'), `${new Date().toISOString()} ${where}: ${origin}\n`);
  } catch {
    // sem log, segue
  }
}

const BACKGROUNDS = { dark: '#0e120e', light: '#f5f6ef' };

/** `system` deixa o macOS decidir, e a página lê o resultado pelo `prefers-color-scheme`. */
export function applyWindowTheme(window: BrowserWindow, theme: 'dark' | 'light' | 'system') {
  nativeTheme.themeSource = theme;
  window.setBackgroundColor(BACKGROUNDS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light']);
}

const noteWindows = new Map<string, BrowserWindow>();

/** A janela do app, sem contar as notas em pop-up. */
export const appWindows = () =>
  BrowserWindow.getAllWindows().filter((window) => ![...noteWindows.values()].includes(window));

export function createWindow(onLoad: (window: BrowserWindow) => void, hidden = false) {
  return buildWindow(
    {
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      titleBarStyle: 'hiddenInset',
    },
    onLoad,
    hidden
  );
}

/**
 * Uma nota numa janelinha sem moldura, por cima de tudo, inclusive de app em tela cheia.
 * Abrir de novo a mesma nota traz a janela que já existe.
 */
export function openNoteWindow(noteId: string, onLoad: (window: BrowserWindow) => void) {
  const open = noteWindows.get(noteId);
  if (open && !open.isDestroyed()) {
    open.show();
    open.focus();
    return open;
  }
  const window = buildWindow(
    {
      width: 380,
      height: 460,
      minWidth: 260,
      minHeight: 180,
      frame: false,
      fullscreenable: false,
      minimizable: false,
      alwaysOnTop: true,
    },
    onLoad,
    false,
    `/nota-fixa/${encodeURIComponent(noteId)}`
  );
  window.setAlwaysOnTop(true, 'floating');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  noteWindows.set(noteId, window);
  window.on('closed', () => noteWindows.delete(noteId));
  return window;
}

function buildWindow(
  options: Electron.BrowserWindowConstructorOptions,
  onLoad: (window: BrowserWindow) => void,
  hidden: boolean,
  route?: string
) {
  const window = new BrowserWindow({
    ...options,
    backgroundColor: BACKGROUNDS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
    },
  });
  if (!hidden) window.once('ready-to-show', () => window.show());
  // Link externo abre no navegador; dentro da janela só o próprio app navega. A exceção é o
  // login do Meu Pluggy: o widget abre uma janela e espera a resposta dela pelo `window.opener`,
  // que o navegador de fora não tem.
  window.webContents.setWindowOpenHandler(({ url, referrer }) => {
    const fromPluggy = isPluggyUrl(referrer.url) || isPluggyUrl(url) || url === 'about:blank';
    logWindowOpen(url, fromPluggy ? 'janela do Pluggy' : 'navegador');
    if (fromPluggy && (url === 'about:blank' || isPluggyUrl(url))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 480,
          height: 720,
          backgroundColor: BACKGROUNDS[nativeTheme.shouldUseDarkColors ? 'dark' : 'light'],
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false },
        },
      };
    }
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('did-create-window', (child) => guardPluggyWindow(child));
  window.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    logWindowOpen(url, 'navegação bloqueada');
    event.preventDefault();
  });
  // O que o widget da Pluggy faz dentro do iframe: navegações e o que a CSP barrou.
  window.webContents.on('did-start-navigation', ({ url, isMainFrame }) => {
    if (!isMainFrame) logWindowOpen(url, 'iframe navegou para');
  });
  window.webContents.on('console-message', ({ message }) => {
    if (/Content Security Policy|Refused to/i.test(message)) {
      const url = /https?:\/\/[^\s'"]+/.exec(message)?.[0] ?? 'sem endereço';
      logWindowOpen(url, 'barrado pela CSP');
    }
  });
  // A cada carga da página, inclusive recarregar: a porta anterior morreu com ela.
  window.webContents.on('did-finish-load', () => {
    if (isAppUrl(window.webContents.getURL())) onLoad(window);
  });
  if (devUrl) void window.loadURL(route ? `${devUrl}#${route}` : devUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'), route ? { hash: route } : {});
  return window;
}
