import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { useLayoutEffect, useRef } from 'react';
import {
  Bell,
  CalendarCheck,
  CalendarDays,
  CheckSquare,
  FolderKanban,
  HeartPulse,
  LayoutGrid,
  type LucideIcon,
  Repeat2,
  Settings,
  Sparkles,
  Target,
  Timer,
  Wallet,
} from 'lucide-react';

import { cn, ModuleIcon } from './ui';

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
  { to: '/revisao', label: 'Revisão', icon: CalendarCheck },
  { to: '/lembretes', label: 'Lembretes', icon: Bell },
  { to: '/assistente', label: 'Assistente', icon: Sparkles },
  { to: '/ajustes', label: 'Ajustes', icon: Settings },
];

const isCurrent = (to: string, path: string) => (to === '/' ? path === '/' : path.startsWith(to));

const moduleIndex = (path: string) => ITEMS.findIndex(({ to }) => isCurrent(to, path));

/** A tela nova entra do lado para onde o dock andou; dentro do módulo, entrar é ir adiante. */
export const pageTransition = {
  types: ({
    fromLocation,
    toLocation,
    pathChanged,
  }: {
    fromLocation?: { pathname: string };
    toLocation: { pathname: string };
    pathChanged: boolean;
  }) => {
    if (!fromLocation || !pathChanged) return false as const;
    const from = fromLocation.pathname;
    const to = toLocation.pathname;
    const step = moduleIndex(to) - moduleIndex(from) || to.length - from.length;
    return [step < 0 ? 'page-back' : 'page-forward'];
  },
};

function Dock() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <nav
      aria-label="Navegação principal"
      className="dock fixed bottom-4 left-1/2 z-40 flex h-[52px] -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-raised/90 px-2 shadow-popover backdrop-blur"
    >
      {ITEMS.map(({ to, label, icon: Icon }) => {
        const active = isCurrent(to, path);
        return (
          <Link
            key={to}
            to={to}
            aria-label={label}
            className={cn(
              'flex h-9 items-center rounded-full border px-3 text-sm transition-colors duration-200',
              active
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-transparent text-muted hover:bg-hover hover:text-foreground'
            )}
          >
            <Icon size={18} />
            <span
              aria-hidden={!active}
              className={cn(
                'grid transition-[grid-template-columns,opacity,margin] duration-300 ease-[var(--ease-standard)] motion-reduce:transition-none',
                active ? 'ml-2 grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0'
              )}
            >
              <span className="overflow-hidden whitespace-nowrap">{label}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function Shell() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [path]);
  // A nota em pop-up é uma janela à parte: sem dock e sem a moldura da página.
  if (path.startsWith('/nota-fixa/')) return <Outlet />;
  return (
    <div ref={scroller} className="h-full overflow-y-auto">
      <main className="page mx-auto max-w-[1180px] px-8 pt-8 pb-28">
        <ModuleIcon.Provider value={ITEMS[moduleIndex(path)]?.icon ?? null}>
          <Outlet />
        </ModuleIcon.Provider>
      </main>
      <Dock />
    </div>
  );
}
