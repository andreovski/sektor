import { parseCapture } from '@sektor/core/src/modules/tasks/capture';
import { TASK_PRIORITY_LABELS } from '@sektor/core/src/modules/tasks/contract';
import { relativeDay } from '@sektor/core/src/modules/tasks/logic';
import { CalendarDays, CornerDownLeft, Inbox } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';

import { todayString } from '../../lib/format';
import { useRpcMutation } from '../../lib/rpc';
import { Button, cn } from '../../ui';
import { CapturePlace } from '../tasks/capture-field';
import { Chip, PriorityBars } from '../tasks/chips';

export const CAPTURE_INPUT_ID = 'inicio-captura';

function Tab({ active, disabled, children }: { active?: boolean; disabled?: boolean; children: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={Boolean(active)}
      disabled={disabled}
      title={disabled ? 'Em breve' : undefined}
      className={cn(
        '-mb-px h-9 border-b-2 px-1 text-sm font-medium',
        active ? 'border-primary text-foreground' : 'border-transparent text-muted',
        disabled && 'text-subtle'
      )}
    >
      {children}
    </button>
  );
}

export function CaptureBox() {
  const [text, setText] = useState('');
  const capture = useRpcMutation('tasks.capture');
  const today = todayString();
  const parsed = parseCapture(text, today);
  const typed = text.trim() !== '';

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!typed || !parsed.title || capture.isPending) return;
    capture.mutate(
      { text },
      {
        onSuccess: () => {
          setText('');
          toast.success(parsed.dueDate || parsed.place ? 'Tarefa criada.' : 'Tarefa criada na Entrada.');
        },
      }
    );
  }

  return (
    <form
      onSubmit={submit}
      className="relative w-[630px] max-w-full rounded-panel border border-line-strong bg-raised/90 px-4 pb-3 shadow-popover backdrop-blur focus-within:border-primary/50"
    >
      <div role="tablist" aria-label="Tipo de captura" className="flex gap-4 border-b border-line">
        <Tab active>Tarefa</Tab>
        <Tab disabled>Nota</Tab>
      </div>
      <div className="flex items-center gap-2 pt-3">
        <input
          id={CAPTURE_INPUT_ID}
          aria-label="Capturar tarefa"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ligar para o contador amanhã @trabalho #impostos !alta"
          style={{ outline: 'none' }}
          className="h-9 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-subtle"
        />
        <Button type="submit" variant="primary" disabled={!parsed.title || capture.isPending}>
          Capturar
          <CornerDownLeft size={13} />
        </Button>
      </div>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-1.5 text-xs text-muted" aria-live="polite">
        {typed ? (
          <>
            <span className="max-w-72 truncate text-foreground">
              {parsed.title || 'Falta dizer o que fazer'}
            </span>
            {parsed.dueDate ? (
              <Chip>
                <CalendarDays size={11} />
                {relativeDay(parsed.dueDate, today)}
                {parsed.dueTime ? ` às ${parsed.dueTime}` : ''}
              </Chip>
            ) : (
              !parsed.place && (
                <Chip>
                  <Inbox size={11} />
                  Entrada, sem prazo
                </Chip>
              )
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
          </>
        ) : (
          <span className="text-subtle">Escreva com o dia, @lista ou @projeto, #etiqueta e !prioridade. O que for entendido aparece aqui.</span>
        )}
      </div>
    </form>
  );
}
