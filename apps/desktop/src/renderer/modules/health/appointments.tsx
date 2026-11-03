import type { Rpc } from '@sektor/core';
import { CalendarClock, Check, Pencil, Plus } from 'lucide-react';
import { useState } from 'react';

import { longDate, shortDate, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import {
  Button,
  Card,
  cn,
  Dialog,
  EmptyState,
  Field,
  Input,
  SectionLabel,
  Select,
} from '../../ui';
import { NoteField, RichTextView } from '../../ui/rich-text';

import { DeleteButton, Loading } from './shared';

type List = Awaited<ReturnType<Rpc['health.appointmentList']>>;
type Appointment = List['done'][number] & { overdue?: boolean };

function AppointmentForm({ item, onClose }: { item: Appointment | null; onClose(): void }) {
  const save = useRpcMutation('health.appointmentSave');
  const remove = useRpcMutation('health.appointmentDelete');
  const [kind, setKind] = useState(item?.kind ?? 'CONSULTATION');
  const [title, setTitle] = useState(item?.title ?? '');
  const [date, setDate] = useState(item?.date ?? todayString());
  const [time, setTime] = useState(item?.time ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [returnDate, setReturn] = useState(item?.returnDate ?? '');
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={item ? 'Editar' : 'Nova consulta ou exame'}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            { id: item?.id, kind, title, date, time, location, notes, returnDate },
            { onSuccess: onClose }
          );
        }}
      >
        <div className="grid grid-cols-[1fr_130px] gap-3">
          <Field label="Nome">
            <Input
              autoFocus
              required
              placeholder="Especialidade ou exame"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="CONSULTATION">Consulta</option>
              <option value="EXAM">Exame</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data">
            <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Hora">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
        </div>
        <Field label="Local">
          <Input value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <NoteField label="Anotações" rows={3} value={notes} onChange={setNotes} />
        <Field label="Retorno (opcional)">
          <Input type="date" value={returnDate} onChange={(e) => setReturn(e.target.value)} />
        </Field>
        <div className="mt-1 flex items-center justify-between">
          {item ? (
            <DeleteButton onConfirm={() => remove.mutate({ id: item.id }, { onSuccess: onClose })} />
          ) : (
            <span />
          )}
          <Button type="submit" variant="primary" disabled={save.isPending}>
            Salvar
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function Row({ item, onEdit }: { item: Appointment; onEdit(): void }) {
  const toggle = useRpcMutation('health.appointmentDone');
  const done = item.doneAt !== null;
  return (
    <li className="flex items-start gap-3 border-b border-line py-2.5 last:border-0">
      <button
        type="button"
        aria-pressed={done}
        aria-label={`${item.title}: ${done ? 'voltar para pendente' : 'marcar como feita'}`}
        onClick={() => toggle.mutate({ id: item.id, done: !done })}
        className={cn(
          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border',
          done ? 'border-primary bg-primary text-on-primary' : 'border-line-strong hover:bg-hover'
        )}
      >
        {done && <Check size={13} strokeWidth={3} />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm font-medium', done && 'text-muted')}>
          {item.title}
          <span className="ml-2 text-xs font-normal text-subtle">
            {item.kind === 'EXAM' ? 'Exame' : 'Consulta'}
          </span>
        </p>
        <p className="text-xs text-muted">
          {longDate(item.date)}
          {item.time ? ` às ${item.time}` : ''}
          {item.location ? ` · ${item.location}` : ''}
        </p>
        {item.overdue && <p className="text-xs text-warning">A data passou. Foi feita?</p>}
        {item.returnDate && (
          <p className="text-xs text-info">Retorno em {shortDate(item.returnDate)}</p>
        )}
        {item.notes && <RichTextView source={item.notes} className="mt-1 text-xs text-subtle" />}
      </div>
      <Button variant="ghost" size="sm" aria-label={`Editar ${item.title}`} onClick={onEdit}>
        <Pencil size={13} />
      </Button>
    </li>
  );
}

export function AppointmentsTab() {
  const list = useRpc('health.appointmentList');
  const [editing, setEditing] = useState<Appointment | 'new' | null>(null);
  if (!list.data) return <Loading />;
  const { pending, done } = list.data;
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[1fr_380px]">
      <Card>
        <div className="flex items-center justify-between">
          <SectionLabel>Pendentes</SectionLabel>
          <Button variant="primary" size="sm" onClick={() => setEditing('new')}>
            <Plus size={14} /> Nova
          </Button>
        </div>
        {pending.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title="Nada pendente"
            text="Consultas e exames marcados aparecem aqui, com aviso na véspera."
          />
        ) : (
          <ul>
            {pending.map((item) => (
              <Row key={item.id} item={item} onEdit={() => setEditing(item)} />
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <SectionLabel>Feitas</SectionLabel>
        {done.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma ainda.</p>
        ) : (
          <ul>
            {done.map((item) => (
              <Row key={item.id} item={item} onEdit={() => setEditing(item)} />
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <AppointmentForm
          item={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
