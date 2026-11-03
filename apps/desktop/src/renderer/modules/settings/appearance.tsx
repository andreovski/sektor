import { type LucideIcon, Moon, Sun } from 'lucide-react';

import { setTheme, type Theme, useTheme } from '../../lib/theme';
import { Card, cn } from '../../ui';

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'light', label: 'Claro', icon: Sun },
];

export function Appearance() {
  const theme = useTheme();
  return (
    <Card>
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-2 gap-3">
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
    </Card>
  );
}
