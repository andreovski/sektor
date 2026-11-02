import { HeartPulse } from 'lucide-react';
import { useState } from 'react';

import { PageHeader, Segmented } from '../../ui';

import { AppointmentsTab } from './appointments';
import { DiaryTab } from './diary';
import { MedsTab } from './meds';
import { PatternsTab } from './patterns';
import { SleepTab } from './sleep';
import { TodayTab } from './today';

const TABS = [
  { value: 'today', label: 'Hoje' },
  { value: 'sleep', label: 'Sono' },
  { value: 'diary', label: 'Diário' },
  { value: 'meds', label: 'Remédios' },
  { value: 'appointments', label: 'Consultas' },
  { value: 'patterns', label: 'Padrões' },
] as const;

type Tab = (typeof TABS)[number]['value'];

function HealthPage() {
  const [tab, setTab] = useState<Tab>('today');
  return (
    <>
      <PageHeader
        icon={HeartPulse}
        title="Saúde"
        description="Corpo, rotina e cuidados do dia a dia"
        actions={<Segmented<Tab> value={tab} onChange={setTab} options={[...TABS]} />}
      />
      {tab === 'today' && (
        <TodayTab onSleep={() => setTab('sleep')} onMeds={() => setTab('meds')} />
      )}
      {tab === 'sleep' && <SleepTab />}
      {tab === 'diary' && <DiaryTab />}
      {tab === 'meds' && <MedsTab />}
      {tab === 'appointments' && <AppointmentsTab />}
      {tab === 'patterns' && <PatternsTab />}
    </>
  );
}

export const routes = [{ path: '/saude', component: HealthPage }];
