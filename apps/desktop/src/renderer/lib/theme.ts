import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

import type { Tones, Wallpaper } from './wallpaper';

export type Theme = 'dark' | 'light';
export type ThemeChoice = Theme | 'system';

export const PALETTES = [
  { value: 'floresta', label: 'Floresta' },
  { value: 'papel', label: 'Papel' },
  { value: 'oceano', label: 'Oceano' },
  { value: 'ameixa', label: 'Ameixa' },
  { value: 'rose', label: 'Rosé' },
  { value: 'grafite', label: 'Grafite' },
  { value: 'dracula', label: 'Dracula' },
] as const;

export type FixedPalette = (typeof PALETTES)[number]['value'];
/** `wallpaper` são os matizes tirados da imagem da capa, guardados junto com ela. */
export type Palette = FixedPalette | 'wallpaper';

const THEME_KEY = 'sektor-theme';
const PALETTE_KEY = 'sektor-palette';
const COVER_KEY = 'sektor-cover-everywhere';
const WALLPAPER_KEY = 'sektor-wallpaper';

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

function readWallpaper(): Wallpaper {
  try {
    const saved = JSON.parse(read(WALLPAPER_KEY) ?? 'null') as Wallpaper | null;
    if (saved && (saved.id === 'pixels' || ('src' in saved && saved.tones))) return saved;
  } catch {
    // Valor estragado: volta para os pixels.
  }
  return { id: 'pixels' };
}

let wallpaper = readWallpaper();
const savedPalette =
  read(PALETTE_KEY) === 'wallpaper' && 'tones' in wallpaper
    ? 'wallpaper'
    : PALETTES.find(({ value }) => value === read(PALETTE_KEY))?.value;

const savedChoice = read(THEME_KEY);
let choice: ThemeChoice = savedChoice === 'light' || savedChoice === 'system' ? savedChoice : 'dark';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const resolved = (): Theme => (choice === 'system' ? (systemDark.matches ? 'dark' : 'light') : choice);
let theme = resolved();
let palette: Palette = savedPalette ?? 'floresta';
let coverEverywhere = read(COVER_KEY) !== 'off';
const listeners = new Set<() => void>();

/** Os matizes da imagem nas mesmas variáveis de um bloco `[data-palette]` do `theme.css`. */
export const toneVars = (tones: Tones) => ({
  '--tint-h': String(tones.tintH),
  '--tint-c': String(tones.tintC),
  '--accent-h': String(tones.accentH),
  '--accent-c': String(tones.accentC),
  '--accent-dark-l': '0.8',
  '--accent-light-l': '0.48',
  '--second-h': String(tones.secondH),
  '--second-c': String(tones.secondC),
});

const TONE_VARS = Object.keys(toneVars({} as Tones));

function paint() {
  theme = resolved();
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.palette = palette;
  const vars: Record<string, string> =
    palette === 'wallpaper' && 'tones' in wallpaper ? toneVars(wallpaper.tones) : {};
  for (const name of TONE_VARS) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
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

/** Sem troca de tema: a capa entra e sai com a própria transição de opacidade. */
export function setCoverEverywhere(next: boolean) {
  if (next === coverEverywhere) return;
  coverEverywhere = next;
  write(COVER_KEY, next ? 'on' : 'off');
  listeners.forEach((listener) => listener());
}

/** Trocar a imagem já leva a paleta para as cores dela; os pixels voltam à paleta Floresta. */
export function setWallpaper(next: Wallpaper) {
  wallpaper = next;
  write(WALLPAPER_KEY, JSON.stringify(next));
  const nextPalette = 'tones' in next ? 'wallpaper' : palette === 'wallpaper' ? 'floresta' : palette;
  palette = nextPalette;
  write(PALETTE_KEY, nextPalette);
  repaint();
}

/** Uma das cores sugeridas pela imagem vira a primária; a secundária fica. */
export function setWallpaperAccent(swatch: { c: number; h: number }) {
  if (!('tones' in wallpaper)) return;
  setWallpaper({
    ...wallpaper,
    tones: { ...wallpaper.tones, accentH: swatch.h, accentC: Math.min(0.17, Math.max(0.08, swatch.c)) },
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** O modo em vigor, já resolvido quando a escolha é Sistema. */
export const useTheme = () => useSyncExternalStore(subscribe, () => theme);
export const useThemeChoice = () => useSyncExternalStore(subscribe, () => choice);
export const usePalette = () => useSyncExternalStore(subscribe, () => palette);
export const useCoverEverywhere = () => useSyncExternalStore(subscribe, () => coverEverywhere);
export const useWallpaper = () => useSyncExternalStore(subscribe, () => wallpaper);
