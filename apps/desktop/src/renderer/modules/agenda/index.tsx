import { CalendarDays } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={CalendarDays} title="Agenda" />;
}

export const routes = [{ path: '/agenda', component: Page0 }];
