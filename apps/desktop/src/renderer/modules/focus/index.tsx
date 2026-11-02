import { Link } from '@tanstack/react-router';
import { CalendarCheck, Maximize2, Play, Settings2, Timer, Trash2 } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { longDate, shortDate } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import {
  Button,
  Card,
  CardHeader,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  SectionLabel,
  Segmented,
  Select,
  Stat,
} from '../../ui';

import { type ActiveSession, clockFace, FocusScreen, MODE_LABEL, useNow } from './focus-screen';
import { duration } from './time';

type Mode = keyof typeof MODE_LABEL;

const MINUTES: Record<Exclude<Mode, 'FREE'>, number[]> = {
  POMODORO: [15, 25, 50],
  DEEP_WORK: [60, 90, 120],
};
const DEFAULT_MINUTES = { POMODORO: 25, DEEP_WORK: 90 };
const MINIMIZED_KEY = 'sektor.focus.minimized';

function StartCard({ onStarted }: { onStarted(): void }) {
  const [mode, setMode] = useState<Mode>('POMODORO');
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [link, setLink] = useState('');
  const linkables = useRpc('focus.linkables');
  const start = useRpcMutation('focus.start');
  const { tasks = [], projects = [] } = linkables.data ?? {};
  const [kind, id] = link.split(':');

  const begin = () =>
    start.mutate(
      {
        mode,
        plannedMinutes: mode === 'FREE' ? null : minutes[mode],
        taskId: kind === 'task' ? id : null,
        projectId: kind === 'project' ? id : null,
      },
      { onSuccess: onStarted }
    );

  return (
    <Card>
      <CardHeader icon={Timer} title="Nova sessão" />
      <div className="flex flex-col gap-4">
        <div>
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={(Object.keys(MODE_LABEL) as Mode[]).map((value) => ({
              value,
              label: MODE_LABEL[value],
            }))}
          />
        </div>
        {mode === 'FREE' ? (
          <p className="flex h-[52px] items-center text-sm text-muted">
            Sem tempo marcado: conta até você terminar.
          </p>
        ) : (
          <Field label="Duração">
            <div>
              <Segmented
                value={String(minutes[mode])}
                onChange={(value) => setMinutes({ ...minutes, [mode]: Number(value) })}
                options={MINUTES[mode].map((value) => ({
                  value: String(value),
                  label: `${value} min`,
                }))}
              />
            </div>
          </Field>
        )}
        <Field label="Ligar a">
          <Select value={link} onChange={(event) => setLink(event.target.value)}>
            <option value="">Nada, só foco</option>
            {tasks.length > 0 && (
              <optgroup label="Tarefas">
                {tasks.map((task) => (
                  <option key={task.id} value={`task:${task.id}`}>
                    {task.label}
                  </option>
                ))}
              </optgroup>
            )}
            {projects.length > 0 && (
              <optgroup label="Projetos">
                {projects.map((project) => (
                  <option key={project.id} value={`project:${project.id}`}>
                    {project.label}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Button variant="primary" className="self-start" disabled={start.isPending} onClick={begin}>
          <Play size={15} /> Começar
        </Button>
      </div>
    </Card>
  );
}

function MinimizedCard({ session, onOpen }: { session: ActiveSession; onOpen(): void }) {
  const now = useNow();
  return (
    <Card className="flex flex-col justify-between">
      <CardHeader icon={Timer} title={`${MODE_LABEL[session.mode]} em andamento`} />
      <p className="font-mono text-6xl tabular-nums">{clockFace(session, now).text}</p>
      {session.label && <p className="mt-2 text-sm text-muted">{session.label}</p>}
      <Button variant="primary" className="mt-4 self-start" onClick={onOpen}>
        <Maximize2 size={15} /> Voltar ao relógio
      </Button>
    </Card>
  );
}

function GoalDialog({
  goalMinutes,
  onClose,
}: {
  goalMinutes: number;
  onClose(): void;
}) {
  const [hours, setHours] = useState(String(goalMinutes / 60));
  const save = useRpcMutation('focus.setGoal');
  return (
    <Dialog open onOpenChange={onClose} title="Meta diária de foco">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            { goalMinutes: Math.round(Number(hours.replace(',', '.')) * 60) },
            { onSuccess: onClose }
          );
        }}
      >
        <Field label="Horas por dia">
          <Input autoFocus inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} />
        </Field>
        <Button type="submit" variant="primary" className="self-end" disabled={save.isPending}>
          Salvar
        </Button>
      </form>
    </Dialog>
  );
}

function TodayCard({
  todaySeconds,
  goalMinutes,
  onEdit,
}: {
  todaySeconds: number;
  goalMinutes: number;
  onEdit(): void;
}) {
  const goal = goalMinutes * 60;
  const progress = Math.min(1, todaySeconds / goal);
  const left = goal - todaySeconds;
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Hoje"
        action={
          <button type="button" onClick={onEdit} className="flex items-center gap-1 hover:text-foreground">
            <Settings2 size={13} /> Meta de {duration(goal)}
          </button>
        }
      />
      <p className="text-5xl font-semibold tabular-nums">{duration(todaySeconds)}</p>
      <div className="mt-auto">
        <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-active">
          <div className="h-full rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
        </div>
        <p className="mt-2 text-sm text-muted">
          {left > 0 ? `Faltam ${duration(left)} para a meta` : 'Meta do dia alcançada'}
        </p>
      </div>
    </Card>
  );
}

function ChartTip({ active, payload }: { active?: boolean; payload?: { payload: { date: string; seconds: number } }[] }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-control bg-raised px-2.5 py-1.5 text-xs shadow-popover">
      <p className="text-muted">{longDate(point.date)}</p>
      <p className="font-medium tabular-nums">{duration(point.seconds)}</p>
    </div>
  );
}

function FourteenDays({
  days,
  goalMinutes,
}: {
  days: { date: string; seconds: number }[];
  goalMinutes: number;
}) {
  const data = days.map((day) => ({ ...day, hours: day.seconds / 3600 }));
  const goal = goalMinutes / 60;
  return (
    <Card>
      <CardHeader title="Últimos 14 dias" action={`Linha: meta de ${duration(goalMinutes * 60)}`} />
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -20 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--subtle-foreground)', fontSize: 11 }}
            />
            <YAxis
              allowDecimals={false}
              domain={[0, (max: number) => Math.ceil(Math.max(max, goal))]}
              tickFormatter={(value: number) => `${value} h`}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--subtle-foreground)', fontSize: 11 }}
            />
            <Tooltip content={<ChartTip />} cursor={{ fill: 'var(--hover)' }} isAnimationActive={false} />
            <ReferenceLine y={goal} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
            <Bar dataKey="hours" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

function History() {
  const { data, isLoading } = useRpc('focus.history', { limit: 8 });
  const remove = useRpcMutation('focus.delete');
  if (isLoading) return <p className="text-sm text-muted">Carregando…</p>;
  if (!data?.length) {
    return (
      <Card>
        <EmptyState
          icon={Timer}
          title="Nenhuma sessão ainda"
          text="As sessões terminadas aparecem aqui, com o que ficou de cada uma."
        />
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <ul className="divide-y divide-[var(--border)]">
        {data.map((session) => (
          <li key={session.id} className="group flex items-start gap-3 px-4 py-3">
            <span className="w-14 pt-0.5 text-xs text-subtle tabular-nums">{shortDate(session.day)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                {MODE_LABEL[session.mode]}
                {session.label && <span className="text-muted"> · {session.label}</span>}
              </p>
              {session.note && <p className="mt-0.5 text-sm text-muted">{session.note}</p>}
            </div>
            <span className="text-sm font-medium tabular-nums">{duration(session.elapsedSeconds)}</span>
            <button
              type="button"
              aria-label="Apagar sessão"
              className="text-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-danger"
              onClick={() => remove.mutate({ id: session.id })}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function readMinimized() {
  try {
    return localStorage.getItem(MINIMIZED_KEY);
  } catch {
    return null;
  }
}

function FocusPage() {
  const active = useRpc('focus.active');
  const panel = useRpc('focus.panel');
  const [minimized, setMinimized] = useState(readMinimized);
  const [finished, setFinished] = useState<{ id: string; focusSeconds: number } | null>(null);
  const [editingGoal, setEditingGoal] = useState(false);
  const session = active.data ?? null;

  const minimize = (id: string | null) => {
    setMinimized(id);
    try {
      if (id) localStorage.setItem(MINIMIZED_KEY, id);
      else localStorage.removeItem(MINIMIZED_KEY);
    } catch {
      // Sem armazenamento, só não lembra ao recarregar.
    }
  };

  const showClock = finished !== null || (session !== null && minimized !== session.id);

  return (
    <>
      <PageHeader
        icon={Timer}
        title="Foco"
        description="Uma coisa de cada vez."
        actions={
          <Link to="/revisao">
            <Button variant="ghost">
              <CalendarCheck size={15} /> Revisão
            </Button>
          </Link>
        }
      />
      {showClock && (
        <FocusScreen
          session={session}
          finished={finished}
          onMinimize={() => session && minimize(session.id)}
          onFinished={setFinished}
          onClose={() => setFinished(null)}
        />
      )}
      {editingGoal && panel.data && (
        <GoalDialog goalMinutes={panel.data.goalMinutes} onClose={() => setEditingGoal(false)} />
      )}
      {!panel.data ? (
        <p className="text-sm text-muted">Carregando…</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            {session ? (
              <MinimizedCard session={session} onOpen={() => minimize(null)} />
            ) : (
              <StartCard onStarted={() => minimize(null)} />
            )}
            <TodayCard
              todaySeconds={panel.data.todaySeconds}
              goalMinutes={panel.data.goalMinutes}
              onEdit={() => setEditingGoal(true)}
            />
          </div>
          <div className="grid grid-cols-[220px_1fr] gap-4">
            <div className="flex flex-col gap-4">
              <Card className="flex-1">
                <Stat label="Foco na semana" value={duration(panel.data.weekSeconds)} hint="Segunda a domingo" />
              </Card>
              <Card className="flex-1">
                <Stat
                  label="Melhor dia"
                  value={panel.data.bestDay ? duration(panel.data.bestDay.seconds) : '—'}
                  hint={panel.data.bestDay ? longDate(panel.data.bestDay.date) : 'Nos últimos 14 dias'}
                />
              </Card>
            </div>
            <FourteenDays days={panel.data.last14} goalMinutes={panel.data.goalMinutes} />
          </div>
          <div>
            <SectionLabel>Histórico</SectionLabel>
            <History />
          </div>
        </div>
      )}
    </>
  );
}

export const routes = [{ path: '/foco', component: FocusPage }];
