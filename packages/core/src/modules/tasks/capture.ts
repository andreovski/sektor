import { addDays, dateStringToUtc } from '@sektor/finance-engine';

import type { TaskPriority } from './contract';

export interface ParsedCapture {
  title: string;
  dueDate: string | null;
  /** "HH:MM". Só com data, a do texto ou a padrão da tela. */
  dueTime: string | null;
  tags: string[];
  priority: TaskPriority | null;
}

const PRIORITIES: Record<string, TaskPriority> = {
  alta: 'HIGH',
  media: 'MEDIUM',
  baixa: 'LOW',
};

const WEEKDAYS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
};

/** Sem acento e em minúsculas, letra por letra: os índices valem para o texto original. */
const plain = (text: string) =>
  text.replace(/[\u00C0-\u00FF]/g, (letter) => letter.normalize('NFD')[0]!).toLowerCase();

const BOUNDARY_BEFORE = '(?<![\\p{L}\\p{N}_-])';
const BOUNDARY_AFTER = '(?![\\p{L}\\p{N}_])';
const PREPOSITION = '(?:(?:na|no|para|pra|ate|dia)\\s+)';
const WEEKDAY = '(domingo|segunda|terca|quarta|quinta|sexta|sabado)';

// Preposição + dia em qualquer lugar; "-feira" também. Dia sozinho só no fim do texto, porque
// "segunda via do boleto" e "quinta parcela" não são datas.
const DATE_PATTERNS: { pattern: RegExp; resolve(match: RegExpExecArray, today: string): string }[] =
  [
    {
      pattern: new RegExp(
        `${BOUNDARY_BEFORE}${PREPOSITION}?depois de amanha${BOUNDARY_AFTER}`,
        'u'
      ),
      resolve: (_, today) => addDays(today, 2),
    },
    {
      pattern: new RegExp(`${BOUNDARY_BEFORE}${PREPOSITION}?amanha${BOUNDARY_AFTER}`, 'u'),
      resolve: (_, today) => addDays(today, 1),
    },
    {
      pattern: new RegExp(`${BOUNDARY_BEFORE}${PREPOSITION}?hoje${BOUNDARY_AFTER}`, 'u'),
      resolve: (_, today) => today,
    },
    {
      pattern: new RegExp(
        `${BOUNDARY_BEFORE}${PREPOSITION}?${WEEKDAY}[- ]feira${BOUNDARY_AFTER}`,
        'u'
      ),
      resolve: (match, today) => nextWeekday(today, WEEKDAYS[match[1]!]!),
    },
    {
      pattern: new RegExp(`${BOUNDARY_BEFORE}${PREPOSITION}${WEEKDAY}${BOUNDARY_AFTER}`, 'u'),
      resolve: (match, today) => nextWeekday(today, WEEKDAYS[match[1]!]!),
    },
    {
      pattern: new RegExp(`${BOUNDARY_BEFORE}${WEEKDAY}\\s*$`, 'u'),
      resolve: (match, today) => nextWeekday(today, WEEKDAYS[match[1]!]!),
    },
  ];

// "15h", "15h30", "15:30", com ou sem "às". Sem fronteira, "15h2" e "1:305" virariam hora.
const TIME = new RegExp(
  `${BOUNDARY_BEFORE}(?:as\\s+)?(\\d{1,2})(?:h(\\d{2})?|:(\\d{2}))(?![\\p{L}\\p{N}_:])`,
  'gu'
);

function takeTime(text: string): { time: string; rest: string } | null {
  const nfc = text.normalize('NFC');
  const search = plain(nfc);
  if (search.length !== nfc.length) return null;
  for (const match of search.matchAll(TIME)) {
    const hour = Number(match[1]);
    const minute = Number(match[2] ?? match[3] ?? 0);
    if (hour > 23 || minute > 59) continue;
    return {
      time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      rest: `${nfc.slice(0, match.index)} ${nfc.slice(match.index + match[0].length)}`,
    };
  }
  return null;
}

/** A próxima vez que o dia cai depois de hoje: "sexta" dito numa sexta é a da semana que vem. */
function nextWeekday(today: string, weekday: number) {
  const current = dateStringToUtc(today).getUTCDay();
  return addDays(today, (weekday - current + 7) % 7 || 7);
}

/** Interpreta "pagar a luz sexta #casa !alta". `today` é AAAA-MM-DD. Sem IA e sem rede. */
export function parseCapture(
  text: string,
  today: string,
  options: { hasDefaultDate?: boolean } = {}
): ParsedCapture {
  const tags: string[] = [];
  let priority: TaskPriority | null = null;

  let rest = text.replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, (_, space: string, tag: string) => {
    const name = tag.toLowerCase().slice(0, 30);
    if (!tags.includes(name) && tags.length < 10) tags.push(name);
    return space;
  });
  rest = rest.replace(/(^|\s)!(alta|m[eé]dia|baixa)(?![\p{L}\p{N}_-])/giu, (_, space, word) => {
    priority ??= PRIORITIES[plain(word)]!;
    return space;
  });
  rest = rest.replace(/\s+/g, ' ').trim();

  let dueDate: string | null = null;
  const nfc = rest.normalize('NFC');
  const search = plain(nfc);
  if (search.length === nfc.length) {
    for (const { pattern, resolve } of DATE_PATTERNS) {
      const match = pattern.exec(search);
      if (!match) continue;
      dueDate = resolve(match, today);
      rest = `${nfc.slice(0, match.index)} ${nfc.slice(match.index + match[0].length)}`;
      break;
    }
  }

  // Sem data nenhuma, "pacote de 15h" é título.
  let dueTime: string | null = null;
  if (dueDate || options.hasDefaultDate) {
    const found = takeTime(rest);
    if (found) {
      dueTime = found.time;
      rest = found.rest;
    }
  }

  return { title: rest.replace(/\s+/g, ' ').trim(), dueDate, dueTime, tags, priority };
}
