import { LayoutGrid } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={LayoutGrid} title="Início" />;
}

export const routes = [{ path: '/', component: Page0 }];
