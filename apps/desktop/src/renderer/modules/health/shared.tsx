import type { Rpc } from '@sektor/core';
import {
  Battery,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  type LucideIcon,
  Pill,
  Undo2,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

import { longDate, shortDate, todayString } from '../../lib/format';
import { useRpcMutation } from '../../lib/rpc';
import { Button, cn, Input } from '../../ui';

export type DayData = Awaited<ReturnType<Rpc['health.day']>>;

export const durationLabel = (minutes: number) =>
  `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}`;

export const litersLabel = (ml: number) =>
  `${(ml / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} L`;

export function shiftDate(date: string, days: number) {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

export function dayLabel(date: string) {
  const today = todayString();
  if (date === today) return 'Hoje';
  if (date === shiftDate(today, -1)) return 'Ontem';
  return longDate(date);
}

export const clockOf = (timestamp: number) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(timestamp);

/** Anda de dia em dia, sem passar de hoje. */
export function DayStepper({ date, onChange }: { date: string; onChange(date: string): void }) {
  const today = todayString();
  return (
    <div className="inline-flex items-center gap-1 self-start">
      <Button
        variant="ghost"
        size="sm"
        aria-label="Dia anterior"
        onClick={() => onChange(shiftDate(date, -1))}
      >
        <ChevronLeft size={15} />
      </Button>
      <Input
        type="date"
        aria-label="Dia"
        className="w-[132px]"
        max={today}
        value={date}
        onChange={(event) => event.target.value && onChange(event.target.value)}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label="Próximo dia"
        disabled={date >= today}
        onClick={() => onChange(shiftDate(date, 1))}
      >
        <ChevronRight size={15} />
      </Button>
    </div>
  );
}

export interface ScoreOption {
  label: string;
  icon?: LucideIcon;
}

export const ENERGY: ScoreOption[] = [
  { label: 'Sem energia', icon: Battery },
  { label: 'Baixa', icon: BatteryLow },
  { label: 'Média', icon: BatteryMedium },
  { label: 'Boa', icon: BatteryFull },
  { label: 'Alta', icon: BatteryCharging },
];

/** Escala de 1 a 5. Clicar de novo no escolhido limpa. */
export function ScorePicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ScoreOption[];
  value: number | null;
  onChange(value: number | null): void;
}) {
  return (
    <div role="group" aria-label={label}>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <span className="text-muted">{label}</span>
        <span className="text-subtle">{value ? options[value - 1]?.label : 'Sem registro'}</span>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {options.map((option, index) => {
          const score = index + 1;
          const Icon = option.icon;
          return (
            <button
              key={option.label}
              type="button"
              aria-label={`${label}: ${option.label}`}
              aria-pressed={value === score}
              title={option.label}
              onClick={() => onChange(value === score ? null : score)}
              className={cn(
                'grid h-9 place-items-center rounded-control border text-sm tabular-nums transition-colors',
                value === score
                  ? 'border-primary/40 bg-primary/15 text-primary'
                  : 'border-line bg-sunken text-muted hover:bg-hover hover:text-foreground'
              )}
            >
              {Icon ? <Icon size={17} /> : score}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Meter({ percent, tone = 'primary' }: { percent: number; tone?: 'primary' | 'muted' }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-active">
      <div
        className={cn('h-full rounded-full', tone === 'primary' ? 'bg-primary' : 'bg-subtle')}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  );
}

export function Loading() {
  return <p className="py-8 text-center text-sm text-subtle">Carregando…</p>;
}

/**
 * Salva sozinho depois de uma pausa na digitação, e na hora ao sair da tela ou fechar a janela.
 * Quem usa carrega o texto com `call`, sem cache: o cache podia devolver o texto de antes do último
 * salvamento e ele sobrescreveria o novo.
 */
export function useAutosave(save: (text: string) => Promise<unknown>, delay = 600) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    if (pending.current === null) return;
    const text = pending.current;
    pending.current = null;
    void saveRef.current(text).then(
      () => setState((current) => (current === 'saving' && pending.current === null ? 'saved' : current)),
      () => setState('idle')
    );
  }, []);

  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [flush]);

  const schedule = useCallback(
    (text: string) => {
      pending.current = text;
      setState('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [delay, flush]
  );

  return { schedule, flush, state };
}

export function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' }) {
  if (state === 'idle') return null;
  return <span className="text-xs text-subtle">{state === 'saving' ? 'Salvando…' : 'Salvo'}</span>;
}

/** Pede um segundo clique antes de apagar. */
export function DeleteButton({ onConfirm, label = 'Apagar' }: { onConfirm(): void; label?: string }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button
      variant="danger"
      size="sm"
      onBlur={() => setArmed(false)}
      onClick={() => (armed ? onConfirm() : setArmed(true))}
    >
      {armed ? 'Confirmar' : label}
    </Button>
  );
}

export function DoseList({ day, empty }: { day: DayData; empty: ReactNode }) {
  const setDose = useRpcMutation('health.doseSet');
  const takeNow = useRpcMutation('health.takeNow');
  const undo = useRpcMutation('health.takeUndo');
  if (day.doses.length === 0 && day.asNeeded.length === 0) return <>{empty}</>;
  return (
    <ul className="flex flex-col gap-1">
      {day.doses.map((dose) => (
        <li key={`${dose.medId}-${dose.time}`}>
          <button
            type="button"
            aria-pressed={dose.taken}
            aria-label={`${dose.name}, ${dose.time}: ${dose.taken ? 'desmarcar' : 'marcar como tomada'}`}
            onClick={() =>
              setDose.mutate({
                medId: dose.medId,
                date: day.date,
                time: dose.time,
                taken: !dose.taken,
              })
            }
            className="flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left hover:bg-hover"
          >
            <span
              className={cn(
                'grid size-5 shrink-0 place-items-center rounded-full border',
                dose.taken ? 'border-primary bg-primary text-on-primary' : 'border-line-strong'
              )}
            >
              {dose.taken && <Check size={13} strokeWidth={3} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-sm', dose.taken && 'text-muted line-through')}>
                {dose.name}
              </span>
              <span className="block truncate text-xs text-subtle">{dose.dose}</span>
            </span>
            {dose.late && (
              <span className="inline-flex items-center gap-1 text-xs text-warning">
                <Clock size={12} /> Atrasada
              </span>
            )}
            <span className="font-mono text-xs text-muted">{dose.time}</span>
          </button>
        </li>
      ))}
      {day.asNeeded.map((med) => {
        const last = med.uses[0];
        return (
          <li key={med.medId} className="flex items-center gap-3 rounded-control px-2 py-1.5">
            <Pill size={16} className="mx-0.5 shrink-0 text-subtle" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{med.name}</span>
              <span className="block truncate text-xs text-subtle">
                {med.dose}
                {last ? ` · ${med.uses.length}× · ${clockOf(last.takenAt)}` : ' · se precisar'}
              </span>
            </span>
            {last && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Desfazer último uso de ${med.name}`}
                title="Desfazer último uso"
                onClick={() => undo.mutate({ id: last.id })}
              >
                <Undo2 size={13} />
              </Button>
            )}
            {day.isToday && (
              <Button size="sm" onClick={() => takeNow.mutate({ medId: med.medId })}>
                Tomei agora
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export { shortDate };
