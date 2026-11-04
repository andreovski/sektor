// Wallpaper da capa e as cores que saem dele. A conta é em OKLCH, a mesma das paletas, para
// a paleta "Do wallpaper" ser só mais um jogo de matizes em `theme.css`.

import horizonte from '../assets/wallpapers/horizonte.webp';
import noite from '../assets/wallpapers/noite.webp';
import prisma from '../assets/wallpapers/prisma.webp';
import revoada from '../assets/wallpapers/revoada.webp';

export interface Tones {
  tintH: number;
  tintC: number;
  accentH: number;
  accentC: number;
  secondH: number;
  secondC: number;
  /** Cores marcantes da imagem, da mais forte para a mais fraca, para sugerir a primária. */
  swatches: { l: number; c: number; h: number }[];
}

export interface Credit {
  name: string;
  url: string;
}

export type Wallpaper =
  | { id: 'pixels' }
  | { id: string; src: string; thumb: string; tones: Tones; credit?: Credit };

export const PRESETS = [
  { id: 'revoada', label: 'Revoada', src: revoada },
  { id: 'noite', label: 'Noite', src: noite },
  { id: 'horizonte', label: 'Horizonte', src: horizonte },
  { id: 'prisma', label: 'Prisma', src: prisma },
] as const;

const SAMPLE = 72;
const BINS = 24;
const MAX_SWATCHES = 5;

const linear = (value: number) => {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

function oklch(r: number, g: number, b: number) {
  const lr = linear(r);
  const lg = linear(g);
  const lb = linear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), a: A, b: B };
}

const hueOf = (a: number, b: number) => ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
const distance = (x: number, y: number) => Math.min(Math.abs(x - y), 360 - Math.abs(x - y));
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const round = (value: number, places = 3) => Number(value.toFixed(places));

/** Lê os pixels de uma amostra pequena da imagem: o bastante para as cores, rápido de contar. */
async function sample(src: string) {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = src;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = SAMPLE;
  canvas.height = Math.max(1, Math.round((SAMPLE * image.naturalHeight) / image.naturalWidth));
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

export async function extractTones(src: string): Promise<Tones> {
  const data = await sample(src);
  const bins = Array.from({ length: BINS }, () => ({ weight: 0, l: 0, c: 0, a: 0, b: 0 }));
  let tintA = 0;
  let tintB = 0;
  let chroma = 0;
  let count = 0;
  for (let index = 0; index < data.length; index += 4) {
    const color = oklch(data[index]!, data[index + 1]!, data[index + 2]!);
    tintA += color.a;
    tintB += color.b;
    chroma += color.c;
    count++;
    // Quase preto, quase branco ou cinza não dizem a cor da imagem.
    if (color.c < 0.035 || color.l < 0.22 || color.l > 0.95) continue;
    const bin = bins[Math.floor(hueOf(color.a, color.b) / (360 / BINS)) % BINS]!;
    const weight = color.c ** 1.5;
    bin.weight += weight;
    bin.l += color.l * weight;
    bin.c += color.c * weight;
    bin.a += color.a * weight;
    bin.b += color.b * weight;
  }

  const tintH = hueOf(tintA, tintB);
  const swatches: Tones['swatches'] = [];
  for (const bin of [...bins].sort((x, y) => y.weight - x.weight)) {
    if (!bin.weight || swatches.length >= MAX_SWATCHES) break;
    const h = hueOf(bin.a, bin.b);
    if (swatches.some((swatch) => distance(swatch.h, h) < 24)) continue;
    swatches.push({ l: round(bin.l / bin.weight), c: round(bin.c / bin.weight), h: round(h, 1) });
  }

  // Imagem quase sem cor (a noite, por exemplo): a primária sai do próprio tom do fundo.
  const accent = swatches[0] ?? { l: 0.7, c: 0.1, h: tintH };
  const second =
    swatches.find((swatch) => distance(swatch.h, accent.h) >= 50) ??
    ({ l: 0.75, c: 0.1, h: (accent.h + 150) % 360 } as const);
  if (!swatches.length) swatches.push(accent);

  return {
    tintH: round(tintH, 1),
    tintC: round(clamp(chroma / count / 0.03, 0.4, 2), 2),
    accentH: accent.h,
    accentC: round(clamp(accent.c, 0.08, 0.17)),
    secondH: second.h,
    secondC: round(clamp(second.c, 0.07, 0.15)),
    swatches,
  };
}

/** A amostra de uma cor sugerida, na luz em que ela vira primária no tema escuro. */
export const swatchColor = ({ c, h }: { c: number; h: number }) =>
  `oklch(0.8 ${clamp(c, 0.08, 0.17)} ${h})`;

const LOCAL_SIDE = 1920;
const LOCAL_THUMB = 320;

function shrink(bitmap: ImageBitmap, side: number, quality: number) {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Imagem do computador: reduzida e guardada em JPEG junto com a escolha, para o wallpaper não
 * depender do arquivo continuar no lugar.
 */
export async function readLocalImage(file: Blob) {
  if (!file.type.startsWith('image/')) throw new Error('Esse arquivo não é uma imagem.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('Não consegui abrir essa imagem. Tente JPEG, PNG ou WebP.');
  }
  try {
    return { src: shrink(bitmap, LOCAL_SIDE, 0.8), thumb: shrink(bitmap, LOCAL_THUMB, 0.75) };
  } finally {
    bitmap.close();
  }
}
