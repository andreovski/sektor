// Nomes dos arquivos e quais backups ficam. Só toca nos diários: o manual é da pessoa.

const DAILY = /^sektor-(\d{4}-\d{2}-\d{2})\.db$/;
const MANUAL = /^sektor-(\d{4}-\d{2}-\d{2})-manual-\d{6}\.db$/;

export const KEEP_DAILY = 7;
export const KEEP_WEEKLY = 4;

export const dailyName = (date: string) => `sektor-${date}.db`;

export function manualName(date: string, now = new Date()) {
  return `sektor-${date}-manual-${now.toISOString().slice(11, 19).replaceAll(':', '')}.db`;
}

export const backupDate = (name: string) => (DAILY.exec(name) ?? MANUAL.exec(name))?.[1] ?? null;

/** Segunda-feira da semana de uma data. */
function weekOf(date: string) {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** Os 7 dias mais novos ficam; dos mais velhos, fica o último dia de cada uma de 4 semanas. */
export function namesToRotate(names: string[]) {
  const dates = names
    .flatMap((name) => DAILY.exec(name)?.[1] ?? [])
    .sort()
    .reverse();
  const keep = new Set(dates.slice(0, KEEP_DAILY));
  const weeks = new Map<string, string>();
  for (const date of dates) if (!weeks.has(weekOf(date))) weeks.set(weekOf(date), date);
  const weekly = [...weeks.values()].filter((date) => !keep.has(date)).slice(0, KEEP_WEEKLY);
  for (const date of weekly) keep.add(date);
  return dates.filter((date) => !keep.has(date)).map(dailyName);
}
