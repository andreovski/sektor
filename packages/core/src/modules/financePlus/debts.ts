export interface Debt {
  id: string;
  name: string;
  balanceCents: number;
  /** Juros ao mês em centésimos de ponto percentual: 2,99% = 299. */
  rateBp: number;
  minPaymentCents: number;
}

export type PayoffStrategy = 'snowball' | 'avalanche';

/** Teto da simulação: 50 anos. */
const MAX_MONTHS = 600;

const interestOf = (balanceCents: number, rateBp: number) =>
  Math.round((balanceCents * rateBp) / 10_000);

export function debtTotals(debts: Debt[]) {
  const balanceCents = debts.reduce((sum, debt) => sum + debt.balanceCents, 0);
  return {
    count: debts.length,
    balanceCents,
    minPaymentCents: debts.reduce((sum, debt) => sum + debt.minPaymentCents, 0),
    monthlyInterestCents: debts.reduce(
      (sum, debt) => sum + interestOf(debt.balanceCents, debt.rateBp),
      0
    ),
    averageRateBp:
      balanceCents === 0
        ? 0
        : Math.round(
            debts.reduce((sum, debt) => sum + debt.balanceCents * debt.rateBp, 0) / balanceCents
          ),
  };
}

/** Da mais cara para a mais barata; no empate de juros, a de maior saldo custa mais. */
export function byCost<T extends Debt>(debts: T[]): T[] {
  return [...debts].sort((a, b) => b.rateBp - a.rateBp || b.balanceCents - a.balanceCents);
}

function priority(debts: Debt[], strategy: PayoffStrategy): Debt[] {
  if (strategy === 'avalanche') return byCost(debts);
  return [...debts].sort((a, b) => a.balanceCents - b.balanceCents || b.rateBp - a.rateBp);
}

export interface PayoffPlan {
  /** false: a parcela não vence os juros e a dívida nunca acaba. */
  feasible: boolean;
  months: number;
  totalInterestCents: number;
  totalPaidCents: number;
  /** Em que mês cada dívida acaba, na ordem em que acabam. */
  order: { id: string; name: string; month: number }[];
}

/**
 * Mês a mês: entram os juros e saem as parcelas mínimas; o que sobra (`extraCents` e, com
 * `rollover`, a parcela das dívidas já quitadas) vai para a primeira da fila.
 */
export function simulatePayoff(
  debts: Debt[],
  strategy: PayoffStrategy,
  extraCents: number,
  rollover = true
): PayoffPlan {
  const queue = priority(
    debts.filter((debt) => debt.balanceCents > 0),
    strategy
  );
  const balance = new Map(queue.map((debt) => [debt.id, debt.balanceCents]));
  const allMinimums = queue.reduce((sum, debt) => sum + debt.minPaymentCents, 0);
  const plan: PayoffPlan = {
    feasible: true,
    months: 0,
    totalInterestCents: 0,
    totalPaidCents: 0,
    order: [],
  };

  const owed = () => [...balance.values()].reduce((sum, value) => sum + value, 0);
  while (owed() > 0) {
    if (plan.months >= MAX_MONTHS) return { ...plan, feasible: false };
    const before = owed();
    plan.months += 1;

    let budget = extraCents + (rollover ? allMinimums : 0);
    for (const debt of queue) {
      const open = balance.get(debt.id)!;
      if (open === 0) continue;
      const interest = interestOf(open, debt.rateBp);
      plan.totalInterestCents += interest;
      const pay = Math.min(debt.minPaymentCents, open + interest);
      balance.set(debt.id, open + interest - pay);
      plan.totalPaidCents += pay;
      if (rollover) budget -= pay;
    }
    for (const debt of queue) {
      if (budget <= 0) break;
      const open = balance.get(debt.id)!;
      const pay = Math.min(budget, open);
      balance.set(debt.id, open - pay);
      plan.totalPaidCents += pay;
      budget -= pay;
    }
    for (const debt of queue) {
      if (balance.get(debt.id) === 0 && !plan.order.some((item) => item.id === debt.id)) {
        plan.order.push({ id: debt.id, name: debt.name, month: plan.months });
      }
    }
    // O total parado ou subindo não volta a cair: a parcela não paga os juros de alguma dívida.
    if (owed() >= before) return { ...plan, feasible: false };
  }
  return plan;
}

export function comparePlans(debts: Debt[], extraCents: number) {
  const snowball = simulatePayoff(debts, 'snowball', extraCents);
  const avalanche = simulatePayoff(debts, 'avalanche', extraCents);
  const minimumsOnly = simulatePayoff(debts, 'avalanche', 0, false);
  const better =
    snowball.feasible && avalanche.feasible && snowball.totalInterestCents < avalanche.totalInterestCents
      ? ('snowball' as const)
      : ('avalanche' as const);
  return { snowball, avalanche, minimumsOnly, better };
}

/** Parcela fixa que quita o saldo no prazo; arredondada para cima para fechar dentro dele. */
export function fixedInstallment(balanceCents: number, rateBp: number, months: number): number {
  if (rateBp === 0) return Math.ceil(balanceCents / months);
  const rate = rateBp / 10_000;
  return Math.ceil((balanceCents * rate) / (1 - (1 + rate) ** -months));
}

export type RenegotiationVerdict = 'worth' | 'relief' | 'not_worth';

export function simulateRenegotiation(debt: Debt, rateBp: number, termMonths: number) {
  const current = simulatePayoff([debt], 'avalanche', 0);
  const installmentCents = fixedInstallment(debt.balanceCents, rateBp, termMonths);
  const proposal = simulatePayoff(
    [{ ...debt, rateBp, minPaymentCents: installmentCents }],
    'avalanche',
    0
  );
  const savingsCents = current.feasible ? current.totalPaidCents - proposal.totalPaidCents : null;
  const verdict: RenegotiationVerdict =
    savingsCents === null || savingsCents > 0
      ? 'worth'
      : installmentCents < debt.minPaymentCents
        ? 'relief'
        : 'not_worth';
  return {
    verdict,
    savingsCents,
    installmentCents,
    currentInstallmentCents: debt.minPaymentCents,
    current: {
      feasible: current.feasible,
      months: current.months,
      totalPaidCents: current.totalPaidCents,
    },
    proposal: { months: proposal.months, totalPaidCents: proposal.totalPaidCents },
  };
}
