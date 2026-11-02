import { app, Menu, type MenuItemConstructorOptions } from 'electron';

/** Mínimo, em português. Sem o menu, copiar e colar param no Mac. */
export function setAppMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Sektor',
      submenu: [
        { role: 'about', label: 'Sobre o Sektor' },
        { type: 'separator' },
        { role: 'hide', label: 'Ocultar o Sektor' },
        { role: 'hideOthers', label: 'Ocultar os outros' },
        { role: 'unhide', label: 'Mostrar todos' },
        { type: 'separator' },
        { role: 'quit', label: 'Sair do Sektor' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Desfazer' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Janela',
      submenu: [
        { role: 'minimize', label: 'Minimizar' },
        { role: 'zoom', label: 'Zoom' },
        { role: 'close', label: 'Fechar' },
        ...(app.isPackaged
          ? []
          : ([
              { type: 'separator' },
              { role: 'reload', label: 'Recarregar' },
              { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
