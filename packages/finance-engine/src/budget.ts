export type BudgetLevel = 'ok' | 'warn' | 'over';

/** Alerta a partir de 80% do limite; "over" ao atingir 100%. */
export function budgetLevel(spentCents: number, limitCents: number): BudgetLevel {
  const ratio = limitCents > 0 ? spentCents / limitCents : 0;
  if (ratio >= 1) return 'over';
  if (ratio >= 0.8) return 'warn';
  return 'ok';
}
