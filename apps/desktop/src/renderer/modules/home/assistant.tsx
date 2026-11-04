import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUp, Check, ChevronDown, Flag, History, ImagePlus, Mic, PenSquare, RotateCcw, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { money } from '../../lib/format';
import { type PreparedImage, prepareImage } from '../../lib/image';
import { useVoice, type VoiceState } from '../../lib/voice/use-voice';
import { call, useRpc } from '../../lib/rpc';
import { Button, cn, Select } from '../../ui';
import { CategorySelect, useAccounts, useCategories } from '../finance/parts';
import { ModelMenu } from '../ai/model-menu';
import { AiText } from '../ai/shared';

import { localDate } from './dates';
import { MOODS } from './today-cards';

// O assistente no Início: o campo no lugar da captura; perguntar recolhe a capa, esconde os
// cartões e vira uma conversa em linha do tempo, como a do Jotta. "Mostrar o dia" volta.

type Conversation = Awaited<ReturnType<typeof call<'ai.chat.get'>>>;
type Message = Conversation['messages'][number];
type Proposal = Message['proposals'][number];

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
  images: string[];
  source: 'text' | 'voice';
  answer: Message | null;
}

/** O jeito como a pergunta chegou, no rodapé dela. */
const sourceLabel = (turn: Pick<Turn, 'images' | 'source'>) =>
  [turn.source === 'voice' ? 'VOZ' : 'TEXTO', turn.images.length ? 'FOTO' : null].filter(Boolean).join(' + ');

const MAX_IMAGES = 3;

/** Pergunta e resposta juntas, que é como a linha do tempo mostra. */
function turnsOf(messages: Message[]): Turn[] {
  const turns: Turn[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      turns.push({
        id: message.id,
        question: message.text,
        askedAt: message.createdAt,
        images: message.images,
        source: message.source,
        answer: null,
      });
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
        'rounded-control border-[1.5px] px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-[0.08em]',
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

const STATUS: Record<Proposal['status'], { label: string; className: string } | null> = {
  PENDING: null,
  APPLYING: { label: 'Salvando…', className: 'text-muted' },
  APPLIED: { label: 'Salvo', className: 'text-success' },
  DISCARDED: { label: 'Descartado', className: 'text-subtle' },
  UNDONE: { label: 'Desfeito', className: 'text-subtle' },
  FAILED: { label: 'Falhou', className: 'text-danger' },
};

const LINKS: Record<string, string> = {
  '/tarefas': 'Nas tarefas',
  '/agenda': 'Na agenda',
  '/financas': 'Nas finanças',
  '/habitos': 'Nos hábitos',
};

/** O cartão da proposta, como no Jotta: o que vai mudar, e salvar ou descartar. */
function ProposalCard({
  proposal,
  onChange,
  onReload,
}: {
  proposal: Proposal;
  onChange(next: Proposal): void;
  onReload(): void;
}) {
  const income = proposal.needs?.kind === 'INCOME';
  // Entrada não cai em cartão de crédito.
  const accounts = useAccounts().filter((a) => !a.archived && !(income && a.type === 'CREDIT_CARD'));
  const categories = useCategories();
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [busy, setBusy] = useState(false);
  const { card, status, needs } = proposal;
  const badge = STATUS[status];
  const missing = Boolean(needs && ((needs.account && !accountId) || (needs.category && !categoryId)));
  const act = async (method: 'ai.proposal.apply' | 'ai.proposal.discard' | 'ai.proposal.undo') => {
    setBusy(true);
    try {
      const next = await call(method, {
        id: proposal.id,
        ...(method === 'ai.proposal.apply' && needs
          ? { ...(accountId ? { accountId } : {}), ...(categoryId ? { categoryId } : {}) }
          : {}),
      } as never);
      onChange(next as Proposal);
    } catch (error) {
      toast.error((error as Error).message);
      // A proposta pode ter virado "Falhou": o cartão mostra o estado de verdade.
      onReload();
    } finally {
      setBusy(false);
    }
  };
  const quiet = status === 'DISCARDED' || status === 'UNDONE';

  return (
    <div className={cn('max-w-[560px] overflow-hidden rounded-[14px] border border-line bg-surface', quiet && 'opacity-60')}>
      <div className="flex items-center justify-between border-b border-dashed border-line-strong px-4 py-2 font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">
        <span>{card.kind}</span>
        {badge && (
          <span className={cn('flex items-center gap-1', badge.className)}>
            {status === 'APPLIED' && <Check size={12} />}
            {badge.label}
            {proposal.auto && status === 'APPLIED' ? ' sozinho' : ''}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1.5 px-4 py-3">
        {card.amountCents != null ? (
          <p className={cn('text-[20px] font-semibold tabular-nums', card.amountTone === 'income' ? 'text-success' : 'text-foreground')}>
            {money(card.amountCents)}
            <span className="ml-2 align-middle text-sm font-normal text-muted">{card.title}</span>
          </p>
        ) : (
          <p className="text-[15px] font-semibold">{card.title}</p>
        )}
        {card.rows.map((row) => {
          const choosing = status === 'PENDING' && needs && row.value === 'Escolha antes de salvar';
          return (
            <div key={row.label} className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-3 text-[13px]">
              <span className="font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">{row.label}</span>
              {choosing && row.label === 'Conta' ? (
                <Select aria-label="Conta" value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                  <option value="">Escolha a conta</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              ) : choosing && row.label === 'Categoria' ? (
                <CategorySelect
                  value={categoryId}
                  onChange={setCategoryId}
                  kind={(needs?.kind ?? 'EXPENSE') as 'EXPENSE' | 'INCOME'}
                  categories={categories}
                  placeholder="Escolha a categoria"
                />
              ) : (
                <span>
                  {row.before && (
                    <span className="mr-2 text-subtle line-through">{row.before}</span>
                  )}
                  {row.value}
                </span>
              )}
            </div>
          );
        })}
        {proposal.error && <p className="text-sm text-danger">{proposal.error}</p>}
      </div>
      {(status === 'PENDING' || status === 'APPLIED') && (
        <div className="grid grid-cols-2 border-t border-line">
          {status === 'PENDING' ? (
            <>
              <button
                type="button"
                disabled={busy || missing}
                onClick={() => void act('ai.proposal.apply')}
                className="flex h-9 items-center justify-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:bg-hover disabled:opacity-50"
              >
                <Check size={14} /> Salvar
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act('ai.proposal.discard')}
                className="flex h-9 items-center justify-center gap-1.5 border-l border-line font-mono text-[11px] tracking-[0.12em] text-muted uppercase transition-colors hover:bg-hover"
              >
                <X size={12} /> Descartar
              </button>
            </>
          ) : (
            <>
              {proposal.undoable ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act('ai.proposal.undo')}
                  className="flex h-9 items-center justify-center gap-1.5 text-[13px] font-medium text-primary transition-colors hover:bg-hover"
                >
                  <RotateCcw size={13} /> Desfazer
                </button>
              ) : (
                <span className="flex h-9 items-center justify-center text-xs text-subtle">Sem desfazer</span>
              )}
              <Link
                to={proposal.link}
                className="flex h-9 items-center justify-center border-l border-line font-mono text-[11px] tracking-[0.12em] text-muted uppercase transition-colors hover:bg-hover"
              >
                {LINKS[proposal.link] ?? 'Abrir'}
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TurnView({
  turn,
  devMode,
  onProposal,
  onReload,
}: {
  turn: Turn & { pending?: boolean };
  devMode: boolean;
  onProposal(next: Proposal): void;
  onReload(): void;
}) {
  const answer = turn.answer;
  return (
    <article className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-4 pt-4">
      <div className="flex flex-col items-center">
        <Tag areas={answer?.areas ?? []} />
        <span aria-hidden className="mt-2 w-0.5 flex-1 bg-primary/30" />
      </div>
      <div className="flex min-w-0 flex-col gap-2 pb-2">
        {turn.question && (
          <p className="text-[17px] leading-snug font-semibold">
            <span className="mr-2 text-primary">›</span>
            {turn.question}
          </p>
        )}
        {turn.images.length > 0 && (
          <div className="flex gap-2">
            {turn.images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt={`Foto ${i + 1}`}
                className="h-20 rounded-control border border-line object-cover"
              />
            ))}
          </div>
        )}
        <span className="font-mono text-[10px] tracking-[0.08em] text-subtle">
          {time(turn.askedAt)} · {sourceLabel(turn)}
        </span>
        {turn.pending ? (
          <div className="flex items-center gap-2.5 py-1 text-sm text-muted">
            <Dots /> Consultando os seus dados…
          </div>
        ) : answer ? (
          <>
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap text-foreground/90">
              <AiText text={answer.text} />
            </p>
            {answer.proposals.map((proposal) => (
              <ProposalCard key={proposal.id} proposal={proposal} onChange={onProposal} onReload={onReload} />
            ))}
            <span className="font-mono text-[10px] tracking-[0.08em] text-subtle uppercase">
              {answer.tools.length ? `Usou ${answer.tools.join(', ')}` : 'Sem consulta'}
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
  const [pending, setPending] = useState<{
    text: string;
    at: number;
    conversationId: string | null;
    images: string[];
    source: 'text' | 'voice';
  } | null>(null);
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

  const send = async (
    question: string,
    { images = [], source = 'text' }: { images?: PreparedImage[]; source?: 'text' | 'voice' } = {}
  ) => {
    const text = question.trim();
    if ((!text && !images.length) || pending || !model || model.problem) return;
    const from = currentId;
    setOpen(true);
    setHistory(false);
    setPending({ text, at: Date.now(), conversationId: from, images: images.map((i) => i.thumb), source });
    try {
      const next = await call('ai.chat.send', { conversationId: from, text, modelId, images, source });
      if (viewing.current === from) {
        setConversation(next);
        setCurrentId(next.id);
      }
      // Um lançamento salvo sozinho pelo Jev muda as outras telas também.
      void client.invalidateQueries();
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
    reload: () => {
      if (!currentId) return;
      void call('ai.chat.get', { id: currentId }).then(setConversation, () => {});
    },
    /** Troca a proposta resolvida na conversa aberta e avisa as telas que algo foi gravado. */
    updateProposal: (next: Proposal) => {
      setConversation((current) =>
        current && {
          ...current,
          messages: current.messages.map((m) => ({
            ...m,
            proposals: m.proposals.map((p) => (p.id === next.id ? next : p)),
          })),
        }
      );
      void client.invalidateQueries();
    },
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

export type HomeAssistant = ReturnType<typeof useHomeAssistant>;

/** No lugar do campo enquanto a voz grava, baixa o modelo ou transcreve. */
function VoiceStatus({ state }: { state: VoiceState }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (state.step !== 'recording') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state.step]);
  let label = '';
  if (state.step === 'recording') {
    const seconds = Math.max(0, Math.floor((now - state.startedAt) / 1000));
    label = `Ouvindo… ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · clique para enviar, Esc cancela`;
  } else if (state.step === 'loading') {
    label =
      state.progress === null
        ? 'Baixando o modelo de voz…'
        : `Baixando o modelo de voz… ${Math.round(state.progress * 100)}% (só na primeira vez)`;
  } else if (state.step === 'transcribing') {
    label = 'Transcrevendo no seu computador…';
  }
  return (
    <div role="status" className="flex h-11 min-w-0 flex-1 items-center gap-2.5 text-[15px] text-muted">
      {state.step === 'recording' ? (
        <span aria-hidden className="size-2.5 animate-pulse rounded-full bg-danger" />
      ) : (
        <Dots />
      )}
      <span className="truncate">{label}</span>
    </div>
  );
}

/** O campo do assistente: no meio da capa fechado, preso embaixo com a conversa aberta. */
export function AssistantInput({
  assistant,
  docked,
  tabs,
}: {
  assistant: HomeAssistant;
  docked?: boolean;
  /** As abas da captura do Início, no topo do campo. */
  tabs?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<PreparedImage[]>([]);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { model, models } = assistant;
  const blocked = !model || Boolean(model.problem);
  const canSend = Boolean(text.trim() || images.length);
  const voice = useVoice(
    (spoken) => {
      const sent = images;
      setImages([]);
      assistant.send(spoken, { images: sent, source: 'voice' }).catch(() => {
        setText(spoken);
        setImages(sent);
      });
    },
    (message) => toast.error(message)
  );
  const listening = voice.state.step !== 'idle' && voice.state.step !== 'confirm';
  const submit = () => {
    const value = text;
    const sent = images;
    if (!canSend) return;
    setText('');
    setImages([]);
    assistant.send(value, { images: sent }).catch(() => {
      setText(value);
      setImages(sent);
    });
  };
  /** Foto escolhida, colada ou arrastada. Passou de três, as primeiras ficam. */
  const attach = async (files: Iterable<File>) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) {
      toast.error(`No máximo ${MAX_IMAGES} fotos por pergunta.`);
      return;
    }
    if (list.length > room) toast.error(`No máximo ${MAX_IMAGES} fotos por pergunta.`);
    try {
      const prepared = await Promise.all(list.slice(0, room).map(prepareImage));
      setImages((current) => [...current, ...prepared].slice(0, MAX_IMAGES));
      input.current?.focus();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };
  useEffect(() => {
    if (docked) input.current?.focus();
  }, [docked]);
  useEffect(() => {
    if (voice.state.step !== 'recording') return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && voice.cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice]);

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
      onDragOver={(event) => {
        if (blocked || assistant.busy || !event.dataTransfer.types.includes('Files')) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!blocked && !assistant.busy) void attach(event.dataTransfer.files);
      }}
      className={cn(
        'rounded-[22px] border border-line-strong py-2 pr-2 pl-4 text-left shadow-popover focus-within:border-primary/50',
        docked ? 'bg-raised/85 backdrop-blur-xl' : 'bg-raised/90 backdrop-blur',
        dragging && 'border-primary'
      )}
    >
      {tabs && <div className="-mt-2 mb-1">{tabs}</div>}
      {images.length > 0 && (
        <div className="flex gap-2 pt-1 pb-2">
          {images.map((image, i) => (
            <div key={i} className="relative">
              <img src={image.thumb} alt={`Foto ${i + 1}`} className="size-14 rounded-control border border-line object-cover" />
              <button
                type="button"
                aria-label={`Tirar a foto ${i + 1}`}
                onClick={() => setImages((current) => current.filter((_, j) => j !== i))}
                className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full border border-line-strong bg-raised text-muted hover:text-foreground"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      {voice.state.step === 'confirm' && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line pt-1 pb-2.5 text-[13px] text-muted">
          <span className="min-w-0 flex-1">
            A voz é transcrita pelo Whisper no seu Mac: o áudio não sai daqui. Na primeira vez, ele baixa o
            modelo (uns 560 MB).
          </span>
          <Button size="sm" variant="primary" onClick={voice.accept}>
            Baixar e falar
          </Button>
          <Button size="sm" variant="ghost" onClick={voice.cancel}>
            Agora não
          </Button>
        </div>
      )}
      <div className="flex items-center gap-3">
        <span aria-hidden className="text-xl text-primary">›</span>
        {listening ? (
          <VoiceStatus state={voice.state} />
        ) : (
        <input
          ref={input}
          aria-label="Peça algo ao assistente"
          value={text}
          disabled={blocked || assistant.busy}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const files = [...event.clipboardData.files].filter((f) => f.type.startsWith('image/'));
            if (!files.length) return;
            event.preventDefault();
            void attach(files);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') submit();
            if (event.key === 'Escape' && docked) assistant.collapse();
          }}
          placeholder={
            !models.length
              ? 'Escolha um modelo em Ajustes › IA para usar o assistente'
              : (model?.problem ?? (images.length ? 'Diga o que fazer com a foto, ou envie' : 'Peça algo'))
          }
          style={{ outline: 'none' }}
          className="h-11 min-w-0 flex-1 bg-transparent text-[17px] placeholder:text-subtle disabled:opacity-70"
        />
        )}
        <input
          ref={picker}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(event) => {
            void attach(event.target.files ?? []);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          aria-label="Anexar foto"
          title="Anexar foto (também dá para colar ou arrastar)"
          onClick={() => picker.current?.click()}
          disabled={blocked || assistant.busy || listening || images.length >= MAX_IMAGES}
          className="grid size-9 place-items-center rounded-[12px] text-muted transition-colors hover:bg-hover hover:text-foreground disabled:opacity-40"
        >
          <ImagePlus size={17} />
        </button>
        {canSend ? (
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
            aria-label={voice.state.step === 'recording' ? 'Parar e enviar' : 'Falar'}
            title={voice.state.step === 'recording' ? 'Parar e enviar (Esc cancela)' : 'Falar'}
            onClick={voice.toggle}
            disabled={blocked || assistant.busy || voice.state.step === 'loading' || voice.state.step === 'transcribing'}
            className={cn(
              'grid size-11 place-items-center rounded-[14px] border transition-colors disabled:opacity-50',
              voice.state.step === 'recording'
                ? 'border-danger/60 bg-danger/15 text-danger'
                : 'border-primary/40 bg-primary/15 text-primary hover:bg-primary/25'
            )}
          >
            {voice.state.step === 'recording' ? <Square size={15} fill="currentColor" /> : <Mic size={18} />}
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
      images: assistant.pending.images,
      source: assistant.pending.source,
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
          turns.map((turn) => (
            <TurnView
              key={turn.id}
              turn={turn}
              devMode={assistant.devMode}
              onProposal={assistant.updateProposal}
              onReload={assistant.reload}
            />
          ))
        )}
        <div ref={end} aria-hidden className="h-40" />
      </div>
    </div>
  );
}
