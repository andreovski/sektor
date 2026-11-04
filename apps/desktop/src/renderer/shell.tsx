import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
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
  Target,
  Timer,
  Wallet,
} from 'lucide-react';

import { type ModuleId, useModules } from './lib/modules';
import { useCoverEverywhere } from './lib/theme';
import { Cover } from './modules/home/cover';
import { Button, cn, EmptyState, ModuleIcon } from './ui';

const ITEMS: { to: string; label: string; icon: LucideIcon; module?: ModuleId }[] = [
  { to: '/', label: 'Início', icon: LayoutGrid },
  { to: '/tarefas', label: 'Tarefas', icon: CheckSquare, module: 'tasks' },
  { to: '/projetos', label: 'Projetos', icon: FolderKanban, module: 'projects' },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays, module: 'agenda' },
  { to: '/financas', label: 'Finanças', icon: Wallet, module: 'finance' },
  { to: '/habitos', label: 'Hábitos', icon: Repeat2, module: 'habits' },
  { to: '/metas', label: 'Metas', icon: Target, module: 'goals' },
  { to: '/saude', label: 'Saúde', icon: HeartPulse, module: 'health' },
  { to: '/foco', label: 'Foco', icon: Timer, module: 'focus' },
  { to: '/revisao', label: 'Revisão', icon: CalendarCheck, module: 'review' },
  { to: '/lembretes', label: 'Lembretes', icon: Bell, module: 'reminders' },
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
  const { isOn } = useModules();
  return (
    <nav
      aria-label="Navegação principal"
      className="dock fixed bottom-4 left-1/2 z-40 flex h-[52px] -translate-x-1/2 items-center gap-1 rounded-full border border-line-strong bg-raised/90 px-2 shadow-popover backdrop-blur"
    >
      {ITEMS.filter((item) => isOn(item.module)).map(({ to, label, icon: Icon }) => {
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

/** Opacidade da capa fora da Início: presente, mas atrás do conteúdo. */
const TRAIL_OPACITY = 0.2;

/**
 * A capa da Início que segue pelos outros módulos, atenuada. Na Início fica invisível e a
 * própria tela mostra a dela (que encolhe com o assistente); a troca é um cruzamento de opacidade.
 */
function CoverTrail({ home }: { home: boolean }) {
  const on = useCoverEverywhere();
  if (!on) return null;
  return (
    <Cover
      trail
      className="transition-opacity duration-500 ease-[var(--ease-standard)] motion-reduce:transition-none"
      style={{ opacity: home ? 0 : TRAIL_OPACITY }}
    />
  );
}

/** Link antigo ou de outro módulo para um módulo desligado: diz onde religar em vez de abrir. */
function ModuleOff({ label, icon }: { label: string; icon: LucideIcon }) {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={icon}
      title={`${label} está desligado`}
      text="Os dados continuam guardados. Ligue o módulo de novo para voltar a usá-lo."
      action={
        <Button
          variant="primary"
          onClick={() => void navigate({ to: '/ajustes', search: { secao: 'modulos' } as never })}
        >
          Abrir Ajustes › Módulos
        </Button>
      }
    />
  );
}

export function Shell() {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const scroller = useRef<HTMLDivElement>(null);
  const { isOn } = useModules();
  const current = ITEMS[moduleIndex(path)];
  useLayoutEffect(() => {
    scroller.current?.scrollTo(0, 0);
  }, [path]);
  // A nota em pop-up e a captura rápida são janelas à parte: sem dock e sem a moldura da página.
  if (path.startsWith('/nota-fixa/') || path === '/captura-rapida') return <Outlet />;
  return (
    <div ref={scroller} className="relative h-full overflow-x-hidden overflow-y-auto">
      <CoverTrail home={path === '/'} />
      <main className="page relative mx-auto max-w-[1180px] px-8 pt-8 pb-28">
        <ModuleIcon.Provider value={current?.icon ?? null}>
          {current && !isOn(current.module) ? (
            <ModuleOff label={current.label} icon={current.icon} />
          ) : (
            <Outlet />
          )}
        </ModuleIcon.Provider>
      </main>
      <Dock />
    </div>
  );
}
