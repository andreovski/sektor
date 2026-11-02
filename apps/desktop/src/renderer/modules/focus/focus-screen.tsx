import type { Rpc } from '@sektor/core';
import { focusSecondsAt, isPaused } from '@sektor/core/src/modules/focus/clock';
import { useQueryClient } from '@tanstack/react-query';
import { Coffee, Minimize2, Pause, Play, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useRpcMutation } from '../../lib/rpc';
import { Button, Textarea } from '../../ui';

import { clock, duration } from './time';

export type ActiveSession = NonNullable<ReturnType<Rpc['focus.active']>>;

export const MODE_LABEL = { POMODORO: 'Pomodoro', DEEP_WORK: 'Deep Work', FREE: 'Tempo livre' };
const BREAK_MINUTES = 5;

export function useNow() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** Com tempo planejado, o relógio desce até zero e depois mostra o que passou. */
export function clockFace(session: ActiveSession, now: number) {
  const elapsed = focusSecondsAt(session, now);
  if (session.plannedSeconds === null) return { text: clock(elapsed), done: false, elapsed };
  const left = session.plannedSeconds - elapsed;
  return { text: left >= 0 ? clock(left) : `+${clock(-left)}`, done: left <= 0, elapsed };
}

function useNativeFullscreen() {
  useEffect(() => {
    // Sem gesto da pessoa (ao recarregar) o pedido é recusado, e a tela segue cobrindo a janela.
    document.documentElement.requestFullscreen?.().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) void document.exitFullscreen();
    };
  }, []);
}

function Running({
  session,
  onMinimize,
  onFinished,
}: {
  session: ActiveSession;
  onMinimize(): void;
  onFinished(result: { id: string; focusSeconds: number }): void;
}) {
  const now = useNow();
  const pause = useRpcMutation('focus.pause');
  const pauseShort = useRpcMutation('focus.break');
  const resume = useRpcMutation('focus.resume');
  const finish = useRpcMutation('focus.finish');
  const client = useQueryClient();
  const paused = isPaused(session, now);
  const breakLeft =
    paused && session.pausedUntil !== null ? Math.ceil((session.pausedUntil - now) / 1000) : null;
  const { text, done, elapsed } = clockFace(session, now);
  const progress = session.plannedSeconds ? Math.min(1, elapsed / session.plannedSeconds) : null;

  const end = async () => {
    try {
      const result = await finish.mutateAsync(undefined);
      if (result.discarded) toast('Menos de 30 s: a sessão não entrou no histórico.');
      else onFinished(result);
    } catch {
      // O núcleo pode ter fechado a sessão esquecida: relê para a tela não ficar presa.
      await client.invalidateQueries();
    }
  };

  return (
    <>
      <button
        type="button"
        aria-label="Minimizar"
        title="Minimizar"
        onClick={onMinimize}
        className="absolute top-6 right-6 grid size-9 place-items-center rounded-control text-muted hover:bg-hover hover:text-foreground"
      >
        <Minimize2 size={18} />
      </button>
      <p className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
        {MODE_LABEL[session.mode]}
      </p>
      {session.label && <p className="mt-2 text-muted">{session.label}</p>}
      <p
        role="timer"
        className={`mt-6 font-mono text-[132px] leading-none tabular-nums ${paused ? 'text-subtle' : done ? 'text-primary' : ''}`}
      >
        {text}
      </p>
      <p className="mt-4 h-5 text-sm text-muted">
        {breakLeft !== null
          ? `Pausa curta: ${clock(breakLeft)}`
          : paused
            ? 'Em pausa'
            : done
              ? 'Tempo concluído'
              : ''}
      </p>
      {progress !== null && (
        <div className="mt-6 h-1 w-80 overflow-hidden rounded-full bg-active">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
      <div className="mt-10 flex items-center gap-2">
        {paused ? (
          <Button onClick={() => resume.mutate(undefined)}>
            <Play size={15} /> Retomar
          </Button>
        ) : (
          <>
            <Button onClick={() => pause.mutate(undefined)}>
              <Pause size={15} /> Pausar
            </Button>
            <Button onClick={() => pauseShort.mutate({ minutes: BREAK_MINUTES })}>
              <Coffee size={15} /> Pausa curta
            </Button>
          </>
        )}
        <Button variant="primary" disabled={finish.isPending} onClick={() => void end()}>
          <Square size={14} /> Terminar
        </Button>
      </div>
    </>
  );
}

function Finished({
  result,
  onClose,
}: {
  result: { id: string; focusSeconds: number };
  onClose(): void;
}) {
  const [note, setNote] = useState('');
  const save = useRpcMutation('focus.note');
  return (
    <div className="flex w-[440px] max-w-[90vw] flex-col items-center">
      <p className="text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
        Sessão encerrada
      </p>
      <p className="mt-3 font-mono text-5xl tabular-nums">{duration(result.focusSeconds)}</p>
      <label className="mt-8 flex w-full flex-col gap-2 text-sm text-muted">
        O que ficou?
        <Textarea
          autoFocus
          rows={4}
          value={note}
          maxLength={2000}
          placeholder="Opcional"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <div className="mt-4 flex gap-2 self-end">
        <Button variant="ghost" onClick={onClose}>
          Pular
        </Button>
        <Button
          variant="primary"
          disabled={!note.trim() || save.isPending}
          onClick={() => save.mutate({ id: result.id, note }, { onSuccess: onClose })}
        >
          Salvar
        </Button>
      </div>
    </div>
  );
}

/** Esconde tudo, inclusive o dock, e deixa o relógio. */
export function FocusScreen({
  session,
  finished,
  onMinimize,
  onFinished,
  onClose,
}: {
  session: ActiveSession | null;
  finished: { id: string; focusSeconds: number } | null;
  onMinimize(): void;
  onFinished(result: { id: string; focusSeconds: number }): void;
  onClose(): void;
}) {
  useNativeFullscreen();
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background">
      {finished ? (
        <Finished result={finished} onClose={onClose} />
      ) : session ? (
        <Running session={session} onMinimize={onMinimize} onFinished={onFinished} />
      ) : null}
    </div>
  );
}
