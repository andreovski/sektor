import { app, type BrowserWindow, globalShortcut, screen } from 'electron';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createQuickCaptureWindow, QUICK_CAPTURE_WIDTH } from './window';

// A captura rápida: o atalho global mostra o campo da Início por cima de qualquer app. A escolha
// do atalho mora num arquivo do main, porque ele precisa dela antes de qualquer página abrir.

export interface QuickCaptureSettings {
  enabled: boolean;
  /** No formato de acelerador do Electron, como `Alt+Space`. */
  accelerator: string;
}

const DEFAULTS: QuickCaptureSettings = { enabled: true, accelerator: 'Alt+Space' };
const settingsFile = () => join(app.getPath('userData'), 'captura-rapida.json');

let settings = DEFAULTS;
let window: BrowserWindow | null = null;
let registered: string | null = null;
let leaving = false;

function load(): QuickCaptureSettings {
  try {
    const saved = JSON.parse(readFileSync(settingsFile(), 'utf8')) as Partial<QuickCaptureSettings>;
    return {
      enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULTS.enabled,
      accelerator: isAccelerator(saved.accelerator) ? saved.accelerator : DEFAULTS.accelerator,
    };
  } catch {
    return DEFAULTS;
  }
}

function save() {
  try {
    writeFileSync(settingsFile(), JSON.stringify(settings));
  } catch (error) {
    console.error('[captura rápida]', error);
  }
}

const isAccelerator = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 60 && /^[\w+]+$/.test(value);

function unregister() {
  if (registered) globalShortcut.unregister(registered);
  registered = null;
}

function register(accelerator: string) {
  unregister();
  let ok = false;
  try {
    ok = globalShortcut.register(accelerator, toggle);
  } catch {
    ok = false;
  }
  if (ok) registered = accelerator;
  return ok;
}

/** No monitor do cursor, centralizada no terço de cima, com a altura que a página pediu. */
function place(target: BrowserWindow) {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const [, height] = target.getSize();
  target.setBounds({
    x: Math.round(workArea.x + (workArea.width - QUICK_CAPTURE_WIDTH) / 2),
    y: Math.round(workArea.y + workArea.height * 0.2),
    width: QUICK_CAPTURE_WIDTH,
    height: height ?? 200,
  });
}

function show() {
  if (!window || window.isDestroyed()) return;
  place(window);
  window.show();
  window.focus();
  window.webContents.send('quick-capture:shown');
}

export function hideQuickCapture() {
  if (window && !window.isDestroyed() && window.isVisible()) window.hide();
}

function toggle() {
  if (window?.isVisible() && window.isFocused()) hideQuickCapture();
  else show();
}

/** Cria a janela escondida e registra o atalho salvo. */
export function startQuickCapture(onLoad: (window: BrowserWindow) => void) {
  settings = load();
  window = createQuickCaptureWindow(onLoad);
  // Clicar fora fecha, como o Spotlight. Com as ferramentas abertas, ficaria impossível inspecionar.
  window.on('blur', () => {
    if (!window?.webContents.isDevToolsOpened()) hideQuickCapture();
  });
  // ⌘W fecharia a janela de vez; ela só se esconde, a não ser que o app esteja saindo.
  window.on('close', (event) => {
    if (leaving) return;
    event.preventDefault();
    hideQuickCapture();
  });
  app.on('before-quit', () => {
    leaving = true;
  });
  app.on('will-quit', unregister);
  if (settings.enabled && !register(settings.accelerator)) {
    console.error('[captura rápida] atalho em uso:', settings.accelerator);
  }
}

export const quickCaptureSettings = () => ({ ...settings, active: registered !== null });

/** A página mede o campo e pede a altura; a janela cresce para baixo, sem sair do lugar. */
export function resizeQuickCapture(height: number) {
  if (!window || window.isDestroyed() || !Number.isFinite(height)) return;
  const [x, y] = window.getPosition();
  window.setBounds({
    x: x ?? 0,
    y: y ?? 0,
    width: QUICK_CAPTURE_WIDTH,
    height: Math.round(Math.min(720, Math.max(60, height))),
  });
}

export function setQuickCaptureEnabled(enabled: boolean) {
  settings = { ...settings, enabled: Boolean(enabled) };
  save();
  if (!settings.enabled) unregister();
  else if (!register(settings.accelerator)) {
    return { ok: false, message: 'Esse atalho já está em uso por outro app. Grave outra combinação.' };
  }
  return { ok: true };
}

/** Troca o atalho. Se o novo não pegar, o antigo volta e nada é salvo. */
export function setQuickCaptureShortcut(accelerator: string) {
  if (!isAccelerator(accelerator)) return { ok: false, message: 'Combinação inválida.' };
  if (settings.enabled && !register(accelerator)) {
    register(settings.accelerator);
    return { ok: false, message: 'Essa combinação já está em uso por outro app. Escolha outra.' };
  }
  settings = { ...settings, accelerator };
  save();
  return { ok: true };
}

/** Enquanto Ajustes grava um atalho novo, o atual não pode abrir a janela. */
export function pauseQuickCapture(paused: boolean) {
  if (paused) unregister();
  else if (settings.enabled) register(settings.accelerator);
}
