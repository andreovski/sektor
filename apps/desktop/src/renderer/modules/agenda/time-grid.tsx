import {
  coversWholeDay,
  dayKey,
  DAY_MINUTES,
  type EventOccurrence,
  instantToWallTime,
  layoutColumns,
  occurrenceKey,
  segmentOnDay,
  timeOf,
  timeRange,
  weekdayShort,
} from '@sektor/core/src/modules/agenda/view';
import { CheckSquare } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef } from 'react';

import { cn } from '../../ui';

import { blockStyle, TIME_ZONE, useNow } from './shared';

const HOUR_HEIGHT = 52;
const PX_PER_MIN = HOUR_HEIGHT / 60;
const GUTTER = 56;
/** Respiro para os rótulos "00:00" e "24:00" não serem cortados. */
const PAD = 10;
const MIN_BLOCK_MIN = 22;

export function AllDayChip({
  event,
  onSelect,
  colorOf,
}: {
  event: EventOccurrence;
  onSelect(event: EventOccurrence): void;
  colorOf(event: EventOccurrence): string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(event)}
      className={cn(
        'flex w-full min-w-0 items-center gap-1 truncate rounded-[6px] px-1.5 py-0.5 text-left text-[11px] font-medium hover:brightness-110',
        event.taskId && 'border border-dashed border-line-strong'
      )}
      style={blockStyle(colorOf(event))}
    >
      {event.taskId && <CheckSquare size={11} className="shrink-0" />}
      <span className="truncate">{event.title}</span>
    </button>
  );
}

export function TimeGrid({
  days,
  byDay,
  colorOf,
  onSelect,
  onCreateAt,
  onSelectDay,
}: {
  days: string[];
  byDay: Map<string, EventOccurrence[]>;
  colorOf(event: EventOccurrence): string;
  onSelect(event: EventOccurrence): void;
  onCreateAt(day: string, hour: number): void;
  onSelectDay(day: string): void;
}) {
  const now = useNow();
  const today = dayKey(new Date(now), TIME_ZONE);
  const wall = instantToWallTime(new Date(now), TIME_ZONE);
  const nowMinutes = wall.hour * 60 + wall.minute;
  const scroller = useRef<HTMLDivElement>(null);
  const showsToday = days.includes(today);

  const columns = useMemo(
    () =>
      days.map((day) => {
        const all = byDay.get(day) ?? [];
        const allDay = all.filter((event) => coversWholeDay(event, day, TIME_ZONE));
        const timed = all.filter((event) => !coversWholeDay(event, day, TIME_ZONE));
        const segments = new Map(
          timed.map((event) => [
            occurrenceKey(event),
            { event, ...segmentOnDay(event, day, TIME_ZONE) },
          ])
        );
        const placed = layoutColumns(
          [...segments.entries()].map(([id, s]) => ({ id, start: s.start, end: s.end })),
          MIN_BLOCK_MIN
        ).map((item) => ({ ...item, event: segments.get(item.id)!.event }));
        return { day, allDay, placed };
      }),
    [days, byDay]
  );
  const hasAllDay = columns.some((column) => column.allDay.length);

  // Ao trocar de período: vai para perto de agora, ou para as 7h. O relógio não puxa a rolagem.
  const scrollKey = `${days[0]}:${days.length}`;
  useLayoutEffect(() => {
    if (!scroller.current) return;
    const target = showsToday ? Math.max(0, nowMinutes - 90) : 7 * 60;
    scroller.current.scrollTop = target * PX_PER_MIN;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const template = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div
      ref={scroller}
      className="relative h-[calc(100vh-14.5rem)] min-h-[420px] overflow-y-auto rounded-panel border border-line bg-surface shadow-card"
    >
      <div
        className="sticky top-0 z-30 grid border-b border-line bg-surface"
        style={{ gridTemplateColumns: template }}
      >
        <div />
        {columns.map(({ day }) => {
          const isToday = day === today;
          return (
            <button
              key={day}
              type="button"
              onClick={() => onSelectDay(day)}
              className="flex flex-col items-center gap-0.5 py-2 hover:bg-hover"
            >
              <span
                className={cn(
                  'text-[11px] font-medium uppercase',
                  isToday ? 'text-primary' : 'text-subtle'
                )}
              >
                {weekdayShort(day)}
              </span>
              <span
                className={cn(
                  'grid size-7 place-items-center rounded-full text-sm tabular-nums',
                  isToday && 'bg-primary font-semibold text-on-primary'
                )}
              >
                {Number(day.slice(8))}
              </span>
            </button>
          );
        })}
        {hasAllDay && (
          <>
            <div className="border-t border-line pt-1.5 pr-2 text-right text-[10px] text-subtle">
              dia inteiro
            </div>
            {columns.map(({ day, allDay }) => (
              <div key={day} className="flex min-w-0 flex-col gap-0.5 border-t border-line p-1">
                {allDay.slice(0, 3).map((event) => (
                  <AllDayChip
                    key={occurrenceKey(event)}
                    event={event}
                    colorOf={colorOf}
                    onSelect={onSelect}
                  />
                ))}
                {allDay.length > 3 && (
                  <span className="px-1 text-[11px] text-muted">+{allDay.length - 3}</span>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      <div
        className="relative grid"
        style={{
          gridTemplateColumns: template,
          height: DAY_MINUTES * PX_PER_MIN + PAD * 2,
        }}
      >
        <div className="relative">
          {Array.from({ length: 25 }, (_, hour) => (
            <span
              key={hour}
              className={cn(
                'absolute right-2 -translate-y-1/2 text-[11px] text-subtle tabular-nums',
                showsToday && Math.abs(hour * 60 - nowMinutes) < 14 && 'opacity-0'
              )}
              style={{ top: PAD + hour * HOUR_HEIGHT }}
            >
              {String(hour % 24).padStart(2, '0')}:00
            </span>
          ))}
          {showsToday && (
            <span
              className="absolute right-2 -translate-y-1/2 text-[11px] font-semibold text-danger tabular-nums"
              style={{ top: PAD + nowMinutes * PX_PER_MIN }}
            >
              {timeOf(new Date(now).toISOString(), TIME_ZONE)}
            </span>
          )}
        </div>

        {columns.map(({ day, placed }) => (
          <div
            key={day}
            data-day={day}
            className="relative border-l border-line"
            style={{
              backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_HEIGHT}px)`,
              backgroundPosition: `0 ${PAD}px`,
              backgroundSize: `100% ${DAY_MINUTES * PX_PER_MIN + 1}px`,
              backgroundRepeat: 'no-repeat',
            }}
            onDoubleClick={(event) => {
              if (event.target !== event.currentTarget) return;
              const y = event.nativeEvent.offsetY - PAD;
              onCreateAt(day, Math.min(23, Math.max(0, Math.floor(y / HOUR_HEIGHT))));
            }}
          >
            {placed.map((item) => {
              const height = Math.max(item.end - item.start, MIN_BLOCK_MIN) * PX_PER_MIN - 1.5;
              const range = timeRange(item.event.startAt, item.event.endAt, TIME_ZONE);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelect(item.event)}
                  aria-label={`${item.event.title}, ${range}`}
                  className={cn(
                    'absolute overflow-hidden rounded-[6px] px-1.5 py-[3px] text-left leading-[15px] hover:brightness-110',
                    item.event.taskId && 'border border-dashed border-line-strong'
                  )}
                  style={{
                    ...blockStyle(colorOf(item.event)),
                    top: PAD + item.start * PX_PER_MIN,
                    height,
                    left: `calc(${(item.column / item.columns) * 100}% + 1px)`,
                    width: `calc(${(item.span / item.columns) * 100}% - 2px)`,
                    zIndex: 1 + item.column,
                  }}
                >
                  <span className="flex items-center gap-1 truncate text-xs font-medium">
                    {item.event.taskId && <CheckSquare size={11} className="shrink-0" />}
                    <span className="truncate">{item.event.title}</span>
                  </span>
                  {height >= 34 && (
                    <span className="block truncate text-[11px] opacity-80 tabular-nums">
                      {item.event.taskId ? timeOf(item.event.startAt, TIME_ZONE) : range}
                    </span>
                  )}
                  {height >= 64 && item.event.location && (
                    <span className="block truncate text-[11px] opacity-70">
                      {item.event.location}
                    </span>
                  )}
                </button>
              );
            })}

            {day === today && (
              <div
                aria-hidden
                data-now-line
                className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                style={{ top: PAD + nowMinutes * PX_PER_MIN, transform: 'translateY(-50%)' }}
              >
                <span className="size-[9px] shrink-0 rounded-full bg-danger" />
                <span className="h-[1.5px] flex-1 bg-danger" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
