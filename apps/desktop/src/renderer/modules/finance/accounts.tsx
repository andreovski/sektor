import { Archive, ArchiveRestore, ArrowLeft, CreditCard, Pencil, Plus, Scale, Trash2, Wallet } from 'lucide-react';
import { useState } from 'react';

import { longDate, money, shortDate, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, Card, cn, Dialog, EmptyState, Field, Input, SectionLabel, Segmented, Select } from '../../ui';
import { CategoriesPanel } from './categories';
import { InvoicePanel } from './invoice';
import {
  accountDot,
  ColorPicker,
  ConfirmDialog,
  invoiceName,
  InvoicePill,
  Metric,
  MoneyInput,
  MonthSwitcher,
  Skeleton,
  TransactionRow,
  useAccounts,
  useCategories,
} from './parts';
import { useTransactionDialog } from './transaction-dialog';
import {
  type Account,
  ACCOUNT_TYPE_LABELS,
  type AccountType,
  type CardCheck,
  futureInvoiceIds,
  groupInvoices,
  type Invoice,
  monthOfDay,
} from './utils';

type Panel = 'accounts' | 'categories';

export function AccountsTab({ panel, onPanel }: { panel: Panel; onPanel(panel: Panel): void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const accounts = useAccounts();
  const account = accounts.find((a) => a.id === selected);

  if (account) {
    const back = () => setSelected(null);
    return account.type === 'CREDIT_CARD' ? (
      <CardScreen card={account} onBack={back} />
    ) : (
      <AccountScreen account={account} onBack={back} />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Segmented<Panel>
          value={panel}
          onChange={onPanel}
          options={[
            { value: 'accounts', label: 'Contas e cartões' },
            { value: 'categories', label: 'Categorias' },
          ]}
        />
      </div>
      {panel === 'accounts' && <AccountList onSelect={setSelected} />}
      {panel === 'categories' && <CategoriesPanel />}
    </div>
  );
}

function AccountList({ onSelect }: { onSelect(id: string): void }) {
  const query = useRpc('accounts.list', { archived: true });
  const all = query.data ?? [];
  const [creating, setCreating] = useState(false);
  const active = all.filter((a) => !a.archived);
  const plain = active.filter((a) => a.type !== 'CREDIT_CARD');
  const cards = active.filter((a) => a.type === 'CREDIT_CARD');
  const archived = all.filter((a) => a.archived);
  const available = plain.reduce((sum, a) => sum + a.balanceCents, 0);
  const owed = cards.reduce((sum, a) => sum + (a.unpaidInvoiceCents ?? 0), 0);
  const overdue = cards.reduce((sum, a) => sum + (a.overdueInvoiceCents ?? 0), 0);

  if (query.isPending) return <Skeleton className="h-40" />;
  return (
    <>
      <Card className="flex items-center gap-8">
        <Metric size="xl" label="Saldo nas contas" value={money(available)} tone={available < 0 ? 'danger' : undefined} />
        {cards.length > 0 && (
          <Metric
            label="Faturas a pagar"
            value={money(owed)}
            hint={overdue > 0 ? `${money(overdue)} vencidas` : undefined}
            tone={overdue > 0 ? 'danger' : undefined}
          />
        )}
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus size={14} /> Nova conta ou cartão
        </Button>
      </Card>
      {active.length === 0 && (
        <Card>
          <EmptyState icon={Wallet} title="Nenhuma conta" text="Crie uma conta ou um cartão para começar a lançar." />
        </Card>
      )}
      {plain.length > 0 && <AccountGroup title="Contas" list={plain} onSelect={onSelect} />}
      {cards.length > 0 && <AccountGroup title="Cartões" list={cards} onSelect={onSelect} />}
      {archived.length > 0 && <AccountGroup title="Arquivadas" list={archived} onSelect={onSelect} />}
      {creating && <AccountDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function AccountGroup({
  title,
  list,
  onSelect,
}: {
  title: string;
  list: Account[];
  onSelect(id: string): void;
}) {
  return (
    <section>
      <SectionLabel>{title}</SectionLabel>
      <div className="grid grid-cols-3 gap-4">
        {list.map((account) => {
          const isCard = account.type === 'CREDIT_CARD';
          const value = isCard ? (account.unpaidInvoiceCents ?? 0) : account.balanceCents;
          const overdue = account.overdueInvoiceCents ?? 0;
          return (
            <button
              key={account.id}
              type="button"
              onClick={() => onSelect(account.id)}
              className="rounded-panel border border-line bg-surface p-4 text-left shadow-card hover:border-line-strong"
            >
              <p className="mb-3 flex items-center gap-2 text-sm">
                <span className="size-2 rounded-full" style={{ backgroundColor: accountDot(account) }} />
                <span className="truncate">{account.name}</span>
              </p>
              <p className={cn('text-2xl font-semibold tabular-nums', value < 0 && 'text-danger')}>
                {money(value)}
              </p>
              <p className="text-xs text-subtle">
                {isCard
                  ? `${overdue > 0 ? `${money(overdue)} vencidas` : 'A pagar'} · fecha dia ${account.closingDay}, vence dia ${account.dueDay}`
                  : ACCOUNT_TYPE_LABELS[account.type]}
              </p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AccountActions({ account, onBack }: { account: Account; onBack(): void }) {
  const update = useRpcMutation('accounts.update');
  const remove = useRpcMutation('accounts.delete');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeft size={14} /> Contas
      </Button>
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: accountDot(account) }} />
        {account.name}
      </h2>
      <div className="ml-auto flex gap-2">
        <Button onClick={() => setEditing(true)}>
          <Pencil size={14} /> Editar
        </Button>
        <Button
          disabled={update.isPending}
          onClick={() => update.mutate({ id: account.id, archived: !account.archived })}
        >
          {account.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
          {account.archived ? 'Reativar' : 'Arquivar'}
        </Button>
        <Button variant="danger" aria-label="Apagar conta" onClick={() => setDeleting(true)}>
          <Trash2 size={14} />
        </Button>
      </div>
      {editing && <AccountDialog account={account} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Apagar ${account.name}?`}
        message="Só dá para apagar conta sem lançamentos. Com lançamentos, arquive."
        actions={[
          {
            label: 'Apagar',
            danger: true,
            onSelect: () => remove.mutateAsync({ id: account.id }).then(onBack, () => {}),
          },
        ]}
      />
    </div>
  );
}

function AccountScreen({ account, onBack }: { account: Account; onBack(): void }) {
  const dialog = useTransactionDialog();
  const accounts = useAccounts();
  const categories = useCategories();
  const [month, setMonth] = useState(monthOfDay(todayString()));
  const list = useRpc('transactions.list', { month, accountId: account.id });
  const scope = new Set([account.id]);
  return (
    <div className="flex flex-col gap-4">
      <AccountActions account={account} onBack={onBack} />
      <Card className="flex items-center gap-8">
        <Metric
          size="xl"
          label="Saldo"
          value={money(account.balanceCents)}
          tone={account.balanceCents < 0 ? 'danger' : undefined}
        />
        <Metric label="Com os previstos até hoje" value={money(account.expectedBalanceCents)} />
      </Card>
      <Card className="p-2">
        <div className="p-1">
          <MonthSwitcher month={month} onChange={setMonth} />
        </div>
        {list.isPending ? (
          <Skeleton className="h-24" />
        ) : list.data?.length ? (
          list.data.map((tx) => (
            <TransactionRow
              key={tx.id}
              tx={tx}
              accounts={accounts}
              categories={categories}
              scope={scope}
              showDate
              onClick={() => dialog.edit(tx)}
            />
          ))
        ) : (
          <EmptyState icon={Wallet} title="Nada neste mês" />
        )}
      </Card>
    </div>
  );
}

function CardScreen({ card, onBack }: { card: Account; onBack(): void }) {
  const invoices = useRpc('accounts.invoices', { id: card.id });
  const bank = useRpc('bank.status');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const list = invoices.data ?? [];
  const future = futureInvoiceIds(list);
  const current =
    list.find((i) => i.status === 'OPEN' && !future.has(i.id)) ?? groupInvoices(list)[0]?.items[0];
  const selected = list.find((i) => i.id === selectedId) ?? current;
  const linked = bank.data?.items.some((item) =>
    item.accounts.some((a) => a.accountId === card.id && a.type === 'CREDIT')
  );

  return (
    <div className="flex flex-col gap-4">
      <AccountActions account={card} onBack={onBack} />
      <Card className="flex items-center gap-8">
        <Metric
          size="xl"
          label="Fatura atual"
          value={money(current?.totalCents ?? 0)}
          hint={current ? `Vence em ${longDate(current.dueDate)}` : undefined}
        />
        <Metric label="Fechamento" value={`Dia ${card.closingDay}`} />
        <Metric label="Vencimento" value={`Dia ${card.dueDay}`} />
        {linked && (
          <Button className="ml-auto" onClick={() => setChecking(true)}>
            <Scale size={14} /> Conferir com o banco
          </Button>
        )}
      </Card>
      {invoices.isPending ? (
        <Skeleton className="h-40" />
      ) : list.length === 0 ? (
        <Card>
          <EmptyState icon={CreditCard} title="Nenhuma fatura" text="As faturas nascem com as compras do cartão." />
        </Card>
      ) : (
        <div className="grid grid-cols-[2fr_3fr] items-start gap-4">
          <Card className="p-2">
            {groupInvoices(list).map((group) => (
              <div key={group.title} className="p-1">
                <SectionLabel>{group.title}</SectionLabel>
                {group.items.map((invoice) => (
                  <InvoiceRow
                    key={invoice.id}
                    invoice={invoice}
                    future={future.has(invoice.id)}
                    active={invoice.id === selected?.id}
                    onClick={() => setSelectedId(invoice.id)}
                  />
                ))}
              </div>
            ))}
          </Card>
          <Card>
            {selected && (
              <InvoicePanel key={selected.id} invoice={selected} future={future.has(selected.id)} />
            )}
          </Card>
        </div>
      )}
      {checking && <BankCheckDialog accountId={card.id} onClose={() => setChecking(false)} />}
    </div>
  );
}

function InvoiceRow({
  invoice,
  future,
  active,
  onClick,
}: {
  invoice: Invoice;
  future: boolean;
  active: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active}
      className={cn(
        'flex h-[52px] w-full items-center gap-2 rounded-control px-2 text-left hover:bg-hover',
        active && 'bg-active'
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{invoiceName(invoice)}</span>
        <span className="block text-xs text-subtle">Vence em {shortDate(invoice.dueDate)}</span>
      </span>
      <InvoicePill status={invoice.status} future={future} />
      <span className="text-sm font-medium tabular-nums">{money(invoice.totalCents)}</span>
    </button>
  );
}

function bankLine(bill: CardCheck['bills'][number]) {
  const total = `Banco ${money(bill.bankTotalCents)}`;
  if (bill.bankPaidCents >= bill.bankTotalCents && bill.bankPaidCents > 0) {
    return `${total} · paga${bill.bankPaidOn ? ` em ${shortDate(bill.bankPaidOn)}` : ''}`;
  }
  if (bill.bankPaidCents > 0) return `${total} · pagou ${money(bill.bankPaidCents)}`;
  return `${total} · sem pagamento informado`;
}

/** Montado só ao abrir: lê a Pluggy na hora. */
function BankCheckDialog({ accountId, onClose }: { accountId: string; onClose(): void }) {
  const check = useRpc('bank.cardCheck', { accountId });
  const data = check.data;
  const diff = data ? data.usedCents - data.openCents : 0;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} title="Conferir com o banco">
      {check.isError && (
        <p className="text-sm text-muted">Não deu para ler o banco agora. Tente de novo em alguns minutos.</p>
      )}
      {check.isPending && <Skeleton className="h-40" />}
      {data && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <Metric label={`Usado no ${data.bankName}`} value={money(data.usedCents)} />
            <Metric
              label="Em aberto no Sektor"
              value={money(data.openCents)}
              hint={
                diff !== 0
                  ? `${money(Math.abs(diff))} ${diff > 0 ? 'a menos aqui' : 'a mais aqui'}`
                  : 'Bate com o banco'
              }
            />
          </div>
          <p className="text-xs text-subtle">
            O banco soma a fatura aberta, as fechadas ainda sem pagar e as parcelas que vão cair.
          </p>
          <div>
            <SectionLabel>Faturas fechadas no banco</SectionLabel>
            {data.bills.length === 0 && (
              <p className="text-sm text-muted">O banco não informou faturas fechadas.</p>
            )}
            {data.bills.map((bill) => (
              <div key={bill.dueDate} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">Vence em {shortDate(bill.dueDate)}</p>
                  <p className="text-xs text-subtle">{bankLine(bill)}</p>
                </div>
                {bill.invoice ? (
                  <span className="flex flex-col items-end gap-0.5">
                    <span className="text-sm tabular-nums">{money(bill.invoice.totalCents)}</span>
                    <InvoicePill status={bill.invoice.status as Invoice['status']} />
                  </span>
                ) : (
                  <span className="text-xs text-subtle">Sem fatura aqui</span>
                )}
              </div>
            ))}
            <p className="mt-2 text-xs text-subtle">
              {data.movements.withBill} de {data.movements.total} lançamentos do cartão já vieram com a fatura.
            </p>
          </div>
        </div>
      )}
    </Dialog>
  );
}

const TYPES: AccountType[] = ['CHECKING', 'SAVINGS', 'WALLET', 'CREDIT_CARD'];
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1));

function AccountDialog({ account, onClose }: { account?: Account; onClose(): void }) {
  const accounts = useAccounts();
  const create = useRpcMutation('accounts.create');
  const update = useRpcMutation('accounts.update');
  const [type, setType] = useState<AccountType>(account?.type ?? 'CHECKING');
  const [name, setName] = useState(account?.name ?? '');
  const [color, setColor] = useState<string | null>(account?.color ?? null);
  const [initial, setInitial] = useState<number | null>(account ? account.initialBalanceCents : null);
  const [closingDay, setClosingDay] = useState(String(account?.closingDay ?? ''));
  const [dueDay, setDueDay] = useState(String(account?.dueDay ?? ''));
  const [paymentAccountId, setPaymentAccountId] = useState(account?.paymentAccountId ?? '');

  const isCard = type === 'CREDIT_CARD';
  const payers = accounts.filter((a) => a.type !== 'CREDIT_CARD' && !a.archived && a.id !== account?.id);
  const busy = create.isPending || update.isPending;
  const incomplete = !name.trim() || (isCard && (!closingDay || !dueDay));

  function save() {
    const cardFields = {
      closingDay: isCard ? Number(closingDay) : null,
      dueDay: isCard ? Number(dueDay) : null,
      paymentAccountId: isCard ? paymentAccountId || null : null,
    };
    const done = account
      ? update.mutateAsync({
          id: account.id,
          name: name.trim(),
          color,
          ...(isCard ? {} : { initialBalanceCents: initial ?? 0 }),
          ...cardFields,
        })
      : create.mutateAsync({
          name: name.trim(),
          type,
          color,
          initialBalanceCents: isCard ? 0 : (initial ?? 0),
          ...cardFields,
        });
    done.then(onClose, () => {});
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={account ? 'Editar conta' : 'Nova conta ou cartão'}
    >
      <div className="flex flex-col gap-3">
        <Field label="Tipo">
          <Select
            value={type}
            disabled={Boolean(account)}
            onChange={(event) => setType(event.target.value as AccountType)}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {ACCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nome">
          <Input autoFocus value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
        </Field>
        {!isCard && (
          <Field label="Saldo inicial">
            <MoneyInput value={initial} onChange={setInitial} allowNegative />
          </Field>
        )}
        {isCard && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Dia de fechamento">
                <Select value={closingDay} onChange={(event) => setClosingDay(event.target.value)}>
                  <option value="">Escolher</option>
                  {DAYS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Dia de vencimento">
                <Select value={dueDay} onChange={(event) => setDueDay(event.target.value)}>
                  <option value="">Escolher</option>
                  {DAYS.map((d) => (
                    <option key={d}>{d}</option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Conta que paga">
              <Select value={paymentAccountId} onChange={(event) => setPaymentAccountId(event.target.value)}>
                <option value="">Nenhuma</option>
                {payers.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-subtle">Compras depois do fechamento entram na fatura seguinte.</p>
          </>
        )}
        <Field label="Cor">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Button variant="primary" className="ml-auto" disabled={busy || incomplete} onClick={save}>
          {account ? 'Salvar' : 'Adicionar'}
        </Button>
      </div>
    </Dialog>
  );
}

