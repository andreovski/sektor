import { parseCapture } from '@sektor/core/src/modules/tasks/capture';
import { TASK_PRIORITY_LABELS } from '@sektor/core/src/modules/tasks/contract';
import { relativeDay } from '@sektor/core/src/modules/tasks/logic';
import {
  CalendarDays,
  CheckSquare,
  CornerDownLeft,
  Inbox,
  type LucideIcon,
  Sparkles,
  StickyNote,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { todayString } from '../../lib/format';
import { type ModuleId, useModules } from '../../lib/modules';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, cn, Select } from '../../ui';
import { CapturePlace } from '../tasks/capture-field';
import { Chip, PriorityBars } from '../tasks/chips';

import { ModelMenu } from '../ai/model-menu';

import { AssistantInput, type HomeAssistant } from './assistant';

// A captura do Início: Tarefa, Nota e Agente em abas. A aba escolhida fica guardada e volta ao
// abrir o Início de novo.

export const CAPTURE_INPUT_ID = 'inicio-captura';

const BOX =
  'relative w-[760px] max-w-full rounded-[22px] border border-line-strong bg-raised/90 px-4 pb-3 text-left shadow-popover backdrop-blur focus-within:border-primary/50';

type Mode = 'task' | 'note' | 'agent';
const MODES: { id: Mode; label: string; icon: LucideIcon; module: ModuleId }[] = [
  { id: 'task', label: 'Tarefa', icon: CheckSquare, module: 'tasks' },
  { id: 'note', label: 'Nota', icon: StickyNote, module: 'projects' },
  { id: 'agent', label: 'Agente', icon: Sparkles, module: 'assistant' },
];
const MODE_KEY = 'sektor.home.capture';
const NOTE_PROJECT_KEY = 'sektor.home.noteProject';

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento, volta ao padrão na próxima vez.
  }
}

export function HomeCapture({ assistant }: { assistant: HomeAssistant }) {
  const { isOn } = useModules();
  const modes = MODES.filter((m) => isOn(m.module));
  const [chosen, setChosen] = useState<Mode>(() => (read(MODE_KEY) as Mode | null) ?? 'agent');
  // Módulo desligado leva a aba: fica a primeira que sobrou.
  const mode = modes.some((m) => m.id === chosen) ? chosen : modes[0]?.id;
  if (!mode) return null;
  // Cada aba monta o seu campo, e as abas nascem de novo junto: elas recebem a aba de antes para
  // fechar o nome dela e abrir o da nova, como no dock.
  const previous = useRef<Mode | undefined>(undefined);
  const pick = (next: Mode) => {
    setChosen(next);
    write(MODE_KEY, next);
  };
  const tabs =
    modes.length > 1 ? (
      <CaptureTabs
        modes={modes}
        mode={mode}
        from={previous.current}
        onPick={pick}
        // O modelo é do Agente: só aparece com ele aberto, no canto direito.
        agentExtra={
          assistant.models.length > 1 ? (
            <ModelMenu
              models={assistant.models}
              value={assistant.modelId}
              onChange={assistant.choose}
              side="bottom"
              align="end"
            />
          ) : null
        }
      />
    ) : null;
  previous.current = mode;
  if (mode === 'task') return <CaptureBox tabs={tabs} />;
  if (mode === 'note') return <NoteBox tabs={tabs} />;
  return <AssistantInput assistant={assistant} tabs={tabs} />;
}

function CaptureTabs({
  modes,
  mode,
  from,
  onPick,
  agentExtra,
}: {
  modes: typeof MODES;
  mode: Mode;
  from: Mode | undefined;
  onPick(mode: Mode): void;
  agentExtra: ReactNode;
}) {
  const [open, setOpen] = useState(from ?? mode);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(mode));
    return () => cancelAnimationFrame(frame);
  }, [mode]);
  return (
    <div role="tablist" aria-label="O que capturar" className="-mr-2 flex gap-1 border-b border-line pt-2 pb-2">
      {modes.map(({ id, label, icon: Icon }) => {
        const active = id === mode;
        const expanded = id === open;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            title={label}
            onClick={() => onPick(id)}
            className={cn(
              'flex h-7 items-center rounded-full border px-2.5 text-[13px] transition-colors duration-200',
              expanded
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-transparent text-muted hover:bg-hover hover:text-foreground'
            )}
          >
            <Icon size={14} />
            <span
              aria-hidden={!active}
              className={cn(
                'grid transition-[grid-template-columns,opacity,margin] duration-300 ease-[var(--ease-standard)] motion-reduce:transition-none',
                expanded ? 'ml-1.5 grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'
              )}
            >
              <span className="overflow-hidden whitespace-nowrap">{label}</span>
            </span>
          </button>
        );
      })}
      {agentExtra && (mode === 'agent' || open === 'agent') && (
        <div
          className={cn(
            'mr-2 ml-auto transition-[opacity,translate] duration-300 ease-[var(--ease-standard)] motion-reduce:transition-none',
            open === 'agent' && mode === 'agent' ? 'translate-x-0 opacity-100' : 'pointer-events-none translate-x-2 opacity-0'
          )}
        >
          {agentExtra}
        </div>
      )}
    </div>
  );
}

/** Nota rápida num projeto. O projeto escolhido fica guardado para a próxima. */
function NoteBox({ tabs }: { tabs: ReactNode }) {
  const [text, setText] = useState('');
  const projects = useRpc('projects.list', {});
  const list = projects.data ?? [];
  const [projectId, setProjectId] = useState(() => read(NOTE_PROJECT_KEY) ?? '');
  const create = useRpcMutation('projectNotes.create');
  const current = list.find((p) => p.id === projectId) ?? list[0];
  useEffect(() => {
    if (current && current.id !== projectId) setProjectId(current.id);
  }, [current, projectId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() || !current || create.isPending) return;
    create.mutate(
      { projectId: current.id, body: text.trim() },
      {
        onSuccess: () => {
          setText('');
          toast.success(`Nota salva em ${current.name}.`);
        },
      }
    );
  }

  if (projects.data && !list.length) {
    return (
      <div className={cn(BOX, 'text-sm text-muted')}>
        {tabs}
        <p className="pt-3">As notas ficam nos projetos. Crie um projeto em Projetos para guardar a primeira.</p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className={BOX}>
      {tabs}
      <div className="flex items-center gap-2 pt-3">
        <input
          aria-label="Escrever nota"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Uma ideia, um lembrete, o que não pode esquecer"
          style={{ outline: 'none' }}
          className="h-9 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-subtle"
        />
        <Button type="submit" variant="primary" disabled={!text.trim() || !current || create.isPending}>
          Salvar
          <CornerDownLeft size={13} />
        </Button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <span>No projeto</span>
        <Select
          aria-label="Projeto da nota"
          value={current?.id ?? ''}
          onChange={(event) => {
            setProjectId(event.target.value);
            write(NOTE_PROJECT_KEY, event.target.value);
          }}
          className="h-7 w-auto py-0 text-xs"
        >
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
    </form>
  );
}

export function CaptureBox({ tabs }: { tabs?: ReactNode }) {
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
      className={BOX}
    >
      {tabs}
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
