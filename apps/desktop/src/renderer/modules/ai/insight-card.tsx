import { Link } from '@tanstack/react-router';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, CardHeader, Select } from '../../ui';

import { AiText, PROVIDER_INFO } from './shared';

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
  const [chosen, setChosen] = useState('');

  if (!status.data) return null;
  if (status.data.models.length === 0) {
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
  const models = status.data.models;
  // O modelo escolhido aqui vale só para este clique; sem escolha, o do uso nos Ajustes.
  const modelId = chosen || status.data.resolved[kind].modelId;
  const model = models.find((m) => m.id === modelId);
  const ready = Boolean(model && !model.problem);
  return (
    <Card>
      <CardHeader
        icon={Sparkles}
        title={title}
        action={
          data && !data.empty ? (
            <div className="flex items-center gap-1">
              {models.length > 1 && (
                <Select
                  aria-label="Modelo"
                  className="h-7 w-auto py-0 text-xs"
                  value={modelId ?? ''}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {PROVIDER_INFO[m.provider].short} · {m.model}
                    </option>
                  ))}
                </Select>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={generate.isPending || !ready}
                onClick={() => generate.mutate({ kind, period: data.period, modelId })}
              >
                <RefreshCw size={12} className={generate.isPending ? 'animate-spin' : undefined} />
                {generate.isPending ? 'Pensando…' : data.text ? 'Atualizar' : 'Gerar'}
              </Button>
            </div>
          ) : null
        }
      />
      {!ready ? (
        <p className="text-sm text-muted">
          {(model?.problem ?? 'Escolha um modelo em Ajustes › IA.').replace(' em Ajustes › IA.', '.')}{' '}
          <Link to="/ajustes" search={{ secao: 'ia' } as never} className="text-primary underline">
            Abrir Ajustes › IA
          </Link>
        </p>
      ) : data?.empty ? (
        <p className="text-sm text-muted">Nenhuma área liberada para a IA tem dados aqui.</p>
      ) : data?.text ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed">
            <AiText text={data.text} />
          </p>
          <p className="text-xs text-subtle">
            Gerado por {data.model} em {when(data.createdAt!)}.
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
