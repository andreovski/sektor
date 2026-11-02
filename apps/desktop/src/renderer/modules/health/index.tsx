import { HeartPulse } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={HeartPulse} title="Saúde" />;
}

export const routes = [{ path: '/saude', component: Page0 }];
