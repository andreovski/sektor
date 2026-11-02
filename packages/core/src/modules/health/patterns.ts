import { weekdayOf } from './schedule';

export interface PatternDay {
  date: string;
  mood: number | null;
  energy: number | null;
  gratitude: string | null;
  sleepMinutes: number | null;
  waterMl: number;
}

export interface PatternGroup {
  label: string;
  average: number | null;
  count: number;
}

export interface Pattern {
  key: 'sleep-mood' | 'water-energy' | 'gratitude-mood' | 'best-weekday';
  title: string;
  /** `early`: faltam dados. `flat`: há dados e nenhuma diferença que valha citar. */
  status: 'early' | 'flat' | 'found';
  summary: string;
  samples: number;
  needed: number;
  groups: PatternGroup[];
}

export const MIN_DAYS = 14;
export const MIN_GROUP = 4;
export const MIN_DIFF = 0.3;
export const MIN_PER_WEEKDAY = 3;
export const MIN_WEEKDAYS = 4;

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const average = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;
const decimal = (value: number) => value.toFixed(1).replace('.', ',');
const hours = (minutes: number) =>
  `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;
const liters = (ml: number) => `${(ml / 1000).toFixed(2).replace(/0$/, '').replace('.', ',')} L`;

const early = (
  base: Pick<Pattern, 'key' | 'title'>,
  samples: number,
  summary = 'Ainda é cedo: registre mais alguns dias para esta comparação aparecer.'
): Pattern => ({ ...base, status: 'early', summary, samples, needed: MIN_DAYS, groups: [] });

interface Sample {
  split: boolean;
  outcome: number;
}

function compare(
  base: Pick<Pattern, 'key' | 'title'>,
  samples: Sample[],
  labels: { yes: string; no: string },
  texts: { found(yes: string, no: string): string; flat: string; tooAlike: string }
): Pattern {
  if (samples.length < MIN_DAYS) return early(base, samples.length);
  const yes = samples.filter((s) => s.split).map((s) => s.outcome);
  const no = samples.filter((s) => !s.split).map((s) => s.outcome);
  if (yes.length < MIN_GROUP || no.length < MIN_GROUP) {
    return early(base, samples.length, texts.tooAlike);
  }
  const yesAverage = average(yes);
  const noAverage = average(no);
  const differs = Math.abs(yesAverage - noAverage) >= MIN_DIFF;
  return {
    ...base,
    status: differs ? 'found' : 'flat',
    summary: differs ? texts.found(decimal(yesAverage), decimal(noAverage)) : texts.flat,
    samples: samples.length,
    needed: MIN_DAYS,
    groups: [
      { label: labels.yes, average: yesAverage, count: yes.length },
      { label: labels.no, average: noAverage, count: no.length },
    ],
  };
}

/**
 * Corta onde os dois lados ficam mais parecidos em tamanho. Meta fixa deixaria um lado vazio, e a
 * mediana pura falha com copos: valores repetidos caem todos do mesmo lado.
 */
function balancedCut(values: number[]) {
  let cut = 0;
  let gap = Infinity;
  for (const candidate of new Set(values)) {
    const above = values.filter((value) => value >= candidate).length;
    const below = values.length - above;
    if (below > 0 && Math.abs(above - below) < gap) {
      cut = candidate;
      gap = Math.abs(above - below);
    }
  }
  return cut;
}

function splitDays(
  days: PatternDay[],
  value: (day: PatternDay) => number | null,
  outcome: (day: PatternDay) => number | null
) {
  const pairs = days.flatMap((day) => {
    const v = value(day);
    const o = outcome(day);
    return v === null || o === null ? [] : [{ value: v, outcome: o }];
  });
  const cut = balancedCut(pairs.map((p) => p.value));
  return {
    cut,
    samples: pairs.map((p) => ({ split: cut > 0 && p.value >= cut, outcome: p.outcome })),
  };
}

export function sleepAndMood(days: PatternDay[]): Pattern {
  const split = splitDays(days, (d) => d.sleepMinutes, (d) => d.mood);
  const cut = hours(split.cut);
  return compare(
    { key: 'sleep-mood', title: 'Sono e humor' },
    split.samples,
    { yes: `${cut} ou mais`, no: `Menos de ${cut}` },
    {
      found: (yes, no) =>
        `Depois de noites de ${cut} ou mais, seu humor ficou em ${yes}. Nas mais curtas, em ${no}.`,
      flat: 'Até aqui, dormir mais ou menos não mudou muito o seu humor.',
      tooAlike: 'Ainda é cedo: suas noites estão muito parecidas para comparar.',
    }
  );
}

export function waterAndEnergy(days: PatternDay[]): Pattern {
  // Zero é "não registrou", não "não bebeu".
  const split = splitDays(days, (d) => d.waterMl || null, (d) => d.energy);
  const cut = liters(split.cut);
  return compare(
    { key: 'water-energy', title: 'Água e energia' },
    split.samples,
    { yes: `${cut} ou mais`, no: `Menos de ${cut}` },
    {
      found: (yes, no) =>
        `Nos dias com ${cut} ou mais de água, sua energia ficou em ${yes}. Nos outros, em ${no}.`,
      flat: 'Até aqui, beber mais ou menos água não mudou muito a sua energia.',
      tooAlike: 'Ainda é cedo: a água de cada dia está muito parecida para comparar.',
    }
  );
}

export function gratitudeAndMood(days: PatternDay[]): Pattern {
  const samples = days.flatMap((day) =>
    day.mood === null ? [] : [{ split: !!day.gratitude?.trim(), outcome: day.mood }]
  );
  return compare(
    { key: 'gratitude-mood', title: 'Gratidão e humor' },
    samples,
    { yes: 'Com gratidão', no: 'Sem gratidão' },
    {
      found: (yes, no) =>
        `Nos dias em que você escreveu uma gratidão, seu humor ficou em ${yes}. Nos outros, em ${no}.`,
      flat: 'Até aqui, escrever a gratidão não mudou muito o seu humor.',
      tooAlike: 'Ainda é cedo: faltam dias com e sem gratidão para comparar.',
    }
  );
}

export function bestWeekday(days: PatternDay[]): Pattern {
  const base = { key: 'best-weekday', title: 'Melhor dia da semana' } as const;
  const moods = days.flatMap((d) => (d.mood === null ? [] : [{ day: weekdayOf(d.date), mood: d.mood }]));
  if (moods.length < MIN_DAYS) return early(base, moods.length);
  const groups = WEEKDAYS.map((label, day) => {
    const values = moods.filter((m) => m.day === day).map((m) => m.mood);
    const enough = values.length >= MIN_PER_WEEKDAY;
    return { label, average: enough ? average(values) : null, count: values.length, day };
  });
  const ranked = groups.filter((g) => g.average !== null);
  if (ranked.length < MIN_WEEKDAYS) {
    return early(base, moods.length, 'Ainda é cedo: faltam mais semanas para comparar os dias.');
  }
  const best = ranked.reduce((a, b) => (b.average! > a.average! ? b : a));
  const others = average(moods.filter((m) => m.day !== best.day).map((m) => m.mood));
  const tied = ranked.filter((g) => g.average === best.average).length > 1;
  const differs = !tied && best.average! - others >= MIN_DIFF;
  return {
    ...base,
    status: differs ? 'found' : 'flat',
    summary: differs
      ? `${best.label} é o seu melhor dia: humor ${decimal(best.average!)}, contra ${decimal(others)} nos outros.`
      : 'Até aqui, nenhum dia da semana se destaca dos outros.',
    samples: moods.length,
    needed: MIN_DAYS,
    groups: groups.map(({ label, average: value, count }) => ({ label, average: value, count })),
  };
}

export const allPatterns = (days: PatternDay[]): Pattern[] => [
  sleepAndMood(days),
  waterAndEnergy(days),
  gratitudeAndMood(days),
  bestWeekday(days),
];
