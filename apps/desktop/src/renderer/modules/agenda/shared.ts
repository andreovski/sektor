import { useEffect, useState } from 'react';

export const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

export const toneVar = (tone: string | null | undefined) => `var(--tone-${tone ?? 'blue'})`;

/** Fundo a 18% da cor, como os blocos de um calendário. */
export function blockStyle(tone: string) {
  const color = toneVar(tone);
  return {
    backgroundColor: `color-mix(in srgb, ${color} 18%, var(--surface))`,
    borderLeft: `3px solid ${color}`,
    color: `color-mix(in srgb, ${color} 55%, var(--foreground))`,
  };
}

/** Preferência da tela: se o armazenamento falhar, vale o padrão. */
export function useStored<T extends string>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? initial;
    } catch {
      return initial;
    }
  });
  const update = (next: T) => {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Preferência perdida não atrapalha.
    }
  };
  return [value, update] as const;
}

/** Instante atual, andando de 30 em 30 s: a linha do horário. */
export function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

