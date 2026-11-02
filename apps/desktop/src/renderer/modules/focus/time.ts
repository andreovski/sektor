const pad = (value: number) => String(value).padStart(2, '0');

/** Relógio: 04:59, ou 1:02:03 passando de uma hora. */
export function clock(totalSeconds: number) {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const rest = `${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
  return hours ? `${hours}:${rest}` : rest;
}

/** Duração para leitura: 45 min, 2 h, 2 h 15. */
export function duration(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${pad(rest)}` : ''}`;
}
