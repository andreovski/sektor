import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

export type Theme = 'dark' | 'light';
export type ThemeChoice = Theme | 'system';

export const PALETTES = [
  { value: 'floresta', label: 'Floresta' },
  { value: 'papel', label: 'Papel' },
  { value: 'oceano', label: 'Oceano' },
  { value: 'ameixa', label: 'Ameixa' },
  { value: 'rose', label: 'Rosé' },
  { value: 'grafite', label: 'Grafite' },
] as const;

export type Palette = (typeof PALETTES)[number]['value'];

const THEME_KEY = 'sektor-theme';
const PALETTE_KEY = 'sektor-palette';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento, a escolha vale até fechar o app.
  }
}

const savedPalette = PALETTES.find(({ value }) => value === read(PALETTE_KEY));

const savedChoice = read(THEME_KEY);
let choice: ThemeChoice = savedChoice === 'light' || savedChoice === 'system' ? savedChoice : 'dark';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const resolved = (): Theme => (choice === 'system' ? (systemDark.matches ? 'dark' : 'light') : choice);
let theme = resolved();
let palette: Palette = savedPalette?.value ?? 'floresta';
const listeners = new Set<() => void>();

function paint() {
  theme = resolved();
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.palette = palette;
  // A barra da janela e os diálogos do sistema seguem o mesmo tema.
  void window.sektor.setTheme(choice);
}

/** Antes do primeiro desenho, para a janela não abrir no tema errado. */
export const applyStoredTheme = paint;

function repaint() {
  const swap = () => {
    paint();
    listeners.forEach((listener) => listener());
  };
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) swap();
  else document.startViewTransition(() => flushSync(swap));
}

export function setTheme(next: ThemeChoice) {
  if (next === choice) return;
  choice = next;
  write(THEME_KEY, next);
  repaint();
}

// Em Sistema, o macOS trocou de modo (ou o main acabou de liberar a escolha dele).
systemDark.addEventListener('change', () => {
  if (choice === 'system' && resolved() !== theme) repaint();
});

export function setPalette(next: Palette) {
  if (next === palette) return;
  palette = next;
  write(PALETTE_KEY, next);
  repaint();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** O modo em vigor, já resolvido quando a escolha é Sistema. */
export const useTheme = () => useSyncExternalStore(subscribe, () => theme);
export const useThemeChoice = () => useSyncExternalStore(subscribe, () => choice);
export const usePalette = () => useSyncExternalStore(subscribe, () => palette);
