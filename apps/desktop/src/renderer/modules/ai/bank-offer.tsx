import { Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card } from '../../ui';

import { PROVIDER_INFO } from './shared';

/**
 * Na revisão do banco: na primeira vez com IA pronta, pergunta se ela deve sugerir categorias;
 * ligada, oferece rodar agora nos que ainda não passaram por ela.
 */
export function AiCategoryOffer() {
  const status = useRpc('ai.status');
  const update = useRpcMutation('ai.update');
  const run = useRpcMutation('ai.bankCategory.run');
  const data = status.data;
  const use = data?.resolved.bankCategory;
  const model = data?.models.find((m) => m.id === use?.modelId);
  if (!data || !use || !model || !use.ready || data.bankPending === 0) return null;
  if (!use.areas.includes('finance')) return null;

  const suggest = () =>
    run.mutate(undefined, {
      onSuccess: ({ suggested }) =>
        toast.success(
          suggested ? `A IA sugeriu ${suggested} categoria(s).` : 'A IA não teve certeza de nenhuma categoria.'
        ),
    });

  if (data.bankCategory === 'ask') {
    return (
      <Card className="flex items-start gap-3">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-primary" />
        <div className="flex flex-1 flex-col gap-2 text-sm">
          <p>
            Quer que a IA sugira a categoria do que o histórico não reconheceu? São {data.bankPending}{' '}
            agora.{' '}
            {use.local
              ? data.jevReady
                ? 'O modelo é local, mas a descrição e o valor vão para o Jev conferir.'
                : 'O modelo é local: nada sai daqui.'
              : `A descrição e o valor vão para o ${PROVIDER_INFO[model.provider].label}${data.jevReady ? ' e para o Jev' : ''}.`}{' '}
            É sempre sugestão; dá para mudar depois em Ajustes › IA.
          </p>
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={update.isPending || run.isPending}
              onClick={() => update.mutate({ bankCategory: 'on' }, { onSuccess: suggest })}
            >
              Ligar
            </Button>
            <Button size="sm" disabled={update.isPending} onClick={() => update.mutate({ bankCategory: 'off' })}>
              Agora não
            </Button>
          </div>
        </div>
      </Card>
    );
  }
  if (data.bankCategory !== 'on') return null;
  return (
    <Card className="flex items-center gap-3">
      <Sparkles size={16} className="shrink-0 text-primary" />
      <p className="flex-1 text-sm text-muted">
        {data.bankPending} lançamento(s) sem categoria ainda não passaram pela IA.
      </p>
      <Button size="sm" disabled={run.isPending} onClick={suggest}>
        {run.isPending ? 'Pensando…' : 'Sugerir agora'}
      </Button>
    </Card>
  );
}
