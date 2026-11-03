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
              'flex items-center gap-2.5 rounded-control border bg-background p-3 text-sm font-medium text-foreground transition-[border-color,box-shadow]',
              palette === value ? 'border-primary ring-1 ring-primary' : 'border-line-strong hover:border-primary'
            )}
          >
            <span aria-hidden className="flex -space-x-1.5">
              <span className="size-5 rounded-full border-2 border-background bg-primary" />
              <span className="size-5 rounded-full border-2 border-background bg-secondary" />
            </span>
            {label}
          </button>
        ))}
      </div>
    </Card>
  );
}
