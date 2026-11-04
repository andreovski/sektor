import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { TaskResponse, TaskStatus } from '@sektor/core/src/modules/tasks/contract';
import { boardColumns, type StatusGroup } from '@sektor/core/src/modules/tasks/logic';
import { useState } from 'react';

import { useRpcMutation } from '../../lib/rpc';
import { cn } from '../../ui';

import { STATUS_DOT } from './chips';
import { BoardCardBody } from './task-row';

const DONE_SHOWN = 30;

function BoardCard({
  task,
  showPlace,
  onOpen,
}: {
  task: TaskResponse;
  showPlace?: boolean;
  onOpen(id: string): void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-label={task.title}
      onClick={() => onOpen(task.id)}
      className={cn(
        'cursor-grab rounded-control border border-line bg-raised p-2.5 shadow-card hover:border-line-strong',
        isDragging && 'opacity-40'
      )}
    >
      <BoardCardBody task={task} showPlace={showPlace} />
    </li>
  );
}

function Column({
  column,
  showPlace,
  fill,
  onOpen,
}: {
  column: StatusGroup;
  showPlace?: boolean;
  fill?: boolean;
  onOpen(id: string): void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  const shown = column.status === 'DONE' ? column.tasks.slice(0, DONE_SHOWN) : column.tasks;
  return (
    <section
      ref={setNodeRef}
      aria-label={column.title}
      className={cn(
        'flex min-w-0 flex-col rounded-panel border bg-sunken/60 p-2',
        fill ? 'min-h-0' : 'min-h-[420px]',
        isOver ? 'border-primary/50' : 'border-line'
      )}
    >
      <h3 className="mb-2 flex shrink-0 items-center gap-2 px-1 pt-0.5 text-xs font-medium text-muted">
        <span className={cn('size-2 rounded-full', STATUS_DOT[column.status])} />
        <span className="truncate">{column.title}</span>
        <span className="ml-auto tabular-nums text-subtle">{column.tasks.length}</span>
      </h3>
      <ul className={cn('flex flex-col gap-2', fill && 'min-h-0 flex-1 overflow-y-auto')}>
        {shown.map((task) => (
          <BoardCard key={task.id} task={task} showPlace={showPlace} onOpen={onOpen} />
        ))}
      </ul>
      {shown.length < column.tasks.length && (
        <p className="mt-2 shrink-0 px-1 text-[11px] text-subtle">
          Mostrando as {shown.length} mais recentes
        </p>
      )}
    </section>
  );
}

export function Kanban({
  tasks,
  showPlace,
  fill,
  onOpen,
}: {
  tasks: TaskResponse[];
  /** Marca em cada cartão o projeto e a lista (na visão Todas). */
  showPlace?: boolean;
  /** Ocupa a altura do pai, e cada coluna rola por dentro. */
  fill?: boolean;
  onOpen(id: string): void;
}) {
  const update = useRpcMutation('tasks.update');
  const [moved, setMoved] = useState<Record<string, TaskStatus>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );
  const active = tasks.find((task) => task.id === activeId);

  function onDragStart({ active: dragged }: DragStartEvent) {
    setActiveId(String(dragged.id));
  }

  async function onDragEnd({ active: dragged, over }: DragEndEvent) {
    setActiveId(null);
    const id = String(dragged.id);
    const status = over?.id as TaskStatus | undefined;
    const task = tasks.find((item) => item.id === id);
    if (!status || !task || task.status === status) return;
    setMoved((current) => ({ ...current, [id]: status }));
    try {
      await update.mutateAsync({ id, status });
    } finally {
      setMoved(({ [id]: _, ...rest }) => rest);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className={cn('overflow-x-auto pb-1', fill && 'h-full')}>
        <div className={cn('grid min-w-[860px] grid-cols-5 gap-2', fill && 'h-full')}>
          {boardColumns(tasks, moved).map((column) => (
            <Column
              key={column.status}
              column={column}
              showPlace={showPlace}
              fill={fill}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
      <DragOverlay>
        {active && (
          <div className="cursor-grabbing rounded-control border border-primary/50 bg-raised p-2.5 shadow-popover">
            <BoardCardBody task={active} showPlace={showPlace} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
