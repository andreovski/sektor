import { type LucideIcon, Monitor, Moon, Sun } from 'lucide-react';

import {
  PALETTES,
  setPalette,
  setTheme,
  type ThemeChoice,
  usePalette,
  useThemeChoice,
} from '../../lib/theme';
import { Card, cn } from '../../ui';

const THEMES: { value: ThemeChoice; label: string; icon: LucideIcon }[] = [
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

const PREVIEW_CARDS = ['w-3/5', 'w-2/5', 'w-1/2', 'w-2/3', 'w-1/3', 'w-1/2'];

/** A tela Início em esqueleto, pintada com as cores da paleta do card em volta. */
function HomePreview() {
  return (
    <span
      aria-hidden
      className="relative flex aspect-[16/10] w-full flex-col overflow-hidden rounded-[0.375rem] border border-line bg-background"
      style={{ backgroundImage: 'var(--app-backdrop)' }}
    >
      <span className="palette-preview-cover absolute inset-x-0 top-0 h-2/5" />
      <span className="relative flex flex-col items-center gap-1 pt-[13%] pb-[7%]">
        <span className="h-1.5 w-2/5 rounded-full bg-foreground/85" />
        <span className="h-1 w-1/4 rounded-full bg-muted/60" />
        <span className="mt-1 flex h-2.5 w-3/5 items-center justify-end rounded-full border border-line-strong bg-surface px-0.5">
          <span className="size-1.5 rounded-full bg-primary" />
        </span>
      </span>
      <span className="relative grid flex-1 grid-cols-3 gap-1 px-1.5 pb-1.5">
        {PREVIEW_CARDS.map((width, index) => (
          <span
            key={index}
            className="flex flex-col justify-between rounded-[3px] border border-line bg-surface p-1"
          >
            <span className={cn('h-0.5 rounded-full bg-subtle/70', width)} />
            <span
              className={cn(
                'h-1 rounded-full',
                index === 0 ? 'w-full bg-primary' : index === 4 ? 'w-3/4 bg-secondary' : 'w-1/2 bg-line-strong'
              )}
            />
          </span>
        ))}
      </span>
    </span>
  );
}

export function Appearance() {
  const theme = useThemeChoice();
  const palette = usePalette();
  return (
    <Card className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-3">
        {THEMES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            data-testid={`theme-${value}`}
            onClick={() => setTheme(value)}
            className={cn(
              'flex h-12 items-center justify-center gap-2 rounded-control border text-sm font-medium transition-colors',
              theme === value
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-line bg-sunken text-muted hover:bg-hover hover:text-foreground'
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>
      <div role="radiogroup" aria-label="Paleta" className="grid grid-cols-3 gap-3">
        {PALETTES.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={palette === value}
            data-palette={value}
            data-testid={`palette-${value}`}
            onClick={() => setPalette(value)}
            className={cn(
              'flex flex-col gap-2 rounded-control border bg-background p-2 text-left text-sm font-medium text-foreground transition-[border-color,box-shadow]',
              palette === value ? 'border-primary ring-1 ring-primary' : 'border-line-strong hover:border-primary'
            )}
          >
            <HomePreview />
            <span className="flex items-center gap-2 px-1 pb-0.5">
              <span aria-hidden className="flex -space-x-1">
                <span className="size-3.5 rounded-full border-2 border-background bg-primary" />
                <span className="size-3.5 rounded-full border-2 border-background bg-secondary" />
              </span>
              {label}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
