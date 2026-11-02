import type { Rpc } from '@sektor/core';
import { MoonStar, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { shortDate, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, CardHeader, EmptyState, Field, Input, SectionLabel, Stat } from '../../ui';

import { durationLabel, Loading, ScorePicker, shiftDate } from './shared';

type History = Awaited<ReturnType<Rpc['health.sleepList']>>;
type Entry = History['entries'][number];

const QUALITY = ['Péssima', 'Ruim', 'Regular', 'Boa', 'Ótima'].map((label) => ({ label }));
const CHART_NIGHTS = 14;

function minutesBetween(bed: string, wake: string) {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return (toMinutes(wake) - toMinutes(bed) + 1440) % 1440;
}

function SleepForm({ entries }: { entries: Entry[] }) {
  const save = useRpcMutation('health.sleepSave');
  const [date, setDate] = useState(todayString);
  const [bedTime, setBed] = useState('23:00');
  const [wakeTime, setWake] = useState('07:00');
  const [quality, setQuality] = useState<number | null>(null);

  const saved = entries.find((entry) => entry.date === date);
  useEffect(() => {
    if (!saved) return;
    setBed(saved.bedTime);
    setWake(saved.wakeTime);
    setQuality(saved.quality);
  }, [saved]);

  const minutes = bedTime && wakeTime ? minutesBetween(bedTime, wakeTime) : 0;
  return (
    <Card>
      <CardHeader icon={MoonStar} title={saved ? 'Editar noite' : 'Registrar noite'} />
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ date, bedTime, wakeTime, quality });
        }}
      >
        <Field label="Dia em que acordou">
          <Input
            type="date"
            max={todayString()}
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dormi às">
            <Input type="time" value={bedTime} onChange={(e) => setBed(e.target.value)} required />
          </Field>
          <Field label="Acordei às">
            <Input type="time" value={wakeTime} onChange={(e) => setWake(e.target.value)} required />
          </Field>
        </div>
        <ScorePicker label="Qualidade" options={QUALITY} value={quality} onChange={setQuality} />
        <div className="mt-1 flex items-center justify-between">
          <p className="text-sm text-muted">
            Duração: <span className="font-medium text-foreground">{durationLabel(minutes)}</span>
          </p>
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** Uma barra por noite; a noite sem registro fica como espaço vazio, não como zero. */
function SleepChart({ entries }: { entries: Entry[] }) {
  const today = todayString();
  const nights = Array.from({ length: CHART_NIGHTS }, (_, i) => {
    const date = shiftDate(today, i + 1 - CHART_NIGHTS);
    return { date, entry: entries.find((e) => e.date === date) };
  });
  const top = Math.max(600, ...nights.map((n) => n.entry?.minutes ?? 0));
  return (
    <div>
      <div className="relative flex h-40 items-end gap-1.5 border-b border-line">
        {nights.map(({ date, entry }) => (
          <div key={date} className="group relative flex h-full flex-1 items-end justify-center">
            {entry && (
              <>
                <div
                  className="w-full max-w-5 rounded-t bg-primary transition-opacity group-hover:opacity-80"
                  style={{ height: `${(entry.minutes / top) * 100}%` }}
                />
                <div className="pointer-events-none absolute bottom-full z-10 mb-1 hidden rounded-control bg-raised px-2 py-1 text-xs whitespace-nowrap shadow-popover group-hover:block">
                  {shortDate(date)} · {durationLabel(entry.minutes)}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-subtle">
        <span>{shortDate(nights[0]!.date)}</span>
        <span>{shortDate(today)}</span>
      </div>
    </div>
  );
}

export function SleepTab() {
  const history = useRpc('health.sleepList');
  const remove = useRpcMutation('health.sleepDelete');
  if (!history.data) return <Loading />;
  const { entries, averageWeek, averageMonth, averageQuality } = history.data;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[320px_1fr]">
      <SleepForm entries={entries} />
      <div className="flex flex-col gap-4">
        <Card>
          <div className="mb-4 grid grid-cols-3 gap-3">
            <Stat label="Média em 7 dias" value={averageWeek ? durationLabel(averageWeek) : '—'} />
            <Stat label="Média em 30 dias" value={averageMonth ? durationLabel(averageMonth) : '—'} />
            <Stat
              label="Qualidade média"
              value={averageQuality ? (averageQuality / 10).toLocaleString('pt-BR') : '—'}
              hint="de 1 a 5"
            />
          </div>
          <SectionLabel>Últimas 14 noites</SectionLabel>
          <SleepChart entries={entries} />
        </Card>
        <Card>
          <SectionLabel>Noites registradas</SectionLabel>
          {entries.length === 0 ? (
            <EmptyState
              icon={MoonStar}
              title="Nenhuma noite ainda"
              text="Registre a última noite para começar o histórico."
            />
          ) : (
            <ul className="flex flex-col">
              {entries.slice(0, 14).map((entry) => (
                <li
                  key={entry.date}
                  className="flex items-center gap-4 border-b border-line py-1.5 text-sm last:border-0"
                >
                  <span className="w-12 text-muted tabular-nums">{shortDate(entry.date)}</span>
                  <span className="font-mono text-xs text-muted">
                    {entry.bedTime} – {entry.wakeTime}
                  </span>
                  <span className="font-medium tabular-nums">{durationLabel(entry.minutes)}</span>
                  <span className="text-xs text-subtle">
                    {entry.quality ? QUALITY[entry.quality - 1]!.label : 'Sem nota'}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    aria-label={`Apagar noite de ${shortDate(entry.date)}`}
                    onClick={() => remove.mutate({ date: entry.date })}
                  >
                    <Trash2 size={13} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
