import { z } from 'zod';

import { isoDateSchema, isoMonthSchema } from './common';

export const monthSummaryQuerySchema = z.object({ month: isoMonthSchema });

const categoryTotalSchema = z.object({
  categoryId: z.string().nullable(),
  totalCents: z.number().int(),
});

export const monthSummaryResponseSchema = z.object({
  month: isoMonthSchema,
  incomeCents: z.number().int(),
  expenseCents: z.number().int(),
  netCents: z.number().int(),
  /** Inclui os previstos do mês. */
  plannedIncomeCents: z.number().int(),
  plannedExpenseCents: z.number().int(),
  expenseByCategory: z.array(categoryTotalSchema),
  incomeByCategory: z.array(categoryTotalSchema),
  previous: z.object({
    month: isoMonthSchema,
    incomeCents: z.number().int(),
    expenseCents: z.number().int(),
    expenseByCategory: z.array(categoryTotalSchema),
  }),
});
export type MonthSummaryResponse = z.infer<typeof monthSummaryResponseSchema>;

export const forecastQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => [30, 90, 365].includes(d), 'Use 30, 90 ou 365.'),
});

export const forecastResponseSchema = z.object({
  start: isoDateSchema,
  days: z.array(
    z.object({
      date: isoDateSchema,
      totalCents: z.number().int(),
      byAccount: z.record(z.number().int()),
    })
  ),
  /** Primeiro dia em que alguma conta (ou o total) fica negativa. */
  firstNegative: z
    .object({ date: isoDateSchema, accountId: z.string().nullable(), balanceCents: z.number() })
    .nullable(),
});
export type ForecastResponse = z.infer<typeof forecastResponseSchema>;
