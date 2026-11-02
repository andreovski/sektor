import type { CalendarResponse } from '@sektor/core/src/modules/agenda/service';
import {
  ALERT_OPTIONS,
  alertLabel,
  bodyOf,
  endBeforeStart,
  type EventForm,
  momentsOf,
  REPEAT_OPTIONS,
  type RepeatKind,
  shiftSeries,
  withStart,
} from '@sektor/core/src/modules/agenda/form';
import type { EventOccurrence } from '@sektor/core/src/modules/agenda/view';
import { useState } from 'react';
import { toast } from 'sonner';

import { call, useRpcMutation } from '../../lib/rpc';
import { Button, cn, Dialog, Field, Input, Select, Textarea } from '../../ui';

import { TIME_ZONE } from './shared';

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export function EventFormDialog({
  initial,
  editing,
  calendars,
  onClose,
}: {
  initial: EventForm;
  /** A ocorrência em edição. Sem ela, é evento novo. */
  editing: EventOccurrence | null;
  calendars: CalendarResponse[];
  onClose(): void;
}) {
  const [form, setForm] = useState(initial);
  const set = (patch: Partial<EventForm>) => setForm((current) => ({ ...current, ...patch }));
  const create = useRpcMutation('events.create');
  const update = useRpcMutation('events.update');
  const pending = create.isPending || update.isPending;
  const invalid = endBeforeStart(form);
  const series = Boolean(editing?.isRecurring);
  const writable = calendars.filter((calendar) => !calendar.readOnly);

  const done = {
    onSuccess: () => {
      toast.success(editing ? 'Evento salvo' : 'Evento criado');
      onClose();
    },
  };

  const save = async (scope: 'single' | 'all') => {
    const body = bodyOf(form, TIME_ZONE);
    if (!editing) return create.mutate(body, done);
    if (scope === 'single') {
      const { rrule: _rrule, reminders: _reminders, calendarId: _calendar, ...fields } = body;
      return update.mutate(
        { id: editing.eventId, ...fields, scope, occurrenceStart: editing.occurrenceStart },
        done
      );
    }
    if (!series) return update.mutate({ id: editing.eventId, ...body, scope }, done);
    try {
      const master = await call('events.get', { id: editing.eventId });
      const moved = shiftSeries(master, editing, {
        ...momentsOf(form, TIME_ZONE),
        allDay: form.allDay,
      });
      update.mutate({ id: editing.eventId, ...body, ...moved, scope }, done);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={editing ? 'Editar evento' : 'Novo evento'}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalid && !series) void save('all');
        }}
      >
        <Field label="Título">
          <Input
            autoFocus
            value={form.title}
            placeholder="Novo evento"
            onChange={(event) => set({ title: event.target.value })}
          />
        </Field>
        <Field label="Local">
          <Input
            value={form.location}
            onChange={(event) => set({ location: event.target.value })}
          />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.allDay}
            onChange={(event) => set({ allDay: event.target.checked })}
          />
          Dia inteiro
        </label>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <Input
              type="date"
              value={form.startDate}
              onChange={(event) => setForm(withStart(form, event.target.value))}
            />
          </Field>
          {!form.allDay && (
            <Field label="Hora">
              <Input
                type="time"
                value={form.startTime}
                onChange={(event) => setForm(withStart(form, form.startDate, event.target.value))}
              />
            </Field>
          )}
          <Field label={form.allDay ? 'Último dia' : 'Fim'}>
            <Input
              type="date"
              value={form.endDate}
              onChange={(event) => set({ endDate: event.target.value })}
            />
          </Field>
          {!form.allDay && (
            <Field label="Hora">
              <Input
                type="time"
                value={form.endTime}
                onChange={(event) => set({ endTime: event.target.value })}
              />
            </Field>
          )}
        </div>
        {invalid && <p className="text-xs text-danger">O fim precisa ser depois do início.</p>}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Repetir">
            <Select
              value={form.repeat}
              onChange={(event) => set({ repeat: event.target.value as RepeatKind })}
            >
              {REPEAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
              {form.repeat === 'custom' && <option value="custom">Personalizado</option>}
            </Select>
          </Field>
          <Field label="Calendário">
            <Select
              value={form.calendarId}
              disabled={Boolean(editing) || writable.length < 2}
              onChange={(event) => set({ calendarId: event.target.value })}
            >
              {writable.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {(form.repeat === 'weekly' || form.repeat === 'biweekly') && (
          <div className="flex gap-1" role="group" aria-label="Dias da semana">
            {WEEKDAYS.map((letter, day) => {
              const active = form.weekdays.includes(day);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    set({
                      weekdays: active
                        ? form.weekdays.filter((d) => d !== day)
                        : [...form.weekdays, day],
                    })
                  }
                  className={cn(
                    'size-7 rounded-full border border-line text-xs',
                    active ? 'bg-primary text-on-primary' : 'text-muted hover:bg-hover'
                  )}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        )}

        {form.repeat !== 'never' && form.repeat !== 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Termina">
              <Select
                value={form.repeatEnd}
                onChange={(event) =>
                  set({ repeatEnd: event.target.value as EventForm['repeatEnd'] })
                }
              >
                <option value="never">Nunca</option>
                <option value="date">Em uma data</option>
              </Select>
            </Field>
            {form.repeatEnd === 'date' && (
              <Field label="Até">
                <Input
                  type="date"
                  value={form.untilDate}
                  onChange={(event) => set({ untilDate: event.target.value })}
                />
              </Field>
            )}
          </div>
        )}

        <div className="flex flex-col gap-1 text-xs text-muted" role="group" aria-label="Alertas">
          Alertas
          <div className="flex flex-wrap gap-1">
            {ALERT_OPTIONS.map((minutes) => {
              const active = form.reminders.includes(minutes);
              return (
                <button
                  key={minutes}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    set({
                      reminders: active
                        ? form.reminders.filter((m) => m !== minutes)
                        : [...form.reminders, minutes].sort((a, b) => a - b),
                    })
                  }
                  className={cn(
                    'rounded-full border border-line px-2 py-0.5 text-[11px]',
                    active
                      ? 'border-primary/40 bg-primary/15 text-primary'
                      : 'text-muted hover:bg-hover'
                  )}
                >
                  {alertLabel(minutes)}
                </button>
              );
            })}
          </div>
        </div>

        <Field label="Notas">
          <Textarea
            rows={3}
            value={form.notes}
            onChange={(event) => set({ notes: event.target.value })}
          />
        </Field>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          {series ? (
            <>
              <Button disabled={invalid || pending} onClick={() => void save('single')}>
                Salvar só este
              </Button>
              <Button
                variant="primary"
                disabled={invalid || pending}
                onClick={() => void save('all')}
              >
                Salvar todos
              </Button>
            </>
          ) : (
            <Button type="submit" variant="primary" disabled={invalid || pending}>
              Salvar
            </Button>
          )}
        </div>
      </form>
    </Dialog>
  );
}
