import { app, BrowserWindow, nativeTheme, shell } from 'electron';
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

const BACKGROUNDS = { dark: '#0e120e', light: '#f5f6ef' };

export function applyWindowTheme(window: BrowserWindow, theme: keyof typeof BACKGROUNDS) {
  nativeTheme.themeSource = theme;
  window.setBackgroundColor(BACKGROUNDS[theme]);
}

export function createWindow(onLoad: (window: BrowserWindow) => void, hidden = false) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: BACKGROUNDS.dark,
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
  // Link externo abre no navegador; dentro da janela só o próprio app navega.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault();
  });
  // A cada carga da página, inclusive recarregar: a porta anterior morreu com ela.
  window.webContents.on('did-finish-load', () => {
    if (isAppUrl(window.webContents.getURL())) onLoad(window);
  });
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));
  return window;
}
