import {
  ArrowDownToLine,
  Copy,
  CreditCard,
  Hash,
  Inbox,
  KeyRound,
  Landmark,
  LockKeyhole,
  type LucideIcon,
  Plug,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Unplug,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { money, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, Dialog, Field, Input, SectionLabel, Select } from '../../ui';
import { ConfirmDialog, Skeleton, useAccounts } from './parts';
import { type Account, addDays, ago, type BankAccount, type BankItem, type BankStatus } from './utils';

const DEFAULT_IMPORT_DAYS = 30;

const NOTICE: { title: string; text: string; icon: LucideIcon }[] = [
  {
    title: 'Sem acesso direto ao banco',
    text: 'O Sektor não se conecta ao seu banco e nunca vê sua senha. A conexão é feita por você no Meu Pluggy, pelo Open Finance.',
    icon: Landmark,
  },
  {
    title: 'O Meu Pluggy só repassa',
    text: 'Em modo de leitura, as contas, os saldos e os lançamentos que você autorizou, pela aplicação que você criou na Pluggy, com as suas chaves.',
    icon: ArrowDownToLine,
  },
  {
    title: 'Tudo fica neste computador',
    text: 'Os dados vão para o banco de dados cifrado do Sektor. Só a Pluggy recebe pedidos, e só com as suas chaves.',
    icon: LockKeyhole,
  },
  {
    title: 'Você decide quando parar',
    text: 'Remova um banco ou as chaves quando quiser, e revogue o acesso no Meu Pluggy ou no app do banco.',
    icon: Unplug,
  },
];

const STEPS: { title: string; text: string; link?: string }[] = [
  {
    title: 'Vincule os bancos no Meu Pluggy',
    text: 'Crie sua conta e conecte seus bancos pelo Open Finance. É de graça para as suas próprias contas, até 5 bancos.',
    link: 'https://meu.pluggy.ai',
  },
  {
    title: 'Crie uma aplicação na Pluggy',
    text: 'Crie a conta de desenvolvedor e uma aplicação. Em Dados Financeiros › Customização, deixe o conector MeuPluggy na lista. O aviso de teste de 15 dias não vale para o Meu Pluggy, que continua grátis.',
    link: 'https://dashboard.pluggy.ai',
  },
  {
    title: 'Copie as chaves',
    text: 'Na página da aplicação, copie o Client ID e o Client Secret e cole aqui embaixo.',
  },
  {
    title: 'Adicione cada banco pelo ID do item',
    text: 'No painel da Pluggy, cada banco conectado aparece com um ID. Cole-o aqui, um por banco, e escolha onde cada conta entra.',
  },
];

/** Endereço para copiar: o app não abre navegador externo por conta própria. */
function CopyLink({ href }: { href: string }) {
  return (
    <button
      type="button"
      onClick={() => navigator.clipboard.writeText(href).then(() => toast.success('Endereço copiado.'))}
      className="mt-1 inline-flex items-center gap-1.5 font-mono text-xs text-primary"
    >
      {href.replace('https://', '')} <Copy size={12} />
    </button>
  );
}

function NoticeList() {
  return (
    <div className="flex flex-col gap-3">
      {NOTICE.map(({ title, text, icon: Icon }) => (
        <div key={title} className="flex gap-3">
          <Icon size={16} className="mt-0.5 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-medium">{title}</p>
            <p className="text-sm text-muted">{text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function BanksPanel() {
  const status = useRpc('bank.status');
  const accept = useRpcMutation('bank.acceptNotice');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const data = status.data;

  if (!data) return <Skeleton className="h-40" />;
  if (!data.noticeAcceptedAt) {
    return (
      <Card className="max-w-xl">
        <h3 className="mb-3 flex items-center gap-2 font-medium">
          <ShieldCheck size={18} className="text-primary" /> Como seus dados de banco chegam aqui
        </h3>
        <NoticeList />
        <Button
          variant="primary"
          className="mt-4"
          disabled={accept.isPending}
          onClick={() => accept.mutate(undefined)}
        >
          Entendi
        </Button>
      </Card>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {data.configured ? <Connected data={data} /> : <Setup />}
      <button
        type="button"
        onClick={() => setNoticeOpen(true)}
        className="mx-auto flex items-center gap-1.5 text-xs text-primary"
      >
        <ShieldCheck size={14} /> Como seus dados de banco chegam aqui
      </button>
      <Dialog open={noticeOpen} onOpenChange={setNoticeOpen} title="Privacidade">
        <NoticeList />
      </Dialog>
    </div>
  );
}

function Setup() {
  return (
    <div className="grid grid-cols-2 items-start gap-4">
      <Card>
        <SectionLabel>Passo a passo</SectionLabel>
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-xs font-medium text-primary">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{step.title}</p>
                <p className="text-sm text-muted">{step.text}</p>
                {step.link && <CopyLink href={step.link} />}
              </div>
            </li>
          ))}
        </ol>
      </Card>
      <Card>
        <SectionLabel>Chaves da Pluggy</SectionLabel>
        <KeysForm />
      </Card>
    </div>
  );
}

function KeysForm({ onSaved }: { onSaved?(): void }) {
  const save = useRpcMutation('bank.saveCredentials');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <Field label="Client ID">
        <Input
          autoComplete="off"
          spellCheck={false}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        />
      </Field>
      <Field label="Client Secret">
        <Input
          type="password"
          autoComplete="off"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
        />
      </Field>
      <p className="text-xs text-subtle">
        O Client Secret fica cifrado neste computador e não volta para a tela.
      </p>
      <Button
        variant="primary"
        disabled={save.isPending || !clientId.trim() || !clientSecret.trim()}
        onClick={() =>
          save.mutateAsync({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }).then(() => {
            toast.success('Chaves salvas. Agora adicione um banco.');
            setClientSecret('');
            onSaved?.();
          }, () => {})
        }
      >
        Salvar chaves
      </Button>
    </div>
  );
}

function Connected({ data }: { data: BankStatus }) {
  const accounts = useAccounts();
  const sync = useRpcMutation('bank.sync');
  const removeKeys = useRpcMutation('bank.removeCredentials');
  const removeItem = useRpcMutation('bank.removeItem');
  const [linking, setLinking] = useState<BankAccount | null>(null);
  const [sheet, setSheet] = useState<'item' | 'keys' | 'remove' | null>(null);
  const [removing, setRemoving] = useState<BankItem | null>(null);

  return (
    <>
      <Card className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Pluggy conectada</p>
          <p className="text-xs text-subtle">
            Sincronizado {ago(data.syncedAt)}
            {data.pendingCount > 0 && ` · ${data.pendingCount} a revisar`}
          </p>
        </div>
        <Button disabled title="O widget ainda não entrou no app">
          <Plug size={14} /> Conectar pelo widget (em breve)
        </Button>
        <Button onClick={() => setSheet('item')}>
          <Hash size={14} /> Adicionar pelo ID do item
        </Button>
        <Button
          variant="primary"
          disabled={sync.isPending || data.items.length === 0}
          onClick={() => sync.mutate(undefined)}
        >
          <RefreshCw size={14} className={sync.isPending ? 'animate-spin' : undefined} />
          Sincronizar
        </Button>
      </Card>

      {data.lastError && (
        <div className="flex items-center gap-3 rounded-panel border border-warning/30 bg-warning/10 p-4 text-sm">
          <TriangleAlert size={16} className="shrink-0 text-warning" />
          <div>
            <p className="font-medium">A última sincronização falhou</p>
            <p className="text-muted">{data.lastError}</p>
          </div>
        </div>
      )}

      {data.items.length === 0 && (
        <Card>
          <p className="flex items-center gap-2 text-sm text-muted">
            <Inbox size={16} /> Nenhum banco ainda. Adicione pelo ID do item que aparece no painel da Pluggy.
          </p>
        </Card>
      )}

      {data.items.map((item) => (
        <Card key={item.id}>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-sm font-medium">{item.name}</h3>
            <span className="text-xs text-subtle">
              {item.lastError ?? `Atualizado ${ago(item.syncedAt)}. O Meu Pluggy lê o banco uma vez por dia.`}
            </span>
            <Button size="sm" variant="danger" className="ml-auto" onClick={() => setRemoving(item)}>
              Remover
            </Button>
          </div>
          {item.accounts.length === 0 && (
            <p className="text-sm text-muted">Nenhuma conta neste banco ainda. Sincronize mais tarde.</p>
          )}
          {item.accounts.map((account) => {
            const Icon = account.type === 'CREDIT' ? CreditCard : Landmark;
            return (
              <button
                key={account.id}
                type="button"
                onClick={() => setLinking(account)}
                className="flex h-[52px] w-full items-center gap-3 rounded-control px-2 text-left hover:bg-hover"
              >
                <Icon size={16} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{account.name}</span>
                  <span className="block truncate text-xs text-subtle">
                    {[
                      `${account.type === 'CREDIT' ? 'Fatura' : 'Saldo'} ${money(account.balanceCents)}`,
                      account.number,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <span className="text-sm text-muted">
                  {accounts.find((a) => a.id === account.accountId)?.name ?? 'Não importar'}
                </span>
              </button>
            );
          })}
        </Card>
      ))}

      <Card className="flex items-center gap-3">
        <KeyRound size={16} className="text-muted" />
        <p className="flex-1 font-mono text-xs text-muted">{data.clientId?.slice(0, 8)}…</p>
        <Button size="sm" onClick={() => setSheet('keys')}>
          Trocar chaves
        </Button>
        <Button size="sm" variant="danger" onClick={() => setSheet('remove')}>
          Desconectar a Pluggy
        </Button>
      </Card>

      {linking && (
        <LinkDialog
          account={linking}
          accounts={accounts.filter((a) => !a.archived)}
          linkedIds={data.items
            .flatMap((i) => i.accounts)
            .filter((a) => a.id !== linking.id)
            .map((a) => a.accountId)}
          onClose={() => setLinking(null)}
        />
      )}
      {sheet === 'item' && <ItemDialog onClose={() => setSheet(null)} />}
      <Dialog
        open={sheet === 'keys'}
        onOpenChange={(open) => setSheet(open ? 'keys' : null)}
        title="Chaves da Pluggy"
      >
        <KeysForm onSaved={() => setSheet(null)} />
      </Dialog>
      <ConfirmDialog
        open={sheet === 'remove'}
        onOpenChange={(open) => setSheet(open ? 'remove' : null)}
        title="Desconectar a Pluggy?"
        message="As chaves e os bancos saem do Sektor. Os lançamentos já importados continuam."
        actions={[{ label: 'Desconectar', danger: true, onSelect: () => removeKeys.mutate(undefined) }]}
      />
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={`Remover ${removing?.name ?? 'banco'}?`}
        message="Ele para de trazer lançamentos. Os já importados continuam."
        actions={[
          { label: 'Remover banco', danger: true, onSelect: () => removeItem.mutate({ id: removing!.id }) },
        ]}
      />
    </>
  );
}

const NEW = 'new';

function LinkDialog({
  account,
  accounts,
  linkedIds,
  onClose,
}: {
  account: BankAccount;
  accounts: Account[];
  linkedIds: (string | null)[];
  onClose(): void;
}) {
  const link = useRpcMutation('bank.linkAccount');
  const isCard = account.type === 'CREDIT';
  const today = todayString();
  const [target, setTarget] = useState(account.accountId ?? '');
  const [importFrom, setImportFrom] = useState(account.importFrom ?? addDays(today, -DEFAULT_IMPORT_DAYS));
  const options = accounts
    .filter((a) => (isCard ? a.type === 'CREDIT_CARD' : a.type !== 'CREDIT_CARD'))
    .filter((a) => !linkedIds.includes(a.id));

  function confirm() {
    if (target === (account.accountId ?? '') && importFrom === account.importFrom) return onClose();
    const body =
      target === ''
        ? { accountId: null }
        : target === NEW
          ? { create: true, importFrom }
          : { accountId: target, importFrom };
    link.mutateAsync({ id: account.id, ...body }).then((status) => {
      if (target) {
        const count = status.pendingCount;
        toast.success(count ? `Pronto. ${count} lançamento(s) esperando revisão.` : 'Pronto.');
      }
      onClose();
    }, () => {});
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title={account.name}>
      <div className="flex flex-col gap-3">
        <Field label="Entra em">
          <Select value={target} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Não importar</option>
            <option value={NEW}>{isCard ? 'Criar cartão novo' : 'Criar conta nova'}</option>
            {options.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {target !== '' && (
          <Field label="Importar desde">
            <Input
              type="date"
              value={importFrom}
              max={today}
              onChange={(event) => event.target.value && setImportFrom(event.target.value)}
            />
          </Field>
        )}
        <p className="text-xs text-subtle">
          {target === NEW
            ? isCard
              ? 'O cartão nasce com o fechamento e o vencimento que o banco informa.'
              : 'A conta nasce com um saldo inicial que, depois da revisão, deixa o saldo igual ao do banco.'
            : 'O que você já lançou (mesmo valor, até 4 dias de diferença) não se repete. O resto aparece em Revisar.'}
        </p>
        {link.isPending && <p className="text-xs text-muted">Lendo os lançamentos do banco…</p>}
        <Button variant="primary" className="ml-auto" disabled={link.isPending} onClick={confirm}>
          Salvar
        </Button>
      </div>
    </Dialog>
  );
}

function ItemDialog({ onClose }: { onClose(): void }) {
  const add = useRpcMutation('bank.addItem');
  const [itemId, setItemId] = useState('');
  const valid = /^[0-9a-f-]{36}$/i.test(itemId.trim());
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Adicionar pelo ID do item">
      <div className="flex flex-col gap-3">
        <Field label="ID do item">
          <Input
            autoFocus
            autoComplete="off"
            spellCheck={false}
            placeholder="1a2b3c4d-…"
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
          />
        </Field>
        <p className="text-xs text-subtle">
          No painel da Pluggy, depois de conectar o banco pelo Meu Pluggy, o item aparece com um ID.
        </p>
        <Button
          variant="primary"
          className="ml-auto"
          disabled={add.isPending || !valid}
          onClick={() =>
            add.mutateAsync({ itemId: itemId.trim() }).then(() => {
              toast.success('Banco adicionado. Agora escolha onde cada conta entra.');
              onClose();
            }, () => {})
          }
        >
          Adicionar
        </Button>
      </div>
    </Dialog>
  );
}
