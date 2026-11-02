import { CalendarRange, Flame, Grid3x3 } from 'lucide-react';

import { longDate, todayString } from '../../lib/format';
import { useRpc } from '../../lib/rpc';
import { cn } from '../../ui';

import { Empty, HomeCard, Loaded } from './card';
import { localDate, minutesLabel, mondayOf, shiftDate } from './dates';

export function StreakCard() {
  const query = useRpc('habits.list');
  return (
    <HomeCard icon={Flame} title="Sequência" to="/habitos" module="Hábitos">
      <Loaded query={query}>
        {(all) => {
          const habits = all.filter((habit) => !habit.ended);
          const ranked = [...habits].sort((a, b) => b.streak - a.streak).slice(0, 3);
          const top = ranked[0];
          if (!top) {
            return <Empty icon={Flame} title="Sem sequência ainda" action="Criar hábito" to="/habitos" />;
          }
          const record = Math.max(...habits.map((habit) => habit.longestStreak));
          return (
            <>
              <p className="text-[32px] leading-none font-semibold tabular-nums">{top.streak}</p>
              <p className="mt-1 truncate text-xs text-muted">
                {top.streak > 0 ? `seguidas em ${top.name}` : 'Marque um hábito para começar'}
              </p>
              <ul className="mt-4 flex flex-col gap-2 border-t border-line pt-3">
                {ranked.slice(1).map((habit) => (
                  <li key={habit.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 truncate text-muted">{habit.name}</span>
                    <span className="ml-auto text-xs tabular-nums">{habit.streak}</span>
                  </li>
                ))}
                <li className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Recorde</span>
                  <span className="ml-auto text-xs tabular-nums">{record}</span>
                </li>
              </ul>
            </>
          );
        }}
      </Loaded>
    </HomeCard>
  );
}

const WEEKS = 17;
const COMPLETED_LIMIT = 1000;
// Degraus de um tom só: 1, 2, 3 ou 4 tarefas ou mais no dia.
const LEVELS = ['bg-primary/25', 'bg-primary/50', 'bg-primary/75', 'bg-primary'];

function useCompletedByDay() {
  const query = useRpc('tasks.list', { view: 'completed', limit: COMPLETED_LIMIT });
  const counts = new Map<string, number>();
  for (const task of query.data ?? []) {
    if (!task.completedAt) continue;
    const day = localDate(task.completedAt);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return { query, counts };
}

export function MosaicCard() {
  const { query, counts } = useCompletedByDay();
  const today = todayString();
  const start = shiftDate(mondayOf(today), -7 * (WEEKS - 1));
  const days = Array.from({ length: WEEKS * 7 }, (_, index) => shiftDate(start, index));
  const inWindow = days.reduce((sum, day) => sum + (counts.get(day) ?? 0), 0);
  return (
    <HomeCard
      icon={Grid3x3}
      title="Tarefas concluídas"
      to="/tarefas"
      module="Tarefas"
      extra={inWindow > 0 && `${inWindow} em ${WEEKS} semanas`}
    >
      <Loaded query={query} rows={4}>
        {() =>
          inWindow === 0 ? (
            <Empty icon={Grid3x3} title="Nada concluído ainda" action="Ver tarefas" to="/tarefas" />
          ) : (
            <>
              <div
                className="grid grid-flow-col gap-[3px]"
                style={{
                  gridTemplateRows: 'repeat(7, 1fr)',
                  gridTemplateColumns: `repeat(${WEEKS}, 1fr)`,
                }}
              >
                {days.map((day) => {
                  const count = counts.get(day) ?? 0;
                  const future = day > today;
                  return (
                    <span
                      key={day}
                      title={future ? undefined : `${longDate(day)}: ${count}`}
                      className={cn(
                        'aspect-square rounded-[3px]',
                        future
                          ? 'bg-transparent'
                          : count
                            ? LEVELS[Math.min(count, LEVELS.length) - 1]
                            : 'bg-active',
                        day === today && 'outline outline-1 outline-line-strong'
                      )}
                    />
                  );
                })}
              </div>
              <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-subtle">
                1
                {LEVELS.map((level) => (
                  <span key={level} className={cn('size-2.5 rounded-[3px]', level)} />
                ))}
                4+
              </div>
            </>
          )
        }
      </Loaded>
    </HomeCard>
  );
}

const WEEK_LETTERS = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

export function WeekCard() {
  const panel = useRpc('focus.panel');
  const { counts } = useCompletedByDay();
  const today = todayString();
  const monday = mondayOf(today);
  const week = Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
  return (
    <HomeCard icon={CalendarRange} title="Ritmo da semana" to="/foco" module="Foco">
      <Loaded query={panel}>
        {(data) => {
          const seconds = new Map(data.last14.map((day) => [day.date, day.seconds]));
          const top = Math.max(data.goalMinutes * 60, ...week.map((day) => seconds.get(day) ?? 0));
          const tasks = week.reduce((sum, day) => sum + (counts.get(day) ?? 0), 0);
          if (data.weekSeconds === 0 && tasks === 0) {
            return (
              <Empty
                icon={CalendarRange}
                title="Semana começando"
                text="Foco e tarefas concluídas aparecem aqui."
                action="Começar sessão"
                to="/foco"
              />
            );
          }
          return (
            <>
              <p className="text-xs text-muted tabular-nums">
                {minutesLabel(data.weekSeconds)} de foco, {tasks}{' '}
                {tasks === 1 ? 'tarefa concluída' : 'tarefas concluídas'}
              </p>
              <div className="mt-3 grid flex-1 grid-cols-7 gap-1.5">
                {week.map((day, index) => {
                  const spent = seconds.get(day) ?? 0;
                  const done = counts.get(day) ?? 0;
                  return (
                    <div
                      key={day}
                      title={`${longDate(day)}: ${minutesLabel(spent)} de foco, ${done} concluídas`}
                      className="flex flex-col items-center gap-1"
                    >
                      <div className="flex h-24 w-full items-end justify-center rounded-[4px] bg-hover">
                        <div
                          className={cn('w-full rounded-[4px]', day > today ? '' : 'bg-primary')}
                          style={{ height: `${Math.round((spent / top) * 100)}%` }}
                        />
                      </div>
                      <span className={cn('text-[11px]', day === today ? 'text-foreground' : 'text-subtle')}>
                        {WEEK_LETTERS[index]}
                      </span>
                      <span className="text-[11px] text-muted tabular-nums">{done || '·'}</span>
                    </div>
                  );
                })}
              </div>
            </>
          );
        }}
      </Loaded>
    </HomeCard>
  );
}
