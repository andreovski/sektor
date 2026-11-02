import type { TaskListResponse } from '@sektor/core/src/modules/tasks/contract';
import { Trash2 } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { useRpcMutation } from '../../lib/rpc';
import { Button, Dialog, Field, Input } from '../../ui';

import { ToneSwatches } from './chips';

function Form({
  list,
  onClose,
  onDeleted,
}: {
  list: TaskListResponse | null;
  onClose(): void;
  onDeleted(): void;
}) {
  const [name, setName] = useState(list?.name ?? '');
  const [color, setColor] = useState(list?.color ?? null);
  const create = useRpcMutation('taskLists.create');
  const update = useRpcMutation('taskLists.update');
  const remove = useRpcMutation('taskLists.delete');
  const [confirming, setConfirming] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (list) await update.mutateAsync({ id: list.id, name, color });
    else await create.mutateAsync({ name, color });
    onClose();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Field label="Nome">
        <Input autoFocus required value={name} onChange={(event) => setName(event.target.value)} />
      </Field>
      <Field label="Cor">
        <ToneSwatches value={color} onChange={setColor} />
      </Field>
      {confirming && (
        <p className="text-sm text-danger">
          As tarefas desta lista serão apagadas junto. Clique de novo para confirmar.
        </p>
      )}
      <div className="flex items-center gap-2">
        {list && !list.isInbox && (
          <Button
            variant="danger"
            aria-label="Apagar lista"
            onClick={() => {
              if (!confirming) setConfirming(true);
              else remove.mutate({ id: list.id }, { onSuccess: onDeleted });
            }}
          >
            <Trash2 size={14} />
          </Button>
        )}
        <Button className="ml-auto" variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" variant="primary">
          {list ? 'Salvar' : 'Criar lista'}
        </Button>
      </div>
    </form>
  );
}

export function ListDialog({
  open,
  list,
  onClose,
  onDeleted,
}: {
  open: boolean;
  list: TaskListResponse | null;
  onClose(): void;
  onDeleted(): void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => !value && onClose()}
      title={list ? 'Editar lista' : 'Nova lista'}
    >
      {open && <Form key={list?.id ?? 'nova'} list={list} onClose={onClose} onDeleted={onDeleted} />}
    </Dialog>
  );
}
