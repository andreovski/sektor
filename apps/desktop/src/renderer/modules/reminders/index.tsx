import { ALERT_OPTIONS, alertLabel } from '@sektor/core/src/modules/agenda/form';
import {
  addDays,
  type EventOccurrence,
  readTaskDue,
  type TaskDue,
} from '@sektor/core/src/modules/agenda/view';
import type { ReminderResponse } from '@sektor/core/src/modules/reminders/service';
import type { Schedule } from '@sektor/core/src/modules/reminders/schema';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  CalendarDays,
  CheckSquare,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { todayString } from '../../lib/format';
import { call, useRpc, useRpcMutation } from '../../lib/rpc';
import {
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionLabel,
  Segmented,
  Select,
  Textarea,
} from '../../ui';

const SCHEDULES: { value: Schedule; label: string }[] = [
  { value: 'ONCE', label: 'Uma vez' },
  { value: 'INTERVAL', label: 'A cada N horas' },
  { value: 'DAILY', label: 'Todo dia' },
  { value: 'WEEKDAYS', label: 'Dias úteis' },
  { value: 'WEEKLY', label: 'Toda semana' },
  { value: 'MONTHLY', label: 'Todo mês' },
];

const KIND_ICON = { EVENT: CalendarDays, TASK: CheckSquare, CUSTOM: Bell };
const KIND_LABEL = { EVENT: 'Evento', TASK: 'Tarefa', CUSTOM: 'Avulso' };

const nextText = (iso: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));

type Kind = keyof typeof KIND_LABEL;

function occurrenceOptions(list: EventOccurrence[]) {
  const seen = new Map<string, string>();
  for (const event of list) {
    if (event.source === 'LOCAL' && !seen.has(event.eventId)) seen.set(event.eventId, event.title);
  }
  return [...seen.entries()].map(([id, title]) => ({ id, title }));
}

function ReminderDialog({
  editing,
  onClose,
}: {
  editing: ReminderResponse | null;
  onClose(): void;
}) {
  const today = todayString();
  const [kind, setKind] = useState<Kind>('CUSTOM');
  const [title, setTitle] = useState(editing?.title ?? '');
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [schedule, setSchedule] = useState<Schedule>(editing?.schedule ?? 'DAILY');
  const [startDate, setStartDate] = useState(editing?.startDate ?? today);
  const [time, setTime] = useState(editing?.time ?? '09:00');
  const [hours, setHours] = useState(String(editing?.intervalHours ?? 2));
  const [windowStart, setWindowStart] = useState(editing?.windowStart ?? '08:00');
  const [windowEnd, setWindowEnd] = useState(editing?.windowEnd ?? '18:00');
  const [ownerId, setOwnerId] = useState('');
  const [minutes, setMinutes] = useState('0');

  const create = useRpcMutation('reminders.create');
  const update = useRpcMutation('reminders.update');
  const forEvent = useRpcMutation('reminders.createForEvent');
  const forTask = useRpcMutation('reminders.createForTask');
  const pending =
    create.isPending || update.isPending || forEvent.isPending || forTask.isPending;

  const events = useRpc('events.list', { from: today, to: addDays(today, 90) });
  // Tarefas são de outro módulo: sem elas, só a opção de tarefa fica vazia.
  const tasks = useQuery({
    queryKey: ['tasks.list', 'lembretes'],
    queryFn: () => call('tasks.list', { limit: 500 }),
    enabled: kind === 'TASK',
    retry: false,
  });
  const eventOptions = occurrenceOptions(events.data ?? []);
  const taskOptions = (Array.isArray(tasks.data) ? tasks.data : [])
    .map(readTaskDue)
    .filter((task): task is TaskDue => !!task && !task.done);

  const done = {
    onSuccess: () => {
      toast.success(editing ? 'Lembrete salvo' : 'Lembrete criado');
      onClose();
    },
  };

  const submit = () => {
    const minutesBefore = Number(minutes);
    if (kind === 'EVENT') return forEvent.mutate({ eventId: ownerId, minutesBefore }, done);
    if (kind === 'TASK') {
      const task = taskOptions.find((option) => option.id === ownerId);
      if (!task) return;
      return forTask.mutate(
        {
          taskId: task.id,
          title: task.title,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          minutesBefore,
        },
        done
      );
    }
    const interval = schedule === 'INTERVAL';
    const body = {
      title,
      notes: notes.trim() || null,
      schedule,
      startDate,
      time: interval ? null : time,
      intervalHours: interval ? Number(hours) : null,
      windowStart: interval ? windowStart : null,
      windowEnd: interval ? windowEnd : null,
    };
    if (editing) update.mutate({ id: editing.id, ...body }, done);
    else create.mutate(body, done);
  };

  const ready = kind === 'CUSTOM' ? Boolean(title.trim()) : Boolean(ownerId);

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={editing ? 'Editar lembrete' : 'Novo lembrete'}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        {!editing && (
          <Segmented
            value={kind}
            onChange={(value) => {
              setKind(value);
              setOwnerId('');
            }}
            options={[
              { value: 'CUSTOM', label: 'Avulso' },
              { value: 'EVENT', label: 'Evento' },
              { value: 'TASK', label: 'Tarefa' },
            ]}
          />
        )}

        {kind === 'CUSTOM' && (
          <>
            <Field label="Título">
              <Input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} />
            </Field>
            <Field label="Texto do aviso">
              <Textarea
                rows={2}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Repetição">
                <Select
                  value={schedule}
                  onChange={(event) => setSchedule(event.target.value as Schedule)}
                >
                  {SCHEDULES.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={schedule === 'ONCE' ? 'Dia' : 'Começa em'}>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </Field>
            </div>
            {schedule === 'INTERVAL' ? (
              <div className="grid grid-cols-3 gap-3">
                <Field label="A cada (horas)">
                  <Input
                    type="number"
                    min={1}
                    max={24}
                    value={hours}
                    onChange={(event) => setHours(event.target.value)}
                  />
                </Field>
                <Field label="Das">
                  <Input
                    type="time"
                    value={windowStart}
                    onChange={(event) => setWindowStart(event.target.value)}
                  />
                </Field>
                <Field label="Às">
                  <Input
                    type="time"
                    value={windowEnd}
                    onChange={(event) => setWindowEnd(event.target.value)}
                  />
                </Field>
              </div>
            ) : (
              <Field label="Hora">
                <Input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </Field>
            )}
          </>
        )}

        {kind !== 'CUSTOM' && (
          <>
            <Field label={kind === 'EVENT' ? 'Evento' : 'Tarefa'}>
              <Select value={ownerId} onChange={(event) => setOwnerId(event.target.value)}>
                <option value="">Escolha…</option>
                {(kind === 'EVENT' ? eventOptions : taskOptions).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.title}
                  </option>
                ))}
              </Select>
            </Field>
            {kind === 'TASK' && tasks.isError && (
              <p className="text-xs text-subtle">Tarefas indisponíveis agora.</p>
            )}
            {kind === 'TASK' && (
              <p className="text-xs text-muted">Tarefa sem hora avisa às 9h do dia do prazo.</p>
            )}
            <Field label="Avisar">
              <Select value={minutes} onChange={(event) => setMinutes(event.target.value)}>
                {ALERT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {alertLabel(option)}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" disabled={!ready || pending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReminderRow({
  reminder,
  onEdit,
}: {
  reminder: ReminderResponse;
  onEdit(): void;
}) {
  const pause = useRpcMutation('reminders.pause');
  const resume = useRpcMutation('reminders.resume');
  const remove = useRpcMutation('reminders.delete');
  const Icon = KIND_ICON[reminder.kind];

  return (
    <li className="flex items-center gap-3 px-2 py-2">
      <span className="grid size-8 shrink-0 place-items-center rounded-control border border-line text-muted">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{reminder.title}</p>
        <p className="truncate text-xs text-muted">
          {KIND_LABEL[reminder.kind]} · {reminder.description}
        </p>
      </div>
      <p className="shrink-0 text-right text-xs text-muted tabular-nums">
        {reminder.state === 'PAUSED' && 'Pausado'}
        {reminder.state === 'DONE' && 'Concluído'}
        {reminder.nextFireAt && nextText(reminder.nextFireAt)}
      </p>
      <div className="flex shrink-0 gap-0.5">
        {reminder.kind === 'CUSTOM' && (
          <Button size="sm" variant="ghost" aria-label="Editar" onClick={onEdit}>
            <Pencil size={13} />
          </Button>
        )}
        {reminder.state === 'PAUSED' ? (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Retomar"
            onClick={() => resume.mutate({ id: reminder.id })}
          >
            <Play size={13} />
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Pausar"
            disabled={reminder.state === 'DONE'}
            onClick={() => pause.mutate({ id: reminder.id })}
          >
            <Pause size={13} />
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          aria-label="Apagar"
          onClick={() => remove.mutate({ id: reminder.id })}
        >
          <Trash2 size={13} />
        </Button>
      </div>
    </li>
  );
}

const GROUPS = [
  { state: 'ACTIVE', label: 'Próximos' },
  { state: 'PAUSED', label: 'Pausados' },
  { state: 'DONE', label: 'Concluídos' },
] as const;

function Page() {
  const reminders = useRpc('reminders.list');
  const [dialog, setDialog] = useState<{ editing: ReminderResponse | null } | null>(null);
  const list = reminders.data ?? [];

  return (
    <>
      <PageHeader
        icon={Bell}
        title="Lembretes"
        description="Avisos no sistema, com o app aberto ou na bandeja."
        actions={
          <Button variant="primary" onClick={() => setDialog({ editing: null })}>
            <Plus size={15} />
            Novo lembrete
          </Button>
        }
      />

      {reminders.isError && (
        <p className="text-sm text-danger">Não deu para ler os lembretes. Tente de novo.</p>
      )}
      {reminders.isPending && <p className="text-sm text-muted">Carregando…</p>}

      {reminders.isSuccess && !list.length && (
        <Card>
          <EmptyState
            icon={BellOff}
            title="Nenhum lembrete"
            text="Crie um lembrete avulso, ou um para um evento ou tarefa."
            action={
              <Button variant="primary" onClick={() => setDialog({ editing: null })}>
                Novo lembrete
              </Button>
            }
          />
        </Card>
      )}

      <div className="flex flex-col gap-5">
        {GROUPS.map(({ state, label }) => {
          const group = list.filter((reminder) => reminder.state === state);
          if (!group.length) return null;
          return (
            <section key={state}>
              <SectionLabel>{label}</SectionLabel>
              <Card className="!p-1">
                <ul className="divide-y divide-line">
                  {group.map((reminder) => (
                    <ReminderRow
                      key={reminder.id}
                      reminder={reminder}
                      onEdit={() => setDialog({ editing: reminder })}
                    />
                  ))}
                </ul>
              </Card>
            </section>
          );
        })}
      </div>

      {dialog && <ReminderDialog editing={dialog.editing} onClose={() => setDialog(null)} />}
    </>
  );
}

export const routes = [{ path: '/lembretes', component: Page }];
