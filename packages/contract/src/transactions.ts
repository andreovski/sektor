import { z } from 'zod';

import {
  idSchema,
  isoDateSchema,
  isoMonthSchema,
  positiveCentsSchema,
  rruleSchema,
} from './common';

export const transactionKindSchema = z.enum(['INCOME', 'EXPENSE', 'TRANSFER']);
export type TransactionKind = z.infer<typeof transactionKindSchema>;

export const transactionStatusSchema = z.enum(['PLANNED', 'DONE']);
export type TransactionStatus = z.infer<typeof transactionStatusSchema>;

/** "single": só este lançamento. "future": este e os próximos da mesma recorrência. */
export const recurrenceScopeSchema = z.enum(['single', 'future']);
export type RecurrenceScope = z.infer<typeof recurrenceScopeSchema>;

const baseFields = {
  kind: transactionKindSchema,
  amountCents: positiveCentsSchema,
  date: isoDateSchema,
  accountId: idSchema,
  toAccountId: idSchema.nullable().optional(),
  categoryId: idSchema.nullable().optional(),
  description: z.string().trim().min(1, 'Informe a descrição.').max(120),
  notes: z.string().max(2000).nullable().optional(),
  status: transactionStatusSchema.optional(),
};

export const createTransactionBodySchema = z
  .object({
    ...baseFields,
    /** Repete o lançamento (ex.: salário todo dia 5). Gera os previstos de 12 meses. */
    recurrence: z.object({ rrule: rruleSchema }).optional(),
    /** Divide o valor total em N parcelas mensais. */
    installments: z.number().int().min(2).max(72).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'TRANSFER' && !value.toAccountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toAccountId'],
        message: 'Escolha a conta de destino.',
      });
    }
    if (value.kind === 'TRANSFER' && value.toAccountId === value.accountId) {
      ctx.addIssue({
        code: 'custom',
        path: ['toAccountId'],
        message: 'Origem e destino precisam ser contas diferentes.',
      });
    }
    if (value.recurrence && value.installments) {
      ctx.addIssue({
        code: 'custom',
        path: ['installments'],
        message: 'Um lançamento não pode ser recorrente e parcelado ao mesmo tempo.',
      });
    }
  });
export type CreateTransactionBody = z.infer<typeof createTransactionBodySchema>;

export const updateTransactionBodySchema = z
  .object(baseFields)
  .omit({ kind: true })
  .partial()
  .extend({ scope: recurrenceScopeSchema.default('single') });
export type UpdateTransactionBody = z.infer<typeof updateTransactionBodySchema>;

export const deleteTransactionQuerySchema = z.object({
  scope: recurrenceScopeSchema.default('single'),
});

export const listTransactionsQuerySchema = z.object({
  month: isoMonthSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  accountId: idSchema.optional(),
  categoryId: idSchema.optional(),
  kind: transactionKindSchema.optional(),
  status: transactionStatusSchema.optional(),
  search: z.string().max(80).optional(),
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const transactionResponseSchema = z.object({
  id: z.string(),
  kind: transactionKindSchema,
  amountCents: z.number().int(),
  date: isoDateSchema,
  accountId: z.string(),
  toAccountId: z.string().nullable(),
  categoryId: z.string().nullable(),
  description: z.string(),
  notes: z.string().nullable(),
  status: transactionStatusSchema,
  recurrenceId: z.string().nullable(),
  recurrenceRule: z.string().nullable(),
  installmentGroupId: z.string().nullable(),
  installmentNumber: z.number().int().nullable(),
  installmentTotal: z.number().int().nullable(),
  invoiceId: z.string().nullable(),
  paysInvoiceId: z.string().nullable(),
});
export type TransactionResponse = z.infer<typeof transactionResponseSchema>;
