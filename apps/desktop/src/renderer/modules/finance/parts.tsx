import { ArrowLeftRight, ChevronLeft, ChevronRight, CreditCard, Search, X } from 'lucide-react';
import { type ComponentProps, createElement, type ReactNode } from 'react';

import { money, monthLabel, shortDate } from '../../lib/format';
import { useRpc, useRpcMutation } from '../../lib/rpc';
import { Button, cn, Dialog, Input, Select } from '../../ui';
import { categoryIconOf } from './category-icons';
import {
  type Account,
  type Category,
  categoryLabel,
  categoryTree,
  installmentLabel,
  INVOICE_STATUS_LABELS,
  type Invoice,
  shiftMonth,
  signedAmount,
  type AccountScope,
  type StatementItem,
  styledCategory,
  type TransactionKind,
} from './utils';

/** O schema só aceita #RRGGBB: estas são dados gravados na conta ou na categoria, não tema. */
export const SWATCHES = [
  '#34c759', '#30b0c7', '#3987e5', '#5856d6', '#af52de', '#d55181',
  '#ff3b30', '#ff9500', '#c98500', '#199e70', '#8e8e93', '#a2845e',
];

export function useAccounts() {
  return useRpc('accounts.list', { archived: true }).data ?? [];
}

export function useCategories() {
  return useRpc('categories.list').data ?? [];
}

export const Skeleton = ({ className }: { className?: string }) => (
  <div className={cn('animate-pulse rounded-control bg-hover', className)} />
);

/** Número principal de um cartão. */
export function Metric({
  label,
  value,
  hint,
  tone,
  size = 'lg',
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'success' | 'danger' | 'warning';
  size?: 'lg' | 'xl';
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          'font-semibold tracking-tight tabular-nums',
          size === 'xl' ? 'text-[34px] leading-tight' : 'text-2xl',
          tone === 'success' && 'text-success',
          tone === 'danger' && 'text-danger',
          tone === 'warning' && 'text-warning'
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </div>
  );
}

export function Pill({
  tone,
  children,
}: {
  tone?: 'success' | 'warning' | 'danger' | 'info';
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium',
        tone === 'success' && 'border-success/30 bg-success/10 text-success',
        tone === 'warning' && 'border-warning/30 bg-warning/10 text-warning',
        tone === 'danger' && 'border-danger/30 bg-danger/10 text-danger',
        tone === 'info' && 'border-info/30 bg-info/10 text-info',
        !tone && 'border-line-strong text-muted'
      )}
    >
      {children}
    </span>
  );
}

const INVOICE_TONES = {
  OPEN: 'info',
  CLOSED: 'warning',
  OVERDUE: 'danger',
  PAID: 'success',
} as const;

export function InvoicePill({ status, future }: { status: Invoice['status']; future?: boolean }) {
  if (future) return <Pill>Futura</Pill>;
  return <Pill tone={INVOICE_TONES[status]}>{INVOICE_STATUS_LABELS[status]}</Pill>;
}

export function invoiceName(invoice: Pick<Invoice, 'referenceMonth'>) {
  return `Fatura de ${monthLabel(invoice.referenceMonth).toLowerCase()}`;
}

/** Círculo na cor da categoria com o ícone dela; transferências são neutras, com setas. */
export function CategoryIcon({
  category,
  categories,
  kind,
}: {
  category?: Category | null;
  categories: Category[];
  kind?: TransactionKind;
}) {
  const styled = styledCategory(category, categories);
  const color = kind !== 'TRANSFER' && styled?.color ? styled.color : 'var(--muted-foreground)';
  return (
    <span
      className="grid size-8 shrink-0 place-items-center rounded-full"
      style={{ color, backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
    >
      {kind === 'TRANSFER' ? (
        <ArrowLeftRight size={15} />
      ) : (
        createElement(categoryIconOf(styled?.icon), { size: 15 })
      )}
    </span>
  );
}

export function accountDot(account: Pick<Account, 'color'>) {
  return account.color ?? 'var(--muted-foreground)';
}

/** Valor digitado como no caixa eletrônico: os dígitos entram pelos centavos. */
export function MoneyInput({
  value,
  onChange,
  allowNegative,
  large,
  tone,
  ...props
}: {
  value: number | null;
  onChange(cents: number | null): void;
  allowNegative?: boolean;
  large?: boolean;
  tone?: string;
} & Omit<ComponentProps<'input'>, 'value' | 'onChange'>) {
  return (
    <Input
      inputMode="numeric"
      placeholder={money(0)}
      value={value === null ? '' : money(value)}
      onChange={(event) => {
        const text = event.target.value;
        const digits = text.replace(/\D/g, '');
        if (!digits) return onChange(null);
        const negative = allowNegative && text.includes('-');
        onChange(Number(digits) * (negative ? -1 : 1));
      }}
      className={cn(large && 'h-14 text-center text-3xl font-semibold tabular-nums', tone)}
      {...props}
    />
  );
}

export function MonthSwitcher({ month, onChange }: { month: string; onChange(m: string): void }) {
  return (
    <div className="inline-flex items-center gap-1">
      <Button variant="ghost" aria-label="Mês anterior" onClick={() => onChange(shiftMonth(month, -1))}>
        <ChevronLeft size={16} />
      </Button>
      <span className="w-36 text-center text-sm font-medium">{monthLabel(month)}</span>
      <Button variant="ghost" aria-label="Próximo mês" onClick={() => onChange(shiftMonth(month, 1))}>
        <ChevronRight size={16} />
      </Button>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-5 w-9 shrink-0 rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-active'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 size-4 rounded-full bg-foreground transition-[left]',
          checked ? 'left-[18px] bg-on-primary' : 'left-0.5'
        )}
      />
    </button>
  );
}

export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange(value: boolean): void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <div>
        <p>{label}</p>
        {hint && <p className="text-xs text-subtle">{hint}</p>}
      </div>
      <Switch label={label} checked={checked} onChange={onChange} />
    </div>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange(value: string): void;
  placeholder: string;
}) {
  return (
    <div className="relative min-w-48 flex-1">
      <Search size={14} className="absolute top-2 left-2.5 text-subtle" />
      <Input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="px-8"
      />
      {value && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => onChange('')}
          className="absolute top-2 right-2.5 text-subtle hover:text-foreground"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function Chips<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange(value: T): void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="flex gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'h-7 rounded-full border px-3 text-xs font-medium transition-colors',
            option.value === value
              ? 'border-primary/40 bg-primary/15 text-primary'
              : 'border-line text-muted hover:text-foreground'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange(color: string | null): void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {SWATCHES.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Cor ${color}`}
          aria-pressed={value === color}
          onClick={() => onChange(value === color ? null : color)}
          className={cn(
            'size-6 rounded-full ring-offset-2 ring-offset-raised',
            value === color && 'ring-2 ring-foreground'
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

/** Seletor de categoria: a mãe e, logo depois, as filhas dela. */
export function CategorySelect({
  value,
  onChange,
  kind,
  categories,
  disabledIds = [],
  placeholder = 'Nenhuma',
  ...props
}: {
  value: string;
  onChange(id: string): void;
  kind: TransactionKind;
  categories: Category[];
  disabledIds?: string[];
  placeholder?: string;
} & Omit<ComponentProps<'select'>, 'value' | 'onChange'>) {
  return (
    <Select value={value} onChange={(event) => onChange(event.target.value)} {...props}>
      <option value="">{placeholder}</option>
      {categoryTree(categories, kind)
        .flatMap(({ parent, children }) => [parent, ...children])
        .map((category) => (
          <option key={category.id} value={category.id} disabled={disabledIds.includes(category.id)}>
            {categoryLabel(category, categories)}
          </option>
        ))}
    </Select>
  );
}

/** Pergunta antes de agir: uma ação por botão, como "só este" e "este e os próximos". */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  actions,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  message?: string;
  actions: { label: string; danger?: boolean; onSelect(): void }[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title}>
      {message && <p className="mb-4 text-sm text-muted">{message}</p>}
      <div className="flex flex-col gap-2">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant={action.danger ? 'danger' : 'secondary'}
            onClick={() => {
              onOpenChange(false);
              action.onSelect();
            }}
          >
            {action.label}
          </Button>
        ))}
        <Button variant="ghost" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
      </div>
    </Dialog>
  );
}

export function amountClass(signed: number, planned: boolean) {
  if (signed > 0) return planned ? 'text-success/70' : 'text-success';
  if (signed < 0) return planned ? 'text-danger/70' : 'text-danger';
  return 'text-muted';
}

/** Linha de um lançamento. É `div`: tem o botão "Pagar" dentro, e botão dentro de botão não vale. */
export function TransactionRow({
  tx,
  accounts,
  categories,
  scope,
  showDate,
  onClick,
  className,
}: {
  tx: StatementItem;
  accounts: Account[];
  categories: Category[];
  scope?: AccountScope;
  showDate?: boolean;
  onClick(): void;
  className?: string;
}) {
  const update = useRpcMutation('transactions.update');
  const category = categories.find((c) => c.id === tx.categoryId) ?? null;
  const account = accounts.find((a) => a.id === tx.accountId);
  const destination = accounts.find((a) => a.id === tx.toAccountId);
  const planned = tx.status === 'PLANNED';
  const signed = signedAmount(tx, scope);
  const subtitle = [
    showDate ? shortDate(tx.date) : null,
    tx.kind === 'TRANSFER'
      ? `${account?.name ?? 'Conta'} → ${destination?.name ?? 'Conta'}`
      : account?.name,
    tx.dueInvoice ? 'Fatura a pagar' : category ? categoryLabel(category, categories) : null,
    installmentLabel(tx),
  ]
    .filter(Boolean)
    .join(' · ');
  const action = tx.kind === 'INCOME' ? 'Receber' : tx.kind === 'TRANSFER' ? 'Efetivar' : 'Pagar';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'group flex h-[52px] w-full cursor-pointer items-center gap-3 rounded-control px-2 text-left hover:bg-hover',
        className
      )}
    >
      {tx.dueInvoice ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-active text-muted">
          <CreditCard size={15} />
        </span>
      ) : (
        <CategoryIcon category={category} categories={categories} kind={tx.kind} />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{tx.description}</p>
        <p className="truncate text-xs text-subtle">{subtitle}</p>
      </div>
      {planned && (
        <>
          <Pill>Previsto</Pill>
          {!tx.dueInvoice && !tx.id.startsWith('fatura:') && (
            <Button
              size="sm"
              className="hidden group-hover:inline-flex"
              disabled={update.isPending}
              onClick={(event) => {
                event.stopPropagation();
                update.mutate({ id: tx.id, status: 'DONE' });
              }}
            >
              {action}
            </Button>
          )}
        </>
      )}
      <span className={cn('shrink-0 text-sm font-medium tabular-nums', amountClass(signed, planned))}>
        {money(signed === 0 ? tx.amountCents : Math.abs(signed))}
      </span>
    </div>
  );
}
