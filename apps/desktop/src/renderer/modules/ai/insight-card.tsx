import { Link } from '@tanstack/react-router';
import { RefreshCw, Sparkles } from 'lucide-react';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, CardHeader } from '../../ui';

import { AiText } from './shared';

const when = (at: number) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(at);

/** Um insight da IA: mostra o último texto guardado e só chama o modelo quando a pessoa pede. */
export function InsightCard({
  kind,
  period,
  title,
}: {
  kind: 'weekly' | 'financeChanges';
  period?: string;
  title: string;
}) {
  const status = useRpc('ai.status');
  const insight = useRpc('ai.insight', { kind, period });
  const generate = useRpcMutation('ai.insight.generate');

  if (!status.data) return null;
  if (!status.data.provider) {
    return (
      <Card>
        <CardHeader icon={Sparkles} title={title} />
        <p className="text-sm text-muted">
          A IA é opcional. Escolha um modelo, local ou com a sua chave, em{' '}
          <Link to="/ajustes" search={{ secao: 'ia' } as never} className="text-primary underline">
            Ajustes › IA
          </Link>
          .
        </p>
      </Card>
    );
  }
  if (insight.isError) {
    return (
      <Card>
        <CardHeader icon={Sparkles} title={title} />
        <p className="text-sm text-muted">{insight.error.message}</p>
      </Card>
    );
  }

  const data = insight.data;
  const ready = status.data.ready;
  return (
    <Card>
      <CardHeader
        icon={Sparkles}
        title={title}
        action={
          ready && data && !data.empty ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={generate.isPending}
              onClick={() => generate.mutate({ kind, period: data.period })}
            >
              <RefreshCw size={12} className={generate.isPending ? 'animate-spin' : undefined} />
              {generate.isPending ? 'Pensando…' : data.text ? 'Atualizar' : 'Gerar'}
            </Button>
          ) : null
        }
      />
      {!ready ? (
        <p className="text-sm text-muted">
          Falta terminar a configuração em{' '}
          <Link to="/ajustes" search={{ secao: 'ia' } as never} className="text-primary underline">
            Ajustes › IA
          </Link>
          .
        </p>
      ) : data?.empty ? (
        <p className="text-sm text-muted">Nenhuma área liberada para a IA tem dados aqui.</p>
      ) : data?.text ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed">
            <AiText text={data.text} />
          </p>
          <p className="text-xs text-subtle">
            Gerado pela IA em {when(data.createdAt!)}.
            {data.stale ? ' Os dados mudaram desde então.' : ''}
          </p>
        </div>
      ) : (
        <p className="text-sm text-muted">
          {generate.isPending ? 'A IA está lendo os seus números…' : 'Peça um resumo quando quiser.'}
        </p>
      )}
    </Card>
  );
}
