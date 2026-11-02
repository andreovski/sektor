import { z } from 'zod';

import { idSchema, isoDateSchema } from './common';

export const saveBankCredentialsBodySchema = z.object({
  clientId: z.string().trim().min(1, 'Cole o Client ID.').max(200),
  clientSecret: z.string().trim().min(1, 'Cole o Client Secret.').max(500),
});
export type SaveBankCredentialsBody = z.infer<typeof saveBankCredentialsBodySchema>;

export const linkBankAccountBodySchema = z.object({
  accountId: idSchema.nullable().optional(),
  create: z.boolean().optional(),
  importFrom: isoDateSchema.optional(),
});
export type LinkBankAccountBody = z.infer<typeof linkBankAccountBodySchema>;

export const acceptBankMovementBodySchema = z.object({
  kind: z.enum(['INCOME', 'EXPENSE']).optional(),
  categoryId: idSchema.nullable().optional(),
  description: z.string().trim().min(1).max(120).optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type AcceptBankMovementBody = z.infer<typeof acceptBankMovementBodySchema>;

export type BankMovementStatus = 'PENDING' | 'MATCHED' | 'IMPORTED' | 'IGNORED';

export interface BankAccountResponse {
  id: string;
  name: string;
  number: string | null;
  type: 'BANK' | 'CREDIT';
  balanceCents: number;
  accountId: string | null;
  importFrom: string | null;
  syncedAt: string | null;
}

export interface BankItemResponse {
  id: string;
  itemId: string;
  name: string;
  imageUrl: string | null;
  status: string | null;
  lastError: string | null;
  syncedAt: string | null;
  accounts: BankAccountResponse[];
}

export interface BankStatusResponse {
  configured: boolean;
  clientId: string | null;
  syncedAt: string | null;
  lastError: string | null;
  pendingCount: number;
  noticeAcceptedAt: string | null;
  items: BankItemResponse[];
}

export interface BankMovementResponse {
  id: string;
  bankAccountId: string;
  accountId: string | null;
  kind: 'INCOME' | 'EXPENSE';
  amountCents: number;
  date: string;
  description: string;
  bankDescription: string;
  installmentNumber: number | null;
  installmentTotal: number | null;
  status: BankMovementStatus;
  suggestedCategoryId: string | null;
  suggestionSource: 'HISTORY' | 'RULE' | null;
  transactionId: string | null;
}

export interface BankCardCheckResponse {
  bankName: string;
  usedCents: number;
  openCents: number;
  bills: {
    dueDate: string;
    closingDate: string | null;
    bankTotalCents: number;
    bankPaidCents: number;
    bankPaidOn: string | null;
    invoice: { id: string; referenceMonth: string; totalCents: number; status: string } | null;
  }[];
  movements: { total: number; withBill: number };
}
