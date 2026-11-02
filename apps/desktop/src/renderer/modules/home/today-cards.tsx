import { relativeDay } from '@sektor/core/src/modules/tasks/logic';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  Annoyed,
  CalendarDays,
  Check,
  CheckSquare,
  Flame,
  Frown,
  Laugh,
  Meh,
  Receipt,
  Repeat2,
  Smile,
  Sparkles,
  Timer,
} from 'lucide-react';
import { toast } from 'sonner';

import { money, shortDate, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, cn } from '../../ui';
import { ScorePicker } from '../health/shared';
import { PriorityBars } from '../tasks/chips';

import { CAPTURE_INPUT_ID } from './capture';
import { Empty, HomeCard, Loaded, Meter, More } from './card';
import { localDate, minutesLabel, shiftDate, weekdayName } from './dates';

const MOODS = [
  { label: 'Muito mal', icon: Frown },
  { label: 'Mal', icon: Annoyed },
  { label: 'Neutro', icon: Meh },
  { label: 'Bem', icon: Smile },
  { label: 'Muito bem', icon: Laugh },
];
const ENERGY = ['Sem energia', 'Baixa', 'Média', 'Boa', 'Alta'].map((label) => ({ label }));

function Round({
  label,
  done,
  tone,
  disabled,
  onClick,
}: {
  label: string;
  done?: boolean;
  tone?: string;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={Boolean(done)}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      style={done && tone ? { background: tone, borderColor: tone } : undefined}
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-full border',
        done
          ? 'border-primary bg-primary text-on-primary'
          : 'border-line-strong text-transparent hover:border-primary hover:text-primary'
      )}
    >
      <Check size={11} strokeWidth={3} />
    </button>
  );
}

export function CheckinCard() {
  const query = useRpc('health.today');
  const save = useRpcMutation('health.checkinSave');
  return (
    <HomeCard icon={Sparkles} title="Como você está" to="/saude" module="Saúde">
      <Loaded query={query} rows={4}>
        {(day) => (
          <div className="flex flex-col gap-4">
            <ScorePicker
              label="Humor"
              options={MOODS}
              value={day.checkin.mood}
              onChange={(mood) => save.mutate({ date: day.date, mood })}
            />
            <ScorePicker
              label="Energia"
              options={ENERGY}
              value={day.checkin.energy}
              onChange={(energy) => save.mutate({ date: day.date, energy })}
            />
          </div>
        )}
      </Loaded>
    </HomeCard>
  );
}

const HABITS_SHOWN = 5;

export function HabitsCard() {
  const query = useRpc('habits.today');
  const toggle = useRpcMutation('habits.toggle');
  return (
    <HomeCard
      icon={Repeat2}
      title="Hábitos de hoje"
      to="/habitos"
      module="Hábitos"
      extra={query.data && query.data.total > 0 && `${query.data.done} de ${query.data.total}`}
    >
      <Loaded query={query}>
        {(today) =>
          today.total === 0 ? (
            <Empty icon={Repeat2} title="Nada para hoje" action="Criar hábito" to="/habitos" />
          ) : (
            <>
              <ul className="flex flex-col gap-2.5">
                {today.habits.slice(0, HABITS_SHOWN).map((habit) => (
                  <li key={habit.id} className="flex items-center gap-2.5 text-sm">
                    <Round
                      label={`${habit.doneToday ? 'Desmarcar' : 'Marcar'} ${habit.name}`}
                      done={habit.doneToday}
                      tone={`var(--tone-${habit.color})`}
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ id: habit.id, date: today.date })}
                    />
                    <span className={cn('min-w-0 truncate', habit.doneToday && 'text-muted')}>
                      {habit.name}
                    </span>
                    {habit.atRisk && !habit.doneToday && (
                      <span className="shrink-0 text-xs text-warning">Em risco</span>
                    )}
                    {habit.streak > 0 && (
                      <span
                        title={`Sequência de ${habit.streak}`}
                        className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted tabular-nums"
                      >
                        <Flame size={12} />
                        {habit.streak}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              <More to="/habitos" count={today.total - HABITS_SHOWN} />
            </>
          )
        }
      </Loaded>
    </HomeCard>
  );
}

const TASKS_SHOWN = 6;

export function TasksCard() {
  const query = useRpc('tasks.list', { view: 'today' });
  const complete = useRpcMutation('tasks.complete');
  const today = todayString();
  return (
    <HomeCard
      icon={CheckSquare}
      title="Tarefas de hoje"
      to="/tarefas"
      module="Tarefas"
      extra={query.data && query.data.length > 0 && query.data.length}
    >
      <Loaded query={query}>
        {(tasks) =>
          tasks.length === 0 ? (
            <Empty
              icon={CheckSquare}
              title="Nada com prazo para hoje"
              action="Capturar tarefa"
              onAction={() => document.getElementById(CAPTURE_INPUT_ID)?.focus()}
            />
          ) : (
            <>
              <ul className="flex flex-col gap-2.5">
                {tasks.slice(0, TASKS_SHOWN).map((task) => (
                  <li key={task.id} className="flex items-center gap-2.5 text-sm">
                    <Round
                      label={`Concluir ${task.title}`}
                      disabled={complete.isPending}
                      onClick={() =>
                        complete.mutate(
                          { id: task.id },
                          {
                            onSuccess: ({ next }) => {
                              if (next) toast.success('Concluída. A próxima já está na lista.');
                            },
                          }
                        )
                      }
                    />
                    <span className="min-w-0 truncate">{task.title}</span>
                    <PriorityBars priority={task.priority} />
                    <span
                      className={cn(
                        'ml-auto shrink-0 text-xs tabular-nums',
                        task.dueDate && task.dueDate < today ? 'text-danger' : 'text-muted'
                      )}
                    >
                      {task.dueDate && task.dueDate < today
                        ? relativeDay(task.dueDate, today)
                        : task.dueTime}
                    </span>
                  </li>
                ))}
              </ul>
              <More to="/tarefas" count={tasks.length - TASKS_SHOWN} />
            </>
          )
        }
      </Loaded>
    </HomeCard>
  );
}

const AGENDA_DAYS = 7;
const EVENTS_SHOWN = 5;
const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function AgendaCard() {
  const today = todayString();
  const query = useRpc('events.list', { from: today, to: shiftDate(today, AGENDA_DAYS) });
  const dayName = (date: string) => {
    if (date === today) return 'Hoje';
    if (date === shiftDate(today, 1)) return 'Amanhã';
    return weekdayName(date);
  };
  return (
    <HomeCard icon={CalendarDays} title="Agenda" to="/agenda" module="Agenda">
      <Loaded query={query}>
        {(occurrences) => {
          const now = Date.now();
          const events = occurrences
            .filter((event) => !event.taskId)
            .filter((event) => event.allDay || new Date(event.endAt).getTime() >= now)
            .map((event) => ({
              ...event,
              day: event.allDay ? event.startAt.slice(0, 10) : localDate(event.startAt),
            }))
            .sort((a, b) => a.startAt.localeCompare(b.startAt));
          if (events.length === 0) {
            return (
              <Empty
                icon={CalendarDays}
                title="Semana livre"
                text="Nada marcado nos próximos dias."
                action="Abrir agenda"
                to="/agenda"
              />
            );
          }
          const shown = events.slice(0, EVENTS_SHOWN);
          return (
            <>
              <ul className="flex flex-col gap-2.5">
                {shown.map((event, index) => (
                  <li key={`${event.eventId}-${event.occurrenceStart}`}>
                    {event.day !== shown[index - 1]?.day && (
                      <p className="mb-1.5 text-[11px] text-subtle first-letter:uppercase">
                        {dayName(event.day)}
                      </p>
                    )}
                    <div className="flex items-center gap-2.5 text-sm">
                      <span
                        className="h-4 w-[3px] shrink-0 rounded-full bg-primary"
                        style={event.color ? { background: `var(--tone-${event.color})` } : undefined}
                      />
                      <span className="min-w-0 truncate">{event.title}</span>
                      <span className="ml-auto shrink-0 text-xs text-muted tabular-nums">
                        {event.allDay ? 'Dia todo' : clock.format(new Date(event.startAt))}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              <More to="/agenda" count={events.length - EVENTS_SHOWN} />
            </>
          );
        }}
      </Loaded>
    </HomeCard>
  );
}

export function FocusCard() {
  const query = useRpc('focus.summary');
  const navigate = useNavigate();
  return (
    <HomeCard icon={Timer} title="Foco" to="/foco" module="Foco">
      <Loaded query={query}>
        {(focus) =>
          !focus.active && focus.todaySeconds === 0 && focus.weekSeconds === 0 ? (
            <Empty icon={Timer} title="Sem foco ainda" text={`Meta de ${minutesLabel(focus.goalSeconds)} por dia.`} action="Começar sessão" to="/foco" />
          ) : (
            <div className="flex flex-1 flex-col gap-3">
              <div className="flex items-baseline justify-between">
                <p className="text-2xl font-semibold tabular-nums">{minutesLabel(focus.todaySeconds)}</p>
                <p className="text-xs text-muted tabular-nums">de {minutesLabel(focus.goalSeconds)}</p>
              </div>
              <Meter value={focus.goalProgress} />
              <p className="text-xs text-muted">{minutesLabel(focus.weekSeconds)} nesta semana</p>
              {focus.active ? (
                <Link to="/foco" className="mt-auto truncate text-sm text-primary">
                  {focus.active.paused ? 'Pausada' : 'Em andamento'}
                  {focus.active.label ? `: ${focus.active.label}` : ''}
                </Link>
              ) : (
                <Button size="sm" className="mt-auto self-start" onClick={() => void navigate({ to: '/foco' })}>
                  Começar sessão
                </Button>
              )}
            </div>
          )
        }
      </Loaded>
    </HomeCard>
  );
}

const BILLS_DAYS = 30;
const BILLS_SHOWN = 5;

export function BillsCard() {
  const today = todayString();
  const invoices = useRpc('invoices.due', { to: shiftDate(today, BILLS_DAYS) });
  const accounts = useRpc('accounts.list');
  // Sem isto, o cartão ainda mostra as faturas.
  const available = useRpc('plus.available');
  return (
    <HomeCard icon={Receipt} title="Contas a pagar" to="/financas" module="Finanças">
      <Loaded query={invoices}>
        {(due) => {
          const names = new Map(accounts.data?.map((account) => [account.id, account.name]));
          const bills = [
            ...due.map((invoice) => ({
              id: invoice.id,
              name: `Fatura ${names.get(invoice.accountId) ?? 'do cartão'}`,
              date: invoice.dueDate,
              cents: invoice.totalCents,
            })),
            ...(available.data?.plannedItems ?? []).map((item) => ({
              id: item.id,
              name: item.description,
              date: item.date,
              cents: item.amountCents,
            })),
          ].sort((a, b) => a.date.localeCompare(b.date));
          if (bills.length === 0) {
            return <Empty icon={Receipt} title="Nada a pagar" text="Nenhuma conta prevista." action="Abrir finanças" to="/financas" />;
          }
          const hidden = due.length + (available.data?.plannedCount ?? 0) - BILLS_SHOWN;
          return (
            <>
              <ul className="flex flex-col gap-2.5">
                {bills.slice(0, BILLS_SHOWN).map((bill) => (
                  <li key={bill.id} className="flex items-center gap-2.5 text-sm">
                    <span className={cn('w-10 shrink-0 text-xs tabular-nums', bill.date < today ? 'text-danger' : 'text-muted')}>
                      {shortDate(bill.date)}
                    </span>
                    <span className="min-w-0 truncate">{bill.name}</span>
                    <span className="ml-auto shrink-0 tabular-nums">{money(bill.cents)}</span>
                  </li>
                ))}
              </ul>
              <More to="/financas" count={hidden} />
            </>
          );
        }}
      </Loaded>
    </HomeCard>
  );
}
