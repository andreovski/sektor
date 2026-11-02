import { CalendarClock, CreditCard, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { longDate, money, shortDate, todayString } from '../../lib/format';
import { useRpc } from '../../lib/rpc';
import { Card, CardHeader, EmptyState, Segmented } from '../../ui';
import { InvoiceDialog } from './invoice';
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
import { addDays, compactMoney, type Forecast, type Invoice, zeroCrossingOffset } from './utils';

type Horizon = '30' | '90' | '365';

export function ForecastTab() {
  const [horizon, setHorizon] = useState<Horizon>('30');
  const forecast = useRpc('reports.forecast', { days: Number(horizon) });
  const accounts = useAccounts();
  const data = forecast.data;
  const negative = data?.firstNegative;
  const account = accounts.find((a) => a.id === negative?.accountId);
  const end = data?.days.at(-1);

  return (
    <div className="flex flex-col gap-4">
      {negative && (
        <div className="flex items-center gap-3 rounded-panel border border-danger/30 bg-danger/10 p-4">
          <TriangleAlert size={18} className="shrink-0 text-danger" />
          <div>
            <p className="font-medium">Seu saldo fica negativo em {longDate(negative.date)}</p>
            <p className="text-sm text-muted">
              {account ? account.name : 'Saldo total'}:{' '}
              <span className="font-medium text-danger tabular-nums">
                {money(Math.round(negative.balanceCents))}
              </span>
            </p>
          </div>
        </div>
      )}
      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          {end ? (
            <Metric
              size="xl"
              label={`Saldo previsto em ${longDate(end.date)}`}
              value={money(end.totalCents)}
              tone={end.totalCents < 0 ? 'danger' : undefined}
            />
          ) : (
            <Skeleton className="h-14 w-56" />
          )}
          <Segmented<Horizon>
            value={horizon}
            onChange={setHorizon}
            options={[
              { value: '30', label: '30 dias' },
              { value: '90', label: '90 dias' },
              { value: '365', label: '365 dias' },
            ]}
          />
        </div>
        {data ? <ForecastChart forecast={data} /> : <Skeleton className="h-64" />}
      </Card>
      <div className="grid grid-cols-2 items-start gap-4">
        <UnpaidInvoices />
        <Upcoming />
      </div>
    </div>
  );
}

function ChartTip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload?: { date: string; value: number } }[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-control bg-raised px-3 py-2 text-xs shadow-popover">
      <p className="text-muted">{longDate(point.date)}</p>
      <p className="text-sm font-medium tabular-nums">{money(point.value)}</p>
    </div>
  );
}

function ForecastChart({ forecast }: { forecast: Forecast }) {
  const id = useId();
  const points = forecast.days.map((day) => ({ date: day.date, value: day.totalCents }));
  const values = points.map((p) => p.value);
  const offset = zeroCrossingOffset(values);
  const crossesZero = Math.min(...values) < 0;

  return (
    <div className="h-64" role="img" aria-label="Saldo total previsto por dia">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`${id}-line`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={offset} stopColor="var(--primary)" />
              <stop offset={offset} stopColor="var(--danger)" />
            </linearGradient>
            <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset={0} stopColor="var(--primary)" stopOpacity={0.18} />
              <stop offset={offset} stopColor="var(--primary)" stopOpacity={0.02} />
              <stop offset={offset} stopColor="var(--danger)" stopOpacity={0.02} />
              <stop offset={1} stopColor="var(--danger)" stopOpacity={0.18} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="date"
            tickFormatter={shortDate}
            minTickGap={48}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--subtle-foreground)', fontSize: 11 }}
          />
          <YAxis
            width={48}
            tickFormatter={compactMoney}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--subtle-foreground)', fontSize: 11 }}
          />
          {crossesZero && <ReferenceLine y={0} stroke="var(--border-strong)" />}
          <Tooltip content={ChartTip} cursor={{ stroke: 'var(--border-strong)' }} />
          <Area
            type="stepAfter"
            dataKey="value"
            // Gradiente em linha reta não pinta (a caixa dela tem altura zero).
            stroke={crossesZero ? `url(#${id}-line)` : 'var(--primary)'}
            strokeWidth={2}
            fill={`url(#${id}-fill)`}
            activeDot={{ r: 4, fill: 'var(--foreground)', stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function UnpaidInvoices() {
  const accounts = useAccounts();
  const due = useRpc('invoices.due', {});
  const [open, setOpen] = useState<Invoice | null>(null);
  const list = due.data ?? [];
  return (
    <Card>
      <CardHeader icon={CreditCard} title="Faturas a pagar" />
      {due.isPending ? (
        <Skeleton className="h-24" />
      ) : list.length === 0 ? (
        <EmptyState icon={CreditCard} title="Nenhuma fatura a pagar" />
      ) : (
        list.map((invoice) => (
          <button
            key={invoice.id}
            type="button"
            onClick={() => setOpen(invoice)}
            className="flex h-[52px] w-full items-center gap-3 rounded-control px-2 text-left hover:bg-hover"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {accounts.find((a) => a.id === invoice.accountId)?.name ?? 'Cartão'}
              </p>
              <p className="truncate text-xs text-subtle">
                {invoiceName(invoice)} · vence em {shortDate(invoice.dueDate)}
              </p>
            </div>
            <InvoicePill status={invoice.status} />
            <span className="text-sm font-medium tabular-nums">{money(invoice.totalCents)}</span>
          </button>
        ))
      )}
      {open && <InvoiceDialog invoice={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}

function Upcoming() {
  const dialog = useTransactionDialog();
  const accounts = useAccounts();
  const categories = useCategories();
  const today = todayString();
  const planned = useRpc('transactions.list', {
    from: today,
    to: addDays(today, 30),
    status: 'PLANNED',
  });
  const list = [...(planned.data ?? [])].sort((a, b) => a.date.localeCompare(b.date));
  return (
    <Card>
      <CardHeader icon={CalendarClock} title="Próximos lançamentos" action="30 dias" />
      {planned.isPending ? (
        <Skeleton className="h-24" />
      ) : list.length === 0 ? (
        <EmptyState icon={CalendarClock} title="Nada previsto" />
      ) : (
        list.slice(0, 12).map((tx) => (
          <TransactionRow
            key={tx.id}
            tx={tx}
            accounts={accounts}
            categories={categories}
            showDate
            onClick={() => dialog.edit(tx)}
          />
        ))
      )}
    </Card>
  );
}
