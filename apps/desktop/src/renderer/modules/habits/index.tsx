import { Repeat2 } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={Repeat2} title="Hábitos" />;
}

export const routes = [{ path: '/habitos', component: Page0 }];
