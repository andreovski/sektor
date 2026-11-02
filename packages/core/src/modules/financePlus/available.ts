import {
  addDays,
  daysInMonth,
  monthRange,
  parseDateString,
  toDateString,
} from '@sektor/finance-engine';

export interface AvailableInput {
  today: string;
  /** Saldo das contas que não são cartão. */
  balanceCents: number;
  plannedExpenses: { amountCents: number }[];
  invoices: { totalCents: number }[];
  goalsCents: number;
  /** Só informa a projeção do fim do mês: não entra no disponível. */
  plannedIncomeCents: number;
  /** Despesas feitas no mês, até hoje. `fixed`: recorrente ou parcela. */
  spending: { date: string; amountCents: number; fixed: boolean }[];
  dailyCapCents: number | null;
}

const total = (rows: { amountCents: number }[]) =>
  rows.reduce((sum, row) => sum + row.amountCents, 0);

/** Quanto dá para gastar hoje sem faltar para o que já está comprometido no mês. */
export function computeAvailable(input: AvailableInput) {
  const { today } = input;
  const { year, month, day } = parseDateString(today);
  const plannedCents = total(input.plannedExpenses);
  const invoicesCents = input.invoices.reduce((sum, row) => sum + row.totalCents, 0);
  const availableCents = input.balanceCents - plannedCents - invoicesCents - input.goalsCents;

  const lastDay = daysInMonth(year, month);
  const daysLeft = lastDay - day + 1;
  // Fixa não entra no ritmo: o aluguel paga uma vez, não se repete até o fim do mês.
  const variable = input.spending.filter((row) => !row.fixed);
  const dailyPaceCents = Math.round(total(variable) / day);
  const closeCents = availableCents + input.plannedIncomeCents - dailyPaceCents * (daysLeft - 1);

  const spentTodayCents = total(input.spending.filter((row) => row.date === today));
  const dailyAllowanceCents = Math.max(0, Math.floor(availableCents / daysLeft));
  const cap =
    input.dailyCapCents === null
      ? null
      : {
          capCents: input.dailyCapCents,
          spentTodayCents,
          leftTodayCents: input.dailyCapCents - spentTodayCents,
          fits: input.dailyCapCents <= dailyAllowanceCents,
          closeCents:
            availableCents + input.plannedIncomeCents - input.dailyCapCents * (daysLeft - 1),
        };

  return {
    availableCents,
    balanceCents: input.balanceCents,
    plannedCents,
    invoicesCents,
    goalsCents: input.goalsCents,
    plannedIncomeCents: input.plannedIncomeCents,
    daysLeft,
    dailyAllowanceCents,
    pace: { dailyCents: dailyPaceCents, closeCents, risk: closeCents < 0 },
    cap,
  };
}

const DAYS_PER_MONTH = 30.4375;

export interface GoalView {
  id: string;
  title: string;
  money: boolean;
  pace: { remaining: number; daysLeft: number | null; status: string };
}

/**
 * O aporte do mês de cada meta em dinheiro com prazo: o que falta dividido pelos meses até lá.
 * Meta sem prazo não exige nada num mês específico; a vencida fica para a pessoa rever.
 */
export function goalContributions(goals: GoalView[]) {
  return goals.flatMap((goal) => {
    const { remaining, daysLeft, status } = goal.pace;
    if (!goal.money || daysLeft === null || daysLeft < 0 || status === 'done') return [];
    const months = Math.max(1, Math.ceil((daysLeft + 1) / DAYS_PER_MONTH));
    return [{ id: goal.id, title: goal.title, amountCents: Math.ceil(remaining / months) }];
  });
}

export interface MonthRow {
  date: string;
  kind: 'INCOME' | 'EXPENSE';
  amountCents: number;
  categoryId: string | null;
}

/**
 * Este mês contra o anterior até o mesmo dia. Comparar com o mês anterior inteiro faria todo
 * começo de mês parecer economia.
 */
export function monthChanges(rows: MonthRow[], today: string, previousMonth: string) {
  const { day } = parseDateString(today);
  const { first, last } = monthRange(previousMonth);
  const { year, month } = parseDateString(first);
  const cutoff = last < toDateString(year, month, day) ? last : toDateString(year, month, day);
  const currentFirst = addDays(today, 1 - day);

  const current = rows.filter((row) => row.date >= currentFirst && row.date <= today);
  const previous = rows.filter((row) => row.date >= first && row.date <= cutoff);
  const sumOf = (list: MonthRow[], kind: MonthRow['kind']) =>
    total(list.filter((row) => row.kind === kind));

  const byCategory = new Map<string | null, { nowCents: number; beforeCents: number }>();
  const add = (list: MonthRow[], field: 'nowCents' | 'beforeCents') => {
    for (const row of list) {
      if (row.kind !== 'EXPENSE') continue;
      const entry = byCategory.get(row.categoryId) ?? { nowCents: 0, beforeCents: 0 };
      entry[field] += row.amountCents;
      byCategory.set(row.categoryId, entry);
    }
  };
  add(current, 'nowCents');
  add(previous, 'beforeCents');

  return {
    cutoff,
    hasPrevious: rows.some((row) => row.date >= first && row.date <= last),
    spentCents: sumOf(current, 'EXPENSE'),
    spentBeforeCents: sumOf(previous, 'EXPENSE'),
    incomeCents: sumOf(current, 'INCOME'),
    incomeBeforeCents: sumOf(previous, 'INCOME'),
    categories: [...byCategory.entries()]
      .map(([categoryId, entry]) => ({
        categoryId,
        ...entry,
        deltaCents: entry.nowCents - entry.beforeCents,
      }))
      .filter((entry) => entry.deltaCents !== 0)
      .sort((a, b) => Math.abs(b.deltaCents) - Math.abs(a.deltaCents))
      .slice(0, 3),
  };
}
