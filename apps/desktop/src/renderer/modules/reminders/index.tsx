import { Bell } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={Bell} title="Lembretes" />;
}

export const routes = [{ path: '/lembretes', component: Page0 }];
