import type { Rpc } from '@sektor/core';
import { Pencil, Pill, Plus, X } from 'lucide-react';
import { useState } from 'react';

import { shortDate, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import {
  Button,
  Card,
  CardHeader,
  cn,
  Dialog,
  EmptyState,
  Field,
  Input,
  SectionLabel,
  Select,
  Stat,
} from '../../ui';
import { NoteField } from '../../ui/rich-text';

import { DayStepper, DeleteButton, dayLabel, DoseList, Loading, Meter } from './shared';

type Med = Awaited<ReturnType<Rpc['health.medList']>>['items'][number];
type Schedule = Med['schedule'];

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function ruleLabel(med: Med) {
  if (med.schedule === 'AS_NEEDED') return 'Se precisar';
  const times = med.times.join(', ');
  if (med.schedule === 'DAILY') return `Todo dia · ${times}`;
  if (med.schedule === 'WEEKDAYS') {
    return `${med.weekdays.map((day) => WEEKDAYS[day]).join(', ')} · ${times}`;
  }
  return `A cada ${med.intervalDays} dias · ${times}`;
}

function periodLabel(med: Med) {
  if (med.status === 'UPCOMING') return `Começa em ${shortDate(med.startDate)}`;
  if (med.status === 'ENDED') return `Encerrado em ${shortDate(med.endDate!)}`;
  return med.endDate ? `Até ${shortDate(med.endDate)}` : `Desde ${shortDate(med.startDate)}`;
}

function MedForm({ med, onClose }: { med: Med | null; onClose(): void }) {
  const save = useRpcMutation('health.medSave');
  const remove = useRpcMutation('health.medDelete');
  const [name, setName] = useState(med?.name ?? '');
  const [kind, setKind] = useState(med?.kind ?? 'MEDICINE');
  const [dose, setDose] = useState(med?.dose ?? '');
  const [schedule, setSchedule] = useState<Schedule>(med?.schedule ?? 'DAILY');
  const [weekdays, setWeekdays] = useState(med?.weekdays ?? []);
  const [intervalDays, setInterval] = useState(String(med?.intervalDays ?? 2));
  const [times, setTimes] = useState(med?.times.length ? med.times : ['08:00']);
  const [startDate, setStart] = useState(med?.startDate ?? todayString());
  const [endDate, setEnd] = useState(med?.endDate ?? '');
  const [notes, setNotes] = useState(med?.notes ?? '');

  const toggleDay = (day: number) =>
    setWeekdays(weekdays.includes(day) ? weekdays.filter((d) => d !== day) : [...weekdays, day]);

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={med ? 'Editar remédio' : 'Novo remédio ou suplemento'}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate(
            {
              id: med?.id,
              name,
              kind,
              dose,
              schedule,
              weekdays,
              intervalDays: schedule === 'INTERVAL' ? Number(intervalDays) : null,
              times: schedule === 'AS_NEEDED' ? [] : times.filter(Boolean),
              startDate,
              endDate: endDate || null,
              notes,
            },
            { onSuccess: onClose }
          );
        }}
      >
        <div className="grid grid-cols-[1fr_140px] gap-3">
          <Field label="Nome">
            <Input autoFocus required value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Tipo">
            <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
              <option value="MEDICINE">Remédio</option>
              <option value="SUPPLEMENT">Suplemento</option>
            </Select>
          </Field>
        </div>
        <Field label="Dose">
          <Input
            required
            placeholder="500 mg, 1 cápsula…"
            value={dose}
            onChange={(e) => setDose(e.target.value)}
          />
        </Field>
        <Field label="Frequência">
          <Select value={schedule} onChange={(e) => setSchedule(e.target.value as Schedule)}>
            <option value="DAILY">Todo dia</option>
            <option value="WEEKDAYS">Dias da semana</option>
            <option value="INTERVAL">A cada X dias</option>
            <option value="AS_NEEDED">Se precisar</option>
          </Select>
        </Field>
        {schedule === 'WEEKDAYS' && (
          <div role="group" aria-label="Dias da semana" className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((label, day) => (
              <button
                key={label}
                type="button"
                aria-pressed={weekdays.includes(day)}
                onClick={() => toggleDay(day)}
                className={cn(
                  'h-8 rounded-control border text-xs',
                  weekdays.includes(day)
                    ? 'border-primary/40 bg-primary/15 text-primary'
                    : 'border-line bg-sunken text-muted hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {schedule === 'INTERVAL' && (
          <Field label="A cada quantos dias">
            <Input
              type="number"
              min={2}
              max={365}
              value={intervalDays}
              onChange={(e) => setInterval(e.target.value)}
            />
          </Field>
        )}
        {schedule !== 'AS_NEEDED' && (
          <div className="flex flex-col gap-1 text-xs text-muted">
            Horários
            <div className="flex flex-wrap items-center gap-1.5">
              {times.map((time, index) => (
                <span key={index} className="flex items-center gap-0.5">
                  <Input
                    type="time"
                    aria-label={`Horário ${index + 1}`}
                    className="w-[104px]"
                    value={time}
                    onChange={(e) =>
                      setTimes(times.map((t, i) => (i === index ? e.target.value : t)))
                    }
                  />
                  {times.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Tirar horário ${index + 1}`}
                      onClick={() => setTimes(times.filter((_, i) => i !== index))}
                    >
                      <X size={13} />
                    </Button>
                  )}
                </span>
              ))}
              <Button size="sm" onClick={() => setTimes([...times, '12:00'])}>
                <Plus size={13} /> Horário
              </Button>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Início">
            <Input
              type="date"
              required
              value={startDate}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="Fim (opcional)">
            <Input type="date" value={endDate} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <NoteField label="Anotações" rows={2} value={notes} onChange={setNotes} />
        <div className="mt-1 flex items-center justify-between">
          {med ? (
            <DeleteButton onConfirm={() => remove.mutate({ id: med.id }, { onSuccess: onClose })} />
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

function MedCard({ med, onEdit }: { med: Med; onEdit(): void }) {
  const percent = med.adherence?.percent ?? null;
  return (
    <Card className={cn(med.status === 'ENDED' && 'opacity-70')}>
      <div className="mb-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{med.name}</p>
          <p className="truncate text-xs text-muted">
            {med.kind === 'SUPPLEMENT' ? 'Suplemento' : 'Remédio'} · {med.dose}
          </p>
        </div>
        <Button variant="ghost" size="sm" aria-label={`Editar ${med.name}`} onClick={onEdit}>
          <Pencil size={13} />
        </Button>
      </div>
      <p className="text-xs text-muted">{ruleLabel(med)}</p>
      <p className="mb-3 text-xs text-subtle">{periodLabel(med)}</p>
      {med.schedule === 'AS_NEEDED' ? (
        <p className="text-xs text-muted">
          {med.uses === 1 ? '1 uso' : `${med.uses} usos`} em 30 dias
        </p>
      ) : percent === null ? (
        <p className="text-xs text-subtle">Aderência aparece depois da primeira dose</p>
      ) : (
        <>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-muted">Aderência em 30 dias</span>
            <span className="tabular-nums">
              {percent}% · {med.adherence!.taken} de {med.adherence!.expected}
            </span>
          </div>
          <Meter percent={percent} />
        </>
      )}
    </Card>
  );
}

export function MedsTab() {
  const [date, setDate] = useState(todayString);
  const [editing, setEditing] = useState<Med | 'new' | null>(null);
  const day = useRpc('health.day', { date });
  const meds = useRpc('health.medList');
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader icon={Pill} title={`Doses · ${dayLabel(date)}`} />
        <div className="mb-3">
          <DayStepper date={date} onChange={setDate} />
        </div>
        {day.data ? (
          <DoseList
            day={day.data}
            empty={<p className="py-4 text-center text-sm text-muted">Nenhuma dose neste dia.</p>}
          />
        ) : (
          <Loading />
        )}
      </Card>
      <div>
        <div className="mb-3 flex items-center justify-between">
          {meds.data?.overall.percent != null ? (
            <Stat
              label="Aderência geral em 30 dias"
              value={`${meds.data.overall.percent}%`}
              hint={`${meds.data.overall.taken} de ${meds.data.overall.expected} doses`}
            />
          ) : (
            <SectionLabel>Remédios e suplementos</SectionLabel>
          )}
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={15} /> Novo
          </Button>
        </div>
        {!meds.data ? (
          <Loading />
        ) : meds.data.items.length === 0 ? (
          <Card>
            <EmptyState
              icon={Pill}
              title="Nada cadastrado"
              text="Cadastre um remédio ou suplemento para acompanhar as doses."
            />
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {meds.data.items.map((med) => (
              <MedCard key={med.id} med={med} onEdit={() => setEditing(med)} />
            ))}
          </div>
        )}
      </div>
      {editing && (
        <MedForm med={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
