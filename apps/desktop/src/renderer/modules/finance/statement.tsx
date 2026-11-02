import { useVirtualizer } from '@tanstack/react-virtual';
import { Receipt } from 'lucide-react';
import { useRef, useState } from 'react';

import { longDate, money, monthLabel, todayString } from '../../lib/format';
import { useRpc } from '../../lib/rpc';
import { Button, Card, cn, EmptyState } from '../../ui';
import { InvoiceDialog } from './invoice';
import {
  amountClass,
  Chips,
  Metric,
  MonthSwitcher,
  SearchBox,
  Skeleton,
  TransactionRow,
  useAccounts,
  useCategories,
} from './parts';
import { useTransactionDialog } from './transaction-dialog';
import {
  dueInvoiceRows,
  filterStatement,
  type Invoice,
  monthOfDay,
  scopeAccountIds,
  statementRows,
  type StatementItem,
  type StatementScope,
  totalsOf,
} from './utils';

const SCOPES: { value: StatementScope; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'accounts', label: 'Contas' },
  { value: 'cards', label: 'Cartão' },
];

export function StatementTab() {
  const dialog = useTransactionDialog();
  const accounts = useAccounts();
  const categories = useCategories();
  const [month, setMonth] = useState(monthOfDay(todayString()));
  const [scope, setScope] = useState<StatementScope>('all');
  const [search, setSearch] = useState('');
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const transactions = useRpc('transactions.list', { month });
  const due = useRpc('invoices.due', { month });

  const perspective = scopeAccountIds(accounts, scope);
  const invoiceRows = scope === 'accounts' ? dueInvoiceRows(due.data ?? [], accounts) : [];
  const all: StatementItem[] = [...invoiceRows, ...(transactions.data ?? [])];
  const inScope = filterStatement(all, '', perspective);
  const rows = statementRows(filterStatement(inScope, search, perspective), perspective);
  const totals = totalsOf(inScope, perspective);

  const scroller = useRef<HTMLDivElement>(null);
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: (index) => (rows[index]!.type === 'day' ? 34 : 52),
    overscan: 10,
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <Metric label="Entradas" value={money(totals.incomeCents)} tone="success" />
        </Card>
        <Card>
          <Metric label="Saídas" value={money(totals.expenseCents)} tone="danger" />
        </Card>
        <Card>
          <Metric
            label={`Resultado de ${monthLabel(month).toLowerCase()}`}
            value={money(totals.netCents)}
            tone={totals.netCents < 0 ? 'danger' : undefined}
          />
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <MonthSwitcher month={month} onChange={setMonth} />
        <Chips<StatementScope> value={scope} onChange={setScope} options={SCOPES} />
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar no extrato" />
      </div>

      <Card className="p-2">
        {transactions.isPending ? (
          <div className="flex flex-col gap-2 p-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={all.length ? 'Nada encontrado' : 'Nenhum lançamento'}
            text={
              all.length
                ? 'Tente outra busca ou outro recorte.'
                : `Nada registrado em ${monthLabel(month).toLowerCase()}.`
            }
            action={
              !all.length && (
                <Button variant="primary" onClick={() => dialog.create()}>
                  Novo lançamento
                </Button>
              )
            }
          />
        ) : null}
        {/* Fica montado mesmo vazio: o virtualizador guarda a referência deste elemento. */}
        <div
          ref={scroller}
          className={cn('overflow-y-auto', rows.length === 0 && 'hidden')}
          style={{ height: 'max(320px, calc(100vh - 400px))' }}
        >
          <div className="relative w-full" style={{ height: virtual.getTotalSize() }}>
            {virtual.getVirtualItems().map((entry) => {
              const row = rows[entry.index]!;
              return (
                <div
                  key={entry.key}
                  className="absolute top-0 left-0 w-full"
                  style={{ height: entry.size, transform: `translateY(${entry.start}px)` }}
                >
                  {row.type === 'day' ? (
                    <div className="flex h-full items-end justify-between px-2 pb-1 text-xs text-subtle">
                      <span>{longDate(row.date)}</span>
                      <span className={cn('tabular-nums', amountClass(row.totalCents, false))}>
                        {money(row.totalCents)}
                      </span>
                    </div>
                  ) : (
                    <TransactionRow
                      tx={row.item}
                      accounts={accounts}
                      categories={categories}
                      scope={perspective}
                      onClick={() =>
                        row.item.dueInvoice ? setInvoice(row.item.dueInvoice) : dialog.edit(row.item)
                      }
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </Card>
      {invoice && <InvoiceDialog invoice={invoice} onClose={() => setInvoice(null)} />}
    </div>
  );
}
