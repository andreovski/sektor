import {
  TASK_PRIORITY_LABELS,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskPriority,
  type TaskResponse,
  type TaskStatus,
} from '@sektor/core/src/modules/tasks/contract';
import {
  addTag,
  bodyFromForm,
  formFromTask,
  REPEAT_OPTIONS,
  type TaskForm,
} from '@sektor/core/src/modules/tasks/logic';
import { Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, cn, Dialog, Field, Input, Select, Textarea } from '../../ui';

import { CheckButton } from './task-row';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function Subtasks({ task }: { task: TaskResponse }) {
  const [title, setTitle] = useState('');
  const create = useRpcMutation('tasks.create');
  const remove = useRpcMutation('tasks.delete');
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">Subtarefas</span>
      {task.subtasks.map((sub) => (
        <div key={sub.id} className="flex items-center gap-2 text-sm">
          <CheckButton task={sub} />
          <span className={cn('min-w-0 flex-1 truncate', sub.completedAt && 'text-muted line-through')}>
            {sub.title}
          </span>
          <button
            type="button"
            aria-label={`Apagar ${sub.title}`}
            onClick={() => remove.mutate({ id: sub.id })}
            className="text-subtle hover:text-danger"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <Input
        aria-label="Nova subtarefa"
        value={title}
        placeholder="Nova subtarefa"
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return;
          event.preventDefault();
          if (!title.trim()) return;
          create.mutate(
            { title, parentTaskId: task.id },
            { onSuccess: () => setTitle('') }
          );
        }}
      />
    </div>
  );
}

function Form({
  task,
  defaults,
  onClose,
}: {
  task: TaskResponse | null;
  defaults: { listId: string; projectId?: string; date?: string };
  onClose(): void;
}) {
  const [form, setForm] = useState<TaskForm>(() =>
    formFromTask(task, { ...defaults, today: todayString() })
  );
  const [tag, setTag] = useState('');
  const lists = useRpc('taskLists.list');
  const projects = useRpc('projects.list', { includeCompleted: true });
  const create = useRpcMutation('tasks.create');
  const update = useRpcMutation('tasks.update');
  const remove = useRpcMutation('tasks.delete');
  const set = (patch: Partial<TaskForm>) => setForm((current) => ({ ...current, ...patch }));
  const isSub = Boolean(task?.parentTaskId);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = bodyFromForm(form);
    if (task) {
      const { listId, projectId, ...rest } = body;
      await update.mutateAsync({
        id: task.id,
        ...rest,
        ...(isSub ? {} : { listId, projectId }),
      });
    } else await create.mutateAsync(body);
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Título">
        <Input
          autoFocus={!task}
          required
          value={form.title}
          onChange={(event) => set({ title: event.target.value })}
        />
      </Field>
      <Field label="Notas">
        <Textarea
          rows={2}
          value={form.notes}
          onChange={(event) => set({ notes: event.target.value })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Status">
          <Select
            value={form.status}
            onChange={(event) => set({ status: event.target.value as TaskStatus })}
          >
            {TASK_STATUSES.map((status) => (
              <option key={status} value={status}>
                {TASK_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prioridade">
          <Select
            value={form.priority ?? ''}
            onChange={(event) =>
              set({ priority: (event.target.value || null) as TaskPriority | null })
            }
          >
            <option value="">Nenhuma</option>
            {(['HIGH', 'MEDIUM', 'LOW'] as const).map((priority) => (
              <option key={priority} value={priority}>
                {TASK_PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
        </Field>
        {!isSub && (
          <>
            <Field label="Lista">
              <Select
                value={form.listId}
                onChange={(event) => set({ listId: event.target.value })}
              >
                {lists.data?.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Projeto">
              <Select
                value={form.projectId}
                onChange={(event) => set({ projectId: event.target.value })}
              >
                <option value="">Sem projeto</option>
                {projects.data?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={form.hasDate}
              onChange={(event) => set({ hasDate: event.target.checked })}
            />
            Prazo
          </label>
          {form.hasDate && (
            <Input
              type="date"
              aria-label="Data do prazo"
              value={form.date}
              onChange={(event) => set({ date: event.target.value })}
            />
          )}
        </div>
        {form.hasDate && (
          <div className="flex flex-col gap-1.5">
            <label className="flex items-center gap-2 text-xs text-muted">
              <input
                type="checkbox"
                checked={form.hasTime}
                onChange={(event) => set({ hasTime: event.target.checked })}
              />
              Hora
            </label>
            {form.hasTime && (
              <Input
                type="time"
                aria-label="Hora do prazo"
                value={form.time}
                onChange={(event) => set({ time: event.target.value })}
              />
            )}
          </div>
        )}
      </div>

      {form.hasDate && !isSub && (
        <Field label="Repetir">
          <Select value={form.repeat} onChange={(event) => set({ repeat: event.target.value })}>
            {REPEAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            {form.repeat.startsWith('FREQ=') && (
              <option value={form.repeat}>Personalizada</option>
            )}
          </Select>
        </Field>
      )}
      {form.hasDate && form.repeat === 'WEEKLY' && (
        <div className="flex gap-1">
          {WEEKDAYS.map((label, day) => {
            const on = form.weekdays.includes(day);
            return (
              <button
                key={WEEKDAY_NAMES[day]}
                type="button"
                aria-label={WEEKDAY_NAMES[day]}
                aria-pressed={on}
                onClick={() =>
                  set({
                    weekdays: on
                      ? form.weekdays.filter((value) => value !== day)
                      : [...form.weekdays, day],
                  })
                }
                className={cn(
                  'size-7 rounded-full text-xs',
                  on ? 'bg-primary text-on-primary' : 'border border-line text-muted'
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      <Field label="Etiquetas">
        <div className="flex flex-wrap items-center gap-1">
          {form.tags.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={`Tirar etiqueta ${name}`}
              onClick={() => set({ tags: form.tags.filter((value) => value !== name) })}
              className="inline-flex h-6 items-center gap-1 rounded-[6px] border border-line px-1.5 text-xs text-foreground"
            >
              #{name}
              <X size={11} />
            </button>
          ))}
        </div>
        <Input
          value={tag}
          placeholder="Nova etiqueta"
          onChange={(event) => setTag(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' && event.key !== ',') return;
            event.preventDefault();
            set({ tags: addTag(form.tags, tag) });
            setTag('');
          }}
        />
      </Field>

      {task && !isSub && <Subtasks task={task} />}

      <div className="mt-1 flex items-center gap-2">
        {task && (
          <Button
            variant="danger"
            aria-label="Apagar tarefa"
            onClick={() => remove.mutate({ id: task.id }, { onSuccess: onClose })}
          >
            <Trash2 size={14} />
          </Button>
        )}
        <Button className="ml-auto" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary" disabled={create.isPending || update.isPending}>
          {task ? 'Salvar' : 'Criar tarefa'}
        </Button>
      </div>
    </form>
  );
}

export function NewTaskButton({ onClick }: { onClick(): void }) {
  return (
    <Button variant="primary" onClick={onClick}>
      <Plus size={15} />
      Nova tarefa
    </Button>
  );
}

/** `task` nulo com `open` é tarefa nova. */
export function TaskDialog({
  open,
  task,
  defaults,
  onClose,
}: {
  open: boolean;
  task: TaskResponse | null;
  defaults: { listId: string; projectId?: string; date?: string };
  onClose(): void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title={task ? 'Editar tarefa' : 'Nova tarefa'}
    >
      {open && <Form key={task?.id ?? 'nova'} task={task} defaults={defaults} onClose={onClose} />}
    </Dialog>
  );
}
