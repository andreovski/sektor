import { addDays, dateStringToUtc } from '@sektor/finance-engine';

import type { TaskPriority } from './contract';

export interface ParsedCapture {
  title: string;
  dueDate: string | null;
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

/** A próxima vez que o dia cai depois de hoje: "sexta" dito numa sexta é a da semana que vem. */
function nextWeekday(today: string, weekday: number) {
  const current = dateStringToUtc(today).getUTCDay();
  return addDays(today, (weekday - current + 7) % 7 || 7);
}

/** Interpreta "pagar a luz sexta #casa !alta". `today` é AAAA-MM-DD. Sem IA e sem rede. */
export function parseCapture(text: string, today: string): ParsedCapture {
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

  return { title: rest.replace(/\s+/g, ' ').trim(), dueDate, tags, priority };
}
