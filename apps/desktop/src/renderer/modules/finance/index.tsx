import { Wallet } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={Wallet} title="Finanças" />;
}

export const routes = [{ path: '/financas', component: Page0 }];
