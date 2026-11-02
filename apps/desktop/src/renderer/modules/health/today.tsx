import { useQueryClient } from '@tanstack/react-query';
import {
  Annoyed,
  CalendarClock,
  Droplets,
  Frown,
  Laugh,
  Meh,
  Minus,
  MoonStar,
  Pill,
  Plus,
  Settings2,
  Smile,
  Sparkles,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { longDate, todayString } from '../../lib/format';
import { call, useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, CardHeader, Dialog, EmptyState, Field, Input, Stat, Textarea } from '../../ui';

import {
  type DayData,
  DayStepper,
  dayLabel,
  DoseList,
  durationLabel,
  litersLabel,
  Loading,
  Meter,
  SaveState,
  ScorePicker,
  useAutosave,
} from './shared';

const MOODS = [
  { label: 'Muito mal', icon: Frown },
  { label: 'Mal', icon: Annoyed },
  { label: 'Neutro', icon: Meh },
  { label: 'Bem', icon: Smile },
  { label: 'Muito bem', icon: Laugh },
];
const ENERGY = ['Sem energia', 'Baixa', 'Média', 'Boa', 'Alta'].map((label) => ({ label }));

function Gratitude({ date }: { date: string }) {
  const client = useQueryClient();
  const [text, setText] = useState<string | null>(null);
  const { schedule, flush, state } = useAutosave(async (value) => {
    try {
      await call('health.checkinSave', { date, gratitude: value });
      await client.invalidateQueries({ queryKey: ['health.patterns'] });
    } catch (error) {
      toast.error((error as Error).message);
      throw error;
    }
  });

  useEffect(() => {
    let live = true;
    void call('health.day', { date }).then((day) => {
      if (live) setText(day.checkin.gratitude ?? '');
    });
    return () => {
      live = false;
    };
  }, [date]);

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-xs">
        <label htmlFor="health-gratitude" className="text-muted">
          Gratidão
        </label>
        <SaveState state={state} />
      </div>
      <Textarea
        id="health-gratitude"
        rows={3}
        className="resize-none"
        placeholder="Algo bom de hoje, por menor que seja"
        disabled={text === null}
        value={text ?? ''}
        onChange={(event) => {
          setText(event.target.value);
          schedule(event.target.value);
        }}
        onBlur={flush}
      />
    </div>
  );
}

function CheckinCard({ day }: { day: DayData }) {
  const save = useRpcMutation('health.checkinSave');
  return (
    <Card>
      <CardHeader icon={Sparkles} title="Check-in" action={dayLabel(day.date)} />
      <div className="flex flex-col gap-4">
        <ScorePicker
          label="Humor"
          options={MOODS}
          value={day.checkin.mood}
          onChange={(mood) => save.mutate({ date: day.date, mood })}
        />
        <ScorePicker
          label="Energia"
          options={ENERGY}
          value={day.checkin.energy}
          onChange={(energy) => save.mutate({ date: day.date, energy })}
        />
        <Gratitude key={day.date} date={day.date} />
      </div>
    </Card>
  );
}

function WaterSettings({ day, onClose }: { day: DayData; onClose(): void }) {
  const save = useRpcMutation('health.settingsSave');
  const [glass, setGlass] = useState(String(day.water.glassMl));
  const [goal, setGoal] = useState(String(day.water.goalMl));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Ajustes da água">
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ glassMl: Number(glass), goalMl: Number(goal) }, { onSuccess: onClose });
        }}
      >
        <Field label="Tamanho do copo (ml)">
          <Input
            type="number"
            min={50}
            max={2000}
            step={10}
            value={glass}
            onChange={(e) => setGlass(e.target.value)}
          />
        </Field>
        <Field label="Meta do dia (ml)">
          <Input
            type="number"
            min={250}
            max={10000}
            step={50}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
        </Field>
        <Button type="submit" variant="primary" className="mt-1 self-end" disabled={save.isPending}>
          Salvar
        </Button>
      </form>
    </Dialog>
  );
}

function WaterCard({ day }: { day: DayData }) {
  const add = useRpcMutation('health.waterAdd');
  const [editing, setEditing] = useState(false);
  const { water } = day;
  const percent = Math.round((water.ml / water.goalMl) * 100);
  return (
    <Card>
      <CardHeader
        icon={Droplets}
        title="Água"
        action={
          <Button
            variant="ghost"
            size="sm"
            aria-label="Ajustes da água"
            onClick={() => setEditing(true)}
          >
            <Settings2 size={14} />
          </Button>
        }
      />
      <div className="mb-3 flex items-end justify-between">
        <div>
          <p className="text-2xl font-semibold tabular-nums">{litersLabel(water.ml)}</p>
          <p className="text-xs text-muted">
            {water.glasses} de {water.goalGlasses} copos de {water.glassMl} ml
          </p>
        </div>
        <div className="flex gap-1.5">
          <Button
            aria-label="Tirar um copo"
            disabled={water.ml === 0}
            onClick={() => add.mutate({ date: day.date, glasses: -1 })}
          >
            <Minus size={15} />
          </Button>
          <Button
            variant="primary"
            aria-label="Somar um copo"
            onClick={() => add.mutate({ date: day.date, glasses: 1 })}
          >
            <Plus size={15} /> Copo
          </Button>
        </div>
      </div>
      <Meter percent={percent} />
      <p className="mt-1.5 text-xs text-subtle">
        {percent >= 100 ? 'Meta do dia alcançada' : `${percent}% da meta de ${litersLabel(water.goalMl)}`}
      </p>
      {editing && <WaterSettings day={day} onClose={() => setEditing(false)} />}
    </Card>
  );
}

function SleepCard({ day, onOpen }: { day: DayData; onOpen(): void }) {
  return (
    <Card>
      <CardHeader
        icon={MoonStar}
        title="Sono"
        action={
          <Button variant="ghost" size="sm" onClick={onOpen}>
            {day.sleep ? 'Ver' : 'Registrar'}
          </Button>
        }
      />
      {day.sleep ? (
        <div className="grid grid-cols-2 gap-3">
          <Stat
            label="Duração"
            value={durationLabel(day.sleep.minutes)}
            hint={`${day.sleep.bedTime} às ${day.sleep.wakeTime}`}
          />
          <Stat
            label="Qualidade"
            value={day.sleep.quality ? `${day.sleep.quality} de 5` : 'Sem nota'}
          />
        </div>
      ) : (
        <p className="text-sm text-muted">Nenhuma noite registrada para este dia.</p>
      )}
    </Card>
  );
}

function AppointmentCard({ day }: { day: DayData }) {
  const next = day.nextAppointment;
  return (
    <Card>
      <CardHeader icon={CalendarClock} title="Próxima consulta" />
      {next ? (
        <>
          <p className="text-sm font-medium">{next.title}</p>
          <p className="text-xs text-muted">
            {longDate(next.date)}
            {next.time ? ` às ${next.time}` : ''}
            {next.location ? ` · ${next.location}` : ''}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted">Nada marcado.</p>
      )}
    </Card>
  );
}

export function TodayTab({ onSleep, onMeds }: { onSleep(): void; onMeds(): void }) {
  const [date, setDate] = useState(todayString);
  const day = useRpc('health.day', { date });
  return (
    <div className="flex flex-col gap-4">
      <DayStepper date={date} onChange={setDate} />
      {!day.data ? (
        <Loading />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 lg:grid-cols-3">
          <CheckinCard day={day.data} />
          <div className="flex flex-col gap-4">
            <WaterCard day={day.data} />
            <SleepCard day={day.data} onOpen={onSleep} />
          </div>
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader icon={Pill} title="Doses do dia" />
              <DoseList
                day={day.data}
                empty={
                  <EmptyState
                    icon={Pill}
                    title="Nenhuma dose neste dia"
                    action={<Button onClick={onMeds}>Cadastrar remédio</Button>}
                  />
                }
              />
            </Card>
            <AppointmentCard day={day.data} />
          </div>
        </div>
      )}
    </div>
  );
}
