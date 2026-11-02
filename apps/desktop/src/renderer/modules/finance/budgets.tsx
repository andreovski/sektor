import { Copy, PieChart, Plus, Target, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { money, monthLabel, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, CardHeader, cn, Dialog, EmptyState, Field } from '../../ui';
import {
  CategoryIcon,
  CategorySelect,
  Metric,
  MoneyInput,
  MonthSwitcher,
  Pill,
  Skeleton,
  useCategories,
} from './parts';
import {
  type Budget,
  budgetBar,
  type Category,
  categoryLabel,
  categorySlices,
  comparisonText,
  monthOfDay,
} from './utils';

const LEVEL_BG = { ok: 'bg-primary', warn: 'bg-warning', over: 'bg-danger' };

export function BudgetsTab() {
  const [month, setMonth] = useState(monthOfDay(todayString()));
  const categories = useCategories();
  const budgets = useRpc('budgets.list', { month });
  const summary = useRpc('reports.month', { month });
  const copy = useRpcMutation('budgets.copyPrevious');
  const [dialog, setDialog] = useState<{ budget?: Budget } | null>(null);

  const list = budgets.data ?? [];
  const spent = list.reduce((sum, b) => sum + b.spentCents, 0);
  const limit = list.reduce((sum, b) => sum + b.limitCents, 0);
  const atRisk = list.filter((b) => budgetBar(b).level !== 'ok').length;
  const s = summary.data;
  const previousName = s ? monthLabel(s.previous.month).split(' ')[0]!.toLowerCase() : '';
  const slices = s ? categorySlices(s.expenseByCategory, categories) : [];
  const copyButton = (
    <Button disabled={copy.isPending} onClick={() => copy.mutate({ month })}>
      <Copy size={14} /> Copiar do mês anterior
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <MonthSwitcher month={month} onChange={setMonth} />
        <div className="ml-auto flex gap-2">
          {copyButton}
          <Button variant="primary" onClick={() => setDialog({})}>
            <Plus size={14} /> Definir limite
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <Metric
            label="Receitas"
            value={money(s?.incomeCents ?? 0)}
            tone="success"
            hint={s ? comparisonText(s.incomeCents, s.previous.incomeCents, previousName) : null}
          />
        </Card>
        <Card>
          <Metric
            label="Despesas"
            value={money(s?.expenseCents ?? 0)}
            tone="danger"
            hint={s ? comparisonText(s.expenseCents, s.previous.expenseCents, previousName) : null}
          />
        </Card>
        <Card>
          <Metric
            label="Resultado"
            value={money(s?.netCents ?? 0)}
            tone={(s?.netCents ?? 0) < 0 ? 'danger' : undefined}
            hint={
              s && (s.plannedIncomeCents || s.plannedExpenseCents)
                ? `Ainda previstos: +${money(s.plannedIncomeCents)} e −${money(s.plannedExpenseCents)}`
                : null
            }
          />
        </Card>
      </div>

      <div className="grid grid-cols-[3fr_2fr] items-start gap-4">
        <Card>
          <CardHeader
            icon={Target}
            title="Orçamentos"
            action={list.length ? `${money(spent)} de ${money(limit)}` : undefined}
          />
          {atRisk > 0 && (
            <p className="mb-3 flex items-center gap-2 text-sm text-warning">
              <TriangleAlert size={14} />
              {atRisk === 1 ? '1 categoria' : `${atRisk} categorias`} perto ou acima do limite.
            </p>
          )}
          {budgets.isPending ? (
            <Skeleton className="h-32" />
          ) : list.length === 0 ? (
            <EmptyState
              icon={Target}
              title="Nenhum orçamento"
              text={`Defina quanto quer gastar por categoria em ${monthLabel(month).toLowerCase()}.`}
            />
          ) : (
            <div className="flex flex-col">
              {list.map((budget) => (
                <BudgetRow
                  key={budget.id}
                  budget={budget}
                  categories={categories}
                  onClick={() => setDialog({ budget })}
                />
              ))}
            </div>
          )}
        </Card>
        <Card>
          <CardHeader icon={PieChart} title="Despesas por categoria" />
          {summary.isPending ? (
            <Skeleton className="h-32" />
          ) : slices.length === 0 ? (
            <EmptyState icon={PieChart} title="Sem despesas neste mês" />
          ) : (
            <div className="flex flex-col gap-3">
              {slices.map((slice) => (
                <div key={slice.categoryId ?? 'sem'} className="flex items-center gap-2.5">
                  <CategoryIcon category={slice.category} categories={categories} />
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-sm">
                      <span className="truncate">{slice.name}</span>
                      <span className="tabular-nums">{money(slice.totalCents)}</span>
                    </div>
                    <div className="mt-1 h-1 overflow-hidden rounded-full bg-hover">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${slice.percent}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      {dialog && (
        <BudgetDialog
          month={month}
          budget={dialog.budget}
          categories={categories}
          usedIds={list.map((b) => b.categoryId)}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function BudgetRow({
  budget,
  categories,
  onClick,
}: {
  budget: Budget;
  categories: Category[];
  onClick(): void;
}) {
  const category = categories.find((c) => c.id === budget.categoryId) ?? null;
  const bar = budgetBar(budget);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-control p-2 text-left hover:bg-hover"
    >
      <CategoryIcon category={category} categories={categories} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm">
          <span className="truncate">{category ? categoryLabel(category, categories) : 'Categoria'}</span>
          {bar.level === 'warn' && <Pill tone="warning">Atenção</Pill>}
          {bar.level === 'over' && <Pill tone="danger">Estourou</Pill>}
          <span className="ml-auto shrink-0 text-muted tabular-nums">
            <span className="font-medium text-foreground">{money(budget.spentCents)}</span> de{' '}
            {money(budget.limitCents)}
          </span>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={budget.limitCents}
          aria-valuenow={budget.spentCents}
          className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-hover"
        >
          <div className={LEVEL_BG[bar.level]} style={{ width: `${bar.spentWidth}%` }} />
          <div
            className={cn(LEVEL_BG[bar.level], 'opacity-35')}
            style={{ width: `${bar.plannedWidth}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-subtle tabular-nums">
          {bar.remainingCents >= 0
            ? `Faltam ${money(bar.remainingCents)}`
            : `${money(-bar.remainingCents)} acima do limite`}
        </p>
      </div>
    </button>
  );
}

function BudgetDialog({
  month,
  budget,
  categories,
  usedIds,
  onClose,
}: {
  month: string;
  budget?: Budget;
  categories: Category[];
  usedIds: string[];
  onClose(): void;
}) {
  const upsert = useRpcMutation('budgets.upsert');
  const remove = useRpcMutation('budgets.delete');
  const [categoryId, setCategoryId] = useState(budget?.categoryId ?? '');
  const [limit, setLimit] = useState<number | null>(budget?.limitCents ?? null);
  const busy = upsert.isPending || remove.isPending;

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={budget ? 'Editar limite' : 'Definir limite'}
    >
      <div className="flex flex-col gap-3">
        <Field label={`Categoria em ${monthLabel(month).toLowerCase()}`}>
          <CategorySelect
            value={categoryId}
            onChange={setCategoryId}
            kind="EXPENSE"
            categories={categories}
            placeholder="Escolher"
            disabled={Boolean(budget)}
            disabledIds={budget ? [] : usedIds}
          />
        </Field>
        <Field label="Limite do mês">
          <MoneyInput value={limit} onChange={setLimit} />
        </Field>
        <p className="text-xs text-subtle">O limite da categoria também cobre as subcategorias dela.</p>
        <div className="flex gap-2">
          {budget && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => remove.mutateAsync({ id: budget.id }).then(onClose, () => {})}
            >
              Apagar
            </Button>
          )}
          <Button
            variant="primary"
            className="ml-auto"
            disabled={busy || !categoryId || !limit || limit <= 0}
            onClick={() =>
              upsert
                .mutateAsync({ categoryId, month, limitCents: limit! })
                .then(onClose, () => {})
            }
          >
            Salvar
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
