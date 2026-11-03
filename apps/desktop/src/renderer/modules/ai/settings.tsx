import { CircleCheck, CircleX, KeyRound } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, CardHeader, cn, Field, Input, SectionLabel, Select } from '../../ui';
import { Pill } from '../finance/parts';

import { type Area, AREA_LABELS, NoticeDialog, type Provider, PROVIDER_INFO } from './shared';

type Status = NonNullable<ReturnType<typeof useRpc<'ai.status'>>['data']>;

const FEATURES: Record<string, string> = {
  'insight.weekly': 'Resumo da semana',
  'insight.financeChanges': 'O que mudou nas finanças',
  'bank.category': 'Categoria na revisão do banco',
  'bank.category.jev': 'Conferência do Jev',
  'test.text': 'Teste do modelo',
  'test.json': 'Teste do modelo (JSON)',
};

const when = (at: number) =>
  new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(at);

const dollars = (micros: number | null) =>
  micros === null
    ? 'preço desconhecido'
    : micros === 0
      ? 'grátis'
      : `US$ ${(micros / 1_000_000).toFixed(4).replace('.', ',')}`;

function Toggle({
  checked,
  disabled,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  hint?: string;
  onChange(value: boolean): void;
}) {
  return (
    <label className={cn('flex items-start gap-2 py-1 text-sm', disabled && 'opacity-60')}>
      <input
        type="checkbox"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-subtle">{hint}</span>}
      </span>
    </label>
  );
}

function KeyField({
  label,
  saved,
  url,
  onSave,
  pending,
}: {
  label: string;
  saved: boolean;
  url: string | null;
  onSave(key: string | null): void;
  pending: boolean;
}) {
  const [key, setKey] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <Field label={label}>
        <div className="flex gap-2">
          <Input
            type="password"
            autoComplete="off"
            placeholder={saved ? 'Guardada no cofre do sistema' : 'Cole a chave aqui'}
            value={key}
            onChange={(event) => setKey(event.target.value)}
          />
          <Button
            disabled={!key.trim() || pending}
            onClick={() => {
              onSave(key.trim());
              setKey('');
            }}
          >
            Salvar
          </Button>
          {saved && (
            <Button variant="ghost" disabled={pending} onClick={() => onSave(null)}>
              Remover
            </Button>
          )}
        </div>
      </Field>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="text-xs text-primary underline">
          Onde pegar a chave
        </a>
      )}
    </div>
  );
}

type ModelRow = Status['models'][number];

export const modelLabel = (model: Pick<ModelRow, 'provider' | 'model'>) =>
  `${PROVIDER_INFO[model.provider].short} · ${model.model}`;

function useTestModel() {
  const test = useRpcMutation('ai.test');
  const run = (id: string) =>
    test.mutate(
      { id },
      {
        onSuccess: (result) =>
          result.json
            ? toast.success(
                `Funcionou em ${(result.ms / 1000).toFixed(1).replace('.', ',')} s: “${result.text}”`
              )
            : toast.warning(
                `Respondeu (“${result.text}”), mas não devolveu JSON válido. Insights funcionam; a categoria do banco não.`
              ),
      }
    );
  return { run, pending: test.isPending ? test.variables?.id : null };
}

function ModelsCard({ status }: { status: Status }) {
  const remove = useRpcMutation('ai.models.remove');
  const setDefault = useRpcMutation('ai.models.setDefault');
  const accept = useRpcMutation('ai.acceptNotice');
  const test = useTestModel();
  const [notice, setNotice] = useState<Provider | null>(null);
  const areas = (Object.keys(status.areas) as Area[]).filter((a) => status.areas[a]);

  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title="Modelos" action={status.models.length ? `${status.models.length} na lista` : undefined} />
      {status.models.length === 0 && (
        <p className="text-sm text-muted">
          Nenhum modelo ainda. Adicione um local, um com a sua chave, ou os dois.
        </p>
      )}
      <ul className="flex flex-col divide-y divide-line">
        {status.models.map((model) => {
          const isDefault = model.id === status.defaultModelId;
          const needsNotice = model.problem?.includes('aviso');
          return (
            <li key={model.id} className="flex flex-col gap-1.5 py-2">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">{modelLabel(model)}</span>
                {model.local && <Pill tone="success">Local</Pill>}
                {isDefault && <Pill tone="info">Padrão</Pill>}
              </div>
              {model.baseUrl && <span className="text-xs text-subtle">{model.baseUrl}</span>}
              {model.problem && (
                <div className="flex items-center gap-2 text-xs text-warning">
                  {model.problem.replace(' em Ajustes › IA', '')}
                  {needsNotice && (
                    <Button size="sm" onClick={() => setNotice(model.provider)}>
                      Ver aviso
                    </Button>
                  )}
                </div>
              )}
              <div className="flex gap-1">
                <Button
                  size="sm"
                  disabled={Boolean(model.problem) || test.pending === model.id}
                  onClick={() => test.run(model.id)}
                >
                  {test.pending === model.id ? 'Testando…' : 'Testar'}
                </Button>
                {!isDefault && (
                  <Button size="sm" variant="ghost" onClick={() => setDefault.mutate({ id: model.id })}>
                    Tornar padrão
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: model.id })}
                >
                  Remover
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
      <AddModel
        status={status}
        onAdded={(model) => {
          if (!model.local && !status.noticeAccepted.includes(model.provider)) setNotice(model.provider);
        }}
      />
      {notice && (
        <NoticeDialog
          provider={notice}
          areas={areas}
          onClose={() => setNotice(null)}
          onAccept={() => accept.mutate({ provider: notice }, { onSuccess: () => setNotice(null) })}
        />
      )}
    </Card>
  );
}

function AddModel({ status, onAdded }: { status: Status; onAdded(model: ModelRow): void }) {
  const add = useRpcMutation('ai.models.add');
  const [provider, setProvider] = useState<Provider>('ollama');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const available = useRpc('ai.providerModels', {
    provider,
    baseUrl: provider === 'ollama' ? baseUrl || null : null,
  });
  const taken = new Set(status.models.filter((m) => m.provider === provider).map((m) => m.model));
  const suggestions = (available.data ?? status.suggestedModels[provider]).filter((name) => !taken.has(name));

  return (
    <div className="flex flex-col gap-2 rounded-control border border-line p-3">
      <SectionLabel>Adicionar modelo</SectionLabel>
      <Field label="Provedor">
        <Select
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as Provider);
            setModel('');
          }}
        >
          {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_INFO[p].label}
            </option>
          ))}
        </Select>
      </Field>
      <p className="-mt-1 text-xs text-subtle">{PROVIDER_INFO[provider].hint}</p>
      <Field label="Modelo">
        <Input
          list="ai-models"
          value={model}
          placeholder={suggestions[0] ?? 'nome do modelo'}
          onChange={(event) => setModel(event.target.value)}
        />
        <datalist id="ai-models">
          {suggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </Field>
      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {suggestions.slice(0, 8).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setModel(name)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-xs transition-colors',
                model === name ? 'border-primary text-primary' : 'border-line-strong text-muted hover:bg-hover'
              )}
            >
              {name}
            </button>
          ))}
        </div>
      )}
      {provider === 'ollama' && (
        <>
          <Field label="Endereço do Ollama">
            <Input
              value={baseUrl}
              placeholder={status.ollamaUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </Field>
          {available.data && available.data.length === 0 && (
            <p className="text-xs text-warning">
              Não achei o Ollama neste endereço, ou ele não tem modelo baixado.
            </p>
          )}
        </>
      )}
      <div>
        <Button
          variant="primary"
          disabled={add.isPending || !model.trim()}
          onClick={() =>
            add.mutate(
              { provider, model: model.trim(), baseUrl: provider === 'ollama' ? baseUrl : null },
              {
                onSuccess: (next) => {
                  toast.success('Modelo adicionado.');
                  setModel('');
                  const added = next.models.find((m) => m.id === next.added);
                  if (added) onAdded(added);
                },
              }
            )
          }
        >
          Adicionar
        </Button>
      </div>
    </div>
  );
}

function KeysCard({ status }: { status: Status }) {
  const setKey = useRpcMutation('ai.setKey');
  const providers = [...new Set(status.models.map((m) => m.provider))].filter(
    (p): p is Exclude<Provider, 'ollama'> => p !== 'ollama'
  );
  if (providers.length === 0) return null;
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title="Chaves" action="no cofre do sistema" />
      {providers.map((provider) => (
        <KeyField
          key={provider}
          label={`Chave do ${PROVIDER_INFO[provider].label}`}
          saved={status.keys[provider]}
          url={PROVIDER_INFO[provider].keyUrl}
          pending={setKey.isPending}
          onSave={(key) =>
            setKey.mutate(
              { provider, key },
              { onSuccess: () => toast.success(key ? 'Chave guardada.' : 'Chave removida.') }
            )
          }
        />
      ))}
    </Card>
  );
}

const USE_LABELS: Record<keyof Status['resolved'], string> = {
  weekly: 'Resumo da semana',
  financeChanges: 'O que mudou nas finanças',
  bankCategory: 'Categoria na revisão do banco',
};

function UsesCard({ status }: { status: Status }) {
  const update = useRpcMutation('ai.update');
  const fallback = status.models.find((m) => m.id === status.defaultModelId);
  if (status.models.length < 2) return null;
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title="Qual modelo em cada lugar" />
      {(Object.keys(USE_LABELS) as (keyof Status['resolved'])[]).map((use) => (
        <Field key={use} label={USE_LABELS[use]}>
          <Select
            value={status.uses[use] ?? ''}
            onChange={(event) => update.mutate({ uses: { [use]: event.target.value || null } })}
          >
            <option value="">Padrão{fallback ? ` (${modelLabel(fallback)})` : ''}</option>
            {status.models.map((model) => (
              <option key={model.id} value={model.id}>
                {modelLabel(model)}
              </option>
            ))}
          </Select>
        </Field>
      ))}
      <p className="text-xs text-subtle">
        Nos insights, dá também para escolher outro modelo na hora de gerar.
      </p>
    </Card>
  );
}

function AreasCard({ status }: { status: Status }) {
  const update = useRpcMutation('ai.update');
  return (
    <Card className="flex flex-col">
      <CardHeader title="O que a IA pode ler" />
      {status.models.every((m) => m.local) ? (
        <p className="text-sm text-muted">
          Com o modelo local, nada sai deste computador e a IA lê todas as áreas.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-subtle">
            Vale para os modelos na nuvem; o local lê tudo. Saúde e Diário começam desligados.
          </p>
          {(Object.keys(AREA_LABELS) as Area[]).map((area) => (
            <Toggle
              key={area}
              label={AREA_LABELS[area]}
              checked={status.areas[area]}
              disabled={update.isPending}
              onChange={(value) => update.mutate({ areas: { [area]: value } })}
            />
          ))}
        </>
      )}
    </Card>
  );
}

function BankCard({ status }: { status: Status }) {
  const update = useRpcMutation('ai.update');
  const setKey = useRpcMutation('ai.setKey');
  const accept = useRpcMutation('ai.acceptNotice');
  const [notice, setNotice] = useState(false);
  const noticeMissing = status.jev && !status.noticeAccepted.includes('jev');
  return (
    <Card className="flex flex-col gap-3">
      <CardHeader title="Revisão do banco" />
      <Field label="Categoria sugerida pela IA">
        <Select
          value={status.bankCategory}
          onChange={(event) => update.mutate({ bankCategory: event.target.value as Status['bankCategory'] })}
        >
          <option value="ask">Perguntar na primeira vez</option>
          <option value="on">Ligada</option>
          <option value="off">Desligada</option>
        </Select>
      </Field>
      <p className="-mt-1 text-xs text-subtle">
        Só para o que o histórico não reconhece. É sempre sugestão: você confere antes de lançar.
      </p>
      <div className="flex items-center gap-2 text-sm">
        <KeyRound size={14} className="text-muted" /> Jev (TypeSafe), opcional
      </div>
      <p className="-mt-2 text-xs text-subtle">
        Confere a escolha do modelo com uma probabilidade e descarta a sugestão quando os dois discordam.
      </p>
      <KeyField
        label="Chave do Jev"
        saved={status.jev}
        url={null}
        pending={setKey.isPending}
        onSave={(key) =>
          setKey.mutate(
            { provider: 'jev', key },
            {
              onSuccess: (next) => {
                toast.success(key ? 'Chave do Jev guardada.' : 'Chave do Jev removida.');
                if (key && !next.noticeAccepted.includes('jev')) setNotice(true);
              },
            }
          )
        }
      />
      {noticeMissing && (
        <div className="flex items-center gap-2 text-xs text-warning">
          O Jev só entra depois do aviso de privacidade.
          <Button size="sm" onClick={() => setNotice(true)}>
            Ver aviso
          </Button>
        </div>
      )}
      {status.jev && !noticeMissing && !status.areas.finance && (
        <p className="text-xs text-warning">O Jev fica parado enquanto Finanças está desligada para a IA.</p>
      )}
      {notice && (
        <NoticeDialog
          provider="jev"
          areas={['finance']}
          onClose={() => setNotice(false)}
          onAccept={() => accept.mutate({ provider: 'jev' }, { onSuccess: () => setNotice(false) })}
        />
      )}
    </Card>
  );
}

function LogCard({ status }: { status: Status }) {
  const update = useRpcMutation('ai.update');
  const calls = useRpc('ai.calls', { limit: 20 });
  const data = calls.data;
  return (
    <Card className="flex flex-col gap-2">
      <CardHeader title="Registro" action="últimos 30 dias" />
      <Toggle
        label="Modo dev"
        hint="Mostra tokens e custo estimado de cada chamada."
        checked={status.devMode}
        onChange={(value) => update.mutate({ devMode: value })}
      />
      <Toggle
        label="Guardar o conteúdo enviado"
        hint="Para depurar. O texto fica só neste computador, no banco cifrado."
        checked={status.debug}
        onChange={(value) => update.mutate({ debug: value })}
      />
      {status.devMode && data && data.month.length > 0 && (
        <div className="rounded-control bg-sunken p-2 text-xs">
          <SectionLabel>Este mês</SectionLabel>
          {data.month.map((total) => (
            <p key={total.provider} className="tabular-nums">
              {total.provider}: {total.calls} chamada(s), {total.inputTokens} + {total.outputTokens} tokens,{' '}
              {dollars(total.costMicros)}
            </p>
          ))}
        </div>
      )}
      {data && data.rows.length === 0 && <p className="text-sm text-muted">Nenhuma chamada ainda.</p>}
      <ul className="flex flex-col divide-y divide-line">
        {data?.rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-0.5 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              {row.ok ? (
                <CircleCheck size={12} className="text-success" />
              ) : (
                <CircleX size={12} className="text-danger" />
              )}
              <span className="text-sm">{FEATURES[row.feature] ?? row.feature}</span>
              <span className="ml-auto text-subtle">{when(row.createdAt)}</span>
            </div>
            <span className="text-subtle">
              {row.provider} · {row.model}
              {row.areas.length ? ` · ${row.areas.map((a) => AREA_LABELS[a as Area] ?? a).join(', ')}` : ''}
              {status.devMode && row.inputTokens !== null
                ? ` · ${row.inputTokens} + ${row.outputTokens} tokens · ${dollars(row.costMicros)}`
                : ''}
            </span>
            {row.error && <span className="text-danger">{row.error}</span>}
            {row.content && (
              <pre className="max-h-32 overflow-auto rounded-control bg-sunken p-2 whitespace-pre-wrap">
                {row.content}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AiSettings() {
  const status = useRpc('ai.status');
  if (!status.data) return null;
  return (
    <div className="flex flex-col gap-4">
      <ModelsCard status={status.data} />
      {status.data.models.length > 0 && (
        <>
          <KeysCard status={status.data} />
          <UsesCard status={status.data} />
          <AreasCard status={status.data} />
          <BankCard status={status.data} />
          <LogCard status={status.data} />
        </>
      )}
    </div>
  );
}
