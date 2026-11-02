import { useEffect, useState } from 'react';

import { SectionLabel } from '../../ui';

import { CaptureBox } from './capture';
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
  return (
    // O -mt-8 desfaz o respiro do `main`: a capa encosta no topo da janela.
    <div className="relative -mt-8">
      <Cover />
      <header className="relative flex min-h-[430px] flex-col items-center pt-[116px] pb-8 text-center">
        <h1 className="text-[36px] leading-tight font-semibold">{greeting(now.getHours())}</h1>
        <p className="mt-1 mb-8 text-muted first-letter:uppercase">{coverDate(now)}</p>
        <CaptureBox />
      </header>
      {/* A chave recarrega os cartões na virada do dia, com o app aberto na bandeja. */}
      <Sections key={localDate(now.getTime())} />
    </div>
  );
}

export const routes = [{ path: '/', component: HomePage }];
