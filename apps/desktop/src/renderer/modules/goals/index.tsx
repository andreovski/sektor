import type { Rpc } from '@sektor/core';
import { CalendarClock, Link2, Pencil, Plus, Target, TriangleAlert, Unlink } from 'lucide-react';
import { useState } from 'react';

import { money, shortDate } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import {
  Button,
  Card,
  cn,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionLabel,
  Segmented,
  Select,
  Stat,
} from '../../ui';
import { Group, type Tone, TonePicker, toneVar } from '../habits/tone';

type Goal = Awaited<ReturnType<Rpc['goals.list']>>[number];
type Sources = Awaited<ReturnType<Rpc['goals.sources']>>;
type Area = Goal['area'];
type Source = Goal['source'];
type Filter = 'OPEN' | 'DONE' | 'ALL';

const AREAS: Record<Area, string> = {
  SAUDE: 'Saúde',
  FINANCAS: 'Finanças',
  CARREIRA: 'Carreira',
  ESTUDOS: 'Estudos',
  RELACIONAMENTOS: 'Relacionamentos',
  PESSOAL: 'Pessoal',
};

const SOURCES: { value: Source; label: string }[] = [
  { value: 'MANUAL', label: 'Manual' },
  { value: 'PROJECT_TASKS', label: 'Tarefas' },
  { value: 'HABIT_STREAK', label: 'Hábito' },
  { value: 'ACCOUNT_BALANCE', label: 'Conta' },
];

const SOURCE_TEXT: Record<Exclude<Source, 'MANUAL'>, string> = {
  PROJECT_TASKS: 'Tarefas concluídas de',
  HABIT_STREAK: 'Sequência de',
  ACCOUNT_BALANCE: 'Saldo de',
};

const STATUS: Partial<Record<Goal['pace']['status'], { label: string; className: string }>> = {
  done: { label: 'Concluída', className: 'text-success' },
  ahead: { label: 'Adiantada', className: 'text-success' },
  on_track: { label: 'No ritmo', className: 'text-muted' },
  behind: { label: 'Atrasada', className: 'text-warning' },
  overdue: { label: 'Prazo vencido', className: 'text-danger' },
  unreachable: { label: 'Não cabe no prazo', className: 'text-danger' },
};

const NUMBER = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

function amount(goal: Pick<Goal, 'money' | 'unit'>, value: number) {
  return goal.money ? money(value) : `${NUMBER.format(value)} ${goal.unit}`;
}

/** "1.500,50" ou "1500.5" viram número; vazio ou lixo, `null`. */
function parseNumber(text: string): number | null {
  const clean = text.trim();
  if (!clean) return null;
  const normalized = clean.includes(',') ? clean.replace(/\./g, '').replace(',', '.') : clean;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

const toStored = (value: number, isMoney: boolean) => (isMoney ? Math.round(value * 100) : value);
const toInput = (value: number, isMoney: boolean) =>
  new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2, useGrouping: false }).format(
    isMoney ? value / 100 : value
  );

const PERIOD = { month: 'por mês', week: 'por semana', day: 'por dia' };

function paceText(goal: Goal) {
  const { status, remaining, perPeriod, period, daysLeft } = goal.pace;
  if (status === 'done') return 'Alvo alcançado';
  const left = `Faltam ${amount(goal, remaining)}`;
  if (status === 'overdue') return left;
  if (status === 'no_deadline') return `${left}, sem prazo`;
  if (status === 'unreachable') return `${left}, e restam ${daysLeft} até o prazo`;
  if (perPeriod === null || period === null) return left;
  return `${left}, ${amount(goal, perPeriod)} ${PERIOD[period]}`;
}

function deadlineText({ deadline, pace }: Goal) {
  if (!deadline) return 'Sem prazo';
  const date = `${shortDate(deadline)}/${deadline.slice(0, 4)}`;
  if (pace.status === 'done' || pace.daysLeft === null) return date;
  if (pace.daysLeft < 0) return `${date}, há ${-pace.daysLeft} dias`;
  if (pace.daysLeft === 0) return `${date}, hoje`;
  return `${date}, em ${pace.daysLeft} ${pace.daysLeft === 1 ? 'dia' : 'dias'}`;
}

function GoalCard({
  goal,
  onEdit,
  onProgress,
}: {
  goal: Goal;
  onEdit(goal: Goal): void;
  onProgress(goal: Goal): void;
}) {
  const percent = Math.round(goal.pace.progress * 100);
  const status = STATUS[goal.pace.status];
  return (
    <Card className="group flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] tracking-[0.08em] text-subtle uppercase">{AREAS[goal.area]}</p>
          <h3 className="truncate font-medium" title={goal.title}>
            {goal.title}
          </h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Editar ${goal.title}`}
          className="px-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={() => onEdit(goal)}
        >
          <Pencil size={14} />
        </Button>
        <span className="text-xl font-semibold tabular-nums" style={{ color: toneVar(goal.color) }}>
          {percent}%
        </span>
      </div>

      <div>
        <div
          role="progressbar"
          aria-label={`Progresso de ${goal.title}`}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-2 overflow-hidden rounded-full bg-sunken"
        >
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${percent}%`, background: toneVar(goal.color) }}
          />
        </div>
        <p className="mt-1.5 flex justify-between text-xs tabular-nums text-muted">
          <span>{amount(goal, goal.current)}</span>
          <span>{amount(goal, goal.target)}</span>
        </p>
      </div>

      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 text-sm">{paceText(goal)}</p>
        {status && (
          <span className={cn('shrink-0 text-xs font-medium', status.className)}>{status.label}</span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-3 border-t border-line pt-2.5 text-xs text-muted">
        <span className="flex items-center gap-1 whitespace-nowrap">
          <CalendarClock size={12} />
          {deadlineText(goal)}
        </span>
        {goal.source === 'MANUAL' ? (
          <Button size="sm" className="ml-auto" onClick={() => onProgress(goal)}>
            Atualizar
          </Button>
        ) : goal.sourceMissing ? (
          <span className="ml-auto flex items-center gap-1 text-warning">
            <Unlink size={12} />
            Ligação perdida
          </span>
        ) : (
          <span className="ml-auto flex min-w-0 items-center gap-1" title={goal.sourceLabel ?? ''}>
            <Link2 size={12} className="shrink-0" />
            <span className="truncate">
              {SOURCE_TEXT[goal.source]} {goal.sourceLabel}
            </span>
          </span>
        )}
      </div>
    </Card>
  );
}

interface Draft {
  title: string;
  area: Area;
  target: string;
  unit: string;
  isMoney: boolean;
  deadline: string;
  color: Tone;
  source: Source;
  sourceId: string;
  initial: string;
}

const emptyDraft = (): Draft => ({
  title: '',
  area: 'PESSOAL',
  target: '',
  unit: '',
  isMoney: false,
  deadline: '',
  color: 'green',
  source: 'MANUAL',
  sourceId: '',
  initial: '',
});

const draftOf = (goal: Goal): Draft => ({
  title: goal.title,
  area: goal.area,
  target: toInput(goal.target, goal.money),
  unit: goal.money ? '' : goal.unit,
  isMoney: goal.money,
  deadline: goal.deadline ?? '',
  color: goal.color,
  source: goal.source,
  sourceId: goal.sourceId ?? '',
  initial: '',
});

function sourceOptions(sources: Sources | undefined, source: Source) {
  if (source === 'PROJECT_TASKS') {
    return (sources?.projects ?? []).map((p) => ({
      id: p.id,
      label: `${p.label} (${p.total} ${p.total === 1 ? 'tarefa' : 'tarefas'})`,
    }));
  }
  if (source === 'ACCOUNT_BALANCE') {
    return (sources?.accounts ?? []).map((a) => ({
      id: a.id,
      label: `${a.label} (${money(a.balanceCents)})`,
    }));
  }
  return source === 'HABIT_STREAK' ? (sources?.habits ?? []) : [];
}

const SOURCE_FIELD: Record<Exclude<Source, 'MANUAL'>, { label: string; empty: string }> = {
  PROJECT_TASKS: { label: 'Projeto', empty: 'Nenhum projeto ainda. Crie um em Projetos.' },
  HABIT_STREAK: { label: 'Hábito', empty: 'Nenhum hábito ainda. Crie um em Hábitos.' },
  ACCOUNT_BALANCE: { label: 'Conta', empty: 'Nenhuma conta ainda. Crie uma em Finanças.' },
};

const TARGET_LABEL: Record<Exclude<Source, 'MANUAL'>, string> = {
  PROJECT_TASKS: 'Tarefas concluídas',
  HABIT_STREAK: 'Dias de sequência',
  ACCOUNT_BALANCE: 'Valor a guardar (R$)',
};

function GoalDialog({
  initial,
  editing,
  onClose,
}: {
  initial: Draft;
  editing: Goal | null;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const sources = useRpc('goals.sources');
  const create = useRpcMutation('goals.create');
  const update = useRpcMutation('goals.update');
  const remove = useRpcMutation('goals.delete');
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const options = sourceOptions(sources.data, draft.source);
  const linked = draft.source !== 'MANUAL';
  const isMoney = draft.source === 'ACCOUNT_BALANCE' || (draft.source === 'MANUAL' && draft.isMoney);
  const target = parseNumber(draft.target);
  const ready =
    draft.title.trim() &&
    target !== null &&
    target > 0 &&
    (linked ? draft.sourceId : isMoney || draft.unit.trim());

  const submit = () => {
    if (!ready || target === null) return;
    const body = {
      title: draft.title,
      area: draft.area,
      target: toStored(target, isMoney),
      unit: isMoney ? 'R$' : draft.unit,
      deadline: draft.deadline || null,
      color: draft.color,
      source: draft.source,
      sourceId: linked ? draft.sourceId : null,
      manualValue: toStored(parseNumber(draft.initial) ?? 0, isMoney),
    };
    const done = { onSuccess: onClose };
    if (editing) update.mutate({ ...body, id: editing.id }, done);
    else create.mutate(body, done);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={editing ? 'Editar meta' : 'Nova meta'}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Field label="Título">
          <Input
            autoFocus
            maxLength={120}
            value={draft.title}
            placeholder="Onde você quer chegar?"
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Área da vida">
            <Select
              value={draft.area}
              onChange={(event) => set({ area: event.target.value as Area })}
            >
              {Object.entries(AREAS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prazo">
            <Input
              type="date"
              value={draft.deadline}
              onChange={(event) => set({ deadline: event.target.value })}
            />
          </Field>
        </div>
        <Group label="Progresso">
          <div>
            <Segmented
              value={draft.source}
              onChange={(source) => set({ source, sourceId: '' })}
              options={SOURCES}
            />
          </div>
        </Group>
        {linked && (
          <Field label={SOURCE_FIELD[draft.source as keyof typeof SOURCE_FIELD].label}>
            {options.length === 0 && !sources.isPending ? (
              <p className="text-sm text-subtle">
                {SOURCE_FIELD[draft.source as keyof typeof SOURCE_FIELD].empty}
              </p>
            ) : (
              <Select
                value={draft.sourceId}
                onChange={(event) => set({ sourceId: event.target.value })}
              >
                <option value="">Escolha…</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {linked ? (
          <Field label={TARGET_LABEL[draft.source as keyof typeof TARGET_LABEL]}>
            <Input
              inputMode="decimal"
              value={draft.target}
              onChange={(event) => set({ target: event.target.value })}
            />
          </Field>
        ) : (
          <>
            <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-3">
              <Field label="Alvo">
                <Input
                  inputMode="decimal"
                  placeholder={isMoney ? '10.000,00' : '100'}
                  value={draft.target}
                  onChange={(event) => set({ target: event.target.value })}
                />
              </Field>
              <Field label="Unidade">
                <Input
                  placeholder="km, livros…"
                  maxLength={20}
                  disabled={isMoney}
                  value={isMoney ? 'R$' : draft.unit}
                  onChange={(event) => set({ unit: event.target.value })}
                />
              </Field>
              <label className="flex h-8 items-center gap-1.5 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={draft.isMoney}
                  disabled={Boolean(editing)}
                  onChange={(event) => set({ isMoney: event.target.checked })}
                />
                Dinheiro
              </label>
            </div>
            {!editing && (
              <Field label="Já tenho">
                <Input
                  inputMode="decimal"
                  placeholder="0"
                  value={draft.initial}
                  onChange={(event) => set({ initial: event.target.value })}
                />
              </Field>
            )}
          </>
        )}
        <Group label="Cor">
          <TonePicker value={draft.color} onChange={(color) => set({ color })} />
        </Group>
        <div className="mt-1 flex items-center gap-2">
          {editing &&
            (confirming ? (
              <Button
                variant="danger"
                onClick={() => remove.mutate({ id: editing.id }, { onSuccess: onClose })}
              >
                Apagar de vez
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirming(true)}>
                Apagar
              </Button>
            ))}
          <Button variant="ghost" className="ml-auto" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={!ready || create.isPending || update.isPending}
          >
            {editing ? 'Salvar' : 'Criar meta'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ProgressDialog({ goal, onClose }: { goal: Goal; onClose(): void }) {
  const [text, setText] = useState(toInput(goal.current, goal.money));
  const save = useRpcMutation('goals.setProgress');
  const value = parseNumber(text);
  const valid = value !== null && value >= 0;
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()} title="Atualizar progresso">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) {
            save.mutate(
              { id: goal.id, value: toStored(value, goal.money) },
              { onSuccess: onClose }
            );
          }
        }}
      >
        <Field label={`Quanto você tem agora (alvo: ${amount(goal, goal.target)})`}>
          <Input
            autoFocus
            inputMode="decimal"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={!valid || save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Summary({ goals }: { goals: Goal[] }) {
  const open = goals.filter((goal) => goal.pace.status !== 'done');
  const next = open.find((goal) => goal.deadline && (goal.pace.daysLeft ?? -1) >= 0);
  const late = open.filter((goal) =>
    ['behind', 'overdue', 'unreachable'].includes(goal.pace.status)
  ).length;
  return (
    <div className="mb-6 grid grid-cols-4 gap-3">
      <Card>
        <Stat label="Em andamento" value={open.length} hint={`de ${goals.length} metas`} />
      </Card>
      <Card>
        <Stat
          label="Concluídas"
          value={goals.length - open.length}
          hint="alvo alcançado"
        />
      </Card>
      <Card>
        <Stat
          label="Pedem atenção"
          value={<span className={cn(late > 0 && 'text-warning')}>{late}</span>}
          hint="atrasadas ou fora do prazo"
        />
      </Card>
      <Card>
        <Stat
          label="Próximo prazo"
          value={next ? shortDate(next.deadline!) : '—'}
          hint={next?.title ?? 'nenhum prazo aberto'}
        />
      </Card>
    </div>
  );
}

function Page() {
  const list = useRpc('goals.list');
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [dialog, setDialog] = useState<{ key: number; draft: Draft; editing: Goal | null } | null>(
    null
  );
  const [updating, setUpdating] = useState<Goal | null>(null);

  const goals = list.data ?? [];
  const visible = goals.filter((goal) => {
    if (filter === 'ALL') return true;
    return (goal.pace.status === 'done') === (filter === 'DONE');
  });
  const add = () => setDialog({ key: Date.now(), draft: emptyDraft(), editing: null });

  return (
    <>
      <PageHeader
        icon={Target}
        title="Metas"
        description="Onde você quer chegar, e em que ritmo"
        actions={
          <Button variant="primary" onClick={add}>
            <Plus size={15} />
            Nova meta
          </Button>
        }
      />
      {list.isPending ? (
        <div className="grid grid-cols-2 gap-3" aria-label="Carregando metas">
          {[0, 1].map((card) => (
            <div key={card} className="h-44 animate-pulse rounded-panel border border-line bg-surface" />
          ))}
        </div>
      ) : list.isError ? (
        <Card>
          <EmptyState
            icon={TriangleAlert}
            title="Não deu para abrir as metas"
            text={list.error.message}
            action={<Button onClick={() => list.refetch()}>Tentar de novo</Button>}
          />
        </Card>
      ) : goals.length === 0 ? (
        <Card>
          <EmptyState
            icon={Target}
            title="Nenhuma meta ainda"
            text="Dê um alvo e um prazo. O ritmo necessário aparece aqui."
            action={
              <Button variant="primary" onClick={add}>
                Criar a primeira
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          <Summary goals={goals} />
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Suas metas</SectionLabel>
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'OPEN', label: 'Em andamento' },
                { value: 'DONE', label: 'Concluídas' },
                { value: 'ALL', label: 'Todas' },
              ]}
            />
          </div>
          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={Target}
                title={filter === 'DONE' ? 'Nenhuma concluída ainda' : 'Nada em andamento'}
              />
            </Card>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {visible.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  onEdit={(target) =>
                    setDialog({ key: Date.now(), draft: draftOf(target), editing: target })
                  }
                  onProgress={setUpdating}
                />
              ))}
            </div>
          )}
        </>
      )}
      {dialog && (
        <GoalDialog
          key={dialog.key}
          initial={dialog.draft}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      )}
      {updating && <ProgressDialog goal={updating} onClose={() => setUpdating(null)} />}
    </>
  );
}

export const routes = [{ path: '/metas', component: Page }];
