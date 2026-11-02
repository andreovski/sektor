import { Timer } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={Timer} title="Foco" />;
}

export const routes = [{ path: '/foco', component: Page0 }];
