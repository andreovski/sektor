import { matchPlace, parseCapture } from '@sektor/core/src/modules/tasks/capture';
import { TASK_PRIORITY_LABELS } from '@sektor/core/src/modules/tasks/contract';
import { relativeDay } from '@sektor/core/src/modules/tasks/logic';
import { CalendarDays, CornerDownLeft, FolderKanban, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { cn, Input } from '../../ui';

import { Chip, placeLabel, PriorityBars, toneBg } from './chips';

/** A lista de "@nome", já achada pelo nome dela ou do projeto; em vermelho quando não existe. */
export function CapturePlace({ place }: { place: string | null }) {
  const lists = useRpc('taskLists.list');
  if (!place) return null;
  const list = matchPlace(lists.data ?? [], place);
  return (
    <Chip className={cn(!list && lists.data && 'border-danger/40 text-danger')}>
      {list?.project || !list ? (
        <FolderKanban size={11} className="shrink-0" />
      ) : (
        <span className={cn('size-1.5 shrink-0 rounded-full', toneBg(list.color))} />
      )}
      {list ? placeLabel(list) : `@${place} não existe`}
    </Chip>
  );
}

/** Uma linha só: "pagar a luz sexta @casa #contas !alta". O que foi entendido aparece antes de criar. */
export function CaptureField({
  defaults,
  projectId,
}: {
  defaults: { listId?: string; defaultDueDate?: string; defaultTag?: string };
  projectId?: string;
}) {
  const [text, setText] = useState('');
  const capture = useRpcMutation('tasks.capture');
  const today = todayString();
  const parsed = parseCapture(text, today, { hasDefaultDate: Boolean(defaults.defaultDueDate) });
  const due = parsed.dueDate ?? defaults.defaultDueDate ?? null;
  const understood =
    text.trim() !== '' && (parsed.dueDate || parsed.priority || parsed.place || parsed.tags.length);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || capture.isPending) return;
    capture.mutate({ ...defaults, projectId, text }, { onSuccess: () => setText('') });
  }

  return (
    <form onSubmit={submit} className="mb-5">
      <div className="relative">
        <Plus size={15} className="absolute top-1/2 left-2.5 -translate-y-1/2 text-subtle" />
        <Input
          aria-label="Capturar tarefa"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="pagar a luz sexta @casa #contas !alta"
          className="h-9 pr-9 pl-8"
        />
        <CornerDownLeft
          size={13}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 text-subtle"
        />
      </div>
      {understood ? (
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 px-1 text-xs text-muted">
          <span className="truncate">{parsed.title || 'Falta o que fazer'}</span>
          {due && (
            <Chip>
              <CalendarDays size={11} />
              {relativeDay(due, today)}
              {parsed.dueTime ? ` às ${parsed.dueTime}` : ''}
            </Chip>
          )}
          {parsed.priority && (
            <Chip>
              <PriorityBars priority={parsed.priority} />
              {TASK_PRIORITY_LABELS[parsed.priority]}
            </Chip>
          )}
          <CapturePlace place={parsed.place} />
          {parsed.tags.map((tag) => (
            <span key={tag} className="text-subtle">
              #{tag}
            </span>
          ))}
        </p>
      ) : null}
    </form>
  );
}
