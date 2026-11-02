import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';

import './ui/theme.css';
import { routes as home } from './modules/home';
import { routes as finance } from './modules/finance';
import { routes as tasks } from './modules/tasks';
import { routes as agenda } from './modules/agenda';
import { routes as reminders } from './modules/reminders';
import { routes as habits } from './modules/habits';
import { routes as goals } from './modules/goals';
import { routes as health } from './modules/health';
import { routes as focus } from './modules/focus';
import { routes as review } from './modules/review';
import { Shell } from './shell';

const rootRoute = createRootRoute({ component: Shell });

const moduleRoutes = [
  ...home,
  ...finance,
  ...tasks,
  ...agenda,
  ...reminders,
  ...habits,
  ...goals,
  ...health,
  ...focus,
  ...review,
];

// Rotas por hash: o app abre de arquivo, sem servidor.
const router = createRouter({
  history: createHashHistory(),
  routeTree: rootRoute.addChildren(
    moduleRoutes.map((route) => createRoute({ getParentRoute: () => rootRoute, ...route }))
  ),
});

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster theme="dark" position="top-right" />
    </QueryClientProvider>
  </StrictMode>
);
