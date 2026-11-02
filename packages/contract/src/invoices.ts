import { z } from 'zod';

import { idSchema, isoDateSchema, isoMonthSchema } from './common';

export const invoiceStatusSchema = z.enum(['OPEN', 'CLOSED', 'PAID', 'OVERDUE']);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  PAID: 'Paga',
  OVERDUE: 'Vencida',
};

export const invoiceResponseSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  referenceMonth: z.string(),
  closingDate: isoDateSchema,
  dueDate: isoDateSchema,
  totalCents: z.number().int(),
  status: invoiceStatusSchema,
  paidAt: z.string().nullable(),
  paymentTransactionId: z.string().nullable(),
});
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;

export const payInvoiceBodySchema = z.object({
  /** Conta que paga. Sem ela, vale a conta de pagamento do cartão. */
  fromAccountId: idSchema.optional(),
  /** Dia do pagamento. Sem ele, hoje. */
  date: isoDateSchema.optional(),
});
export type PayInvoiceBody = z.infer<typeof payInvoiceBodySchema>;

/** Faturas a pagar que vencem no mês ou no período (o extrato de Contas as mostra no vencimento). */
export const dueInvoicesQuerySchema = z.object({
  month: isoMonthSchema.optional(),
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
});
export type DueInvoicesQuery = z.infer<typeof dueInvoicesQuerySchema>;
