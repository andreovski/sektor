import { type ComponentType, useEffect, useState } from 'react';

import { type ModuleId, useModules } from '../../lib/modules';
import { useRpc } from '../../lib/rpc';
import { cn, SectionLabel } from '../../ui';

import { AssistantChat, useHomeAssistant } from './assistant';
import { HomeCapture } from './capture';
import { Cover } from './cover';
import { coverDate, greeting, localDate } from './dates';
import { FinanceCard, GoalsCard, ProjectsCard } from './progress-cards';
import { MosaicCard, StreakCard, WeekCard } from './rhythm-cards';
import {
  AgendaCard,
  BillsCard,
  CheckinCard,
  FocusCard,
  HabitsCard,
  TasksCard,
} from './today-cards';

const GRID = 'grid grid-cols-2 gap-4 lg:grid-cols-3';

function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

// Cada cartão mostra dados de um módulo; módulo desligado leva o cartão junto.
const SECTIONS: { label: string; cards: { card: ComponentType; module: ModuleId }[] }[] = [
  {
    label: 'Hoje',
    cards: [
      { card: CheckinCard, module: 'health' },
      { card: HabitsCard, module: 'habits' },
      { card: TasksCard, module: 'tasks' },
      { card: AgendaCard, module: 'agenda' },
      { card: FocusCard, module: 'focus' },
      { card: BillsCard, module: 'finance' },
    ],
  },
  {
    label: 'Progresso',
    cards: [
      { card: GoalsCard, module: 'goals' },
      { card: ProjectsCard, module: 'projects' },
      { card: FinanceCard, module: 'finance' },
    ],
  },
  {
    label: 'Ritmo',
    cards: [
      { card: StreakCard, module: 'habits' },
      { card: MosaicCard, module: 'tasks' },
      { card: WeekCard, module: 'focus' },
    ],
  },
];

function Sections() {
  const { isOn } = useModules();
  return (
    <div className="flex flex-col gap-8">
      {SECTIONS.map(({ label, cards }) => {
        const shown = cards.filter((item) => isOn(item.module));
        if (!shown.length) return null;
        return (
          <section key={label}>
            <SectionLabel>{label}</SectionLabel>
            <div className={GRID}>
              {shown.map(({ card: Item, module }, index) => (
                <Item key={`${module}-${index}`} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function HomePage() {
  const now = useNow();
  const name = useRpc('settings.get').data?.name;
  const assistant = useHomeAssistant();
  const assistantOn = useModules().isOn('assistant');
  const open = assistant.open && assistantOn;
  return (
    // O -mt-8 desfaz o respiro do `main`: a capa encosta no topo da janela.
    <div className="relative -mt-8">
      <Cover className={cn('transition-[height] duration-500', open && 'h-[150px]')} />
      <header
        className={cn(
          'relative flex flex-col items-center text-center transition-all duration-500',
          open ? 'min-h-[150px] pt-12 pb-6' : 'min-h-[430px] pt-[116px] pb-8'
        )}
      >
        <h1
          className={cn(
            'leading-tight font-semibold transition-all duration-500',
            open ? 'text-2xl' : 'text-[36px]'
          )}
        >
          {greeting(now.getHours())}
          {name ? `, ${name}` : ''}
        </h1>
        <p className={cn('mt-1 text-muted first-letter:uppercase', !open && 'mb-8')}>{coverDate(now)}</p>
        {!open && <HomeCapture assistant={assistant} />}
      </header>
      {open ? (
        <AssistantChat assistant={assistant} />
      ) : (
        /* A chave recarrega os cartões na virada do dia, com o app aberto na bandeja. */
        <Sections key={localDate(now.getTime())} />
      )}
    </div>
  );
}

export const routes = [{ path: '/', component: HomePage }];
