import { z } from 'zod';

import { idSchema, isoMonthSchema, positiveCentsSchema } from './common';

export const upsertBudgetBodySchema = z.object({
  categoryId: idSchema,
  month: isoMonthSchema,
  limitCents: positiveCentsSchema,
});
export type UpsertBudgetBody = z.infer<typeof upsertBudgetBodySchema>;

export const budgetLevelSchema = z.enum(['ok', 'warn', 'over']);
export type BudgetLevel = z.infer<typeof budgetLevelSchema>;

export const budgetStatusResponseSchema = z.object({
  id: z.string(),
  categoryId: z.string(),
  month: isoMonthSchema,
  limitCents: z.number().int(),
  /** Despesas efetivadas da categoria (e subcategorias) no mês. */
  spentCents: z.number().int(),
  /** Despesas previstas que ainda faltam no mês. */
  plannedCents: z.number().int(),
  /** spent / limit. */
  ratio: z.number(),
  /** ok até 80%, warn de 80% a 100%, over acima. */
  level: budgetLevelSchema,
});
export type BudgetStatusResponse = z.infer<typeof budgetStatusResponseSchema>;
