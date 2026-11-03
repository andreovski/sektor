import type {
  TaskListResponse,
  TaskPriority,
  TaskResponse,
  TaskStatus,
  Tone,
} from '@sektor/core/src/modules/tasks/contract';
import { TASK_PRIORITY_LABELS, TONES } from '@sektor/core/src/modules/tasks/contract';
import { dueInfo, priorityBars, clockAt } from '@sektor/core/src/modules/tasks/logic';
import { CalendarDays, FolderKanban } from 'lucide-react';

import { todayString } from '../../lib/format';
import { useRpc } from '../../lib/rpc';
import { cn } from '../../ui';

export const TONE_BG: Record<string, string> = {
  violet: 'bg-violet',
  blue: 'bg-blue',
  green: 'bg-green',
  amber: 'bg-amber',
  orange: 'bg-orange',
  rose: 'bg-rose',
  cyan: 'bg-cyan',
};

export const toneBg = (tone: string | null | undefined) =>
  (tone && TONE_BG[tone]) || 'bg-subtle';

export const STATUS_DOT: Record<TaskStatus, string> = {
  BACKLOG: 'bg-subtle',
  TODO: 'bg-info',
  IN_PROGRESS: 'bg-warning',
  REVIEW: 'bg-violet',
  DONE: 'bg-success',
};

const PRIORITY_BAR: Record<TaskPriority, string> = {
  HIGH: 'bg-danger',
  MEDIUM: 'bg-warning',
  LOW: 'bg-info',
};

export function PriorityBars({ priority }: { priority: TaskPriority | null }) {
  if (!priority) return null;
  const lit = priorityBars(priority);
  return (
    <span
      role="img"
      aria-label={`Prioridade ${TASK_PRIORITY_LABELS[priority].toLowerCase()}`}
      title={`Prioridade ${TASK_PRIORITY_LABELS[priority].toLowerCase()}`}
      className="inline-flex h-3.5 shrink-0 items-end gap-0.5"
    >
      {[1, 2, 3].map((bar) => (
        <span
          key={bar}
          className={cn('w-[3px] rounded-[1px]', bar <= lit ? PRIORITY_BAR[priority] : 'bg-line-strong')}
          style={{ height: `${bar * 33.3}%` }}
        />
      ))}
    </span>
  );
}

export function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-40 items-center gap-1 truncate rounded-[6px] border border-line px-1.5 text-[11px] text-muted',
        className
      )}
    >
      {children}
    </span>
  );
}

export function ProjectChip({ project }: { project: NonNullable<TaskResponse['project']> }) {
  return (
    <Chip>
      <span className={cn('size-1.5 shrink-0 rounded-full', toneBg(project.color))} />
      <span className="truncate">{project.name}</span>
    </Chip>
  );
}

/** "Projeto / Lista" quando os nomes diferem; o projeto sozinho quando a lista leva o nome dele. */
export function placeLabel(list: Pick<TaskListResponse, 'name' | 'project'>) {
  if (!list.project) return list.name;
  return list.project.name.toLowerCase() === list.name.toLowerCase()
    ? list.project.name
    : `${list.project.name} / ${list.name}`;
}

/** Onde a tarefa mora: o projeto (com a lista dele) ou a lista. */
export function PlaceChip({ task }: { task: Pick<TaskResponse, 'listId'> }) {
  const lists = useRpc('taskLists.list');
  const list = lists.data?.find((item) => item.id === task.listId);
  if (!list) return null;
  const label = placeLabel(list);
  return (
    <Chip className="max-w-56">
      {list.project ? (
        <FolderKanban size={11} className="shrink-0" />
      ) : (
        <span className={cn('size-1.5 shrink-0 rounded-full', toneBg(list.color))} />
      )}
      <span className="truncate" title={label}>
        {label}
      </span>
    </Chip>
  );
}

export function DueChip({
  task,
}: {
  task: Pick<TaskResponse, 'dueDate' | 'dueTime' | 'completedAt'>;
}) {
  const info = dueInfo(task, todayString(), clockAt(new Date()));
  if (!info) return null;
  return (
    <Chip className={cn(info.overdue && 'border-danger/40 text-danger')}>
      <CalendarDays size={11} className="shrink-0" />
      {info.label}
    </Chip>
  );
}

export function ToneSwatches({
  value,
  onChange,
}: {
  value: Tone | null;
  onChange(tone: Tone | null): void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          aria-label={`Cor ${tone}`}
          aria-pressed={value === tone}
          onClick={() => onChange(value === tone ? null : tone)}
          className={cn(
            'size-6 rounded-full',
            TONE_BG[tone],
            value === tone && 'ring-2 ring-foreground ring-offset-2 ring-offset-raised'
          )}
        />
      ))}
    </div>
  );
}
