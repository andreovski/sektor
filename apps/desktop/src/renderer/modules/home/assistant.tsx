import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUp, ChevronDown, Flag, History, Mic, PenSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { call, useRpc } from '../../lib/rpc';
import { cn } from '../../ui';
import { ModelMenu } from '../ai/model-menu';
import { AiText } from '../ai/shared';

import { localDate } from './dates';
import { MOODS } from './today-cards';

// O assistente no Início: o campo no lugar da captura; perguntar recolhe a capa, esconde os
// cartões e vira uma conversa em linha do tempo, como a do Jotta. "Mostrar o dia" volta.

type Conversation = Awaited<ReturnType<typeof call<'ai.chat.get'>>>;
type Message = Conversation['messages'][number];

const SUGGESTIONS = [
  'Quanto gastei com mercado no mês passado?',
  'O que tenho amanhã na agenda?',
  'Que tarefas vencem esta semana?',
];

/** A etiqueta da área, como no Jotta. As cores são do tipo, não do tema. */
const TAGS: Record<string, { tag: string; className: string }> = {
  finance: { tag: 'FIN', className: 'border-success text-success' },
  agenda: { tag: 'AGD', className: 'border-danger text-danger' },
  tasks: { tag: 'TAR', className: 'border-warning text-warning' },
  projects: { tag: 'PRJ', className: 'border-warning text-warning' },
  habits: { tag: 'HAB', className: 'border-info text-info' },
  focus: { tag: 'FOC', className: 'border-info text-info' },
  health: { tag: 'SAU', className: 'border-danger text-danger' },
  journal: { tag: 'DIA', className: 'border-line-strong text-muted' },
};
const ASK = { tag: 'ASK', className: 'border-info text-info' };

const time = (at: number) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(at);

const dayLabel = (at: number) => {
  const day = localDate(at);
  const today = localDate(Date.now());
  const yesterday = localDate(Date.now() - 24 * 60 * 60 * 1000);
  if (day === today) return 'HOJE';
  if (day === yesterday) return 'ONTEM';
  return new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long' }).format(at).toUpperCase();
};

interface Turn {
  id: string;
  question: string;
  askedAt: number;
  answer: Message | null;
}

/** Pergunta e resposta juntas, que é como a linha do tempo mostra. */
function turnsOf(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({ id: message.id, question: message.text, askedAt: message.createdAt, answer: null });
    } else if (turns.length) {
      turns[turns.length - 1]!.answer = message;
    }
  }
  return turns;
}

function Tag({ areas }: { areas: string[] }) {
  const tag = TAGS[areas[0] ?? ''] ?? ASK;
  return (
    <span
      className={cn(
        'rounded-control border-[1.5px] px-2 py-0.5 font-mono text-[11px] font-medium tracking-[0.08em]',
        tag.className
      )}
    >
      {tag.tag}
    </span>
  );
}

function Dots() {
  return (
    <span className="flex gap-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-pulse rounded-full bg-primary"
          style={{ animationDelay: `${i * 150}ms` }}
        />
      ))}
    </span>
  );
}

function TurnView({ turn, devMode }: { turn: Turn & { pending?: boolean }; devMode: boolean }) {
  const answer = turn.answer;
  return (
    <article className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-5 pt-5">
      <div className="flex flex-col items-center">
        <Tag areas={answer?.areas ?? []} />
        <span aria-hidden className="mt-2 w-0.5 flex-1 bg-primary/30" />
      </div>
      <div className="flex min-w-0 flex-col gap-2 pb-2">
        <p className="text-xl leading-snug font-semibold">
          <span className="mr-2 text-primary">›</span>
          {turn.question}
        </p>
        <span className="font-mono text-[11px] tracking-[0.08em] text-subtle">
          {time(turn.askedAt)} · TEXTO
        </span>
        {turn.pending ? (
          <div className="flex items-center gap-2.5 py-1 text-sm text-muted">
            <Dots /> Consultando os seus dados…
          </div>
        ) : answer ? (
          <>
            <p className="text-[16px] leading-relaxed whitespace-pre-wrap text-foreground/90">
              <AiText text={answer.text} />
            </p>
            <span className="font-mono text-[11px] tracking-[0.08em] text-subtle uppercase">
              {answer.tools.length ? `Consultou ${answer.tools.join(', ')}` : 'Sem consulta'}
              {devMode && answer.model ? ` · ${answer.model}` : ''}
            </span>
            {devMode && <div aria-hidden className="h-1.5 rounded-full bg-primary/80" />}
            <button
              type="button"
              title="Em breve: marcar a resposta para revisão"
              disabled
              className="flex items-center gap-1.5 self-start py-0.5 text-[13px] text-subtle"
            >
              <Flag size={12} /> Isso está errado
            </button>
          </>
        ) : null}
      </div>
    </article>
  );
}

function DaySummary() {
  const health = useRpc('health.today');
  const habits = useRpc('habits.today');
  const tasks = useRpc('tasks.list', { view: 'today' });
  const mood = health.data?.checkin.mood;
  const chips = [
    mood ? `Humor · ${MOODS[mood - 1]?.label ?? '—'}` : 'Humor · sem registro',
    habits.data?.total
      ? `Hábitos ${habits.data.habits.filter((h) => h.doneToday).length} de ${habits.data.total}`
      : null,
    tasks.data
      ? tasks.data.length
        ? `${tasks.data.length} tarefa(s) para hoje`
        : 'Nenhuma tarefa para hoje'
      : null,
  ].filter(Boolean) as string[];
  return (
    <>
      <span className="mr-1 font-mono text-[11px] tracking-[0.14em] text-subtle">HOJE</span>
      {chips.map((chip) => (
        <span
          key={chip}
          className="flex h-7 items-center rounded-full border border-line bg-surface px-3 text-[13px] text-muted"
        >
          {chip}
        </span>
      ))}
    </>
  );
}

function IconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick(): void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'grid size-9 place-items-center rounded-full border border-line-strong text-primary transition-colors hover:bg-hover',
        active ? 'bg-primary/15' : 'bg-raised'
      )}
    >
      {children}
    </button>
  );
}

function HistoryList({
  currentId,
  onPick,
}: {
  currentId: string | null;
  onPick(id: string): void;
}) {
  const list = useRpc('ai.chat.list');
  let group = '';
  return (
    <aside
      aria-label="Histórico de conversas"
      className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto rounded-panel border border-line bg-surface p-3"
    >
      <span className="px-2 pb-1 font-mono text-[11px] tracking-[0.12em] text-subtle">
        HISTÓRICO · SOME EM 30 DIAS
      </span>
      {list.data?.length === 0 && <p className="px-2 py-2 text-sm text-muted">Nenhuma conversa ainda.</p>}
      {list.data?.map((item) => {
        const label = dayLabel(item.updatedAt);
        const header = label !== group;
        group = label;
        return (
          <div key={item.id} className="flex flex-col">
            {header && (
              <span className="px-2 pt-2 pb-1 font-mono text-[10px] tracking-[0.12em] text-subtle">{label}</span>
            )}
            <button
              type="button"
              onClick={() => onPick(item.id)}
              className={cn(
                'rounded-control border px-2.5 py-2 text-left text-[13px] leading-snug transition-colors hover:bg-hover',
                item.id === currentId ? 'border-primary/60 bg-hover' : 'border-transparent'
              )}
            >
              {item.title}
              <span className="block font-mono text-[10px] tracking-[0.08em] text-subtle">
                {time(item.updatedAt)}
              </span>
            </button>
          </div>
        );
      })}
    </aside>
  );
}

export function useHomeAssistant() {
  const client = useQueryClient();
  const status = useRpc('ai.status');
  const [open, setOpen] = useState(false);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [pending, setPending] = useState<{ text: string; at: number; conversationId: string | null } | null>(null);
  const [history, setHistory] = useState(false);
  const [chosen, setChosen] = useState('');
  const viewing = useRef<string | null>(null);
  viewing.current = currentId;

  useEffect(() => {
    if (!currentId) {
      setConversation(null);
      return;
    }
    let live = true;
    void call('ai.chat.get', { id: currentId }).then(
      (found) => live && setConversation(found),
      () => live && setCurrentId(null)
    );
    return () => {
      live = false;
    };
  }, [currentId]);

  const data = status.data;
  const models = data?.models ?? [];
  const modelId = chosen || data?.resolved.assistant.modelId || null;
  const model = models.find((m) => m.id === modelId) ?? null;

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || pending || !model || model.problem) return;
    const from = currentId;
    setOpen(true);
    setHistory(false);
    setPending({ text, at: Date.now(), conversationId: from });
    try {
      const next = await call('ai.chat.send', { conversationId: from, text, modelId });
      if (viewing.current === from) {
        setConversation(next);
        setCurrentId(next.id);
      }
      void client.invalidateQueries({ queryKey: ['ai.chat.list'] });
      void client.invalidateQueries({ queryKey: ['ai.calls'] });
    } catch (error) {
      toast.error((error as Error).message);
      throw error;
    } finally {
      setPending(null);
    }
  };

  return {
    open,
    collapse: () => {
      setOpen(false);
      setHistory(false);
    },
    showHistory: () => {
      setOpen(true);
      setHistory(true);
    },
    toggleHistory: () => setHistory((value) => !value),
    history,
    newChat: () => {
      setCurrentId(null);
      setHistory(false);
    },
    pick: (id: string) => {
      setCurrentId(id);
      setHistory(false);
    },
    currentId,
    conversation,
    pending: pending && pending.conversationId === currentId ? pending : null,
    busy: Boolean(pending),
    send,
    models,
    model,
    modelId,
    choose: setChosen,
    devMode: data?.devMode ?? false,
    ready: Boolean(data),
  };
}

type HomeAssistant = ReturnType<typeof useHomeAssistant>;

/** O campo do assistente: no meio da capa fechado, preso embaixo com a conversa aberta. */
export function AssistantInput({ assistant, docked }: { assistant: HomeAssistant; docked?: boolean }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const { model, models } = assistant;
  const blocked = !model || Boolean(model.problem);
  const submit = () => {
    const value = text;
    if (!value.trim()) return;
    setText('');
    assistant.send(value).catch(() => setText(value));
  };
  useEffect(() => {
    if (docked) input.current?.focus();
  }, [docked]);

  return (
    <div
      className={cn(
        'flex w-[760px] max-w-full flex-col gap-2',
        // Preso embaixo, por cima da conversa, que passa por trás dele.
        docked && 'absolute -bottom-5 left-1/2 z-10 -translate-x-1/2'
      )}
    >
      {models.length > 1 && (
        <div className="flex">
          <ModelMenu models={models} value={assistant.modelId} onChange={assistant.choose} />
        </div>
      )}
    <div
      className={cn(
        'rounded-[22px] border border-line-strong py-2 pr-2 pl-4 text-left shadow-popover focus-within:border-primary/50',
        docked ? 'bg-raised/85 backdrop-blur-xl' : 'bg-raised/90 backdrop-blur'
      )}
    >
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-xl text-primary">›</span>
        <input
          ref={input}
          aria-label="Peça algo ao assistente"
          value={text}
          disabled={blocked || assistant.busy}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape' && docked) assistant.collapse();
          }}
          placeholder={
            !models.length
              ? 'Escolha um modelo em Ajustes › IA para usar o assistente'
              : (model?.problem ?? 'Peça algo')
          }
          style={{ outline: 'none' }}
          className="h-11 min-w-0 flex-1 bg-transparent text-[17px] placeholder:text-subtle disabled:opacity-70"
        />
        {text.trim() ? (
          <button
            type="button"
            aria-label="Perguntar"
            onClick={submit}
            disabled={blocked || assistant.busy}
            className="grid size-11 place-items-center rounded-[14px] border border-primary/40 bg-primary/15 text-primary disabled:opacity-50"
          >
            <ArrowUp size={18} />
          </button>
        ) : (
          <button
            type="button"
            aria-label="Falar (em breve)"
            title="Falar: chega na etapa de voz"
            disabled
            className="grid size-11 place-items-center rounded-[14px] border border-primary/40 bg-primary/15 text-primary opacity-60"
          >
            <Mic size={18} />
          </button>
        )}
      </div>
      {!docked && (
        <div className="flex items-center gap-1.5 pt-2 pb-1">
          {!models.length ? (
            <Link
              to="/ajustes"
              search={{ secao: 'ia' } as never}
              className="text-[13px] text-primary underline"
            >
              Abrir Ajustes › IA
            </Link>
          ) : (
            SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={blocked || assistant.busy}
                onClick={() => void assistant.send(suggestion).catch(() => {})}
                className="h-7 shrink-0 rounded-full border border-line-strong bg-white/[0.03] px-2.5 text-xs whitespace-nowrap text-muted transition-colors hover:bg-hover disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))
          )}
          {models.length > 0 && (
            <button
              type="button"
              aria-label="Conversas anteriores"
              title="Conversas anteriores"
              onClick={assistant.showHistory}
              className="ml-auto grid size-7 shrink-0 place-items-center rounded-full border border-primary/40 text-primary hover:bg-hover"
            >
              <History size={14} />
            </button>
          )}
        </div>
      )}
    </div>
    </div>
  );
}

/** A conversa aberta: o resumo do dia em fichas, a linha do tempo e o histórico ao lado. */
/** A conversa e o campo preso embaixo, na altura da janela: só a conversa rola. */
export function AssistantChat({ assistant }: { assistant: HomeAssistant }) {
  return (
    // A capa (150px) e o respiro do dock (112px do `main`) ficam de fora: a tela não rola.
    <div className="tab-panel relative flex h-[calc(100vh-264px)] flex-col">
      <AssistantConversation assistant={assistant} />
      <AssistantInput assistant={assistant} docked />
    </div>
  );
}

export function AssistantConversation({ assistant }: { assistant: HomeAssistant }) {
  const end = useRef<HTMLDivElement>(null);
  const turns: (Turn & { pending?: boolean })[] = turnsOf(assistant.conversation?.messages ?? []);
  if (assistant.pending) {
    turns.push({
      id: 'pending',
      question: assistant.pending.text,
      askedAt: assistant.pending.at,
      answer: null,
      pending: true,
    });
  }
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [turns.length, assistant.currentId, assistant.conversation?.messages.length]);

  return (
    <div className="relative mx-auto flex min-h-0 w-[760px] max-w-full flex-1 flex-col gap-3">
      <nav aria-label="Conversa" className="flex flex-wrap items-center gap-2">
        <DaySummary />
        <div className="ml-auto flex items-center gap-2">
          <IconButton label="Histórico" active={assistant.history} onClick={assistant.toggleHistory}>
            <History size={16} />
          </IconButton>
          <IconButton label="Nova conversa" onClick={assistant.newChat}>
            <PenSquare size={16} />
          </IconButton>
          <button
            type="button"
            onClick={assistant.collapse}
            className="flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-[13px] transition-colors hover:bg-hover"
          >
            <ChevronDown size={14} /> Mostrar o dia
          </button>
        </div>
      </nav>

      {assistant.history && (
        <div className="absolute top-12 right-[calc(100%+20px)] z-10 w-60 max-xl:static max-xl:w-full">
          <HistoryList currentId={assistant.currentId} onPick={assistant.pick} />
        </div>
      )}

      {/* O respiro de baixo é a altura do campo: a última resposta não fica escondida atrás dele. */}
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {turns.length === 0 ? (
          <p className="pt-10 pl-[84px] text-[15px] text-muted">
            Conversa nova. Pergunte sobre as contas, a agenda, as tarefas ou o seu dia.
          </p>
        ) : (
          turns.map((turn) => <TurnView key={turn.id} turn={turn} devMode={assistant.devMode} />)
        )}
        <div ref={end} aria-hidden className="h-40" />
      </div>
    </div>
  );
}
