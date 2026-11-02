import {
  capitalize,
  type EventOccurrence,
  listDayTitle,
  longDay,
  occurrenceKey,
  weekdayShort,
} from '@sektor/core/src/modules/agenda/view';
import { CalendarPlus } from 'lucide-react';

import { Card, cn, SectionLabel } from '../../ui';

import { EventRow } from './list-view';
import { toneVar } from './shared';

export function MonthView({
  date,
  today,
  weeks,
  byDay,
  colorOf,
  onSelectDay,
  onSelect,
  onCreate,
  loading,
}: {
  date: string;
  today: string;
  weeks: string[][];
  byDay: Map<string, EventOccurrence[]>;
  colorOf(event: EventOccurrence): string;
  onSelectDay(day: string): void;
  onSelect(event: EventOccurrence): void;
  onCreate(): void;
  loading: boolean;
}) {
  const month = date.slice(0, 7);
  const dayEvents = byDay.get(date) ?? [];

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_18rem] items-start gap-4">
      <Card className="overflow-hidden !p-0">
        <div className="grid grid-cols-7 border-b border-line">
          {(weeks[0] ?? []).map((day) => (
            <span
              key={day}
              className="py-2 text-center text-[11px] font-medium text-subtle uppercase"
            >
              {weekdayShort(day)}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} className="grid grid-cols-7 border-b border-line last:border-b-0">
            {week.map((day) => {
              const events = byDay.get(day) ?? [];
              const inMonth = day.slice(0, 7) === month;
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  aria-pressed={day === date}
                  aria-label={`${longDay(day)}${events.length ? `, ${events.length} itens` : ''}`}
                  className={cn(
                    'flex min-h-[92px] min-w-0 flex-col items-stretch border-l border-line p-1 text-left first:border-l-0 hover:bg-hover',
                    day === date && 'bg-active'
                  )}
                >
                  <span
                    className={cn(
                      'grid size-6 place-items-center self-start rounded-full text-xs tabular-nums',
                      !inMonth && 'text-subtle',
                      day === today && 'bg-primary font-semibold text-on-primary'
                    )}
                  >
                    {Number(day.slice(8))}
                  </span>
                  <span className="mt-1 flex min-w-0 flex-col gap-[2px]">
                    {events.slice(0, 3).map((event) => (
                      <span
                        key={occurrenceKey(event)}
                        className={cn(
                          'flex min-w-0 items-center gap-1 text-[11px]',
                          !inMonth && 'opacity-50',
                          event.taskId && 'text-muted'
                        )}
                      >
                        <span
                          className={cn(
                            'size-[6px] shrink-0',
                            event.taskId ? 'rounded-[1px]' : 'rounded-full'
                          )}
                          style={{ backgroundColor: toneVar(colorOf(event)) }}
                        />
                        <span className="truncate">{event.title}</span>
                      </span>
                    ))}
                    {events.length > 3 && (
                      <span className="pl-2.5 text-[11px] text-muted">
                        +{events.length - 3}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </Card>

      <aside className="sticky top-0">
        <SectionLabel>{capitalize(listDayTitle(date, today))}</SectionLabel>
        <Card className="!p-1">
          {dayEvents.length ? (
            dayEvents.map((event) => (
              <EventRow
                key={occurrenceKey(event)}
                event={event}
                day={date}
                color={colorOf(event)}
                onSelect={onSelect}
              />
            ))
          ) : (
            <button
              type="button"
              onClick={onCreate}
              className="flex w-full items-center gap-2 rounded-control p-2 text-sm text-muted hover:bg-hover"
            >
              <CalendarPlus size={16} />
              {loading ? 'Carregando…' : 'Nada marcado. Criar evento'}
            </button>
          )}
        </Card>
      </aside>
    </div>
  );
}
