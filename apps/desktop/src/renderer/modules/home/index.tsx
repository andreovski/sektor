import { useEffect, useState } from 'react';

import { useRpc } from '../../lib/rpc';
import { cn, SectionLabel } from '../../ui';

import { AssistantConversation, AssistantInput, useHomeAssistant } from './assistant';
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

function Sections() {
  return (
    <div className="flex flex-col gap-8">
      <section>
        <SectionLabel>Hoje</SectionLabel>
        <div className={GRID}>
          <CheckinCard />
          <HabitsCard />
          <TasksCard />
          <AgendaCard />
          <FocusCard />
          <BillsCard />
        </div>
      </section>
      <section>
        <SectionLabel>Progresso</SectionLabel>
        <div className={GRID}>
          <GoalsCard />
          <ProjectsCard />
          <FinanceCard />
        </div>
      </section>
      <section>
        <SectionLabel>Ritmo</SectionLabel>
        <div className={GRID}>
          <StreakCard />
          <MosaicCard />
          <WeekCard />
        </div>
      </section>
    </div>
  );
}

function HomePage() {
  const now = useNow();
  const name = useRpc('settings.get').data?.name;
  const assistant = useHomeAssistant();
  const open = assistant.open;
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
        {!open && <AssistantInput assistant={assistant} />}
      </header>
      {open ? (
        <div className="tab-panel flex flex-col gap-4">
          <AssistantConversation assistant={assistant} />
          <AssistantInput assistant={assistant} docked />
        </div>
      ) : (
        /* A chave recarrega os cartões na virada do dia, com o app aberto na bandeja. */
        <Sections key={localDate(now.getTime())} />
      )}
    </div>
  );
}

export const routes = [{ path: '/', component: HomePage }];
