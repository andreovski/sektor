import { findTask } from '@sektor/core/src/modules/tasks/logic';
import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';

import { useRpc } from '../../lib/rpc';
import { EmptyState } from '../../ui';
import { CaptureField } from '../tasks/capture-field';
import { Kanban } from '../tasks/kanban';
import { ListBody } from '../tasks/list-body';
import { NewTaskButton, TaskDialog } from '../tasks/task-dialog';

/** Kanban e Tarefas são as peças de `modules/tasks`, presas a um projeto. */
export function ProjectTasks({ projectId, mode }: { projectId: string; mode: 'kanban' | 'lista' }) {
  const [showDone, setShowDone] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const lists = useRpc('taskLists.list');
  const tasks = useRpc('tasks.list', {
    projectId,
    includeCompleted: mode === 'kanban' || showDone || undefined,
  });
  const inbox = lists.data?.find((list) => list.isInbox);
  const opened = findTask([tasks.data], openId);

  return (
    <div>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <CaptureField defaults={{}} projectId={projectId} />
        </div>
        <NewTaskButton onClick={() => setCreating(true)} />
      </div>
      {mode === 'lista' && (
        <label className="mb-3 flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(event) => setShowDone(event.target.checked)}
          />
          Mostrar concluídas
        </label>
      )}

      {tasks.isPending ? (
        <p className="py-10 text-center text-sm text-muted">Carregando tarefas…</p>
      ) : mode === 'kanban' ? (
        <Kanban tasks={tasks.data ?? []} onOpen={setOpenId} />
      ) : tasks.data?.length ? (
        <ListBody tasks={tasks.data} listId={null} showCompleted={showDone} onOpen={setOpenId} />
      ) : (
        <EmptyState
          icon={CheckCircle2}
          title="Nenhuma tarefa aberta"
          text="Escreva no campo acima: data, #etiqueta e !prioridade são entendidas."
        />
      )}

      <TaskDialog
        open={creating || Boolean(opened)}
        task={creating ? null : opened}
        defaults={{ listId: inbox?.id ?? '', projectId }}
        onClose={() => {
          setCreating(false);
          setOpenId(null);
        }}
      />
    </div>
  );
}
