import { daysInMonth, toDateString } from '@sektor/finance-engine';

import { looksLikeInvoicePayment } from '../../bank/movements';
import { AppError } from '../../services/context';

import { plainText } from './rules';

export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_LINES = 5000;

/** `amountCents` com o sinal do arquivo. */
export interface StatementLine {
  date: string;
  amountCents: number;
  description: string;
  externalId: string | null;
}

export interface ParsedStatement {
  format: 'CSV' | 'OFX';
  lines: StatementLine[];
  /** Linhas com cara de lançamento que não deu para ler. */
  unreadable: number;
  /** Linhas de saldo e de valor zero: não são lançamentos. */
  ignored: number;
}

const tooMany = () =>
  new AppError(400, `O arquivo passa de ${MAX_LINES.toLocaleString('pt-BR')} linhas.`);

function validDate(year: number, month: number, day: number): string | null {
  if (year < 1970 || year > 2100 || month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  return toDateString(year, month, day);
}

const fullYear = (value: string) => (value.length === 2 ? 2000 + Number(value) : Number(value));

/** Lê a data. `monthFirst` só para arquivo que prove usar MM/DD (ver `prefersMonthFirst`). */
export function parseDate(raw: string, monthFirst = false): string | null {
  const text = raw.trim();
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{4})(\d{2})(\d{2})/.exec(text);
  if (match) return validDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/.exec(text);
  if (!match) return null;
  const [first, second] = [Number(match[1]), Number(match[2])];
  return monthFirst
    ? validDate(fullYear(match[3]!), first, second)
    : validDate(fullYear(match[3]!), second, first);
}

/** MM/DD só quando algum dia não cabe como mês e nenhum cabe no outro sentido. */
function prefersMonthFirst(values: string[]): boolean {
  let dayFirst = false;
  let monthFirst = false;
  for (const value of values) {
    const match = /^\s*(\d{1,2})[/.-](\d{1,2})[/.-]/.exec(value);
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  return monthFirst && !dayFirst;
}

/** Lê valores como "1.234,56", "-12.50", "R$ 10", "(5,00)", "12,34-" e "12,34 D". */
export function parseAmount(raw: string): number | null {
  let text = raw.toUpperCase().replace(/[R$\s\u00a0]/g, '');
  if (!text) return null;
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }
  const mark = /([DC])$/.exec(text)?.[1];
  if (mark) {
    negative = negative || mark === 'D';
    text = text.slice(0, -1);
  }
  if (text.startsWith('+')) text = text.slice(1);
  if (text.startsWith('-') || text.endsWith('-')) {
    negative = true;
    text = text.replace(/-/g, '');
  }
  if (!/^[\d.,]*\d[\d.,]*$/.test(text)) return null;

  const separator = Math.max(text.lastIndexOf(','), text.lastIndexOf('.'));
  const decimals = separator < 0 ? '' : text.slice(separator + 1);
  const hasDecimals = separator >= 0 && decimals.length <= 2;
  const whole = (hasDecimals ? text.slice(0, separator) : text).replace(/[.,]/g, '');
  const cents = hasDecimals ? decimals.padEnd(2, '0') : '00';
  const value = Number(whole || '0') * 100 + Number(cents);
  if (!Number.isSafeInteger(value) || value > 1e12) return null;
  return negative ? -value : value;
}

function splitRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === delimiter) {
      record.push(cell);
      cell = '';
    } else if (char === '\n') {
      record.push(cell);
      records.push(record);
      record = [];
      cell = '';
    } else if (char !== '\r') cell += char;
  }
  record.push(cell);
  records.push(record);
  return records.filter((row) => row.some((value) => value.trim()));
}

/** O separador que divide as primeiras linhas no mesmo número de colunas, e no maior deles. */
function findDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter(Boolean).slice(0, 30);
  let best = ';';
  let bestScore = 0;
  for (const delimiter of [';', ',', '\t', '|']) {
    const counts = new Map<number, number>();
    for (const line of sample) {
      const cells = line.split(delimiter).length;
      if (cells > 1) counts.set(cells, (counts.get(cells) ?? 0) + 1);
    }
    const score = Math.max(0, ...[...counts].map(([cells, lines]) => cells * lines));
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

interface Columns {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  direction: number;
  id: number;
}

function findColumn(header: string[], test: (cell: string) => boolean) {
  return header.findIndex(test);
}

function headerColumns(row: string[]): Columns | null {
  const header = row.map(plainText);
  const date = findColumn(header, (c) => c.startsWith('data') || c === 'date' || c === 'dt');
  const taken = (i: number) => i === date;
  const description = header.findIndex(
    (c, i) =>
      !taken(i) &&
      /^(descri|historico|lancamento|title|titulo|memo|estabelecimento|detalhe|complemento)/.test(c)
  );
  const amount = header.findIndex(
    (c, i) => !taken(i) && /^(valor|amount|value|quantia)/.test(c) && !/(us\$|dolar|usd)/.test(c)
  );
  const debit = findColumn(header, (c) => /^(debito|saida)/.test(c));
  const credit = findColumn(header, (c) => /^(credito|entrada)/.test(c));
  if (date < 0 || description < 0 || (amount < 0 && debit < 0 && credit < 0)) return null;
  return {
    date,
    description,
    amount,
    debit,
    credit,
    direction: findColumn(header, (c) => c === 'd/c' || c === 'dc' || c === 'tipo'),
    id: findColumn(header, (c) => c === 'identificador' || c === 'id' || c === 'fitid'),
  };
}

/** Arquivo sem cabeçalho: a data é a primeira coluna que parece data, o valor a última numérica. */
function guessColumns(rows: string[][]): Columns | null {
  const first = rows.find((row) => row.some((cell) => parseDate(cell)));
  if (!first) return null;
  const date = first.findIndex((cell) => parseDate(cell));
  const amount = first.findLastIndex((cell, i) => i !== date && parseAmount(cell) !== null);
  if (amount < 0) return null;
  let description = -1;
  first.forEach((cell, i) => {
    if (i === date || i === amount) return;
    if (description < 0 || cell.length > first[description]!.length) description = i;
  });
  if (description < 0) return null;
  return { date, description, amount, debit: -1, credit: -1, direction: -1, id: -1 };
}

function rowAmount(row: string[], columns: Columns): number | null {
  if (columns.amount >= 0) {
    const value = parseAmount(row[columns.amount] ?? '');
    if (value === null) return null;
    const direction = plainText(row[columns.direction] ?? '');
    if (/^(d|debito|saida)$/.test(direction)) return -Math.abs(value);
    if (/^(c|credito|entrada)$/.test(direction)) return Math.abs(value);
    return value;
  }
  const debit = parseAmount(row[columns.debit] ?? '');
  const credit = parseAmount(row[columns.credit] ?? '');
  if (debit) return -Math.abs(debit);
  if (credit) return Math.abs(credit);
  return debit ?? credit;
}

function isBalanceLine(description: string) {
  return /^(saldo\b|s a l d o\b|total( da fatura| geral| do dia)?$)/.test(plainText(description));
}

export function parseCsv(text: string): ParsedStatement {
  const rows = splitRecords(text, findDelimiter(text));
  // Muitos bancos põem agência, conta e período antes do cabeçalho.
  const headerAt = rows.slice(0, 30).findIndex((row) => headerColumns(row));
  const body = headerAt >= 0 ? rows.slice(headerAt + 1) : rows;
  const columns = headerAt >= 0 ? headerColumns(rows[headerAt]!) : guessColumns(rows);
  if (!columns) {
    throw new AppError(400, 'Não encontrei as colunas de data, descrição e valor neste CSV.');
  }
  if (body.length > MAX_LINES) throw tooMany();

  const monthFirst = prefersMonthFirst(body.map((row) => row[columns.date] ?? ''));
  const parsed: ParsedStatement = { format: 'CSV', lines: [], unreadable: 0, ignored: 0 };
  for (const row of body) {
    const description = (row[columns.description] ?? '').trim();
    if (isBalanceLine(description)) {
      parsed.ignored += 1;
      continue;
    }
    const date = parseDate(row[columns.date] ?? '', monthFirst);
    const amountCents = rowAmount(row, columns);
    if (!date || amountCents === null) {
      parsed.unreadable += 1;
    } else if (amountCents === 0) {
      parsed.ignored += 1;
    } else {
      const externalId = columns.id >= 0 ? (row[columns.id] ?? '').trim() : '';
      parsed.lines.push({ date, amountCents, description, externalId: externalId || null });
    }
  }
  return parsed;
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string) {
  return text.replace(/&(#\d+|[a-z]+);/gi, (whole, name: string) =>
    name.startsWith('#')
      ? String.fromCodePoint(Number(name.slice(1)))
      : (ENTITIES[name.toLowerCase()] ?? whole)
  );
}

/** No OFX o valor é sempre decimal, sem milhar; alguns bancos daqui usam vírgula. */
function ofxAmount(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (!/^[+-]?\d*\.?\d+$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

/** Vale para o OFX 1.x (SGML, sem fechar as tags) e o 2.x (XML). */
export function parseOfx(text: string): ParsedStatement {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi);
  if (!blocks) throw new AppError(400, 'Este OFX não tem lançamentos.');
  if (blocks.length > MAX_LINES) throw tooMany();

  const field = (block: string, tag: string) => {
    const match = new RegExp(`<${tag}>\\s*([^<\\r\\n]*)`, 'i').exec(block);
    return match ? decodeEntities(match[1]!).trim() : '';
  };
  const parsed: ParsedStatement = { format: 'OFX', lines: [], unreadable: 0, ignored: 0 };
  for (const block of blocks) {
    const date = parseDate(field(block, 'DTPOSTED'));
    const amountCents = ofxAmount(field(block, 'TRNAMT'));
    const name = field(block, 'NAME');
    const memo = field(block, 'MEMO');
    const joined = plainText(memo).includes(plainText(name)) || !memo;
    const description = joined ? memo || name : `${name} - ${memo}`;
    if (!date || amountCents === null) parsed.unreadable += 1;
    else if (amountCents === 0) parsed.ignored += 1;
    else {
      parsed.lines.push({
        date,
        amountCents,
        description,
        externalId: field(block, 'FITID') || null,
      });
    }
  }
  return parsed;
}

export function parseStatement(text: string, fileName = ''): ParsedStatement {
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) {
    throw new AppError(413, 'O arquivo passa de 5 MB.');
  }
  const clean = text.replace(/^﻿/, '');
  if (!clean.trim()) throw new AppError(400, 'O arquivo está vazio.');
  const isOfx = /\.(ofx|qfx)$/i.test(fileName) || /<OFX>|OFXHEADER/i.test(clean.slice(0, 2000));
  const parsed = isOfx ? parseOfx(clean) : parseCsv(clean);
  if (parsed.lines.length === 0) {
    throw new AppError(400, 'Não encontrei nenhum lançamento neste arquivo.');
  }
  return parsed;
}

export type ImportMode = 'statement' | 'invoice';
export type LineStatus = 'NEW' | 'DUPLICATE' | 'POSSIBLE' | 'PAYMENT';

export interface ImportEntry {
  index: number;
  date: string;
  kind: 'INCOME' | 'EXPENSE';
  amountCents: number;
  description: string;
  fingerprint: string;
  isPayment: boolean;
}

/**
 * O sinal da compra numa fatura muda de banco para banco: no OFX é sempre negativo; no CSV, vale
 * o sinal da maioria, porque compra é o que mais aparece numa fatura.
 */
export function purchasesAreNegative(parsed: ParsedStatement): boolean {
  if (parsed.format === 'OFX') return true;
  const negative = parsed.lines.filter((line) => line.amountCents < 0).length;
  return negative > parsed.lines.length / 2;
}

const CARD_PAYMENT = /\b(pagamento|pagto|pgto)\b/;

export function toEntries(
  parsed: ParsedStatement,
  mode: ImportMode,
  invert: boolean
): ImportEntry[] {
  const expenseIsNegative = mode === 'statement' || purchasesAreNegative(parsed);
  const seen = new Map<string, number>();
  return parsed.lines.map((line, index) => {
    const isExpense = (line.amountCents < 0) === expenseIsNegative;
    const kind = isExpense !== invert ? ('EXPENSE' as const) : ('INCOME' as const);
    const amountCents = Math.abs(line.amountCents);
    const description = line.description.slice(0, 120).trim() || 'Sem descrição';

    // Duas compras iguais no mesmo dia são duas compras: a repetição entra na identidade.
    const base = `${line.date}|${amountCents}|${kind}|${plainText(description)}`;
    const nth = seen.get(base) ?? 0;
    seen.set(base, nth + 1);
    const fingerprint = line.externalId ? `id:${line.externalId}` : `${base}|${nth}`;

    const isPayment =
      mode === 'invoice'
        ? kind === 'INCOME' && CARD_PAYMENT.test(plainText(description))
        : kind === 'EXPENSE' && looksLikeInvoicePayment(description);
    return { index, date: line.date, kind, amountCents, description, fingerprint, isPayment };
  });
}

export interface ExistingTx {
  id: string;
  date: string;
  kind: string;
  amountCents: number;
  description: string;
}

/**
 * DUPLICATE: a linha já foi importada, e é barrada. POSSIBLE: já há um lançamento igual (feito à
 * mão ou vindo do banco), e a pessoa decide. Cada lançamento só explica uma linha do arquivo.
 */
export function markDuplicates(
  entries: ImportEntry[],
  imported: Map<string, string>,
  existing: ExistingTx[]
): Map<number, LineStatus> {
  const used = new Set<string>();
  const status = new Map<number, LineStatus>();
  for (const entry of entries) {
    const transactionId = imported.get(entry.fingerprint);
    if (transactionId) {
      used.add(transactionId);
      status.set(entry.index, 'DUPLICATE');
    }
  }
  const nearby = (date: string, other: string) =>
    Math.abs(Date.parse(date) - Date.parse(other)) <= 2 * 86_400_000;
  const claim = (entry: ImportEntry, test: (tx: ExistingTx) => boolean) => {
    const found = existing.find(
      (tx) =>
        !used.has(tx.id) &&
        tx.kind === entry.kind &&
        tx.amountCents === entry.amountCents &&
        test(tx)
    );
    if (found) used.add(found.id);
    return Boolean(found);
  };
  const open = entries.filter((entry) => !status.has(entry.index));
  // Primeiro os casos do mesmo dia, para a folga de dois dias não roubar o par de outra linha.
  for (const entry of open) {
    if (claim(entry, (tx) => tx.date === entry.date)) status.set(entry.index, 'POSSIBLE');
  }
  for (const entry of open) {
    if (status.has(entry.index)) continue;
    const key = plainText(entry.description);
    const similar = claim(
      entry,
      (tx) => nearby(tx.date, entry.date) && plainText(tx.description) === key
    );
    if (similar) status.set(entry.index, 'POSSIBLE');
    else status.set(entry.index, entry.isPayment ? 'PAYMENT' : 'NEW');
  }
  return status;
}
