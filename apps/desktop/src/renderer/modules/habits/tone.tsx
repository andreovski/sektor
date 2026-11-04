import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../../ui';

export const TONES = ['green', 'cyan', 'blue', 'violet', 'rose', 'orange', 'amber'] as const;
export type Tone = (typeof TONES)[number];

const TONE_NAMES: Record<Tone, string> = {
  green: 'Verde',
  cyan: 'Ciano',
  blue: 'Azul',
  violet: 'Violeta',
  rose: 'Rosa',
  orange: 'Laranja',
  amber: 'Âmbar',
};

export const toneVar = (tone: Tone) => `var(--tone-${tone})`;

export function TonePicker({ value, onChange }: { value: Tone; onChange(tone: Tone): void }) {
  return (
    <div className="flex gap-2" role="radiogroup" aria-label="Cor">
      {TONES.map((tone) => (
        <button
          key={tone}
          type="button"
          role="radio"
          aria-checked={tone === value}
          aria-label={TONE_NAMES[tone]}
          title={TONE_NAMES[tone]}
          onClick={() => onChange(tone)}
          style={{ background: toneVar(tone) }}
          className={cn(
            'grid size-6 place-items-center rounded-full text-on-primary',
            tone === value && 'ring-2 ring-foreground ring-offset-2 ring-offset-raised'
          )}
        >
          {tone === value && <Check size={13} strokeWidth={3} />}
        </button>
      ))}
    </div>
  );
}

/** Rótulo de botões: dentro de `<label>` (o `Field`), o clique cairia no primeiro botão. */
export function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1 text-xs text-muted">
      <span className="font-mono text-[10px] tracking-[0.12em] text-subtle uppercase">{label}</span>
      {children}
    </div>
  );
}
