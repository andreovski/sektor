import { NoteWindow } from '../projects/note-window';
import { ProjectPage } from '../projects/project-page';

import { ProjectsPage } from './projects-page';
import { TasksPage } from './tasks-page';

export const routes = [
  { path: '/tarefas', component: TasksPage },
  { path: '/projetos', component: ProjectsPage },
  { path: '/projetos/$id', component: ProjectPage },
  { path: '/nota-fixa/$id', component: NoteWindow },
];
