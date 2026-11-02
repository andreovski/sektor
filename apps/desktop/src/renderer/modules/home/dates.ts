export function shiftDate(date: string, days: number) {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

export function shiftMonth(month: string, months: number) {
  const [year, m] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(year!, m! - 1 + months, 1));
  return moved.toISOString().slice(0, 7);
}

/** Dia da semana com a segunda como 0. */
export const weekdayIndex = (date: string) => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

export const mondayOf = (date: string) => shiftDate(date, -weekdayIndex(date));

/** Dia local de um instante, no formato das datas sem hora. */
export function localDate(instant: number | string) {
  const at = new Date(instant);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
}

export function greeting(hour: number) {
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export const coverDate = (now: Date) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);

export const weekdayName = (date: string) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`)
  );

export function minutesLabel(seconds: number) {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)}h${String(rest).padStart(2, '0')}` : `${minutes / 60}h`;
}
