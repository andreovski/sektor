import { CreditCard, Minus, Plus, Repeat } from 'lucide-react';
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { money, todayString } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, cn, Dialog, Field, Input, Segmented, Select } from '../../ui';
import { NoteField } from '../../ui/rich-text';
import {
  CategorySelect,
  ConfirmDialog,
  invoiceName,
  MoneyInput,
  SwitchRow,
  useAccounts,
  useCategories,
} from './parts';
import {
  defaultDone,
  installmentPreview,
  type Repetition,
  REPETITION_OPTIONS,
  repetitionFields,
  type Transaction,
  type TransactionKind,
} from './utils';

type Defaults = Partial<{ kind: TransactionKind; accountId: string; date: string }>;
type Opener = { edit(tx: Transaction): void; create(defaults?: Defaults): void };

const Context = createContext<Opener>({ edit() {}, create() {} });

export const useTransactionDialog = () => useContext(Context);

/** Um diálogo só para todas as abas. Ele remonta a cada abertura, com os dados atuais. */
export function TransactionDialogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ n: number; tx?: Transaction; defaults?: Defaults } | null>(null);
  const opener = useMemo<Opener>(
    () => ({
      edit: (tx) => setState({ n: Date.now(), tx }),
      create: (defaults) => setState({ n: Date.now(), defaults }),
    }),
    []
  );
  return (
    <Context.Provider value={opener}>
      {children}
      {state && (
        <TransactionDialog
          key={state.n}
          transaction={state.tx}
          defaults={state.defaults}
          onClose={() => setState(null)}
        />
      )}
    </Context.Provider>
  );
}

const KINDS: { value: TransactionKind; label: string }[] = [
  { value: 'EXPENSE', label: 'Despesa' },
  { value: 'INCOME', label: 'Receita' },
  { value: 'TRANSFER', label: 'Transferência' },
];

const AMOUNT_TONES: Record<TransactionKind, string> = {
  EXPENSE: 'text-danger',
  INCOME: 'text-success',
  TRANSFER: 'text-foreground',
};

function describeRule(rule: string) {
  if (rule.includes('FREQ=WEEKLY')) return 'Toda semana';
  if (rule.includes('FREQ=MONTHLY')) return 'Todo mês';
  if (rule.includes('FREQ=YEARLY')) return 'Todo ano';
  return 'Repete';
}

type Scope = 'single' | 'future' | 'all';

/** Avisa quando a compra caiu em outra fatura ou quando parcelas pagas ficaram como estavam. */
function noticeAfterSave(saved: { rolledToInvoice?: { referenceMonth: string }; keptInPaidInvoices?: number }[]) {
  const rolled = saved.find((tx) => tx.rolledToInvoice)?.rolledToInvoice;
  if (rolled) toast.info(`Entrou na ${invoiceName(rolled).toLowerCase()}: a do ciclo já estava paga.`);
  noticeKept(saved[0]?.keptInPaidInvoices);
}

function noticeKept(kept = 0) {
  if (kept > 0) toast.info(kept === 1 ? 'A parcela de fatura paga ficou como estava.' : `${kept} parcelas de faturas pagas ficaram como estavam.`);
}

/** Transferência não quita fatura: aqui a pessoa paga a fatura mais antiga em aberto. */
function PayCardHint({
  cardId,
  fromAccount,
  date,
  onPaid,
}: {
  cardId: string;
  fromAccount?: { id: string; type: string };
  date: string;
  onPaid(): void;
}) {
  const invoices = useRpc('accounts.invoices', { id: cardId });
  const pay = useRpcMutation('invoices.pay');
  const oldest = (invoices.data ?? []).filter((i) => i.status !== 'PAID' && i.totalCents > 0).at(-1);
  const fromCard = fromAccount?.type === 'CREDIT_CARD';
  return (
    <div className="flex flex-col gap-2 rounded-control border border-line p-3">
      <p className="flex items-center gap-2 text-sm">
        <CreditCard size={14} className="shrink-0 text-muted" />
        Cartão se paga pela fatura: uma transferência não a quitaria.
      </p>
      {oldest ? (
        <Button
          disabled={pay.isPending || !fromAccount || fromCard}
          onClick={() =>
            pay.mutateAsync({ id: oldest.id, fromAccountId: fromAccount!.id, date }).then(onPaid, () => {})
          }
        >
          Pagar {invoiceName(oldest).toLowerCase()}, {money(oldest.totalCents)}
        </Button>
      ) : (
        <p className="text-xs text-subtle">Este cartão não tem fatura a pagar agora.</p>
      )}
      {oldest && fromCard && (
        <p className="text-xs text-subtle">Escolha em "De" uma conta que não seja cartão.</p>
      )}
    </div>
  );
}

function TransactionDialog({
  transaction,
  defaults,
  onClose,
}: {
  transaction?: Transaction;
  defaults?: Defaults;
  onClose(): void;
}) {
  const today = todayString();
  const allAccounts = useAccounts();
  const categories = useCategories();
  const create = useRpcMutation('transactions.create');
  const update = useRpcMutation('transactions.update');
  const remove = useRpcMutation('transactions.delete');

  const accounts = allAccounts.filter(
    (a) => !a.archived || a.id === transaction?.accountId || a.id === transaction?.toAccountId
  );
  const firstAccount = accounts.find((a) => a.type !== 'CREDIT_CARD') ?? accounts[0];

  const [kind, setKind] = useState<TransactionKind>(transaction?.kind ?? defaults?.kind ?? 'EXPENSE');
  const [amount, setAmount] = useState<number | null>(transaction?.amountCents ?? null);
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? '');
  const [accountId, setAccountId] = useState(transaction?.accountId ?? defaults?.accountId ?? '');
  const [toAccountId, setToAccountId] = useState(transaction?.toAccountId ?? '');
  const [date, setDate] = useState(transaction?.date ?? defaults?.date ?? today);
  const [done, setDone] = useState(
    transaction ? transaction.status === 'DONE' : defaultDone(defaults?.date ?? today, today)
  );
  const [doneTouched, setDoneTouched] = useState(Boolean(transaction));
  const [repetition, setRepetition] = useState<Repetition>('none');
  const [installments, setInstallments] = useState(2);
  // Desligado: o valor digitado é o total. Ligado: é cada parcela.
  const [perInstallment, setPerInstallment] = useState(false);
  const [notes, setNotes] = useState(transaction?.notes ?? '');
  const [pending, setPending] = useState<'save' | 'delete' | null>(null);
  const [error, setError] = useState('');

  const effectiveAccount = accountId || firstAccount?.id || '';
  const recurring = Boolean(transaction?.recurrenceId);
  const parcelled = Boolean(transaction?.installmentGroupId);
  const onCard = accounts.find((a) => a.id === effectiveAccount)?.type === 'CREDIT_CARD';
  const toCard = accounts.find((a) => a.id === toAccountId)?.type === 'CREDIT_CARD';
  // Pagamento já feito e transferência antiga continuam editáveis.
  const blockedCardTransfer = kind === 'TRANSFER' && toCard && toAccountId !== transaction?.toAccountId;
  const busy = create.isPending || update.isPending || remove.isPending;
  const isInstallments = repetition === 'installments';
  const valueIsPart = isInstallments && perInstallment;
  const totalCents = (amount ?? 0) * (valueIsPart ? installments : 1);
  const doneLabel = kind === 'INCOME' ? 'Recebido' : kind === 'TRANSFER' ? 'Efetivada' : 'Pago';

  function problem() {
    if (!amount || amount <= 0) return 'Informe o valor.';
    if (!description.trim()) return 'Informe a descrição.';
    if (!effectiveAccount) return 'Crie uma conta antes de lançar.';
    if (kind === 'TRANSFER' && (!toAccountId || toAccountId === effectiveAccount))
      return 'Escolha a conta de destino.';
    if (blockedCardTransfer) return 'Para pagar o cartão, use "Pagar fatura".';
    return '';
  }

  // Erro da mutação já vira toast; aqui só não fechamos o diálogo.
  async function save(scope: Scope = 'single') {
    const fields = {
      amountCents: totalCents,
      description: description.trim(),
      accountId: effectiveAccount,
      toAccountId: kind === 'TRANSFER' ? toAccountId : null,
      categoryId: kind === 'TRANSFER' ? null : categoryId || null,
      date,
      notes: notes.trim() || null,
      status: done ? ('DONE' as const) : ('PLANNED' as const),
    };
    noticeAfterSave(
      transaction
        ? [await update.mutateAsync({ id: transaction.id, ...fields, scope })]
        : await create.mutateAsync({ kind, ...fields, ...repetitionFields(repetition, installments) })
    );
    onClose();
  }

  async function destroy(scope: Scope = 'single') {
    const { keptInPaidInvoices } = await remove.mutateAsync({ id: transaction!.id, scope });
    noticeKept(keptInPaidInvoices);
    onClose();
  }

  function confirm() {
    const message = problem();
    setError(message);
    if (message || busy) return;
    if (recurring || parcelled) setPending('save');
    else save().catch(() => {});
  }

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => !open && onClose()}
        title={transaction ? 'Editar lançamento' : 'Novo lançamento'}
      >
        <div className="flex flex-col gap-3">
          {transaction ? (
            <p className="text-center text-xs text-muted">
              {KINDS.find((k) => k.value === kind)?.label}
            </p>
          ) : (
            <div className="flex justify-center">
              <Segmented
                value={kind}
                options={KINDS}
                onChange={(value) => {
                  setKind(value);
                  setCategoryId('');
                }}
              />
            </div>
          )}
          <MoneyInput
            aria-label="Valor"
            large
            tone={AMOUNT_TONES[kind]}
            value={amount}
            onChange={setAmount}
            autoFocus={!transaction}
          />
          {valueIsPart && amount ? (
            <p className="-mt-1 text-center text-xs text-muted">
              Total {money(totalCents)} em {installments}×
            </p>
          ) : null}
          <Field label="Descrição">
            <Input
              value={description}
              maxLength={120}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {kind !== 'TRANSFER' && (
              <Field label="Categoria">
                <CategorySelect
                  value={categoryId}
                  onChange={setCategoryId}
                  kind={kind}
                  categories={categories}
                />
              </Field>
            )}
            <Field label={kind === 'TRANSFER' ? 'De' : 'Conta'}>
              <Select
                value={effectiveAccount}
                onChange={(event) => {
                  setAccountId(event.target.value);
                  if (event.target.value === toAccountId) setToAccountId('');
                }}
              >
                {accounts.length === 0 && <option value="">Nenhuma conta</option>}
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            {kind === 'TRANSFER' && (
              <Field label="Para">
                <Select value={toAccountId} onChange={(event) => setToAccountId(event.target.value)}>
                  <option value="">Escolher</option>
                  {accounts
                    .filter((a) => a.id !== effectiveAccount)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
            <Field label="Data">
              <Input
                type="date"
                required
                value={date}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!value) return;
                  setDate(value);
                  if (!doneTouched) setDone(defaultDone(value, today));
                }}
              />
            </Field>
          </div>
          {blockedCardTransfer && (
            <PayCardHint
              cardId={toAccountId}
              fromAccount={accounts.find((a) => a.id === effectiveAccount)}
              date={date}
              onPaid={onClose}
            />
          )}
          {onCard ? (
            <p className="text-xs text-subtle">No cartão, o lançamento entra direto na fatura.</p>
          ) : (
            <SwitchRow
              label={doneLabel}
              hint="Efetivada entra no saldo; prevista só na previsão."
              checked={done}
              onChange={(value) => {
                setDone(value);
                setDoneTouched(true);
              }}
            />
          )}
          {!transaction && (
            <Field label="Repetição">
              <Select
                value={repetition}
                onChange={(event) => setRepetition(event.target.value as Repetition)}
              >
                {REPETITION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {!transaction && repetition !== 'none' && !isInstallments && (
            <p className="text-xs text-subtle">Os próximos 12 meses entram como previstos.</p>
          )}
          {isInstallments && (
            <div className="flex flex-col gap-3 rounded-control border border-line p-3">
              <div className="flex items-center justify-between text-sm">
                Parcelas
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    aria-label="Menos parcelas"
                    disabled={installments <= 2}
                    onClick={() => setInstallments(installments - 1)}
                  >
                    <Minus size={14} />
                  </Button>
                  <span className="w-8 text-center tabular-nums">{installments}×</span>
                  <Button
                    size="sm"
                    aria-label="Mais parcelas"
                    disabled={installments >= 72}
                    onClick={() => setInstallments(installments + 1)}
                  >
                    <Plus size={14} />
                  </Button>
                </div>
              </div>
              <SwitchRow
                label="Utilizar valor como parcela"
                hint={
                  perInstallment
                    ? 'O valor digitado é cada parcela; uma cai por mês.'
                    : 'O valor digitado é o total; uma parcela cai por mês.'
                }
                checked={perInstallment}
                onChange={setPerInstallment}
              />
              {!perInstallment && amount ? (
                <p className="flex justify-between text-sm text-muted">
                  Cada parcela
                  <span className="font-medium text-foreground tabular-nums">
                    {installmentPreview(amount, installments)}
                  </span>
                </p>
              ) : null}
            </div>
          )}
          {transaction?.recurrenceRule && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Repeat size={14} /> {describeRule(transaction.recurrenceRule)}
            </p>
          )}
          <NoteField label="Notas" rows={2} value={notes} onChange={setNotes} />
          {error && <p className={cn('text-sm text-danger')}>{error}</p>}
          <div className="flex items-center gap-2">
            {transaction && (
              <Button
                variant="danger"
                disabled={busy}
                onClick={() =>
                  recurring || parcelled ? setPending('delete') : destroy().catch(() => {})
                }
              >
                Apagar
              </Button>
            )}
            <Button variant="primary" className="ml-auto" disabled={busy} onClick={confirm}>
              {transaction ? 'Salvar' : 'Adicionar'}
            </Button>
          </div>
        </div>
      </Dialog>
      <ConfirmDialog
        open={pending === 'save'}
        onOpenChange={(open) => !open && setPending(null)}
        title={parcelled ? `Parcela ${transaction?.installmentNumber} de ${transaction?.installmentTotal}` : 'Este lançamento se repete'}
        message={parcelled ? 'Parcela de fatura paga fica como está.' : undefined}
        actions={
          parcelled
            ? [
                { label: 'Só esta', onSelect: () => save('single').catch(() => {}) },
                { label: 'Esta e as seguintes', onSelect: () => save('future').catch(() => {}) },
                { label: 'Todas', onSelect: () => save('all').catch(() => {}) },
              ]
            : [
                { label: 'Só este', onSelect: () => save('single').catch(() => {}) },
                { label: 'Este e os próximos', onSelect: () => save('future').catch(() => {}) },
              ]
        }
      />
      <ConfirmDialog
        open={pending === 'delete'}
        onOpenChange={(open) => !open && setPending(null)}
        title={parcelled ? `Parcela ${transaction?.installmentNumber} de ${transaction?.installmentTotal}` : 'Este lançamento se repete'}
        message={parcelled ? 'Parcela de fatura paga fica como está.' : undefined}
        actions={
          parcelled
            ? [
                { label: 'Apagar só esta', danger: true, onSelect: () => destroy('single').catch(() => {}) },
                { label: 'Apagar esta e as seguintes', danger: true, onSelect: () => destroy('future').catch(() => {}) },
                { label: 'Apagar todas', danger: true, onSelect: () => destroy('all').catch(() => {}) },
              ]
            : [
                { label: 'Apagar só este', danger: true, onSelect: () => destroy('single').catch(() => {}) },
                {
                  label: 'Apagar este e os próximos',
                  danger: true,
                  onSelect: () => destroy('future').catch(() => {}),
                },
              ]
        }
      />
    </>
  );
}
