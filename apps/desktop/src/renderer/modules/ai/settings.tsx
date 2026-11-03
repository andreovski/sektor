import { CircleCheck, CircleX, KeyRound } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, CardHeader, cn, Field, Input, SectionLabel, Select } from '../../ui';

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

function ModelCard({ status }: { status: Status }) {
  const update = useRpcMutation('ai.update');
  const accept = useRpcMutation('ai.acceptNotice');
  const setKey = useRpcMutation('ai.setKey');
  const test = useRpcMutation('ai.test');
  const ollama = useRpc('ai.ollamaModels');
  const [provider, setProvider] = useState<Provider | ''>(status.provider ?? '');
  const [model, setModel] = useState(status.model);
  const [baseUrl, setBaseUrl] = useState(status.baseUrl ?? '');
  const [notice, setNotice] = useState<Provider | null>(null);
  useEffect(() => {
    setProvider(status.provider ?? '');
    setModel(status.model);
    setBaseUrl(status.baseUrl ?? '');
  }, [status.provider, status.model, status.baseUrl]);

  const suggestions = provider
    ? provider === 'ollama' && ollama.data?.length
      ? ollama.data
      : status.suggestedModels[provider]
    : [];
  const areas = (Object.keys(status.areas) as Area[]).filter((a) => status.areas[a]);
  const save = () =>
    update.mutate(
      { provider: provider || null, model: model.trim(), baseUrl: provider === 'ollama' ? baseUrl : null },
      {
        onSuccess: (next) => {
          toast.success('Modelo salvo.');
          if (next.provider && !next.local && !next.noticeAccepted.includes(next.provider)) {
            setNotice(next.provider);
          }
        },
      }
    );
  const keyMissing = provider && provider !== 'ollama' && !status.keys[provider];
  const noticeMissing =
    status.provider && !status.local && !status.noticeAccepted.includes(status.provider);

  return (
    <Card className="flex flex-col gap-3">
      <Field label="Provedor">
        <Select
          value={provider}
          onChange={(event) => {
            setProvider(event.target.value as Provider | '');
            setModel('');
          }}
        >
          <option value="">Sem IA</option>
          {(Object.keys(PROVIDER_INFO) as Provider[]).map((p) => (
            <option key={p} value={p}>
              {PROVIDER_INFO[p].label}
            </option>
          ))}
        </Select>
      </Field>
      {provider && <p className="-mt-1 text-xs text-subtle">{PROVIDER_INFO[provider].hint}</p>}
      {provider && (
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
      )}
      {provider === 'ollama' && (
        <Field label="Endereço do Ollama">
          <Input
            value={baseUrl}
            placeholder={status.ollamaUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </Field>
      )}
      {provider === 'ollama' && ollama.data && ollama.data.length === 0 && (
        <p className="text-xs text-warning">
          Não achei o Ollama neste endereço, ou ele não tem modelo baixado.
        </p>
      )}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={update.isPending || (Boolean(provider) && !model.trim())}
          onClick={save}
        >
          Salvar
        </Button>
        {status.provider && (
          <Button
            disabled={test.isPending || !status.ready}
            onClick={() =>
              test.mutate(undefined, {
                onSuccess: (result) =>
                  result.json
                    ? toast.success(`Funcionou em ${(result.ms / 1000).toFixed(1).replace('.', ',')} s: “${result.text}”`)
                    : toast.warning(
                        `Respondeu (“${result.text}”), mas não devolveu JSON válido. Insights funcionam; a categoria do banco não.`
                      ),
              })
            }
          >
            {test.isPending ? 'Testando…' : 'Testar o modelo'}
          </Button>
        )}
      </div>
      {provider && provider !== 'ollama' && (
        <KeyField
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
      )}
      {(keyMissing || noticeMissing) && status.provider === provider && (
        <div className="flex items-center gap-2 text-xs text-warning">
          {keyMissing ? 'Falta a chave.' : 'Falta aceitar o aviso de privacidade.'}
          {noticeMissing && !keyMissing && (
            <Button size="sm" onClick={() => setNotice(status.provider)}>
              Ver aviso
            </Button>
          )}
        </div>
      )}
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

function AreasCard({ status }: { status: Status }) {
  const update = useRpcMutation('ai.update');
  return (
    <Card className="flex flex-col">
      <CardHeader title="O que a IA pode ler" />
      {status.local ? (
        <p className="text-sm text-muted">
          Com o modelo local, nada sai deste computador e a IA lê todas as áreas.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-subtle">
            Vale para modelos na nuvem. Saúde e Diário começam desligados.
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
            { onSuccess: () => toast.success(key ? 'Chave do Jev guardada.' : 'Chave do Jev removida.') }
          )
        }
      />
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
      <ModelCard status={status.data} />
      {status.data.provider && (
        <>
          <AreasCard status={status.data} />
          <BankCard status={status.data} />
          <LogCard status={status.data} />
        </>
      )}
    </div>
  );
}
