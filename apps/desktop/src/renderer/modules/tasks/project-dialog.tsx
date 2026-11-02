import {
  PROJECT_TYPE_LABELS,
  PROJECT_TYPES,
  type ProjectResponse,
  type ProjectType,
} from '@sektor/core/src/modules/tasks/contract';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { useRpcMutation } from '../../lib/rpc';
import { Button, Dialog, Field, Input, Select, Textarea } from '../../ui';

import { ToneSwatches } from './chips';

function Form({ project, onClose }: { project: ProjectResponse | null; onClose(): void }) {
  const [name, setName] = useState(project?.name ?? '');
  const [type, setType] = useState<ProjectType>(project?.type ?? 'PERSONAL');
  const [dueDate, setDueDate] = useState(project?.dueDate ?? '');
  const [description, setDescription] = useState(project?.description ?? '');
  const [color, setColor] = useState(project?.color ?? null);
  const create = useRpcMutation('projects.create');
  const update = useRpcMutation('projects.update');
  const remove = useRpcMutation('projects.delete');

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = {
      name,
      type,
      dueDate: dueDate || null,
      description: description.trim() || null,
      color,
    };
    if (project) await update.mutateAsync({ id: project.id, ...body });
    else await create.mutateAsync(body);
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Nome">
        <Input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tipo">
          <Select value={type} onChange={(event) => setType(event.target.value as ProjectType)}>
            {PROJECT_TYPES.map((value) => (
              <option key={value} value={value}>
                {PROJECT_TYPE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Prazo">
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
      <div className="flex items-center gap-2">
        {project && (
          <Button
            variant="danger"
            aria-label="Apagar projeto"
            title="As tarefas continuam, sem projeto"
            onClick={() => remove.mutate({ id: project.id }, { onSuccess: onClose })}
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
}: {
  open: boolean;
  project: ProjectResponse | null;
  onClose(): void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title={project ? 'Editar projeto' : 'Novo projeto'}
    >
      {open && <Form key={project?.id ?? 'novo'} project={project} onClose={onClose} />}
    </Dialog>
  );
}
