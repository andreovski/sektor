import { CheckSquare, FolderKanban } from 'lucide-react';

import { PageHeader } from '../../ui';

function Page0() {
  return <PageHeader icon={CheckSquare} title="Tarefas" />;
}

function Page1() {
  return <PageHeader icon={FolderKanban} title="Projetos" />;
}

export const routes = [{ path: '/tarefas', component: Page0 }, { path: '/projetos', component: Page1 }];
