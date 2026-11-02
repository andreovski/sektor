import { HandCoins, Pencil, Plus, Scale, Trash2 } from 'lucide-react';
import { useState } from 'react';

import { money, monthLabel } from '../../../lib/format';
import { useRpc, useRpcMutation } from '../../../lib/rpc';
import {
  Button,
  Card,
  CardHeader,
  cn,
  Dialog,
  EmptyState,
  Field,
  Input,
  SectionLabel,
  Stat,
} from '../../../ui';
import {
  addMonths,
  duration,
  moneyField,
  type Out,
  parseMoney,
  parseRate,
  rateField,
  rateLabel,
} from './format';

type Debt = Out<'plus.debts.list'>['debts'][number];
type Plan = Out<'plus.debts.plan'>;
type PayoffPlan = Plan['avalanche'];

function DebtDialog({ debt, onClose }: { debt: Debt | null; onClose(): void }) {
  const create = useRpcMutation('plus.debts.create');
  const update = useRpcMutation('plus.debts.update');
  const [name, setName] = useState(debt?.name ?? '');
  const [balance, setBalance] = useState(debt ? moneyField(debt.balanceCents) : '');
  const [rate, setRate] = useState(debt ? rateField(debt.rateBp) : '');
  const [minimum, setMinimum] = useState(debt ? moneyField(debt.minPaymentCents) : '');
  const [dueDay, setDueDay] = useState(debt ? String(debt.dueDay) : '');

  const balanceCents = parseMoney(balance);
  const rateBp = parseRate(rate);
  const minPaymentCents = parseMoney(minimum);
  const day = Number(dueDay);
  const valid =
    name.trim() &&
    balanceCents !== null &&
    rateBp !== null &&
    minPaymentCents !== null &&
    Number.isInteger(day) &&
    day >= 1 &&
    day <= 31;

  const submit = () => {
    if (!valid) return;
    const body = {
      name,
      balanceCents: balanceCents!,
      rateBp: rateBp!,
      minPaymentCents: minPaymentCents!,
      dueDay: day,
    };
    if (debt) update.mutate({ ...body, id: debt.id }, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: onClose });
  };

  return (
    <Dialog open onOpenChange={onClose} title={debt ? 'Editar dívida' : 'Nova dívida'}>
      <form
        className="grid grid-cols-2 gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <div className="col-span-2">
          <Field label="Nome">
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Field label="Saldo devedor (R$)">
          <Input inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </Field>
        <Field label="Juros ao mês (%)">
          <Input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Parcela mínima (R$)">
          <Input inputMode="decimal" value={minimum} onChange={(e) => setMinimum(e.target.value)} />
        </Field>
        <Field label="Dia do vencimento">
          <Input inputMode="numeric" value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </Field>
        <div className="col-span-2 flex justify-end">
          <Button type="submit" variant="primary" disabled={!valid}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

const VERDICTS = {
  worth: { title: 'Compensa', tone: 'text-success' },
  relief: { title: 'Só alivia a parcela', tone: 'text-warning' },
  not_worth: { title: 'Não compensa', tone: 'text-danger' },
};

function RenegotiateDialog({ debt, onClose }: { debt: Debt; onClose(): void }) {
  const [rate, setRate] = useState(rateField(debt.rateBp));
  const [term, setTerm] = useState('24');
  const rateBp = parseRate(rate);
  const termMonths = Number(term);
  const ready = rateBp !== null && Number.isInteger(termMonths) && termMonths >= 1 && termMonths <= 360;
  const input = ready ? { id: debt.id, rateBp: rateBp!, termMonths } : null;
  const { data } = useRpc('plus.debts.renegotiate', input ?? { id: debt.id, rateBp: 0, termMonths: 1 });
  const result = ready ? data : undefined;

  const explanation = () => {
    if (!result) return '';
    if (result.savingsCents === null) {
      return 'Com a parcela de hoje os juros nunca são vencidos e a dívida não acaba.';
    }
    const delta = money(Math.abs(result.savingsCents));
    if (result.verdict === 'worth') return `Você paga ${delta} a menos no total.`;
    if (result.verdict === 'relief') {
      return `A parcela cai, mas você paga ${delta} a mais no total.`;
    }
    return `Você paga ${delta} a mais no total, sem baixar a parcela.`;
  };

  return (
    <Dialog open onOpenChange={onClose} title={`Renegociar ${debt.name}`}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Nova taxa ao mês (%)">
          <Input autoFocus inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Prazo (meses)">
          <Input inputMode="numeric" value={term} onChange={(e) => setTerm(e.target.value)} />
        </Field>
      </div>
      {result ? (
        <div className="mt-4">
          <p className={cn('text-lg font-semibold', VERDICTS[result.verdict].tone)}>
            {VERDICTS[result.verdict].title}
          </p>
          <p className="text-sm text-muted">{explanation()}</p>
          <table className="mt-3 w-full text-sm tabular-nums">
            <thead className="text-left text-xs text-subtle">
              <tr>
                <th className="py-1 font-normal" />
                <th className="py-1 text-right font-normal">Hoje</th>
                <th className="py-1 text-right font-normal">Renegociada</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-line">
                <td className="py-1.5 text-muted">Parcela</td>
                <td className="text-right">{money(result.currentInstallmentCents)}</td>
                <td className="text-right">{money(result.installmentCents)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 text-muted">Prazo</td>
                <td className="text-right">
                  {result.current.feasible ? duration(result.current.months) : 'nunca acaba'}
                </td>
                <td className="text-right">{duration(result.proposal.months)}</td>
              </tr>
              <tr className="border-t border-line">
                <td className="py-1.5 text-muted">Total pago</td>
                <td className="text-right">
                  {result.current.feasible ? money(result.current.totalPaidCents) : '—'}
                </td>
                <td className="text-right">{money(result.proposal.totalPaidCents)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">Informe a taxa e um prazo de até 360 meses.</p>
      )}
    </Dialog>
  );
}

function PlanColumn({
  title,
  text,
  plan,
  best,
  month,
}: {
  title: string;
  text: string;
  plan: PayoffPlan;
  best: boolean;
  month: string;
}) {
  return (
    <div className={cn('rounded-control border p-3', best ? 'border-primary' : 'border-line')}>
      <div className="flex items-center gap-2">
        <p className="text-sm font-medium">{title}</p>
        {best && <span className="ml-auto text-xs text-primary">Menos juros</span>}
      </div>
      <p className="mb-3 text-xs text-muted">{text}</p>
      {plan.feasible ? (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <Stat label="Quita em" value={duration(plan.months)} hint={monthLabel(addMonths(month, plan.months))} />
            <Stat label="Juros no total" value={money(plan.totalInterestCents)} />
          </dl>
          <ol className="mt-3 flex flex-col gap-1 text-xs text-muted">
            {plan.order.map((item, index) => (
              <li key={item.id} className="flex gap-2">
                <span className="text-subtle">{index + 1}.</span>
                <span className="min-w-0 truncate">{item.name}</span>
                <span className="ml-auto whitespace-nowrap">{duration(item.month)}</span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <p className="text-sm text-danger">
          Com esse valor por mês os juros vencem e a dívida não acaba.
        </p>
      )}
    </div>
  );
}

function PayoffCard() {
  const [text, setText] = useState('100,00');
  const extraCents = parseMoney(text);
  const { data } = useRpc('plus.debts.plan', { extraCents: extraCents ?? 0 });

  return (
    <Card>
      <CardHeader
        icon={HandCoins}
        title="Plano de quitação"
        action={
          <label className="flex items-center gap-2 whitespace-nowrap">
            Extra por mês (R$)
            <Input
              className="w-24 text-right"
              inputMode="decimal"
              aria-label="Valor extra por mês"
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
        }
      />
      {data && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <PlanColumn
              title="Bola de neve"
              text="Quita primeiro a de menor saldo. As vitórias vêm mais cedo."
              plan={data.snowball}
              best={data.better === 'snowball'}
              month={data.month}
            />
            <PlanColumn
              title="Juros altos"
              text="Quita primeiro a de juros mais altos. Custa menos no total."
              plan={data.avalanche}
              best={data.better === 'avalanche'}
              month={data.month}
            />
          </div>
          <p className="mt-3 text-xs text-muted">
            {data.minimumsOnly.feasible
              ? `Pagando só o mínimo: ${duration(data.minimumsOnly.months)} e ${money(data.minimumsOnly.totalInterestCents)} de juros.`
              : 'Pagando só o mínimo, alguma dívida nunca acaba: a parcela não cobre os juros.'}
          </p>
        </>
      )}
    </Card>
  );
}

export function DebtsTab() {
  const { data, isLoading } = useRpc('plus.debts.list');
  const remove = useRpcMutation('plus.debts.delete');
  const [editing, setEditing] = useState<Debt | 'new' | null>(null);
  const [renegotiating, setRenegotiating] = useState<Debt | null>(null);

  if (isLoading || !data) return <div className="h-48 animate-pulse rounded-panel bg-hover" />;

  const addButton = (
    <Button variant="primary" onClick={() => setEditing('new')}>
      <Plus size={14} /> Dívida
    </Button>
  );
  const dialogs = (
    <>
      {editing && (
        <DebtDialog debt={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {renegotiating && (
        <RenegotiateDialog debt={renegotiating} onClose={() => setRenegotiating(null)} />
      )}
    </>
  );

  if (data.debts.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={HandCoins}
          title="Nenhuma dívida cadastrada"
          text="Cadastre saldo, juros e parcela para ver a ordem de quitação e simular renegociações."
          action={addButton}
        />
        {dialogs}
      </Card>
    );
  }

  const { totals } = data;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Stat label="Saldo total" value={money(totals.balanceCents)} />
          <Stat label="Parcelas mínimas" value={money(totals.minPaymentCents)} hint="por mês" />
          <Stat label="Juros por mês" value={money(totals.monthlyInterestCents)} />
          <Stat label="Taxa média" value={`${rateField(totals.averageRateBp)}%`} hint="pelo saldo" />
        </div>
      </Card>

      <section>
        <div className="flex items-center">
          <SectionLabel>Da mais cara para a mais barata</SectionLabel>
          <div className="mb-3 ml-auto">{addButton}</div>
        </div>
        <ul className="flex flex-col gap-2">
          {data.debts.map((debt) => (
            <li key={debt.id}>
              <Card className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{debt.name}</p>
                  <p className="text-xs text-muted">
                    {rateLabel(debt.rateBp)} · vence dia {debt.dueDay}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium tabular-nums">{money(debt.balanceCents)}</p>
                  <p className="text-xs text-muted tabular-nums">
                    parcela {money(debt.minPaymentCents)}
                  </p>
                </div>
                <div className="flex items-center">
                  <Button size="sm" variant="ghost" onClick={() => setRenegotiating(debt)}>
                    <Scale size={13} /> Renegociar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Editar ${debt.name}`}
                    onClick={() => setEditing(debt)}
                  >
                    <Pencil size={13} />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Apagar ${debt.name}`}
                    onClick={() => remove.mutate({ id: debt.id })}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <PayoffCard />
      {dialogs}
    </div>
  );
}
