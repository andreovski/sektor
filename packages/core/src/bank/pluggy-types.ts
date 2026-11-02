// Formatos que a API da Pluggy devolve.

export interface PluggyItem {
  id: string;
  status: string;
  executionStatus?: string;
  connector?: { id: number; name: string; imageUrl?: string };
  error?: { code?: string; message?: string } | null;
  lastUpdatedAt?: string | null;
}

export interface PluggyAccount {
  id: string;
  type: 'BANK' | 'CREDIT';
  subtype?: string;
  number?: string | null;
  name: string;
  marketingName?: string | null;
  balance: number;
  creditData?: { balanceCloseDate?: string | null; balanceDueDate?: string | null } | null;
}

export interface PluggyTransaction {
  id: string;
  description: string;
  descriptionRaw?: string | null;
  amount: number;
  amountInAccountCurrency?: number | null;
  date: string;
  type?: 'DEBIT' | 'CREDIT';
  status?: 'POSTED' | 'PENDING';
  category?: string | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
    purchaseDate?: string | null;
    /** A fatura do lançamento; só vem depois que ela fecha. */
    billId?: string | null;
  } | null;
}

export interface PluggyBill {
  id: string;
  dueDate: string;
  billClosingDate?: string | null;
  totalAmount: number;
  payments?: { paymentDate?: string | null; amount: number }[] | null;
}
