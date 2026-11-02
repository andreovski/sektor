import { formFromOccurrence, type EventForm, newEventForm } from '@sektor/core/src/modules/agenda/form';
import {
  addDays,
  addMonthsClamped,
  capitalize,
  dayKey,
  dayRange,
  type EventOccurrence,
  eventsByDay,
  longDay,
  monthGrid,
  monthTitle,
  shortDay,
  startOfWeek,
  tasksInRange,
  weekDays,
} from '@sektor/core/src/modules/agenda/view';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  AlertTriangle,
  Bell,
  CalendarCog,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { call, useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, cn, PageHeader, Segmented } from '../../ui';
import { useGoogleRefresh } from '../settings/google';

import { CalendarsDialog } from './calendars-dialog';
import { EventDetail } from './event-detail';
import { EventFormDialog } from './event-form';
import { ListView } from './list-view';
import { MonthView } from './month-view';
import { TIME_ZONE, useStored } from './shared';
import { TimeGrid } from './time-grid';

type View = 'month' | 'week' | 'day' | 'list';

const VIEWS: { value: View; label: string }[] = [
  { value: 'month', label: 'Mês' },
  { value: 'week', label: 'Semana' },
  { value: 'day', label: 'Dia' },
  { value: 'list', label: 'Lista' },
];

const LIST_DAYS = 60;

function daysOf(view: View, date: string) {
  if (view === 'month') return monthGrid(date).flat();
  if (view === 'week') return weekDays(date);
  if (view === 'day') return [date];
  return dayRange(date, LIST_DAYS);
}

function periodTitle(view: View, date: string) {
  if (view === 'month') return monthTitle(date);
  if (view === 'day') return capitalize(longDay(date));
  if (view === 'list') return `A partir de ${shortDay(date)}`;
  const first = startOfWeek(date);
  return `${shortDay(first)} – ${shortDay(addDays(first, 6))}`;
}

function shift(view: View, date: string, direction: number) {
  if (view === 'month') return addMonthsClamped(date, direction);
  if (view === 'week') return addDays(date, 7 * direction);
  if (view === 'day') return addDays(date, direction);
  return addDays(date, LIST_DAYS * direction);
}

type Editing = { form: EventForm; event: EventOccurrence | null };

function Page() {
  const navigate = useNavigate();
  const today = dayKey(new Date(), TIME_ZONE);
  const [view, setView] = useStored<View>('sektor.agenda.view', 'month');
  const [tasksPref, setTasksPref] = useStored<'show' | 'hide'>('sektor.agenda.tasks', 'show');
  const showTasks = tasksPref === 'show';
  const [date, setDate] = useState(today);
  const [selected, setSelected] = useState<EventOccurrence | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [managing, setManaging] = useState(false);

  const days = useMemo(() => daysOf(view, date), [view, date]);
  const from = days[0]!;
  const to = addDays(days[days.length - 1]!, 1);

  const google = useGoogleRefresh();
  const syncGoogle = useRpcMutation('google.sync');
  const expired = google?.accounts.filter((account) => account.needsReconnect) ?? [];

  const calendars = useRpc('calendars.list');
  const events = useRpc('events.list', { from, to });
  // Tarefas são de outro módulo: se falhar, a agenda segue só com os eventos.
  const tasks = useQuery({
    queryKey: ['tasks.list', from, to],
    queryFn: () => call('tasks.list', { dueFrom: from, dueTo: addDays(to, -1), limit: 1000 }),
    enabled: showTasks,
    retry: false,
  });

  const merged = useMemo(() => {
    const own = events.data ?? [];
    if (!showTasks || !tasks.data) return own;
    return [...own, ...tasksInRange(tasks.data, from, to, TIME_ZONE)];
  }, [events.data, tasks.data, showTasks, from, to]);
  const byDay = useMemo(() => eventsByDay(merged, days, TIME_ZONE), [merged, days]);

  const list = calendars.data ?? [];
  const colorOf = (event: EventOccurrence) =>
    event.color ?? list.find((c) => c.id === event.calendarId)?.color ?? 'blue';
  const writable = list.filter((calendar) => !calendar.readOnly);
  const defaultCalendar = (writable.find((calendar) => calendar.isDefault) ?? writable[0])?.id ?? '';

  const create = (day = date, hour?: number) =>
    setEditing({
      event: null,
      form: newEventForm({
        date: day,
        now: new Date(),
        timeZone: TIME_ZONE,
        calendarId: defaultCalendar,
        hour,
      }),
    });

  const select = (event: EventOccurrence) => {
    if (event.taskId) void navigate({ to: '/tarefas' });
    else setSelected(event);
  };

  const shared = { byDay, colorOf, onSelect: select };

  return (
    <>
      <PageHeader
        icon={CalendarDays}
        title="Agenda"
        description={periodTitle(view, date)}
        actions={
          <>
            <Button
              variant="ghost"
              aria-pressed={!showTasks}
              onClick={() => setTasksPref(showTasks ? 'hide' : 'show')}
            >
              {showTasks ? <EyeOff size={15} /> : <Eye size={15} />}
              {showTasks ? 'Ocultar tarefas' : 'Mostrar tarefas'}
            </Button>
            <Button variant="ghost" onClick={() => void navigate({ to: '/lembretes' })}>
              <Bell size={15} />
              Lembretes
            </Button>
            {!!google?.accounts.length && (
              <Button
                variant="ghost"
                disabled={syncGoogle.isPending}
                onClick={() => syncGoogle.mutate(undefined)}
              >
                <RefreshCw size={15} className={cn(syncGoogle.isPending && 'animate-spin')} />
                Sincronizar
              </Button>
            )}
            <Button onClick={() => setManaging(true)}>
              <CalendarCog size={15} />
              Calendários
            </Button>
            <Button variant="primary" disabled={!defaultCalendar} onClick={() => create()}>
              <Plus size={15} />
              Novo evento
            </Button>
          </>
        }
      />

      {expired.length > 0 && (
        <p className="mb-3 flex items-center gap-2 text-sm text-warning">
          <AlertTriangle size={14} className="shrink-0" />
          {expired.map((account) => account.email).join(', ')}{' '}
          {expired.length > 1 ? 'precisam' : 'precisa'} entrar de novo. Os eventos que você já tem
          continuam aqui.
          <Button size="sm" variant="ghost" onClick={() => void navigate({ to: '/ajustes' })}>
            Abrir Ajustes
          </Button>
        </p>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Button aria-label="Anterior" onClick={() => setDate(shift(view, date, -1))}>
          <ChevronLeft size={15} />
        </Button>
        <Button onClick={() => setDate(today)}>Hoje</Button>
        <Button aria-label="Próximo" onClick={() => setDate(shift(view, date, 1))}>
          <ChevronRight size={15} />
        </Button>
        {showTasks && tasks.isError && (
          <span className="text-xs text-subtle">Tarefas indisponíveis agora.</span>
        )}
        <div className="ml-auto">
          <Segmented value={view} onChange={setView} options={VIEWS} />
        </div>
      </div>

      {events.isError && (
        <p className="mb-3 text-sm text-danger">Não deu para ler a agenda. Tente de novo.</p>
      )}

      {view === 'month' && (
        <MonthView
          {...shared}
          date={date}
          today={today}
          weeks={monthGrid(date)}
          loading={events.isPending}
          onSelectDay={setDate}
          onCreate={() => create()}
        />
      )}
      {(view === 'week' || view === 'day') && (
        <TimeGrid
          {...shared}
          days={days}
          onCreateAt={create}
          onSelectDay={(day) => {
            setDate(day);
            setView('day');
          }}
        />
      )}
      {view === 'list' && (
        <ListView
          {...shared}
          days={days}
          today={today}
          loading={events.isPending}
          onCreate={() => create()}
        />
      )}

      {selected && (
        <EventDetail
          event={selected}
          calendar={list.find((calendar) => calendar.id === selected.calendarId)}
          color={colorOf(selected)}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing({ event: selected, form: formFromOccurrence(selected, TIME_ZONE) });
            setSelected(null);
          }}
        />
      )}
      {editing && (
        <EventFormDialog
          initial={editing.form}
          editing={editing.event}
          calendars={list}
          onClose={() => setEditing(null)}
        />
      )}
      {managing && <CalendarsDialog calendars={list} onClose={() => setManaging(false)} />}
    </>
  );
}

export const routes = [{ path: '/agenda', component: Page }];
