import { CalendarCheck } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={CalendarCheck} title="Revisão" />;
}

export const routes = [{ path: '/revisao', component: Page0 }];
