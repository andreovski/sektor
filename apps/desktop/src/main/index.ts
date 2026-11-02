import { app, BrowserWindow, MessageChannelMain, utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CoreCommand, CoreEvent } from '../core/protocol';

import { databaseKey, loadSecrets, saveSecrets } from './key';
import { createTray, hasOpenWindow, notify } from './tray';

const SMOKE = process.env.SEKTOR_SMOKE === '1';
// Modo de teste das telas: banco temporário e sem cofre, que abriria um diálogo no Mac.
const TEST_DIR = process.env.SEKTOR_TEST_DIR;
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function startCore(
  dbPath: string,
  keyHex: string,
  secrets: Record<string, string>,
  onEvent: (event: CoreEvent) => void
) {
  const core = utilityProcess.fork(join(__dirname, 'core.js'), [], {
    serviceName: 'sektor-core',
    stdio: 'inherit',
  });
  core.on('message', onEvent);
  core.on('exit', (code) => {
    if (code !== 0) onEvent({ type: 'failed', message: `Núcleo saiu com código ${code}.` });
  });
  core.postMessage({ type: 'init', dbPath, keyHex, timeZone, secrets } satisfies CoreCommand);
  return core;
}

function createWindow(core: Electron.UtilityProcess) {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0e120e',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.once('did-finish-load', () => {
    const { port1, port2 } = new MessageChannelMain();
    core.postMessage({ type: 'port' } satisfies CoreCommand, [port1]);
    window.webContents.postMessage('core-port', null, [port2]);
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void window.loadURL(devUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));
}

/** Prova sem janela e sem o cofre, que abre um diálogo no Mac: banco e chave temporários. */
function runSmoke() {
  const dir = mkdtempSync(join(tmpdir(), 'sektor-smoke-'));
  const dbPath = join(dir, 'sektor.db');
  createTray(() => undefined);
  const core = startCore(dbPath, randomBytes(32).toString('hex'), {}, async (event) => {
    if (event.type === 'ready') {
      core.postMessage({
        type: 'smoke',
        wrongKeyHex: randomBytes(32).toString('hex'),
      } satisfies CoreCommand);
    } else {
      const header = Buffer.alloc(16);
      if (event.type === 'smoke-result') readSync(openSync(dbPath, 'r'), header, 0, 16, 0);
      const report = {
        ...event,
        notificationShown: await notify('Sektor', 'Prova de aviso nativo'),
        packaged: app.isPackaged,
        electron: process.versions.electron,
        plainHeader: header.toString('latin1').startsWith('SQLite format 3'),
        bytes: statSync(dbPath, { throwIfNoEntry: false })?.size ?? 0,
      };
      console.log(`SEKTOR_SMOKE ${JSON.stringify(report)}`);
      core.kill();
      rmSync(dir, { recursive: true, force: true });
      app.exit(event.type === 'smoke-result' ? 0 : 1);
    }
  });
}

void app.whenReady().then(() => {
  if (SMOKE) return runSmoke();
  const dbPath = join(TEST_DIR ?? app.getPath('userData'), 'sektor.db');
  const core = startCore(
    dbPath,
    TEST_DIR ? 'd'.repeat(64) : databaseKey(),
    TEST_DIR ? {} : loadSecrets(),
    (event) => {
      if (event.type === 'failed') console.error('[core]', event.message);
      if (event.type === 'secrets' && !TEST_DIR) saveSecrets(event.secrets);
      if (event.type === 'notify') void notify(event.title, event.body);
    }
  );
  const openWindow = () => {
    if (!hasOpenWindow()) createWindow(core);
  };
  createTray(openWindow);
  openWindow();
});

// Fechar a janela deixa o app na bandeja; sair é pelo menu dela.
app.on('window-all-closed', () => undefined);
