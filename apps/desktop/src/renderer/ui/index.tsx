import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Dialog as RadixDialog } from 'radix-ui';
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useRef,
} from 'react';
import { type LucideIcon, X } from 'lucide-react';

export const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(inputs));

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      type="button"
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap transition-[color,background-color,scale] enabled:active:scale-[0.98] disabled:opacity-50',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
        variant === 'primary' && 'bg-primary text-on-primary shadow-glow hover:bg-primary-hover',
        variant === 'secondary' && 'border border-line-strong bg-sunken hover:bg-hover',
        variant === 'ghost' && 'text-muted hover:bg-hover hover:text-foreground',
        variant === 'danger' && 'border border-line-strong text-danger hover:bg-hover',
        className
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<'section'>) {
  return (
    <section
      className={clsx('rounded-panel border border-line bg-surface p-4 shadow-card', className)}
      {...props}
    />
  );
}

export function CardHeader({
  icon: Icon,
  title,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-3 flex items-center gap-2">
      {Icon && <Icon size={16} className="text-muted" />}
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="ml-auto text-xs text-muted">{action}</div>
    </header>
  );
}

export function PageHeader({
  icon: Icon,
  title,
  description,
  actions,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex items-center gap-3">
      <span className="grid size-9 place-items-center rounded-control border border-line-strong">
        <Icon size={18} />
      </span>
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      <div className="ml-auto flex items-center gap-2">{actions}</div>
    </header>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">
      {children}
    </h2>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="mb-1 grid size-10 place-items-center rounded-full border border-line-strong shadow-glow">
        <Icon size={18} className="text-muted" />
      </span>
      <p className="font-medium">{title}</p>
      {text && <p className="max-w-sm text-sm text-muted">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange(value: T): void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-control border border-line bg-sunken p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={clsx(
            'h-7 rounded-[6px] px-2.5 text-xs font-medium transition-colors',
            option.value === value ? 'bg-active text-foreground' : 'text-muted hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export { Field, fieldClass, Input, Select, Textarea } from './fields';

/** O ícone do módulo aberto, que o cabeçalho dos modais repete. */
export const ModuleIcon = createContext<LucideIcon | null>(null);

const DIALOG_EXIT_MS = 170;

/**
 * Quase todo modal sai da tela junto com quem o abriu, sem passar pelo fechamento do Radix.
 * Uma cópia inerte do que estava à vista faz a saída no lugar dele.
 */
function useDialogExit() {
  const overlay = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(
    () => () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      for (const node of [overlay.current, panel.current]) {
        if (!node) continue;
        const ghost = node.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('id');
        ghost.dataset.state = 'closed';
        ghost.inert = true;
        ghost.style.pointerEvents = 'none';
        document.body.append(ghost);
        const body = node.querySelector('[data-dialog-body]');
        const copy = ghost.querySelector('[data-dialog-body]');
        if (body && copy) copy.scrollTop = body.scrollTop;
        setTimeout(() => ghost.remove(), DIALOG_EXIT_MS);
      }
    },
    []
  );
  return { overlay, panel };
}

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  children: ReactNode;
}) {
  const Icon = useContext(ModuleIcon);
  const { overlay, panel } = useDialogExit();
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay
          ref={overlay}
          className="dialog-overlay fixed inset-0 z-50 bg-[var(--overlay)]"
        />
        <RadixDialog.Content
          ref={panel}
          className="dialog-panel fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[480px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-panel border border-line bg-raised shadow-popover"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-line bg-sunken px-5 py-3">
            {Icon && (
              <span className="grid size-8 shrink-0 place-items-center rounded-control bg-primary/15 text-primary">
                <Icon size={16} />
              </span>
            )}
            <RadixDialog.Title title={title} className="min-w-0 truncate text-[15px] font-semibold">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label="Fechar"
                className="ml-auto grid size-7 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-hover hover:text-foreground"
              >
                <X size={16} />
              </button>
            </RadixDialog.Close>
          </header>
          <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          <div data-dialog-body className="min-h-0 overflow-y-auto p-5">
            {children}
          </div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Número principal de um cartão. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-subtle">{hint}</p>}
    </div>
  );
}
