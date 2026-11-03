import {
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  type ProjectResponse,
  type ProjectType,
} from '@sektor/core/src/modules/tasks/contract';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Dialog, Field, Input, Select, Textarea } from '../../ui';

import { ToneSwatches } from './chips';

function Form({
  project,
  onClose,
  onCreated,
  onDeleted,
}: {
  project: ProjectResponse | null;
  onClose(): void;
  onCreated?(project: ProjectResponse): void;
  onDeleted?(): void;
}) {
  const [name, setName] = useState(project?.name ?? '');
  const [type, setType] = useState<ProjectType>(project?.type ?? 'PERSONAL');
  const [startDate, setStartDate] = useState(project?.startDate ?? '');
  const [dueDate, setDueDate] = useState(project?.dueDate ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [color, setColor] = useState(project?.color ?? null);
  const [calendarId, setCalendarId] = useState(project?.calendarId ?? '');
  const calendars = useRpc('calendars.list');
  const create = useRpcMutation('projects.create');
  const update = useRpcMutation('projects.update');
  const remove = useRpcMutation('projects.delete');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      name,
      type,
      startDate: startDate || null,
      dueDate: dueDate || null,
      description: description.trim() || null,
      color,
      calendarId: calendarId || null,
    };
    if (project) await update.mutateAsync({ id: project.id, ...body });
    else {
      const created = await create.mutateAsync(body);
      onCreated?.(created);
    }
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Nome">
        <Input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Tipo">
        <Select value={type} onChange={(event) => setType(event.target.value as ProjectType)}>
          {PROJECT_TYPES.map((value) => (
            <option key={value} value={value}>
              {PROJECT_TYPE_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Início">
          <Input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </Field>
        <Field label="Entrega">
          <Input
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </Field>
      </div>
      <Field label="Descrição">
        <Textarea
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field label="Cor">
        <ToneSwatches value={color} onChange={setColor} />
      </Field>
      <Field label="Calendário da Agenda">
        <Select
          value={calendarId}
          onChange={(event) => setCalendarId(event.target.value)}
          aria-describedby="project-calendar-hint"
        >
          <option value="">Nenhum</option>
          {(calendars.data ?? []).map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.name}
              {calendar.readOnly ? ' (só leitura)' : ''}
            </option>
          ))}
        </Select>
        <p id="project-calendar-hint" className="text-xs text-subtle">
          A agenda do projeto mostra todos os eventos deste calendário, além dos ligados ao projeto.
        </p>
      </Field>
      <div className="flex items-center gap-2">
        {project && (
          <Button
            variant="danger"
            aria-label="Apagar projeto"
            title="As tarefas continuam, sem projeto"
            onClick={() =>
              remove.mutate(
                { id: project.id },
                {
                  onSuccess: () => {
                    onClose();
                    onDeleted?.();
                  },
                }
              )
            }
          >
            <Trash2 size={14} />
          </Button>
        )}
        <Button className="ml-auto" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary">
          {project ? 'Salvar' : 'Criar projeto'}
        </Button>
      </div>
    </form>
  );
}

export function ProjectDialog({
  open,
  project,
  onClose,
  onCreated,
  onDeleted,
}: {
  open: boolean;
  project: ProjectResponse | null;
  onClose(): void;
  onCreated?(project: ProjectResponse): void;
  onDeleted?(): void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title={project ? 'Editar projeto' : 'Novo projeto'}
    >
      {open && (
        <Form
          key={project?.id ?? 'novo'}
          project={project}
          onClose={onClose}
          onCreated={onCreated}
          onDeleted={onDeleted}
        />
      )}
    </Dialog>
  );
}
