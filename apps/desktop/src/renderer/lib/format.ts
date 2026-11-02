const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const money = (cents: number) => BRL.format(cents / 100);

/** Data sem hora ("2026-11-02") mostrada sem passar por fuso. */
export function shortDate(date: string) {
  const [, month, day] = date.split('-');
  return `${day}/${month}`;
}

export function longDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year!, month! - 1, day!))
  );
}

export function monthLabel(month: string) {
  const [year, m] = month.split('-').map(Number);
  const label = new Intl.DateTimeFormat('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year!, m! - 1, 1)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
