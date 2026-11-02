import { app, BrowserWindow, MessageChannelMain, utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CoreCommand, CoreEvent } from '../core/protocol';

import { databaseKey } from './key';

const SMOKE = process.env.SEKTOR_SMOKE === '1';

function startCore(dbPath: string, keyHex: string, onEvent: (event: CoreEvent) => void) {
  const core = utilityProcess.fork(join(__dirname, 'core.js'), [], {
    serviceName: 'sektor-core',
    stdio: 'inherit',
  });
  core.on('message', onEvent);
  core.on('exit', (code) => {
    if (code !== 0) onEvent({ type: 'failed', message: `Núcleo saiu com código ${code}.` });
  });
  core.postMessage({ type: 'init', dbPath, keyHex } satisfies CoreCommand);
  return core;
}

function createWindow(core: Electron.UtilityProcess) {
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
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
  const core = startCore(dbPath, randomBytes(32).toString('hex'), (event) => {
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
  const dbPath = join(app.getPath('userData'), 'sektor.db');
  const core = startCore(dbPath, databaseKey(), (event) => {
    if (event.type === 'failed') console.error('[core]', event.message);
  });
  createWindow(core);
});

app.on('window-all-closed', () => app.quit());
