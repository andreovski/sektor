import { Target } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={Target} title="Metas" />;
}

export const routes = [{ path: '/metas', component: Page0 }];
