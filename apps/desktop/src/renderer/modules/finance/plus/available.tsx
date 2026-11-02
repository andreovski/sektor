import { AlertTriangle, ChevronRight, Gauge, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { longDate, money, shortDate } from '../../../lib/format';
import { useRpc, useRpcMutation } from '../../../lib/rpc';
import { Button, Card, CardHeader, cn, Dialog, EmptyState, Field, Input, SectionLabel } from '../../../ui';
import { moneyField, type Out, parseMoney } from './format';

type Data = Out<'plus.available'>;

function Row({
  label,
  cents,
  sign,
  children,
}: {
  label: string;
  cents: number;
  sign?: '-';
  children?: ReactNode;
}) {
  const value = (
    <span className="ml-auto tabular-nums">
      {sign && cents > 0 ? '− ' : ''}
      {money(cents)}
    </span>
  );
  if (!children) {
    return (
      <div className="flex items-center gap-2 py-1.5 pl-5 text-sm">
        <span className="text-muted">{label}</span>
        {value}
      </div>
    );
  }
  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-1.5 text-sm">
        <ChevronRight size={12} className="text-subtle transition-transform group-open:rotate-90" />
        <span className="text-muted">{label}</span>
        {value}
      </summary>
      <ul className="mb-1 ml-5 border-l border-line pl-3 text-xs text-muted">{children}</ul>
    </details>
  );
}

function Item({ date, label, cents }: { date?: string; label: string; cents: number }) {
  return (
    <li className="flex gap-2 py-0.5">
      {date && <span className="text-subtle tabular-nums">{shortDate(date)}</span>}
      <span className="min-w-0 truncate">{label}</span>
      <span className="ml-auto tabular-nums">{money(cents)}</span>
    </li>
  );
}

function CapDialog({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  data: Data;
}) {
  const save = useRpcMutation('plus.available.settings');
  const [text, setText] = useState(data.cap ? moneyField(data.cap.capCents) : '');
  const cents = parseMoney(text);
  const submit = (dailyCapCents: number | null) =>
    save.mutate({ dailyCapCents }, { onSuccess: () => onOpenChange(false) });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Teto diário">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (cents) submit(cents);
        }}
      >
        <Field label="Quanto você quer gastar por dia, no máximo">
          <Input
            autoFocus
            inputMode="decimal"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="0,00"
          />
        </Field>
        <p className="text-xs text-muted">
          Hoje cabem até {money(data.dailyAllowanceCents)} por dia até o fim do mês.
        </p>
        <div className="flex justify-end gap-2">
          {data.cap && (
            <Button variant="ghost" onClick={() => submit(null)}>
              Tirar o teto
            </Button>
          )}
          <Button type="submit" variant="primary" disabled={!cents || save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Delta({ cents, inverse }: { cents: number; inverse?: boolean }) {
  if (cents === 0) return <span className="text-subtle">igual</span>;
  const up = cents > 0;
  const bad = up !== Boolean(inverse);
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={cn('inline-flex items-center gap-1 tabular-nums', bad ? 'text-danger' : 'text-success')}>
      <Icon size={12} />
      {up ? '+' : '−'} {money(Math.abs(cents))}
    </span>
  );
}

function Changes({ changes }: { changes: Data['changes'] }) {
  return (
    <Card>
      <CardHeader icon={TrendingUp} title="O que mudou" />
      {!changes.hasPrevious ? (
        <p className="text-sm text-muted">Ainda não há lançamentos do mês anterior para comparar.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-muted">
            Contra o mês anterior até {shortDate(changes.cutoff)}.
          </p>
          <dl className="flex flex-col gap-2 text-sm">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted">Gastos</dt>
              <dd className="ml-auto tabular-nums">{money(changes.spentCents)}</dd>
              <dd className="w-28 text-right text-xs">
                <Delta cents={changes.spentCents - changes.spentBeforeCents} />
              </dd>
            </div>
            <div className="flex items-baseline gap-2">
              <dt className="text-muted">Receitas</dt>
              <dd className="ml-auto tabular-nums">{money(changes.incomeCents)}</dd>
              <dd className="w-28 text-right text-xs">
                <Delta cents={changes.incomeCents - changes.incomeBeforeCents} inverse />
              </dd>
            </div>
          </dl>
          {changes.categories.length > 0 && (
            <div className="mt-4">
              <SectionLabel>Onde mudou mais</SectionLabel>
              <ul className="flex flex-col gap-1.5 text-sm">
                {changes.categories.map((entry) => (
                  <li key={entry.categoryId ?? 'none'} className="flex items-baseline gap-2">
                    <span className="min-w-0 truncate text-muted">{entry.name}</span>
                    <span className="ml-auto text-xs">
                      <Delta cents={entry.deltaCents} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

export function AvailableToday() {
  const { data, isLoading } = useRpc('plus.available');
  const [capOpen, setCapOpen] = useState(false);

  if (isLoading || !data) {
    return <div className="h-72 animate-pulse rounded-panel bg-hover" />;
  }
  if (!data.hasAccounts) {
    return (
      <Card>
        <EmptyState
          icon={Wallet}
          title="Nenhuma conta ainda"
          text="Cadastre uma conta com o saldo de hoje para ver quanto dá para gastar."
        />
      </Card>
    );
  }

  const { pace, cap } = data;
  const lastDay = data.daysLeft === 1 ? 'hoje' : `nos ${data.daysLeft} dias que faltam`;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex flex-col gap-4">
        <Card>
          <p className="text-sm text-muted">Disponível para gastar hoje</p>
          <p
            className={cn(
              'mt-1 text-5xl font-semibold tracking-tight tabular-nums',
              data.availableCents < 0 && 'text-danger'
            )}
          >
            {money(data.availableCents)}
          </p>
          <p className="mt-2 text-sm text-muted">
            {data.availableCents > 0
              ? `Até ${money(data.dailyAllowanceCents)} por dia ${lastDay}.`
              : 'O que já está comprometido no mês passa do que há nas contas.'}
          </p>

          <div className="mt-5 border-t border-line pt-3">
            <SectionLabel>De onde vem</SectionLabel>
            <Row label="Saldo nas contas" cents={data.balanceCents} />
            <Row label="Despesas previstas até o fim do mês" cents={data.plannedCents} sign="-">
              {data.plannedCount > 0 && (
                <>
                  {data.plannedItems.map((item) => (
                    <Item
                      key={item.id}
                      date={item.date}
                      label={item.description}
                      cents={item.amountCents}
                    />
                  ))}
                  {data.plannedCount > data.plannedItems.length && (
                    <li className="py-0.5 text-subtle">
                      e mais {data.plannedCount - data.plannedItems.length}
                    </li>
                  )}
                </>
              )}
            </Row>
            <Row label="Faturas a pagar no mês" cents={data.invoicesCents} sign="-">
              {data.invoiceItems.length > 0 &&
                data.invoiceItems.map((item) => (
                  <Item key={item.id} date={item.dueDate} label={item.name} cents={item.totalCents} />
                ))}
            </Row>
            <Row label="Aporte das metas" cents={data.goalsCents} sign="-">
              {data.goalItems.length > 0 &&
                data.goalItems.map((item) => (
                  <Item key={item.id} label={item.title} cents={item.amountCents} />
                ))}
            </Row>
          </div>
        </Card>

        <Card
          className={cn(pace.risk && 'border-danger')}
          aria-label="Projeção do fim do mês"
        >
          <div className="flex gap-3">
            {pace.risk && <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />}
            <div>
              {pace.dailyCents > 0 ? (
                <p className="text-sm">
                  No ritmo de <strong className="tabular-nums">{money(pace.dailyCents)}</strong> por
                  dia, o mês fecha em{' '}
                  <strong className={cn('tabular-nums', pace.risk && 'text-danger')}>
                    {money(pace.closeCents)}
                  </strong>
                  .
                </p>
              ) : (
                <p className="text-sm">
                  Sem gastos avulsos no mês até agora. Se continuar assim, o mês fecha em{' '}
                  <strong className="tabular-nums">{money(pace.closeCents)}</strong>.
                </p>
              )}
              <p className="mt-1 text-xs text-muted">
                O ritmo conta só os gastos avulsos deste mês, sem recorrentes nem parcelas.
                {data.plannedIncomeCents > 0 &&
                  ` A projeção soma ${money(data.plannedIncomeCents)} de receitas previstas.`}
              </p>
            </div>
          </div>
        </Card>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            icon={Gauge}
            title="Teto diário"
            action={
              <Button size="sm" variant="ghost" onClick={() => setCapOpen(true)}>
                {cap ? 'Alterar' : 'Definir'}
              </Button>
            }
          />
          {cap ? (
            <div className="text-sm">
              <p>
                <span className="text-xl font-semibold tabular-nums">
                  {money(Math.max(0, cap.leftTodayCents))}
                </span>{' '}
                <span className="text-muted">para hoje, de {money(cap.capCents)}</span>
              </p>
              {cap.leftTodayCents < 0 && (
                <p className="mt-1 text-xs text-danger">
                  Hoje passou {money(-cap.leftTodayCents)} do teto.
                </p>
              )}
              <p className="mt-2 text-xs text-muted">
                {cap.fits
                  ? `Gastando o teto todo dia, o mês fecha em ${money(cap.closeCents)}.`
                  : `Acima dos ${money(data.dailyAllowanceCents)} por dia que cabem no mês: gastando o teto todo dia, fecha em ${money(cap.closeCents)}.`}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted">
              Opcional. Defina um limite por dia para acompanhar o gasto de hoje, em{' '}
              {longDate(data.today)}.
            </p>
          )}
        </Card>
        <Changes changes={data.changes} />
      </div>

      {capOpen && <CapDialog open onOpenChange={setCapOpen} data={data} />}
    </div>
  );
}
