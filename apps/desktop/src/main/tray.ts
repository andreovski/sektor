import { app, BrowserWindow, Menu, nativeImage, Notification, Tray } from 'electron';

let tray: Tray | null = null;

/** Mantém o app vivo sem janela: é o que deixa jobs e avisos rodarem. */
export function createTray(openWindow: () => void) {
  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('Sektor');
  tray.setToolTip('Sektor');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir o Sektor', click: openWindow },
      { type: 'separator' },
      { label: 'Sair', click: () => app.quit() },
    ])
  );
}

/** Mostra o aviso e diz se o sistema o exibiu, com limite de espera. */
export function notify(title: string, body: string, timeoutMs = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    if (!Notification.isSupported()) return resolve(false);
    const notification = new Notification({ title, body });
    const timer = setTimeout(() => resolve(false), timeoutMs);
    notification.once('show', () => {
      clearTimeout(timer);
      resolve(true);
    });
    notification.show();
  });
}

export const hasOpenWindow = () => BrowserWindow.getAllWindows().length > 0;
