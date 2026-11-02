import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import {
  CalendarDays,
  CheckSquare,
  FolderKanban,
  HeartPulse,
  LayoutGrid,
  type LucideIcon,
  Repeat2,
  Target,
  Timer,
  Wallet,
} from 'lucide-react';

import { cn } from './ui';

const ITEMS: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/', label: 'Início', icon: LayoutGrid },
  { to: '/tarefas', label: 'Tarefas', icon: CheckSquare },
  { to: '/projetos', label: 'Projetos', icon: FolderKanban },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/financas', label: 'Finanças', icon: Wallet },
  { to: '/habitos', label: 'Hábitos', icon: Repeat2 },
  { to: '/metas', label: 'Metas', icon: Target },
  { to: '/saude', label: 'Saúde', icon: HeartPulse },
  { to: '/foco', label: 'Foco', icon: Timer },
];

function Dock() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav
      aria-label="Navegação principal"
      className="fixed bottom-4 left-1/2 z-40 flex h-[52px] -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-raised/90 px-2 shadow-popover backdrop-blur"
    >
      {ITEMS.map(({ to, label, icon: Icon }) => {
        const active = to === '/' ? path === '/' : path.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            aria-label={label}
            className={cn(
              'flex h-9 items-center gap-2 rounded-full px-3 text-sm',
              active ? 'border border-primary/40 bg-primary/15 text-primary' : 'text-muted hover:text-foreground'
            )}
          >
            <Icon size={18} />
            {active && label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell() {
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto max-w-[1180px] px-8 pt-8 pb-28">
        <Outlet />
      </main>
      <Dock />
    </div>
  );
}
