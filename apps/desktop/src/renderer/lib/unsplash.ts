// Busca no Unsplash com a chave de quem usa o app (o repositório é público, então ela não vem
// no código). As fotos são carregadas direto do Unsplash, como as regras da API pedem.

import { useSyncExternalStore } from 'react';

import type { Credit } from './wallpaper';

const KEY = 'sektor-unsplash-key';
const API = 'https://api.unsplash.com';
// O Unsplash pede o nome do app e a origem nos links de crédito.
const UTM = 'utm_source=sektor&utm_medium=referral';

export interface UnsplashPhoto {
  id: string;
  description: string;
  thumb: string;
  full: string;
  downloadLocation: string;
  credit: Credit;
}

interface ApiPhoto {
  id: string;
  alt_description: string | null;
  urls: { raw: string; small: string };
  links: { download_location: string };
  user: { name: string; links: { html: string } };
}

function readKey() {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

let key = readKey();
const listeners = new Set<() => void>();

export function saveUnsplashKey(next: string) {
  key = next;
  try {
    if (next) localStorage.setItem(KEY, next);
    else localStorage.removeItem(KEY);
  } catch {
    // Sem armazenamento, a chave vale até fechar o app.
  }
  listeners.forEach((listener) => listener());
}

export const useUnsplashKey = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => key
  );

async function request(path: string, key: string) {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
  });
  if (response.status === 401) throw new Error('A chave do Unsplash não foi aceita.');
  if (response.status === 403) throw new Error('O Unsplash limitou as buscas por agora. Tente daqui a pouco.');
  if (!response.ok) throw new Error('O Unsplash não respondeu. Confira a internet.');
  return response.json();
}

export async function searchUnsplash(query: string, key: string): Promise<UnsplashPhoto[]> {
  const params = new URLSearchParams({ query, per_page: '24', orientation: 'landscape' });
  const { results } = (await request(`/search/photos?${params}`, key)) as { results: ApiPhoto[] };
  return results.map((photo) => ({
    id: photo.id,
    description: photo.alt_description ?? '',
    thumb: photo.urls.small,
    full: `${photo.urls.raw}&w=2400&q=80&fm=webp&fit=max`,
    downloadLocation: photo.links.download_location,
    credit: { name: photo.user.name, url: `${photo.user.links.html}?${UTM}` },
  }));
}

/** O Unsplash conta um "download" quando a foto é usada; é exigência da API. */
export function registerUnsplashUse(photo: UnsplashPhoto, key: string) {
  void request(photo.downloadLocation.replace(API, ''), key).catch(() => {});
}

export const unsplashLink = `https://unsplash.com/?${UTM}`;
