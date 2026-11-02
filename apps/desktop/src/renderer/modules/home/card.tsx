import type { UseQueryResult } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { CircleAlert, type LucideIcon } from 'lucide-react';
import { Component, type ReactNode } from 'react';

import { Button, Card, CardHeader, cn, EmptyState } from '../../ui';

function Failed({ onRetry }: { onRetry?(): void }) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <CircleAlert size={18} className="text-subtle" />
      <p className="text-sm text-muted">Não deu para carregar agora.</p>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}

/** Um erro de desenho fica no cartão, sem levar a tela junto. */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (this.state.failed) return <Failed onRetry={() => this.setState({ failed: false })} />;
    return this.props.children;
  }
}

export function HomeCard({
  icon,
  title,
  to,
  module,
  extra,
  className,
  children,
}: {
  icon: LucideIcon;
  title: string;
  to: string;
  module: string;
  extra?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('flex min-w-0 flex-col', className)}>
      <CardHeader
        icon={icon}
        title={title}
        action={
          <span className="flex items-center gap-3">
            {extra}
            <Link to={to} aria-label={`Abrir ${module}`} className="hover:text-foreground">
              Módulo ↗
            </Link>
          </span>
        }
      />
      <CardBoundary>{children}</CardBoundary>
    </Card>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3 py-1" aria-busy aria-label="Carregando">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-4 animate-pulse rounded-[6px] bg-hover motion-reduce:animate-none"
          style={{ width: `${88 - index * 14}%` }}
        />
      ))}
    </div>
  );
}

/** Carregando, falhou ou pronto: um método com problema só apaga o próprio cartão. */
export function Loaded<T>({
  query,
  rows = 3,
  children,
}: {
  query: UseQueryResult<T>;
  rows?: number;
  children(data: T): ReactNode;
}) {
  if (query.data !== undefined) return children(query.data);
  if (query.isError) return <Failed onRetry={() => void query.refetch()} />;
  return <Skeleton rows={rows} />;
}

export function Empty({
  icon,
  title,
  text,
  action,
  to,
  onAction,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
  action: string;
  to?: string;
  onAction?(): void;
}) {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon={icon}
      title={title}
      text={text}
      action={
        <Button size="sm" onClick={() => (onAction ? onAction() : void navigate({ to }))}>
          {action}
        </Button>
      }
    />
  );
}

export function Meter({ value, tone }: { value: number; tone?: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-active">
      <div
        className="h-full rounded-full bg-primary"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: tone }}
      />
    </div>
  );
}

export function More({ to, count }: { to: string; count: number }) {
  if (count <= 0) return null;
  return (
    <Link to={to} className="mt-2 block text-xs text-muted hover:text-foreground">
      Mais {count}
    </Link>
  );
}
