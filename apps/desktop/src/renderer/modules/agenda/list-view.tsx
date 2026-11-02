import {
  type EventOccurrence,
  listDayTitle,
  occurrenceKey,
  occurrenceSpan,
  timeOf,
} from '@sektor/core/src/modules/agenda/view';
import { CalendarX2, CheckSquare, Repeat } from 'lucide-react';

import { Button, Card, cn, EmptyState, SectionLabel } from '../../ui';

import { TIME_ZONE, toneVar } from './shared';

function whenInDay(event: EventOccurrence, day: string) {
  if (event.allDay) return 'Dia inteiro';
  const { first, last } = occurrenceSpan(event, TIME_ZONE);
  if (first === last || first === day) return timeOf(event.startAt, TIME_ZONE);
  return day === last ? `até ${timeOf(event.endAt, TIME_ZONE)}` : 'Dia inteiro';
}

export function EventRow({
  event,
  day,
  color,
  onSelect,
}: {
  event: EventOccurrence;
  day: string;
  color: string;
  onSelect(event: EventOccurrence): void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className="flex w-full items-center gap-2.5 rounded-control px-2 py-1.5 text-left hover:bg-hover"
    >
      {event.taskId ? (
        <CheckSquare size={14} className="shrink-0" style={{ color: toneVar(color) }} />
      ) : (
        <span
          className="h-7 w-[3px] shrink-0 rounded-full"
          style={{ backgroundColor: toneVar(color) }}
        />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{event.title}</span>
        <span className="flex items-center gap-1 truncate text-xs text-muted">
          <span className="tabular-nums">{whenInDay(event, day)}</span>
          {event.location && <span className="truncate">· {event.location}</span>}
          {event.taskId && <span>· Tarefa</span>}
          {event.isRecurring && <Repeat size={11} />}
        </span>
      </span>
    </button>
  );
}

export function ListView({
  days,
  today,
  byDay,
  colorOf,
  onSelect,
  onCreate,
  loading,
}: {
  days: string[];
  today: string;
  byDay: Map<string, EventOccurrence[]>;
  colorOf(event: EventOccurrence): string;
  onSelect(event: EventOccurrence): void;
  onCreate(): void;
  loading: boolean;
}) {
  const groups = days
    .map((day) => ({ day, events: byDay.get(day) ?? [] }))
    .filter((group) => group.events.length);

  if (!groups.length) {
    return (
      <Card>
        <EmptyState
          icon={CalendarX2}
          title={loading ? 'Carregando…' : 'Nada marcado'}
          text={loading ? undefined : 'Nenhum evento nos próximos 60 dias.'}
          action={
            loading ? undefined : (
              <Button variant="primary" onClick={onCreate}>
                Novo evento
              </Button>
            )
          }
        />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {groups.map(({ day, events }) => (
        <section key={day}>
          <div className={cn(day === today && '[&_h2]:text-primary')}>
            <SectionLabel>{listDayTitle(day, today)}</SectionLabel>
          </div>
          <Card className="!p-1">
            {events.map((event) => (
              <EventRow
                key={occurrenceKey(event)}
                event={event}
                day={day}
                color={colorOf(event)}
                onSelect={onSelect}
              />
            ))}
          </Card>
        </section>
      ))}
    </div>
  );
}
