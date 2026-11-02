import { z } from 'zod';

import { centsSchema, colorSchema, idSchema } from './common';

export const accountTypeSchema = z.enum(['WALLET', 'CHECKING', 'SAVINGS', 'CREDIT_CARD']);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  WALLET: 'Carteira',
  CHECKING: 'Conta corrente',
  SAVINGS: 'Poupança',
  CREDIT_CARD: 'Cartão de crédito',
};

const dayOfMonth = z.number().int().min(1).max(31);

const accountFields = {
  name: z.string().trim().min(1, 'Informe o nome.').max(60),
  type: accountTypeSchema,
  initialBalanceCents: centsSchema.default(0),
  color: colorSchema,
  closingDay: dayOfMonth.nullable().optional(),
  dueDay: dayOfMonth.nullable().optional(),
  paymentAccountId: idSchema.nullable().optional(),
};

export const createAccountBodySchema = z.object(accountFields).superRefine((value, ctx) => {
  if (value.type === 'CREDIT_CARD' && (!value.closingDay || !value.dueDay)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['closingDay'],
      message: 'Cartão precisa do dia de fechamento e do dia de vencimento.',
    });
  }
});
export type CreateAccountBody = z.infer<typeof createAccountBodySchema>;

export const updateAccountBodySchema = z
  .object({ ...accountFields, archived: z.boolean() })
  .omit({ type: true })
  .partial();
export type UpdateAccountBody = z.infer<typeof updateAccountBodySchema>;

export const accountResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: accountTypeSchema,
  initialBalanceCents: z.number().int(),
  color: z.string().nullable(),
  closingDay: z.number().int().nullable(),
  dueDay: z.number().int().nullable(),
  paymentAccountId: z.string().nullable(),
  archived: z.boolean(),
  /** Saldo com os lançamentos efetivados. No cartão, é negativo: o que se deve. */
  balanceCents: z.number().int(),
  /** Saldo somando também os previstos até hoje (o que "deveria" estar na conta). */
  expectedBalanceCents: z.number().int(),
  /** Só cartão: total da fatura aberta. */
  openInvoiceCents: z.number().int().nullable(),
});
export type AccountResponse = z.infer<typeof accountResponseSchema>;
