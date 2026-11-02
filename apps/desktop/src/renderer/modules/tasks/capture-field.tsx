import { parseCapture } from '@sektor/core/src/modules/tasks/capture';
import { TASK_PRIORITY_LABELS } from '@sektor/core/src/modules/tasks/contract';
import { relativeDay } from '@sektor/core/src/modules/tasks/logic';
import { CalendarDays, CornerDownLeft, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';

import { todayString } from '../../lib/format';
import { useRpcMutation } from '../../lib/rpc';
import { Input } from '../../ui';

import { Chip, PriorityBars } from './chips';

/** Uma linha só: "pagar a luz sexta #casa !alta". O que foi entendido aparece antes de criar. */
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
  const parsed = parseCapture(text, today);
  const due = parsed.dueDate ?? defaults.defaultDueDate ?? null;
  const understood = text.trim() !== '' && (parsed.dueDate || parsed.priority || parsed.tags.length);

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
          placeholder="pagar a luz sexta #casa !alta"
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
            </Chip>
          )}
          {parsed.priority && (
            <Chip>
              <PriorityBars priority={parsed.priority} />
              {TASK_PRIORITY_LABELS[parsed.priority]}
            </Chip>
          )}
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
