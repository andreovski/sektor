import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Rpc } from '@sektor/core';
import { Check, Flag, Flame, GripVertical, Pencil, Plus, Repeat2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import { longDate, shortDate, todayString } from '../../lib/format';
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

import { Group, type Tone, TonePicker, toneVar } from './tone';

type Habit = Awaited<ReturnType<Rpc['habits.list']>>[number];
type Kind = Habit['kind'];
type Frequency = Habit['frequency'];
type Filter = 'ALL' | Kind;

interface Draft {
  name: string;
  kind: Kind;
  frequency: Frequency;
  timesPerWeek: number;
  endOn: string;
  color: Tone;
}

const SUGGESTIONS: Pick<Draft, 'name' | 'frequency' | 'timesPerWeek' | 'color'>[] = [
  { name: 'Beber 2 litros de água', frequency: 'DAILY', timesPerWeek: 3, color: 'cyan' },
  { name: 'Ler 10 páginas', frequency: 'DAILY', timesPerWeek: 3, color: 'violet' },
  { name: 'Treinar', frequency: 'TIMES', timesPerWeek: 3, color: 'orange' },
  { name: 'Caminhar 30 minutos', frequency: 'TIMES', timesPerWeek: 5, color: 'green' },
  { name: 'Estudar inglês', frequency: 'WEEKDAYS', timesPerWeek: 3, color: 'blue' },
  { name: 'Meditar 5 minutos', frequency: 'DAILY', timesPerWeek: 3, color: 'rose' },
  { name: 'Dormir antes da meia-noite', frequency: 'DAILY', timesPerWeek: 3, color: 'amber' },
  { name: 'Anotar os gastos do dia', frequency: 'WEEKDAYS', timesPerWeek: 3, color: 'green' },
];

const CHALLENGE_DAYS = [21, 30, 66];

function addDaysTo(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const emptyDraft = (): Draft => ({
  name: '',
  kind: 'CONTINUOUS',
  frequency: 'DAILY',
  timesPerWeek: 3,
  endOn: addDaysTo(todayString(), 30),
  color: 'green',
});

const draftOf = (habit: Habit): Draft => ({
  name: habit.name,
  kind: habit.kind,
  frequency: habit.frequency,
  timesPerWeek: habit.timesPerWeek ?? 3,
  endOn: habit.endOn ?? addDaysTo(todayString(), 30),
  color: habit.color,
});

function frequencyLabel(habit: Pick<Habit, 'frequency' | 'timesPerWeek'>) {
  if (habit.frequency === 'DAILY') return 'Todo dia';
  if (habit.frequency === 'WEEKDAYS') return 'Dias úteis';
  return `${habit.timesPerWeek}× em 7 dias`;
}

const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`);
const days = (value: number) => `${value} ${value === 1 ? 'dia' : 'dias'}`;

const weekdayOf = (date: string) =>
  new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
    .format(new Date(`${date}T00:00:00Z`))
    .replace('.', '');

function DayGrid({ habit }: { habit: Habit }) {
  const toggle = useRpcMutation('habits.toggle');
  const today = habit.grid.at(-1)?.date;
  return (
    <div className="flex items-center" role="group" aria-label={`Últimos 28 dias de ${habit.name}`}>
      {habit.grid.map((cell, index) => {
        const label = `${weekdayOf(cell.date)}, ${shortDate(cell.date)}: ${cell.done ? 'feito' : 'sem marca'}`;
        return (
          <button
            key={cell.date}
            type="button"
            title={cell.locked ? `${shortDate(cell.date)}: depois do fim do desafio` : label}
            aria-label={label}
            aria-pressed={cell.done}
            disabled={cell.locked || toggle.isPending}
            onClick={() => toggle.mutate({ id: habit.id, date: cell.date })}
            style={cell.done ? { background: toneVar(habit.color) } : undefined}
            className={cn(
              'size-[17px] shrink-0 rounded-[4px] transition-transform hover:scale-110 disabled:cursor-default disabled:hover:scale-100',
              index > 0 && (index % 7 === 0 ? 'ml-[7px]' : 'ml-[3px]'),
              !cell.done && 'border border-line bg-sunken',
              !cell.done && !cell.scheduled && 'opacity-40',
              cell.done && !cell.scheduled && 'opacity-55',
              cell.locked && 'opacity-20',
              cell.date === today && 'outline-1 outline-offset-1 outline-foreground/60'
            )}
          />
        );
      })}
    </div>
  );
}

function TodayButton({ habit }: { habit: Habit }) {
  const toggle = useRpcMutation('habits.toggle');
  const today = habit.grid.at(-1)!.date;
  return (
    <button
      type="button"
      aria-label={habit.doneToday ? `Desmarcar ${habit.name} hoje` : `Marcar ${habit.name} hoje`}
      aria-pressed={habit.doneToday}
      disabled={habit.ended || toggle.isPending}
      onClick={() => toggle.mutate({ id: habit.id, date: today })}
      style={
        habit.doneToday
          ? { background: toneVar(habit.color), borderColor: toneVar(habit.color) }
          : { borderColor: toneVar(habit.color) }
      }
      className="grid size-8 shrink-0 place-items-center rounded-full border-2 text-on-primary transition-transform hover:scale-105 disabled:opacity-40"
    >
      {habit.doneToday && <Check size={16} strokeWidth={3} />}
    </button>
  );
}

function Note({ habit }: { habit: Habit }) {
  if (habit.atRisk) {
    return (
      <span className="flex items-center gap-1 text-warning">
        <TriangleAlert size={12} />
        Sequência em risco hoje
      </span>
    );
  }
  if (!habit.challenge) return <span>{frequencyLabel(habit)}</span>;
  const { done, target, daysLeft } = habit.challenge;
  return (
    <span className="flex items-center gap-1">
      <Flag size={12} />
      {frequencyLabel(habit)} · {done} de {target}
      {habit.ended ? ' · encerrado' : ` · ${days(daysLeft)} até ${shortDate(habit.endOn!)}`}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="w-[52px] text-right">
      <p className="text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-subtle">{label}</p>
    </div>
  );
}

function HabitRow({
  habit,
  draggable,
  onEdit,
}: {
  habit: Habit;
  draggable: boolean;
  onEdit(habit: Habit): void;
}) {
  const sortable = useSortable({ id: habit.id, disabled: !draggable });
  return (
    <div
      ref={sortable.setNodeRef}
      style={{
        transform: CSS.Translate.toString(sortable.transform),
        transition: sortable.transition,
      }}
      className={cn('group', sortable.isDragging && 'relative z-10 opacity-80')}
    >
      <Card className="flex items-center gap-3 p-3">
        {draggable && (
          <button
            type="button"
            aria-label={`Mover ${habit.name}`}
            className="-mx-1 cursor-grab touch-none text-subtle hover:text-foreground active:cursor-grabbing"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical size={16} />
          </button>
        )}
        <TodayButton habit={habit} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={habit.name}>
            {habit.name}
          </p>
          <div className="truncate text-xs text-muted">
            <Note habit={habit} />
          </div>
        </div>
        <DayGrid habit={habit} />
        <div className="flex shrink-0 items-center">
          <Metric label="taxa" value={percent(habit.rate)} />
          <Metric label="seq." value={habit.streak} />
          <Metric label="maior" value={habit.longestStreak} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Editar ${habit.name}`}
          className="px-1.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          onClick={() => onEdit(habit)}
        >
          <Pencil size={14} />
        </Button>
      </Card>
    </div>
  );
}

function Suggestions({ onPick }: { onPick(suggestion: (typeof SUGGESTIONS)[number]): void }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5">
      {SUGGESTIONS.map((suggestion) => (
        <button
          key={suggestion.name}
          type="button"
          onClick={() => onPick(suggestion)}
          className="flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-xs text-muted hover:bg-hover hover:text-foreground"
        >
          <span className="size-2 rounded-full" style={{ background: toneVar(suggestion.color) }} />
          {suggestion.name}
        </button>
      ))}
    </div>
  );
}

function HabitDialog({
  initial,
  editing,
  onClose,
}: {
  initial: Draft;
  editing: Habit | null;
  onClose(): void;
}) {
  const [draft, setDraft] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const create = useRpcMutation('habits.create');
  const update = useRpcMutation('habits.update');
  const remove = useRpcMutation('habits.delete');
  const set = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));

  const submit = () => {
    const body = {
      name: draft.name,
      kind: draft.kind,
      frequency: draft.frequency,
      timesPerWeek: draft.frequency === 'TIMES' ? draft.timesPerWeek : null,
      endOn: draft.kind === 'CHALLENGE' ? draft.endOn : null,
      color: draft.color,
    };
    const options = { onSuccess: onClose };
    if (editing) update.mutate({ ...body, id: editing.id }, options);
    else create.mutate(body, options);
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={editing ? 'Editar hábito' : 'Novo hábito'}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {!editing && (
          <div>
            <p className="mb-1.5 text-xs text-muted">Sugestões</p>
            <div className="[&>div]:justify-start">
              <Suggestions onPick={set} />
            </div>
          </div>
        )}
        <Field label="Nome">
          <Input
            autoFocus
            value={draft.name}
            maxLength={80}
            placeholder="O que você quer repetir?"
            onChange={(event) => set({ name: event.target.value })}
          />
        </Field>
        <Group label="Tipo">
          <div>
            <Segmented
              value={draft.kind}
              onChange={(kind) => set({ kind })}
              options={[
                { value: 'CONTINUOUS', label: 'Contínuo' },
                { value: 'CHALLENGE', label: 'Desafio com prazo' },
              ]}
            />
          </div>
        </Group>
        {draft.kind === 'CHALLENGE' && (
          <Group label="Termina em">
            <div className="flex items-center gap-2">
              <Input
                type="date"
                aria-label="Termina em"
                className="w-40"
                value={draft.endOn}
                onChange={(event) => set({ endOn: event.target.value })}
              />
              {CHALLENGE_DAYS.map((length) => (
                <Button
                  key={length}
                  size="sm"
                  variant="ghost"
                  onClick={() => set({ endOn: addDaysTo(todayString(), length - 1) })}
                >
                  {length} dias
                </Button>
              ))}
            </div>
          </Group>
        )}
        <Group label="Frequência">
          <div className="flex items-center gap-2">
            <Segmented
              value={draft.frequency}
              onChange={(frequency) => set({ frequency })}
              options={[
                { value: 'DAILY', label: 'Todo dia' },
                { value: 'WEEKDAYS', label: 'Dias úteis' },
                { value: 'TIMES', label: 'Vezes em 7 dias' },
              ]}
            />
            {draft.frequency === 'TIMES' && (
              <Select
                aria-label="Vezes em 7 dias"
                className="w-16"
                value={draft.timesPerWeek}
                onChange={(event) => set({ timesPerWeek: Number(event.target.value) })}
              >
                {[1, 2, 3, 4, 5, 6].map((times) => (
                  <option key={times} value={times}>
                    {times}×
                  </option>
                ))}
              </Select>
            )}
          </div>
        </Group>
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
            disabled={!draft.name.trim() || create.isPending || update.isPending}
          >
            {editing ? 'Salvar' : 'Criar hábito'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Summary({ habits }: { habits: Habit[] }) {
  const active = habits.filter((habit) => !habit.ended);
  const today = active.filter((habit) => habit.doneToday || habit.due);
  const rates = active.flatMap((habit) => (habit.rate === null ? [] : [habit.rate]));
  const average = rates.length ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null;
  const best = active.reduce<Habit | null>(
    (top, habit) => (habit.streak > (top?.streak ?? 0) ? habit : top),
    null
  );
  const risky = active.filter((habit) => habit.atRisk).length;
  return (
    <div className="mb-6 grid grid-cols-4 gap-3">
      <Card>
        <Stat
          label="Hoje"
          value={`${today.filter((habit) => habit.doneToday).length} de ${today.length}`}
          hint={longDate(todayString())}
        />
      </Card>
      <Card>
        <Stat label="Taxa em 28 dias" value={percent(average)} hint="média dos hábitos ativos" />
      </Card>
      <Card>
        <Stat
          label="Melhor sequência"
          value={best ? days(best.streak) : '—'}
          hint={best?.name ?? 'nenhuma por enquanto'}
        />
      </Card>
      <Card>
        <Stat
          label="Em risco"
          value={
            <span className={cn('flex items-center gap-1.5', risky > 0 && 'text-warning')}>
              {risky > 0 && <Flame size={18} />}
              {risky}
            </span>
          }
          hint={risky > 0 ? 'marque antes da meia-noite' : 'nenhuma sequência perto de cair'}
        />
      </Card>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex flex-col gap-2" aria-label="Carregando hábitos">
      {[0, 1, 2].map((row) => (
        <div key={row} className="h-[60px] animate-pulse rounded-panel border border-line bg-surface" />
      ))}
    </div>
  );
}

function Page() {
  const list = useRpc('habits.list');
  const reorder = useRpcMutation('habits.reorder');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [dialog, setDialog] = useState<{ key: number; initial: Draft; editing: Habit | null } | null>(
    null
  );
  const [order, setOrder] = useState<string[] | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const habits = list.data ?? [];
  const sorted = order
    ? order.flatMap((id) => habits.filter((habit) => habit.id === id))
    : habits;
  const visible = filter === 'ALL' ? sorted : sorted.filter((habit) => habit.kind === filter);

  const open = (initial: Draft, editing: Habit | null = null) =>
    setDialog({ key: Date.now(), initial, editing });

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = sorted.map((habit) => habit.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    reorder.mutate({ ids: next }, { onSettled: () => setOrder(null) });
  };

  return (
    <>
      <PageHeader
        icon={Repeat2}
        title="Hábitos"
        description="O que você repete, dia após dia"
        actions={
          <Button variant="primary" onClick={() => open(emptyDraft())}>
            <Plus size={15} />
            Novo hábito
          </Button>
        }
      />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Card>
          <EmptyState
            icon={TriangleAlert}
            title="Não deu para abrir os hábitos"
            text={list.error.message}
            action={<Button onClick={() => list.refetch()}>Tentar de novo</Button>}
          />
        </Card>
      ) : habits.length === 0 ? (
        <Card>
          <EmptyState
            icon={Repeat2}
            title="Nenhum hábito ainda"
            text="Comece por um pequeno. Escolha uma sugestão ou crie o seu."
            action={
              <Suggestions
                onPick={(suggestion) => open({ ...emptyDraft(), ...suggestion })}
              />
            }
          />
        </Card>
      ) : (
        <>
          <Summary habits={habits} />
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel>Últimos 28 dias</SectionLabel>
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'ALL', label: 'Todos' },
                { value: 'CONTINUOUS', label: 'Contínuos' },
                { value: 'CHALLENGE', label: 'Desafios' },
              ]}
            />
          </div>
          {visible.length === 0 ? (
            <Card>
              <EmptyState
                icon={Flag}
                title="Nenhum desafio em andamento"
                text="Um desafio tem começo e fim. Crie um com prazo."
              />
            </Card>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={visible.map((habit) => habit.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="flex flex-col gap-2">
                  {visible.map((habit) => (
                    <HabitRow
                      key={habit.id}
                      habit={habit}
                      draggable={filter === 'ALL'}
                      onEdit={(target) => open(draftOf(target), target)}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </>
      )}
      {dialog && (
        <HabitDialog
          key={dialog.key}
          initial={dialog.initial}
          editing={dialog.editing}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}

export const routes = [{ path: '/habitos', component: Page }];
