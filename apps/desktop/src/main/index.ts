import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
  Menu,
  MessageChannelMain,
  shell,
} from 'electron';
import {
  fileKeyOf,
  migrateProjectFiles,
  openFile,
  sealFile,
} from '@sektor/core/src/modules/projects/file-vault';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CoreCommand, CoreEvent } from '../core/protocol';
import type { CoreFailure, FolderChoice, RestoreResult } from '../preload/api';

import { ask, forkCore } from './core-process';
import { cancelGoogleLogin, googleLogin } from './google-login';
import { databaseKey, dbPath, loadSecrets, saveSecrets, seal, useTestVault } from './key';
import { setAppMenu } from './menu';
import { clearOpenedCopies, projectFileChannels, sweepProjectFiles } from './project-files';
import { applyPendingRestore, filesPath, scheduleRestore, stagedFilesPath, stagePath } from './restore';
import {
  hideQuickCapture,
  pauseQuickCapture,
  quickCaptureSettings,
  resizeQuickCapture,
  setQuickCaptureEnabled,
  setQuickCaptureShortcut,
  startQuickCapture,
} from './quick-capture';
import { createTray, hasOpenWindow, notify } from './tray';
import { appWindows, applyWindowTheme, createWindow, isAppUrl, logWindowOpen, openNoteWindow, openPluggyOauth } from './window';

// O smoke é a prova do pacote: roda sempre em pasta e banco temporários, sem o cofre.
const SMOKE = process.env.SEKTOR_SMOKE === '1';
const smokeDir = SMOKE ? mkdtempSync(join(tmpdir(), 'sektor-smoke-')) : null;
// Modo de teste das telas: dados temporários e sem cofre. No pacote, a variável não vale nada.
const TEST_DIR = app.isPackaged ? undefined : process.env.SEKTOR_TEST_DIR;
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

if (smokeDir) app.setPath('userData', join(smokeDir, 'electron'));
if (TEST_DIR) {
  useTestVault();
  app.setPath('userData', TEST_DIR);
}

let core: Electron.UtilityProcess | null = null;
let failure: CoreFailure | null = null;
let quitting = false;
let restoreFile: string | null = null;
let fileKey: Buffer | null = null;

const dataDir = () => app.getPath('userData');

function fail(kind: CoreFailure['kind'], message: string) {
  console.error('[sektor]', kind, message);
  if (failure) return;
  failure = { kind, message, dataDir: dataDir() };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('core-failed', failure);
  }
}

function startCore(
  path: string,
  keyHex: string,
  secrets: Record<string, string>,
  onEvent: (event: CoreEvent) => void
) {
  const started = forkCore('sektor-core');
  started.on('message', onEvent);
  started.on('exit', (code) => {
    if (quitting) return;
    if (!SMOKE) fail('core', `O núcleo do Sektor parou (código ${code}).`);
    else onEvent({ type: 'failed', message: `Núcleo saiu com código ${code}.` });
  });
  started.postMessage({ type: 'init', dbPath: path, keyHex, timeZone, secrets } satisfies CoreCommand);
  return started;
}

function givePort(window: BrowserWindow) {
  if (!core || failure) return;
  const { port1, port2 } = new MessageChannelMain();
  core.postMessage({ type: 'port' } satisfies CoreCommand, [port1]);
  window.webContents.postMessage('core-port', null, [port2]);
}

function openWindow() {
  if (!hasOpenWindow()) return void createWindow(givePort);
  const [window] = appWindows();
  if (window!.isMinimized()) window!.restore();
  window!.show();
  window!.focus();
}

/** Abre o app numa tela, vindo da captura rápida: a tarefa, a nota ou a conversa. */
function openAppAt(route: string) {
  hideQuickCapture();
  if (!hasOpenWindow()) {
    let sent = false;
    createWindow((window) => {
      givePort(window);
      if (!sent) window.webContents.send('app:navigate', route);
      sent = true;
    });
  } else {
    openWindow();
    appWindows()[0]!.webContents.send('app:navigate', route);
  }
  // O painel não ativa o app; quem vai para a frente agora é a janela principal.
  app.focus({ steal: true });
}

function restart() {
  quitting = true;
  // O Playwright não acompanha um processo novo: o teste abre o app de novo.
  if (!TEST_DIR) app.relaunch();
  app.exit(0);
}

async function runRestore(password?: string): Promise<RestoreResult> {
  if (!restoreFile) return { status: 'error', message: 'Escolha o arquivo de backup primeiro.' };
  let currentKeyHex: string | null;
  try {
    currentKeyHex = databaseKey();
  } catch {
    currentKeyHex = null;
  }
  const targetKeyHex = currentKeyHex ?? randomBytes(32).toString('hex');
  let sealedKey: Buffer | null = null;
  try {
    if (!currentKeyHex) sealedKey = seal(targetKeyHex);
  } catch (error) {
    return { status: 'error', message: `Sem cofre não há onde guardar a chave. ${(error as Error).message}` };
  }
  // Núcleo à parte: o do app pode nem ter subido, e a cópia não mexe no banco em uso.
  const helper = forkCore('sektor-restauracao');
  try {
    const result = await ask<RestoreResult>(helper, {
      type: 'stage-restore',
      file: restoreFile,
      stagePath: stagePath(),
      currentKeyHex,
      targetKeyHex,
      password,
      files: { local: filesPath(), staged: stagedFilesPath() },
    });
    if (result.status !== 'ok') return result;
    scheduleRestore(sealedKey);
    // Com arquivo faltando, a tela avisa antes; quem reinicia é o botão dela.
    if (!result.missingFiles) setImmediate(restart);
    return { status: 'ok', missingFiles: result.missingFiles };
  } catch (error) {
    return { status: 'error', message: (error as Error).message };
  } finally {
    helper.kill();
  }
}

function liveCore() {
  if (!core || failure) throw new Error('O núcleo não está no ar.');
  return core;
}

function liveFileKey() {
  if (!fileKey) throw new Error('A chave dos arquivos não está disponível.');
  return fileKey;
}

/** Nos testes das telas dá para encurtar a vida da cópia aberta. */
const openedCopyMs = Number(TEST_DIR && process.env.SEKTOR_TEST_OPEN_MS) || undefined;

/** Cifra e abre no pacote: a mesma conta que o main faz com os arquivos de verdade. */
function vaultProof() {
  const key = fileKeyOf(randomBytes(32).toString('hex'));
  const sealed = sealFile(key, 'prova', Buffer.from('conteúdo'));
  const tampered = Buffer.from(sealed);
  tampered[tampered.length - 1]! ^= 1;
  let refused = false;
  try {
    openFile(key, 'prova', tampered);
  } catch {
    refused = true;
  }
  return refused && openFile(key, 'prova', sealed).toString() === 'conteúdo';
}

function registerIpc() {
  const handle = <A, R>(channel: string, run: (event: IpcMainInvokeEvent, arg: A) => R) => {
    ipcMain.handle(channel, (event, arg: A) => {
      if (!isAppUrl(event.senderFrame?.url ?? '')) throw new Error('Origem não autorizada.');
      return run(event, arg);
    });
  };
  const parent = (event: IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender)!;

  handle('app:info', () => ({ version: app.getVersion(), dataDir: dataDir() }));
  handle('app:failure', () => failure);
  handle('app:open-data-dir', () => shell.openPath(dataDir()).then(() => undefined));
  handle('app:relaunch', restart);
  handle('app:theme', (event, theme: 'dark' | 'light' | 'system') =>
    applyWindowTheme(parent(event), theme === 'light' || theme === 'system' ? theme : 'dark')
  );
  handle('backup:pick-folder', async (event): Promise<FolderChoice> => {
    if (!core || failure) throw new Error('O núcleo não está no ar.');
    const { canceled, filePaths } = await dialog.showOpenDialog(parent(event), {
      title: 'Pasta de backup',
      buttonLabel: 'Usar esta pasta',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return { canceled: true };
    const chosen = await ask<{ folder: string; recoveryPassword: string | null }>(core, {
      type: 'backup-folder',
      folder: filePaths[0],
    });
    return { canceled: false, ...chosen };
  });
  handle('backup:pick-file', async (event) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(parent(event), {
      title: 'Restaurar backup',
      buttonLabel: 'Escolher',
      properties: ['openFile'],
      filters: [{ name: 'Backup do Sektor', extensions: ['db'] }],
    });
    restoreFile = canceled ? null : (filePaths[0] ?? null);
    return restoreFile;
  });
  handle('backup:restore', (_event, password?: string) => runRestore(password));
  const projectFiles = projectFileChannels(dataDir, liveCore, liveFileKey, openedCopyMs);
  handle('project-files:pick', (event, projectId: string) =>
    projectFiles.pick(parent(event), projectId)
  );
  handle('project-files:add', (_event, input: Parameters<typeof projectFiles.add>[0]) =>
    projectFiles.add(input)
  );
  handle('project-files:open', (_event, id: string) => projectFiles.open(id));
  handle('project-files:remove', (_event, id: string) => projectFiles.remove(id));
  handle('google:login', (_event, hint?: string) => {
    if (!core || failure) throw new Error('O núcleo não está no ar.');
    return googleLogin(core, typeof hint === 'string' ? hint : undefined);
  });
  handle('google:cancel-login', () => cancelGoogleLogin());
  handle('notes:pop-out', (_event, noteId: string) => {
    if (typeof noteId !== 'string' || !/^[\w-]{1,64}$/.test(noteId)) throw new Error('Nota inválida.');
    openNoteWindow(noteId, givePort);
  });
  handle('notes:close-window', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  handle('quick-capture:settings', () => ({
    ...quickCaptureSettings(),
    openAtLogin: app.getLoginItemSettings().openAtLogin,
  }));
  handle('quick-capture:set-enabled', (_event, enabled: boolean) => setQuickCaptureEnabled(enabled === true));
  handle('quick-capture:set-shortcut', (_event, accelerator: string) => setQuickCaptureShortcut(accelerator));
  handle('quick-capture:pause', (_event, paused: boolean) => pauseQuickCapture(paused === true));
  handle('quick-capture:hide', () => hideQuickCapture());
  handle('quick-capture:resize', (_event, height: number) => resizeQuickCapture(Number(height)));
  handle('quick-capture:open', (_event, route: string) => {
    if (typeof route !== 'string' || !/^\/[\w\-/?=&%.]{0,200}$/.test(route)) throw new Error('Tela inválida.');
    openAppAt(route);
  });
  handle('app:set-open-at-login', (_event, open: boolean) => {
    app.setLoginItemSettings({ openAtLogin: open === true });
  });
  handle('pluggy:log', (_event, text: string) => {
    if (typeof text === 'string') logWindowOpen(text.slice(0, 200), 'mensagem do widget');
  });
  handle('pluggy:open-link', (_event, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Endereço inválido.');
    logWindowOpen(url, 'link do widget, no navegador');
    return shell.openExternal(url);
  });
  handle('pluggy:oauth', (event, url: string) => {
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Endereço inválido.');
    return openPluggyOauth(parent(event), url);
  });
}

/** Prova sem cofre: banco e chave temporários, e a janela de verdade, que o asar precisa abrir. */
function runSmoke() {
  const path = join(smokeDir!, 'sektor.db');
  setAppMenu();
  createTray(() => undefined);
  registerIpc();
  const finish = async (event: CoreEvent) => {
    const header = Buffer.alloc(16);
    if (event.type === 'smoke-result') readSync(openSync(path, 'r'), header, 0, 16, 0);
    const window = createWindow(givePort, true);
    const page = await new Promise<unknown>((resolve) => {
      window.webContents.once('did-finish-load', () =>
        setTimeout(() => {
          window.webContents
            .executeJavaScript(
              `window.sektor.info().then((info) => ({
                 url: location.href.replace(/.*\\/(?=[^/]*asar)/, ''),
                 info,
                 home: /hoje/i.test(document.body.innerText),
                 dock: !!document.querySelector('nav[aria-label="Navegação principal"]'),
               }))`
            )
            .then(resolve, (error) => resolve(String(error)));
        }, 1500)
      );
    });
    const report = {
      ...event,
      notificationShown: await notify('Sektor', 'Prova de aviso nativo'),
      packaged: app.isPackaged,
      electron: process.versions.electron,
      plainHeader: header.toString('latin1').startsWith('SQLite format 3'),
      bytes: statSync(path, { throwIfNoEntry: false })?.size ?? 0,
      testDirIgnored: !TEST_DIR,
      fileVault: vaultProof(),
      devToolsOpens: (window.webContents.openDevTools(), window.webContents.isDevToolsOpened()),
      menu: Menu.getApplicationMenu()?.items.flatMap((item) => [
        item.label,
        ...(item.submenu?.items.map((sub) => sub.label) ?? []),
      ]),
      page,
    };
    console.log(`SEKTOR_SMOKE ${JSON.stringify(report)}`);
    quitting = true;
    core?.kill();
    rmSync(smokeDir!, { recursive: true, force: true });
    app.exit(event.type === 'smoke-result' ? 0 : 1);
  };
  core = startCore(path, randomBytes(32).toString('hex'), {}, (event) => {
    if (event.type === 'ready') {
      core!.postMessage({
        type: 'smoke',
        wrongKeyHex: randomBytes(32).toString('hex'),
      } satisfies CoreCommand);
    } else if (event.type === 'smoke-result' || event.type === 'failed') void finish(event);
  });
}

function boot() {
  setAppMenu();
  registerIpc();
  createTray(openWindow);
  try {
    applyPendingRestore();
  } catch (error) {
    fail('database', (error as Error).message);
  }
  clearOpenedCopies(dataDir());
  if (!failure) {
    try {
      const key = databaseKey();
      fileKey = fileKeyOf(key);
      const migration = migrateProjectFiles(filesPath(), fileKey);
      if (migration.failed) console.error('[arquivos de projeto]', migration);
      core = startCore(dbPath(), key, loadSecrets(), (event) => {
        if (event.type === 'failed') fail('database', event.message);
        if (event.type === 'ready') void sweepProjectFiles(dataDir, liveCore);
        if (event.type === 'notify') void notify(event.title, event.body);
        if (event.type === 'secrets') {
          try {
            saveSecrets(event.secrets);
          } catch (error) {
            console.error('[cofre]', error);
          }
        }
      });
    } catch (error) {
      fail('vault', (error as Error).message);
    }
  }
  openWindow();
  // Depois que a principal carrega: ela continua sendo a primeira janela do app. Nos testes das
  // telas só entra quando pedida, para não segurar o atalho nem mudar a conta das janelas.
  if (!failure && (!TEST_DIR || process.env.SEKTOR_TEST_QUICK === '1')) {
    const [main] = appWindows();
    if (main) main.webContents.once('did-finish-load', () => startQuickCapture(givePort));
    else startQuickCapture(givePort);
  }
}

app.on('before-quit', () => {
  quitting = true;
  if (!SMOKE) clearOpenedCopies(dataDir());
});

// Sem a trava, duas instâncias abririam o mesmo banco. O smoke roda em pasta própria.
if (SMOKE || app.requestSingleInstanceLock()) {
  app.on('second-instance', openWindow);
  // Fechar a janela deixa o app na bandeja; o clique no Dock a reabre e sair é pelo menu.
  app.on('activate', () => {
    if (app.isReady() && !SMOKE) openWindow();
  });
  app.on('window-all-closed', () => undefined);
  void app.whenReady().then(() => (SMOKE ? runSmoke() : boot()));
} else {
  app.exit(0);
}
