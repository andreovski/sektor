import type { Rpc } from '@sektor/core';
import type { PeriodKind } from '@sektor/core/src/modules/review/period';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, Check, ChevronLeft, ChevronRight, ListPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { money, monthLabel, shortDate } from '../../lib/format';
import { call, RpcError, useRpc, useRpcMutation } from '../../lib/rpc';
import {
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionLabel,
  Segmented,
  Stat,
  Textarea,
  cn,
} from '../../ui';
import { duration } from '../focus/time';

type View = Awaited<ReturnType<Rpc['review.get']>>;

const WEEKDAY = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' });
const MONTH = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });

function periodTitle({ kind, key, from, to }: View['period']) {
  if (kind === 'week') return `${shortDate(from)} a ${shortDate(to)}`;
  return kind === 'month' ? monthLabel(key) : key;
}

const upperFirst = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const rowLabel = (key: string) => {
  if (key.length === 7) return upperFirst(MONTH.format(new Date(`${key}-01T00:00:00Z`)));
  const name = WEEKDAY.format(new Date(`${key}T00:00:00Z`)).replace('.', '');
  return `${upperFirst(name)} ${shortDate(key)}`;
};

const mood = (value: number | null) =>
  value === null ? '—' : value.toFixed(1).replace('.', ',');

function Numbers({ totals, available }: Pick<View, 'totals' | 'available'>) {
  const soon = 'Ainda sem esse módulo';
  return (
    <div className="grid grid-cols-5 gap-4">
      <Card>
        <Stat label="Tarefas feitas" value={totals.tasks ?? '—'} hint={available.tasks ? undefined : soon} />
      </Card>
      <Card>
        <Stat label="Foco" value={duration(totals.focusSeconds)} />
      </Card>
      <Card>
        <Stat label="Hábitos" value={totals.habits ?? '—'} hint={available.habits ? undefined : soon} />
      </Card>
      <Card>
        <Stat label="Humor médio" value={mood(totals.mood)} hint={available.mood ? undefined : soon} />
      </Card>
      <Card>
        <Stat
          label="Gastos"
          value={totals.expenseCents === null ? '—' : money(totals.expenseCents)}
          hint={available.expenses ? undefined : soon}
        />
      </Card>
    </div>
  );
}

function DayByDay({ days, kind }: { days: View['days']; kind: PeriodKind }) {
  const empty = days.every(
    (d) => !d.tasks && !d.focusSeconds && !d.habits && d.mood === null && !d.expenseCents
  );
  if (empty) {
    return (
      <Card>
        <EmptyState
          icon={CalendarCheck}
          title="Nada registrado neste período"
          text="Tarefas feitas, foco, hábitos, humor e gastos aparecem aqui."
        />
      </Card>
    );
  }
  const cell = 'px-4 py-2 text-right tabular-nums';
  const dash = (value: number) => value || '—';
  return (
    <Card className="p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-subtle">
            <th scope="col" className="px-4 py-2 text-left font-medium">
              {kind === 'year' ? 'Mês' : 'Dia'}
            </th>
            {['Tarefas', 'Foco', 'Hábitos', 'Humor', 'Gastos'].map((name) => (
              <th key={name} scope="col" className="px-4 py-2 text-right font-medium">
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.key} className={cn('border-b border-line last:border-0', day.future && 'text-subtle')}>
              <th scope="row" className="px-4 py-2 text-left font-normal">
                {rowLabel(day.key)}
              </th>
              <td className={cell}>{dash(day.tasks)}</td>
              <td className={cell}>{day.focusSeconds ? duration(day.focusSeconds) : '—'}</td>
              <td className={cell}>{dash(day.habits)}</td>
              <td className={cell}>{mood(day.mood)}</td>
              <td className={cell}>{day.expenseCents ? money(day.expenseCents) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// `tasks.create` pode ainda não existir: chamada sem o tipo, e o 404 vira aviso.
const createTask = call as unknown as (
  method: 'tasks.create',
  input: { title: string }
) => Promise<{ id: string }>;

function ReviewForm({ weekStart, review }: { weekStart: string; review: View['review'] }) {
  const [wentWell, setWentWell] = useState(review?.wentWell ?? '');
  const [blocked, setBlocked] = useState(review?.blocked ?? '');
  const [priorities, setPriorities] = useState(() =>
    [0, 1, 2].map((index) => review?.priorities[index]?.text ?? '')
  );
  const [turning, setTurning] = useState(false);
  const save = useRpcMutation('review.save');
  const client = useQueryClient();

  const input = { weekStart, wentWell, blocked, priorities };
  const taskOf = (text: string) => review?.priorities.find((p) => p.text === text.trim())?.taskId;
  const pending = priorities.filter((text) => text.trim() && !taskOf(text));

  const turnIntoTasks = async () => {
    setTurning(true);
    try {
      const saved = await save.mutateAsync(input);
      let created = 0;
      for (const { text } of saved.priorities.filter((p) => !p.taskId)) {
        const task = await createTask('tasks.create', { title: text });
        await call('review.linkTask', { weekStart, text, taskId: task.id });
        created++;
      }
      toast.success(created === 1 ? '1 tarefa criada.' : `${created} tarefas criadas.`);
    } catch (error) {
      if (error instanceof RpcError && error.status === 404) {
        toast('Tarefas ainda não está disponível. As prioridades ficaram salvas.');
      } else {
        toast.error(error instanceof Error ? error.message : 'Não deu para criar as tarefas.');
      }
    } finally {
      setTurning(false);
      await client.invalidateQueries();
    }
  };

  return (
    <div className="grid grid-cols-2 gap-4">
      <Card className="flex flex-col gap-3">
        <Field label="O que deu certo">
          <Textarea rows={4} value={wentWell} onChange={(e) => setWentWell(e.target.value)} />
        </Field>
        <Field label="O que travou">
          <Textarea rows={4} value={blocked} onChange={(e) => setBlocked(e.target.value)} />
        </Field>
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="text-xs text-muted">3 prioridades da próxima semana</p>
        {priorities.map((text, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-4 text-center text-sm text-subtle tabular-nums">{index + 1}</span>
            <Input
              aria-label={`Prioridade ${index + 1}`}
              value={text}
              maxLength={300}
              onChange={(e) =>
                setPriorities(priorities.map((old, i) => (i === index ? e.target.value : old)))
              }
            />
            <span title={taskOf(text) ? 'Já virou tarefa' : undefined} className="w-4 text-primary">
              {taskOf(text) && <Check size={15} aria-label="Já virou tarefa" />}
            </span>
          </div>
        ))}
        <div className="mt-auto flex justify-end gap-2">
          <Button disabled={turning || pending.length === 0} onClick={() => void turnIntoTasks()}>
            <ListPlus size={15} /> Virar tarefas
          </Button>
          <Button
            variant="primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(input, { onSuccess: () => toast.success('Revisão salva.') })
            }
          >
            Salvar
          </Button>
        </div>
      </Card>
    </div>
  );
}

function ReviewPage() {
  const [kind, setKind] = useState<PeriodKind>('week');
  const [keys, setKeys] = useState<Partial<Record<PeriodKind, string>>>({});
  const { data } = useRpc('review.get', { kind, key: keys[kind] });
  // A resposta da outra aba ainda na tela não pode mandar a navegação para o tipo errado.
  const view = data?.period.kind === kind ? data : undefined;
  const go = (key: string) => setKeys({ ...keys, [kind]: key });

  return (
    <>
      <PageHeader
        icon={CalendarCheck}
        title="Revisão"
        description="Olhar para trás antes de planejar a frente."
        actions={
          <Segmented<PeriodKind>
            value={kind}
            onChange={setKind}
            options={[
              { value: 'week', label: 'Semana' },
              { value: 'month', label: 'Mês' },
              { value: 'year', label: 'Ano' },
            ]}
          />
        }
      />
      {!view ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" aria-label="Período anterior" onClick={() => go(view.period.previous)}>
              <ChevronLeft size={16} />
            </Button>
            <p className="min-w-40 text-center font-medium tabular-nums">{periodTitle(view.period)}</p>
            <Button
              variant="ghost"
              size="sm"
              aria-label="Próximo período"
              disabled={!view.period.next}
              onClick={() => view.period.next && go(view.period.next)}
            >
              <ChevronRight size={16} />
            </Button>
          </div>
          <Numbers totals={view.totals} available={view.available} />
          {kind === 'week' && (
            <div>
              <SectionLabel>Fechar a semana</SectionLabel>
              <ReviewForm
                key={`${view.period.key}:${view.review?.updatedAt ?? 0}`}
                weekStart={view.period.key}
                review={view.review}
              />
            </div>
          )}
          <div>
            <SectionLabel>{kind === 'year' ? 'Mês a mês' : 'Dia a dia'}</SectionLabel>
            <DayByDay days={view.days} kind={kind} />
          </div>
        </div>
      )}
    </>
  );
}

export const routes = [{ path: '/revisao', component: ReviewPage }];
