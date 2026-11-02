import { TONES } from '@sektor/core/src/modules/agenda/contract';
import type { CalendarResponse } from '@sektor/core/src/modules/agenda/service';
import { AlertTriangle, Link2, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useRpcMutation } from '../../lib/rpc';
import { Button, cn, Dialog, Field, Input, SectionLabel } from '../../ui';

import { toneVar } from './shared';

type Tone = (typeof TONES)[number];

export function TonePicker({ value, onChange }: { value: string; onChange(tone: Tone): void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Cor">
      {TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={value === tone}
          aria-label={tone}
          onClick={() => onChange(tone)}
          className={cn(
            'size-5 rounded-full',
            value === tone && 'ring-2 ring-foreground ring-offset-2 ring-offset-raised'
          )}
          style={{ backgroundColor: toneVar(tone) }}
        />
      ))}
    </div>
  );
}

function syncedText(calendar: CalendarResponse) {
  if (!calendar.syncedAt) return 'Ainda não lida';
  return `Lida ${new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(calendar.syncedAt))}`;
}

function CalendarRow({ calendar }: { calendar: CalendarResponse }) {
  const update = useRpcMutation('calendars.update');
  const remove = useRpcMutation('calendars.delete');
  const setDefault = useRpcMutation('calendars.setDefault');
  const sync = useRpcMutation('calendars.sync');
  const replace = useRpcMutation('calendars.replaceIcsUrl');
  const [confirming, setConfirming] = useState(false);
  const [newUrl, setNewUrl] = useState<string | null>(null);

  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={calendar.selected}
          aria-label={`Mostrar ${calendar.name}`}
          style={{ accentColor: toneVar(calendar.color) }}
          onChange={(event) =>
            update.mutate({ id: calendar.id, selected: event.target.checked })
          }
        />
        <span className="min-w-0 flex-1 truncate text-sm">
          {calendar.name}
          {calendar.host && <span className="text-muted"> · {calendar.host}</span>}
        </span>
        {calendar.source === 'ICS' && (
          <Button
            size="sm"
            variant="ghost"
            aria-label="Ler agora"
            disabled={sync.isPending}
            onClick={() => sync.mutate({ id: calendar.id })}
          >
            <RefreshCw size={13} className={cn(sync.isPending && 'animate-spin')} />
          </Button>
        )}
        {calendar.source === 'GOOGLE' ? (
          <span className="text-[11px] text-subtle">Google</span>
        ) : confirming ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Não
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => remove.mutate({ id: calendar.id })}
            >
              Apagar tudo
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Apagar ${calendar.name}`}
            onClick={() => setConfirming(true)}
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>
      <div className="flex items-center gap-3 pl-6">
        <TonePicker
          value={calendar.color}
          onChange={(color) => update.mutate({ id: calendar.id, color })}
        />
        {calendar.isDefault ? (
          <span className="text-[11px] text-subtle">Padrão</span>
        ) : (
          !calendar.readOnly && (
            <Button size="sm" variant="ghost" onClick={() => setDefault.mutate({ id: calendar.id })}>
              Usar como padrão
            </Button>
          )
        )}
        {calendar.source === 'ICS' && (
          <>
            <span className="text-[11px] text-subtle">{syncedText(calendar)}</span>
            <Button size="sm" variant="ghost" onClick={() => setNewUrl(newUrl === null ? '' : null)}>
              Trocar link
            </Button>
          </>
        )}
      </div>
      {newUrl !== null && (
        <form
          className="flex gap-2 pl-6"
          onSubmit={(event) => {
            event.preventDefault();
            replace.mutate({ id: calendar.id, url: newUrl }, { onSuccess: () => setNewUrl(null) });
          }}
        >
          <Input
            aria-label="Novo link"
            autoComplete="off"
            spellCheck={false}
            value={newUrl}
            onChange={(event) => setNewUrl(event.target.value)}
          />
          <Button type="submit" disabled={!newUrl.trim() || replace.isPending}>
            Trocar
          </Button>
        </form>
      )}
      {calendar.lastError && (
        <p className="flex items-start gap-1.5 pl-6 text-xs text-warning">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {calendar.lastError}
        </p>
      )}
    </li>
  );
}

export function CalendarsDialog({
  calendars,
  onClose,
}: {
  calendars: CalendarResponse[];
  onClose(): void;
}) {
  const create = useRpcMutation('calendars.create');
  const addIcs = useRpcMutation('calendars.addIcs');
  const [name, setName] = useState('');
  const [color, setColor] = useState<Tone>('green');
  const [url, setUrl] = useState('');

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Calendários">
      <ul className="mb-4 divide-y divide-line">
        {calendars.map((calendar) => (
          <CalendarRow key={calendar.id} calendar={calendar} />
        ))}
      </ul>

      <SectionLabel>Novo calendário</SectionLabel>
      <form
        className="mb-4 flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate({ name, color }, { onSuccess: () => setName('') });
        }}
      >
        <Field label="Nome">
          <Input value={name} onChange={(event) => setName(event.target.value)} />
        </Field>
        <div className="flex items-center justify-between">
          <TonePicker value={color} onChange={setColor} />
          <Button type="submit" disabled={!name.trim() || create.isPending}>
            Criar
          </Button>
        </div>
      </form>

      <SectionLabel>Agenda por link</SectionLabel>
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          addIcs.mutate(
            { url },
            {
              onSuccess: (calendar) => {
                setUrl('');
                toast.success(`${calendar.name} adicionada`);
              },
            }
          );
        }}
      >
        <Field label="Link ICS (https:// ou webcal://)">
          <Input
            value={url}
            autoComplete="off"
            spellCheck={false}
            placeholder="https://…/calendar.ics"
            onChange={(event) => setUrl(event.target.value)}
          />
        </Field>
        <p className="text-xs text-muted">
          Só de leitura, lida a cada 15 minutos. Quem tem o link vê a agenda: ele fica no cofre, não
          no banco.
        </p>
        <div className="flex justify-end">
          <Button type="submit" disabled={!url.trim() || addIcs.isPending}>
            <Link2 size={14} />
            {addIcs.isPending ? 'Lendo…' : 'Adicionar'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
