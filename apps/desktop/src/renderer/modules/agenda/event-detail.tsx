import { type CalendarResponse } from '@sektor/core/src/modules/agenda/service';
import { alertLabel } from '@sektor/core/src/modules/agenda/form';
import { describeRRule, type EventOccurrence, whenLines } from '@sektor/core/src/modules/agenda/view';
import { Bell, CalendarDays, MapPin, Repeat } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useRpcMutation } from '../../lib/rpc';
import { Button, Dialog } from '../../ui';

import { TIME_ZONE, toneVar } from './shared';

export function EventDetail({
  event,
  calendar,
  color,
  onClose,
  onEdit,
}: {
  event: EventOccurrence;
  calendar: CalendarResponse | undefined;
  color: string;
  onClose(): void;
  onEdit(): void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useRpcMutation('events.delete');
  const [dateLine, timeLine] = whenLines(event, TIME_ZONE);
  const readOnly = calendar?.readOnly ?? event.source !== 'LOCAL';

  const destroy = (scope: 'single' | 'all') =>
    remove.mutate(
      {
        id: event.eventId,
        scope,
        ...(scope === 'single' ? { occurrenceStart: event.occurrenceStart } : {}),
      },
      {
        onSuccess: () => {
          toast.success('Evento apagado');
          onClose();
        },
      }
    );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={event.title}>
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex gap-3">
          <span className="w-1 shrink-0 rounded-full" style={{ backgroundColor: toneVar(color) }} />
          <div>
            <p>{dateLine}</p>
            <p className="text-muted tabular-nums">{timeLine}</p>
          </div>
        </div>

        {event.rrule && (
          <Line icon={Repeat}>
            {describeRRule(event.rrule)}
            {event.isException && ' · alterado só neste dia'}
          </Line>
        )}
        {event.location && <Line icon={MapPin}>{event.location}</Line>}
        <Line icon={CalendarDays}>
          {calendar?.name ?? 'Calendário'}
          {calendar?.host && <span className="text-muted"> · {calendar.host}</span>}
        </Line>
        {!readOnly && (
          <Line icon={Bell}>
            {event.reminders.length ? event.reminders.map(alertLabel).join(', ') : 'Sem alerta'}
          </Line>
        )}
        {event.notes && (
          <p className="rounded-control bg-sunken p-2.5 whitespace-pre-wrap">{event.notes}</p>
        )}

        {readOnly ? (
          <p className="text-xs text-muted">
            {event.source === 'GOOGLE'
              ? 'Vem de um calendário do Google em que esta conta só pode ler.'
              : 'Vem de uma agenda por link e é só de leitura. Mude na agenda de origem: a mudança chega aqui em até 15 minutos.'}
          </p>
        ) : confirming ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              {event.isRecurring ? 'Este evento se repete.' : 'Apagar este evento?'}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Voltar
              </Button>
              {event.isRecurring ? (
                <>
                  <Button
                    variant="danger"
                    disabled={remove.isPending}
                    onClick={() => destroy('single')}
                  >
                    Só este
                  </Button>
                  <Button
                    variant="danger"
                    disabled={remove.isPending}
                    onClick={() => destroy('all')}
                  >
                    Todos
                  </Button>
                </>
              ) : (
                <Button
                  variant="danger"
                  disabled={remove.isPending}
                  onClick={() => destroy('all')}
                >
                  Apagar
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex justify-between">
            <Button variant="danger" onClick={() => setConfirming(true)}>
              Apagar
            </Button>
            <Button variant="primary" onClick={onEdit}>
              Editar
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function Line({
  icon: Icon,
  children,
}: {
  icon: typeof Bell;
  children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-2">
      <Icon size={14} className="shrink-0 text-muted" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
