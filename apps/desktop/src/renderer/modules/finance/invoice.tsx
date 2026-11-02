import { Receipt } from 'lucide-react';
import { useState } from 'react';

import { longDate, money, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Dialog, EmptyState, Field, Input, SectionLabel, Select } from '../../ui';
import {
  invoiceName,
  InvoicePill,
  Metric,
  Skeleton,
  TransactionRow,
  useAccounts,
  useCategories,
} from './parts';
import { useTransactionDialog } from './transaction-dialog';
import type { Invoice } from './utils';

/** Uma fatura: total, pagamento e lançamentos. Remonte por fatura (`key`). */
export function InvoicePanel({
  invoice,
  future,
  onPaid,
  onSelect,
}: {
  invoice: Invoice;
  future?: boolean;
  onPaid?(): void;
  onSelect?(): void;
}) {
  const dialog = useTransactionDialog();
  const accounts = useAccounts();
  const categories = useCategories();
  const items = useRpc('invoices.transactions', { id: invoice.id });
  const pay = useRpcMutation('invoices.pay');
  const card = accounts.find((a) => a.id === invoice.accountId);
  const payers = accounts.filter((a) => a.type !== 'CREDIT_CARD' && !a.archived);
  const [from, setFrom] = useState('');
  const [date, setDate] = useState(todayString());
  // A conta do cartão pode estar arquivada: só vale se estiver entre as que podem pagar.
  const cardPayer = payers.find((a) => a.id === card?.paymentAccountId);
  const effectiveFrom = from || cardPayer?.id || payers[0]?.id || '';
  const payable = invoice.status !== 'PAID' && invoice.totalCents > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <Metric
          size="xl"
          label={invoiceName(invoice)}
          value={money(invoice.totalCents)}
          hint={`Fecha em ${longDate(invoice.closingDate)} · vence em ${longDate(invoice.dueDate)}`}
        />
        <InvoicePill status={invoice.status} future={future} />
      </div>
      {invoice.creditAppliedCents > 0 && (
        <p className="text-sm text-muted">
          Compras de {money(invoice.ownCents)} menos {money(invoice.creditAppliedCents)} de crédito da
          fatura anterior.
        </p>
      )}
      {invoice.creditCarriedCents > 0 && (
        <p className="text-sm text-muted">
          {money(invoice.creditCarriedCents)} de crédito vão para a próxima fatura.
        </p>
      )}
      {payable && (
        <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
          <Field label="Pagar com">
            <Select value={effectiveFrom} onChange={(event) => setFrom(event.target.value)}>
              {payers.length === 0 && <option value="">Crie uma conta</option>}
              {payers.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Data">
            <Input
              type="date"
              value={date}
              onChange={(event) => event.target.value && setDate(event.target.value)}
            />
          </Field>
          <Button
            variant="primary"
            disabled={pay.isPending || !effectiveFrom}
            onClick={() =>
              pay.mutateAsync({ id: invoice.id, fromAccountId: effectiveFrom, date }).then(
                () => onPaid?.(),
                () => {}
              )
            }
          >
            Pagar fatura
          </Button>
        </div>
      )}
      <div>
        <SectionLabel>Lançamentos da fatura</SectionLabel>
        {items.isPending ? (
          <Skeleton className="h-24" />
        ) : items.data?.length ? (
          items.data.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              accounts={accounts}
              categories={categories}
              showDate
              onClick={() => {
                onSelect?.();
                dialog.edit(tx);
              }}
            />
          ))
        ) : (
          <EmptyState icon={Receipt} title="Fatura vazia" text="Nenhuma compra nesta fatura." />
        )}
      </div>
    </div>
  );
}

export function InvoiceDialog({ invoice, onClose }: { invoice: Invoice; onClose(): void }) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={invoiceName(invoice)}>
      <InvoicePanel invoice={invoice} onPaid={onClose} onSelect={onClose} />
    </Dialog>
  );
}
