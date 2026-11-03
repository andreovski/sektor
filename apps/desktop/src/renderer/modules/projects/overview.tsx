import { type EventForm, formFromOccurrence, newEventForm } from '@sektor/core/src/modules/agenda/form';
import { type EventOccurrence, whenLines } from '@sektor/core/src/modules/agenda/view';
import type { ProjectPageResponse } from '@sektor/core/src/modules/projects/contract';
import type { TaskResponse } from '@sektor/core/src/modules/tasks/contract';
import { findTask } from '@sektor/core/src/modules/tasks/logic';
import { CalendarDays, CheckSquare, Info, Plus } from 'lucide-react';
import { useState } from 'react';

import { longDate, todayString } from '../../lib/format';
import { useRpc } from '../../lib/rpc';
import { Button, Card, CardHeader, cn } from '../../ui';
import { EventDetail } from '../agenda/event-detail';
import { EventFormDialog } from '../agenda/event-form';
import { TIME_ZONE, toneVar } from '../agenda/shared';
import { DueChip, PriorityBars } from '../tasks/chips';
import { TaskDialog } from '../tasks/task-dialog';
import { CheckButton } from '../tasks/task-row';

function NextTasks({ tasks }: { tasks: TaskResponse[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = findTask([tasks], openId);
  return (
    <Card>
      <CardHeader icon={CheckSquare} title="Próximas tarefas" />
      {tasks.length ? (
        <ul className="flex flex-col">
          {tasks.map((task) => (
            <li key={task.id} className="flex items-center gap-2.5 rounded-control px-1 py-1.5 hover:bg-hover">
              <CheckButton task={task} />
              <button
                type="button"
                onClick={() => setOpenId(task.id)}
                className="min-w-0 flex-1 truncate text-left text-sm"
              >
                {task.title}
              </button>
              <DueChip task={task} />
              <PriorityBars priority={task.priority} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="py-4 text-center text-sm text-muted">Nenhuma tarefa aberta.</p>
      )}
      <TaskDialog
        open={Boolean(opened)}
        task={opened}
        defaults={{ listId: opened?.listId ?? '' }}
        onClose={() => setOpenId(null)}
      />
    </Card>
  );
}

function ProjectAgenda({
  projectId,
  calendarId,
  events,
}: {
  projectId: string;
  calendarId: string | null;
  events: EventOccurrence[];
}) {
  const [selected, setSelected] = useState<EventOccurrence | null>(null);
  const [editing, setEditing] = useState<{ event: EventOccurrence | null; form: EventForm } | null>(
    null
  );
  const calendars = useRpc('calendars.list');
  const list = calendars.data ?? [];
  const linked = list.find((calendar) => calendar.id === calendarId);
  const colorOf = (event: EventOccurrence) =>
    event.color ?? list.find((calendar) => calendar.id === event.calendarId)?.color ?? 'blue';
  const create = () =>
    setEditing({
      event: null,
      form: {
        ...newEventForm({
          date: todayString(),
          now: new Date(),
          timeZone: TIME_ZONE,
          // Evento novo vai para o calendário do projeto, se dá para escrever nele.
          calendarId:
            (linked && !linked.readOnly ? linked.id : undefined) ??
            list.find((calendar) => calendar.isDefault && !calendar.readOnly)?.id ??
            list.find((calendar) => !calendar.readOnly)?.id ??
            '',
        }),
        projectId,
      },
    });

  return (
    <Card>
      <CardHeader
        icon={CalendarDays}
        title="Agenda do projeto"
        action={
          <span className="flex items-center gap-2">
            {linked && (
              <span className="flex items-center gap-1.5 text-subtle" title="Calendário ligado ao projeto">
                <span
                  className="size-2 rounded-full"
                  style={{ backgroundColor: toneVar(linked.color) }}
                />
                {linked.name}
              </span>
            )}
          <Button variant="ghost" size="sm" aria-label="Novo evento no projeto" onClick={create}>
            <Plus size={13} />
            Evento
          </Button>
          </span>
        }
      />
      {events.length ? (
        <ul className="flex flex-col gap-1">
          {events.map((event) => {
            const [date, time] = whenLines(event, TIME_ZONE);
            return (
              <li key={`${event.eventId}-${event.occurrenceStart}`}>
                <button
                  type="button"
                  onClick={() => setSelected(event)}
                  className="flex w-full items-center gap-2.5 rounded-control px-1 py-1.5 text-left hover:bg-hover"
                >
                  <span
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ backgroundColor: toneVar(colorOf(event)) }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{event.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {date}
                      {time && ` · ${time}`}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-4 text-center text-sm text-muted">
          {linked
            ? `Nenhum evento em ${linked.name} nem ligado a este projeto nos próximos meses.`
            : 'Nenhum evento ligado a este projeto nos próximos meses.'}
        </p>
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
    </Card>
  );
}

const fullDate = (date: string) => `${longDate(date)} de ${date.slice(0, 4)}`;

function Detail({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className={cn('text-right', muted && 'text-subtle')}>{value}</dd>
    </div>
  );
}

function Details({ page }: { page: ProjectPageResponse }) {
  const { project } = page;
  const created = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(project.createdAt);
  return (
    <Card>
      <CardHeader icon={Info} title="Detalhes" />
      <dl>
        <Detail
          label="Início"
          value={project.startDate ? fullDate(project.startDate) : 'Sem data'}
          muted={!project.startDate}
        />
        <Detail
          label="Entrega"
          value={project.dueDate ? fullDate(project.dueDate) : 'Sem prazo'}
          muted={!project.dueDate}
        />
        <Detail label="Criado" value={created} />
      </dl>
    </Card>
  );
}

export function Overview({ page }: { page: ProjectPageResponse }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-3">
      <div className="flex min-w-0 flex-col gap-3">
        <NextTasks tasks={page.upcomingTasks} />
        <ProjectAgenda
          projectId={page.project.id}
          calendarId={page.project.calendarId}
          events={page.upcomingEvents}
        />
      </div>
      <Details page={page} />
    </div>
  );
}
