import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'dark' | 'light';

const KEY = 'sektor-theme';

function stored(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let current = stored();
const listeners = new Set<() => void>();

function paint() {
  document.documentElement.dataset.theme = current;
  // A barra da janela e os diálogos do sistema seguem o mesmo tema.
  void window.sektor.setTheme(current);
}

/** Antes do primeiro desenho, para a janela não abrir no tema errado. */
export const applyStoredTheme = paint;

export function setTheme(theme: Theme) {
  if (theme === current) return;
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Sem armazenamento, o tema vale até fechar o app.
  }
  const swap = () => {
    paint();
    listeners.forEach((listener) => listener());
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) swap();
  else document.startViewTransition(() => flushSync(swap));
}

export function useTheme() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current
  );
}
