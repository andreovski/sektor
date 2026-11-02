import type { Rpc } from '@sektor/core';
import { Hourglass, Minus, Sparkles } from 'lucide-react';

import { useRpc } from '../../lib/rpc';
import { Card, cn } from '../../ui';

import { Loading, Meter } from './shared';

type Pattern = Awaited<ReturnType<Rpc['health.patterns']>>['patterns'][number];

const decimal = (value: number) =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const STATUS = {
  early: { icon: Hourglass, label: 'Ainda é cedo', tone: 'text-subtle' },
  flat: { icon: Minus, label: 'Sem diferença clara', tone: 'text-muted' },
  found: { icon: Sparkles, label: 'Padrão encontrado', tone: 'text-primary' },
};

/** Escala de 1 a 5, a mesma de humor e energia. */
function Groups({ pattern }: { pattern: Pattern }) {
  const best = Math.max(...pattern.groups.map((g) => g.average ?? 0));
  return (
    <ul className="mt-3 flex flex-col gap-1.5">
      {pattern.groups.map((group) => (
        <li
          key={group.label}
          className="grid grid-cols-[104px_1fr_72px] items-center gap-2 text-xs"
        >
          <span className="truncate text-muted">{group.label}</span>
          {group.average === null ? (
            <span className="text-subtle">Poucos dias</span>
          ) : (
            <div className="h-2 overflow-hidden rounded-full bg-active">
              <div
                className={cn(
                  'h-full rounded-full',
                  group.average === best && pattern.status === 'found' ? 'bg-primary' : 'bg-subtle'
                )}
                style={{ width: `${(group.average / 5) * 100}%` }}
              />
            </div>
          )}
          <span className="text-right text-subtle tabular-nums">
            {group.average === null ? `${group.count} dias` : `${decimal(group.average)} · ${group.count}d`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function PatternCard({ pattern }: { pattern: Pattern }) {
  const status = STATUS[pattern.status];
  const Icon = status.icon;
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium">{pattern.title}</h3>
        <span className={cn('ml-auto inline-flex items-center gap-1 text-xs', status.tone)}>
          <Icon size={12} /> {status.label}
        </span>
      </div>
      <p className="text-sm text-muted">{pattern.summary}</p>
      {pattern.status !== 'early' ? (
        <Groups pattern={pattern} />
      ) : (
        pattern.samples < pattern.needed && (
          <div className="mt-3">
            <Meter percent={(pattern.samples / pattern.needed) * 100} tone="muted" />
            <p className="mt-1 text-xs text-subtle">
              {pattern.samples} de {pattern.needed} dias com dados
            </p>
          </div>
        )
      )}
    </Card>
  );
}

export function PatternsTab() {
  const data = useRpc('health.patterns');
  if (!data.data) return <Loading />;
  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Comparações dos seus últimos {data.data.windowDays} dias. Mostram o que costuma andar junto,
        não a causa, e não substituem orientação médica.
      </p>
      <div className="grid items-start gap-4 md:grid-cols-2">
        {data.data.patterns.map((pattern) => (
          <PatternCard key={pattern.key} pattern={pattern} />
        ))}
      </div>
    </div>
  );
}
