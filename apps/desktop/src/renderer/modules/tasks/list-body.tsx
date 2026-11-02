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
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { TaskResponse } from '@sektor/core/src/modules/tasks/contract';
import {
  applyOrder,
  groupByStatus,
  moveId,
  type StatusGroup,
} from '@sektor/core/src/modules/tasks/logic';
import { useState } from 'react';

import { useRpcMutation } from '../../lib/rpc';
import { cn } from '../../ui';

import { STATUS_DOT } from './chips';
import { TaskRow } from './task-row';

function Group({
  group,
  listId,
  showCompleted,
  onOpen,
}: {
  group: StatusGroup;
  listId: string | null;
  showCompleted: boolean;
  onOpen(id: string): void;
}) {
  const [order, setOrder] = useState<string[] | null>(null);
  const reorder = useRpcMutation('tasks.reorder');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const tasks = applyOrder(group.tasks, order);
  const ids = tasks.map((task) => task.id);

  async function onDragEnd({ active, over }: DragEndEvent) {
    if (!listId || !over || active.id === over.id) return;
    const orderedIds = moveId(ids, String(active.id), String(over.id));
    setOrder(orderedIds);
    try {
      await reorder.mutateAsync({ listId, orderedIds });
    } finally {
      setOrder(null);
    }
  }

  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-2 px-1 text-xs font-medium text-muted">
        <span className={cn('size-2 rounded-full', STATUS_DOT[group.status])} />
        {group.title}
        <span className="tabular-nums text-subtle">{group.tasks.length}</span>
      </h3>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="overflow-hidden rounded-panel border border-line bg-surface shadow-card">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                sortable={Boolean(listId)}
                showCompleted={showCompleted}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </section>
  );
}

/** Arrastar só vale numa lista de verdade: as inteligentes seguem o prazo. */
export function ListBody({
  tasks,
  listId,
  showCompleted,
  onOpen,
}: {
  tasks: TaskResponse[];
  listId: string | null;
  showCompleted: boolean;
  onOpen(id: string): void;
}) {
  return (
    <div className="flex flex-col gap-5">
      {groupByStatus(tasks).map((group) => (
        <Group
          key={group.status}
          group={group}
          listId={listId}
          showCompleted={showCompleted}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}
