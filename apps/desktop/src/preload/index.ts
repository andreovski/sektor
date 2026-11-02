import { ipcRenderer } from 'electron';

// A porta do núcleo só atravessa para a página; nada do Electron fica exposto.
ipcRenderer.on('core-port', (event) => {
  window.postMessage('core-port', '*', event.ports);
});
