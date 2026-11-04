import { contextBridge, ipcRenderer } from 'electron';

import type { CoreFailure, SektorApi } from './api';

// A porta do núcleo só atravessa para a página; nada do Electron fica exposto.
ipcRenderer.on('core-port', (event) => {
  window.postMessage('core-port', '*', event.ports);
});

const api: SektorApi = {
  info: () => ipcRenderer.invoke('app:info'),
  failure: () => ipcRenderer.invoke('app:failure'),
  onFailure: (listener) =>
    void ipcRenderer.on('core-failed', (_event, failure: CoreFailure) => listener(failure)),
  pickBackupFolder: () => ipcRenderer.invoke('backup:pick-folder'),
  pickRestoreFile: () => ipcRenderer.invoke('backup:pick-file'),
  restore: (password) => ipcRenderer.invoke('backup:restore', password),
  openDataDir: () => ipcRenderer.invoke('app:open-data-dir'),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  setTheme: (theme) => ipcRenderer.invoke('app:theme', theme),
  pickProjectFiles: (projectId) => ipcRenderer.invoke('project-files:pick', projectId),
  addProjectFile: (projectId, name, bytes) =>
    ipcRenderer.invoke('project-files:add', { projectId, name, bytes }),
  openProjectFile: (id) => ipcRenderer.invoke('project-files:open', id),
  removeProjectFile: (id) => ipcRenderer.invoke('project-files:remove', id),
  googleLogin: (hint) => ipcRenderer.invoke('google:login', hint),
  googleCancelLogin: () => ipcRenderer.invoke('google:cancel-login'),
  popOutNote: (noteId) => ipcRenderer.invoke('notes:pop-out', noteId),
  closeWindow: () => ipcRenderer.invoke('notes:close-window'),
  quickCapture: {
    settings: () => ipcRenderer.invoke('quick-capture:settings'),
    setEnabled: (enabled) => ipcRenderer.invoke('quick-capture:set-enabled', enabled),
    setShortcut: (accelerator) => ipcRenderer.invoke('quick-capture:set-shortcut', accelerator),
    pause: (paused) => ipcRenderer.invoke('quick-capture:pause', paused),
    hide: () => ipcRenderer.invoke('quick-capture:hide'),
    resize: (height) => ipcRenderer.invoke('quick-capture:resize', height),
    openInApp: (route) => ipcRenderer.invoke('quick-capture:open', route),
    onShown: (listener) => void ipcRenderer.on('quick-capture:shown', () => listener()),
  },
  setOpenAtLogin: (open) => ipcRenderer.invoke('app:set-open-at-login', open),
  onNavigate: (listener) => void ipcRenderer.on('app:navigate', (_event, route: string) => listener(route)),
  pluggyOauth: (url) => ipcRenderer.invoke('pluggy:oauth', url),
  pluggyLog: (text) => ipcRenderer.invoke('pluggy:log', text),
  pluggyOpenLink: (url) => ipcRenderer.invoke('pluggy:open-link', url),
};
contextBridge.exposeInMainWorld('sektor', api);

// Arquivo solto na janela faria o Chromium navegar até ele. Quem aceita arquivo marca a área.
function blockFileDrop(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return;
  if ((event.target as Element | null)?.closest?.('[data-file-drop]')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = 'none';
}
window.addEventListener('dragover', blockFileDrop, true);
window.addEventListener('drop', blockFileDrop, true);
