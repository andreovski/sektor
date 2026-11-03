import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { TaskResponse } from '@sektor/core/src/modules/tasks/contract';
import { completedLabel, visibleSubtasks } from '@sektor/core/src/modules/tasks/logic';
import { Check, GripVertical, ListTree, Repeat2 } from 'lucide-react';
import { toast } from 'sonner';

import { useRpcMutation } from '../../lib/rpc';
import { cn } from '../../ui';

import { Chip, DueChip, PlaceChip, PriorityBars, ProjectChip } from './chips';

export function CheckButton({ task }: { task: TaskResponse }) {
  const complete = useRpcMutation('tasks.complete');
  const reopen = useRpcMutation('tasks.reopen');
  const done = Boolean(task.completedAt);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Reabrir ${task.title}` : `Concluir ${task.title}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (done) reopen.mutate({ id: task.id });
        else {
          complete.mutate(
            { id: task.id },
            {
              onSuccess: ({ next }) => {
                if (next) toast.success('Concluída. A próxima já está na lista.');
              },
            }
          );
        }
      }}
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-full border',
        done
          ? 'border-primary bg-primary text-on-primary'
          : 'border-line-strong text-transparent hover:border-primary hover:text-primary'
      )}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  );
}

/** `showPlace` troca o projeto pelo marcador de onde a tarefa mora (na visão Todas). */
function TaskMeta({ task, showPlace }: { task: TaskResponse; showPlace?: boolean }) {
  const done = task.subtasks.filter((sub) => sub.completedAt).length;
  const finished = completedLabel(task, new Date());
  return (
    <>
      {finished ? (
        <span className="text-[11px] text-subtle">{finished}</span>
      ) : (
        <DueChip task={task} />
      )}
      {showPlace ? (
        <PlaceChip task={task} />
      ) : (
        task.project && <ProjectChip project={task.project} />
      )}
      {task.subtasks.length > 0 && (
        <Chip>
          <ListTree size={11} />
          {done}/{task.subtasks.length}
        </Chip>
      )}
      {task.rrule && (
        <span title="Repete" className="text-subtle">
          <Repeat2 size={12} />
        </span>
      )}
      {task.tags.map((tag) => (
        <span key={tag} className="text-[11px] text-subtle">
          #{tag}
        </span>
      ))}
    </>
  );
}

export function TaskRow({
  task,
  sortable,
  showCompleted,
  showPlace,
  onOpen,
}: {
  task: TaskResponse;
  sortable: boolean;
  showCompleted: boolean;
  showPlace?: boolean;
  onOpen(id: string): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !sortable,
  });
  const subtasks = visibleSubtasks(task, showCompleted);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('group border-b border-line last:border-b-0', isDragging && 'relative z-10 bg-raised')}
    >
      <div className="flex items-center gap-2.5 px-3 py-2 hover:bg-hover">
        {sortable && (
          <button
            type="button"
            aria-label={`Mover ${task.title}`}
            className="-ml-1 cursor-grab text-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            {...attributes}
            {...listeners}
          >
            <GripVertical size={14} />
          </button>
        )}
        <CheckButton task={task} />
        <button
          type="button"
          onClick={() => onOpen(task.id)}
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-left"
        >
          <span className={cn('min-w-0 truncate text-sm', task.completedAt && 'text-muted line-through')}>
            {task.title}
          </span>
          <TaskMeta task={task} showPlace={showPlace} />
        </button>
        <PriorityBars priority={task.priority} />
      </div>
      {subtasks.length > 0 && (
        <ul className="pb-1.5 pl-[42px]">
          {subtasks.map((sub) => (
            <li key={sub.id} className="flex items-center gap-2 py-0.5 pr-3">
              <CheckButton task={sub} />
              <button
                type="button"
                onClick={() => onOpen(sub.id)}
                className={cn(
                  'min-w-0 truncate text-left text-xs text-muted hover:text-foreground',
                  sub.completedAt && 'line-through'
                )}
              >
                {sub.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function BoardCardBody({ task, showPlace }: { task: TaskResponse; showPlace?: boolean }) {
  return (
    <>
      <div className="flex items-start gap-2">
        <CheckButton task={task} />
        <span className={cn('min-w-0 flex-1 text-sm leading-snug', task.completedAt && 'text-muted line-through')}>
          {task.title}
        </span>
        <PriorityBars priority={task.priority} />
      </div>
      {(task.dueDate ||
        task.project ||
        showPlace ||
        task.subtasks.length > 0 ||
        task.rrule ||
        task.tags.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <DueChip task={task} />
          {showPlace ? (
            <PlaceChip task={task} />
          ) : (
            task.project && <ProjectChip project={task.project} />
          )}
          {task.subtasks.length > 0 && (
            <Chip>
              <ListTree size={11} />
              {task.subtasks.filter((sub) => sub.completedAt).length}/{task.subtasks.length}
            </Chip>
          )}
          {task.rrule && <Repeat2 size={12} className="text-subtle" />}
          {task.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="text-[11px] text-subtle">
              #{tag}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
